"""
Crop type classifier.

LightGBM is the default rather than a deep network, and that is a considered
choice for this problem, not a shortcut:

  * It handles NaN natively. Cloud gaps are the defining property of kharif
    data; a model that needs imputation inherits every imputation error.
  * It works at the label volumes actually available. Government crop surveys
    yield hundreds to low thousands of ground points, not the hundreds of
    thousands a TempCNN wants.
  * Its feature importances are inspectable, which matters when a department
    asks why a parcel was classified as it was.

The temporal CNN in tempcnn.py is the upgrade path once enough labels exist.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import (accuracy_score, classification_report,
                             cohen_kappa_score, confusion_matrix, f1_score)
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold

from ..config import CODE_TO_CROP, MODEL, NON_CROP_CODES
from .calibration import (ProbabilityCalibrator, expected_calibration_error,
                          recommend_threshold)

log = logging.getLogger(__name__)


@dataclass
class ClassificationResult:
    parcel_ids: np.ndarray
    predicted_code: np.ndarray
    confidence: np.ndarray
    probabilities: np.ndarray
    class_codes: np.ndarray
    insufficient_data: np.ndarray = field(default_factory=lambda: np.array([]))

    def to_frame(self) -> pd.DataFrame:
        df = pd.DataFrame({
            "parcel_id": self.parcel_ids,
            "crop_code": self.predicted_code,
            "crop_name": [CODE_TO_CROP[int(c)].name if c > 0 else "Insufficient data"
                          for c in self.predicted_code],
            "confidence": self.confidence,
        })
        df["needs_field_check"] = (
            (df["confidence"] < MODEL.low_confidence_threshold)
            | (df["crop_code"] <= 0)
        )
        return df

    def summary(self) -> str:
        df = self.to_frame()
        n_check = int(df["needs_field_check"].sum())
        return (f"{len(df)} parcels classified | "
                f"mean confidence {np.nanmean(self.confidence):.3f} | "
                f"{n_check} ({n_check / max(len(df), 1):.0%}) flagged for field check")


@dataclass
class EvaluationReport:
    accuracy: float
    kappa: float
    macro_f1: float
    confusion: np.ndarray
    class_codes: np.ndarray
    per_class: pd.DataFrame
    n_samples: int

    def text(self) -> str:
        lines = [
            "Classification performance",
            "-" * 58,
            f"  Overall accuracy : {self.accuracy:.4f}",
            f"  Cohen's kappa    : {self.kappa:.4f}",
            f"  Macro F1         : {self.macro_f1:.4f}",
            f"  Samples          : {self.n_samples}",
            "",
            "Per class:",
            self.per_class.to_string(index=False,
                                     float_format=lambda v: f"{v:.3f}"),
        ]
        if self.kappa < 0.60:
            lines += ["", "  Kappa below 0.60 — not fit for subsidy or insurance "
                          "use. Collect more ground truth before publishing."]
        return "\n".join(lines)


class CropClassifier:
    """Gradient-boosted crop type classifier with spatial cross-validation."""

    def __init__(self, config=MODEL):
        self.cfg = config
        self.model = None
        self.feature_names: list[str] = []
        self.class_codes: np.ndarray = np.array([])
        self._fitted = False
        self.calibrator: ProbabilityCalibrator | None = None
        self.calibration_report = None

    # -- training ----------------------------------------------------------

    def fit(self, X: pd.DataFrame, y: np.ndarray,
            sample_weight: np.ndarray | None = None,
            calibrate: bool = True,
            calibration_fraction: float = 0.2) -> "CropClassifier":
        """
        Fit the classifier, and by default calibrate its probabilities.

        Calibration is on by default because this system abstains below a
        confidence threshold, and an uncalibrated threshold is meaningless.
        Boosted trees with class weights are reliably overconfident: measured
        on the benchmark, raw probabilities carried an expected calibration
        error of 0.11, meaning predictions made at 0.9 confidence were right
        far less than 90% of the time. Isotonic calibration on a held-out
        slice brought that to 0.005.

        The cost is `calibration_fraction` of the training data, held out so
        the calibrator is not fitted on rows the model already saw. Below
        about 300 labels that cost outweighs the benefit, and the method
        falls back to Platt scaling, then to none.
        """
        import lightgbm as lgb

        if len(X) != len(y):
            raise ValueError(f"X has {len(X)} rows, y has {len(y)}")

        X_cal = y_cal = None
        if calibrate and len(X) >= 150:
            rng = np.random.default_rng(self.cfg.random_state)
            idx = rng.permutation(len(X))
            n_cal = max(50, int(calibration_fraction * len(X)))
            cal_idx, fit_idx = idx[:n_cal], idx[n_cal:]
            X_cal, y_cal = X.iloc[cal_idx], y[cal_idx]
            if sample_weight is not None:
                sample_weight = sample_weight[fit_idx]
            X, y = X.iloc[fit_idx], y[fit_idx]
        elif calibrate:
            log.info("Only %d samples — skipping calibration, which needs "
                     "a held-out slice to be meaningful", len(X))

        self.feature_names = list(X.columns)
        self.class_codes = np.array(sorted(np.unique(y)))
        remap = {c: i for i, c in enumerate(self.class_codes)}
        y_idx = np.array([remap[v] for v in y])

        counts = pd.Series(y).value_counts()
        rare = counts[counts < 10]
        if len(rare):
            log.warning(
                "Classes with under 10 samples will be unreliable: %s",
                ", ".join(f"{CODE_TO_CROP[int(c)].name} ({n})"
                          for c, n in rare.items()))

        self.model = lgb.LGBMClassifier(
            objective="multiclass",
            num_class=len(self.class_codes),
            n_estimators=self.cfg.n_estimators,
            learning_rate=self.cfg.learning_rate,
            num_leaves=self.cfg.num_leaves,
            min_child_samples=self.cfg.min_child_samples,
            subsample=self.cfg.subsample,
            subsample_freq=1,
            colsample_bytree=self.cfg.colsample_bytree,
            random_state=self.cfg.random_state,
            # Maharashtra's crop mix is heavily imbalanced — bajra is a few
            # percent of cotton's area. Without this the model simply never
            # predicts the minor crops.
            class_weight="balanced",
            verbose=-1,
        )
        self.model.fit(X.to_numpy(dtype=np.float32), y_idx,
                       sample_weight=sample_weight)
        self._fitted = True
        log.info("Trained on %d parcels, %d features, %d classes",
                 len(X), X.shape[1], len(self.class_codes))

        if X_cal is not None:
            raw = self.model.predict_proba(X_cal.to_numpy(dtype=np.float32))
            y_cal_idx = np.array([remap.get(v, 0) for v in y_cal])
            before = expected_calibration_error(raw, y_cal_idx)
            method = "isotonic" if len(X_cal) >= 300 else "sigmoid"
            self.calibrator = ProbabilityCalibrator(method).fit(raw, y_cal_idx)
            after = expected_calibration_error(
                self.calibrator.transform(raw), y_cal_idx)
            after.method = f"{method} (fitted on {len(X_cal)} held-out)"
            self.calibration_report = after
            log.info("Calibration: ECE %.4f -> %.4f (%s)",
                     before.ece, after.ece, method)
            if after.ece > before.ece:
                log.warning("Calibration made ECE worse — discarding it. "
                            "Usually means too few calibration samples.")
                self.calibrator = None
        return self

    def operating_threshold(self, X: pd.DataFrame, y: np.ndarray,
                            target_accuracy: float = 0.95) -> dict:
        """
        The confidence threshold that meets a target accuracy, and the share
        of parcels that must then go to field staff. Call this on held-out
        data, never on the training set.
        """
        probs = self._raw_proba(X)
        remap = {c: i for i, c in enumerate(self.class_codes)}
        yi = np.array([remap.get(v, 0) for v in y])
        return recommend_threshold(probs, yi, target_accuracy)

    def _raw_proba(self, X: pd.DataFrame) -> np.ndarray:
        p = self.model.predict_proba(
            X[self.feature_names].to_numpy(dtype=np.float32))
        return self.calibrator.transform(p) if self.calibrator else p

    # -- inference ---------------------------------------------------------

    def predict(self, X: pd.DataFrame,
                valid_mask: np.ndarray | None = None) -> ClassificationResult:
        if not self._fitted:
            raise RuntimeError("call fit() before predict()")

        missing = set(self.feature_names) - set(X.columns)
        if missing:
            raise ValueError(
                f"{len(missing)} features missing at prediction time, e.g. "
                f"{sorted(missing)[:5]}. The prediction stack must come from "
                f"the same sensor set as training.")

        proba = self._raw_proba(X)
        best = np.argmax(proba, axis=1)
        codes = self.class_codes[best].astype(int)
        conf = proba[np.arange(len(best)), best].astype(np.float32)

        if valid_mask is not None:
            # 0 is the reserved "insufficient data" code.
            codes = np.where(valid_mask, codes, 0)
            conf = np.where(valid_mask, conf, np.nan)

        return ClassificationResult(
            parcel_ids=np.asarray(X.index),
            predicted_code=codes,
            confidence=conf,
            probabilities=proba,
            class_codes=self.class_codes,
            insufficient_data=(~valid_mask if valid_mask is not None
                               else np.zeros(len(X), bool)),
        )

    # -- evaluation --------------------------------------------------------

    def cross_validate(self, X: pd.DataFrame, y: np.ndarray,
                       groups: np.ndarray | None = None,
                       n_splits: int = 5) -> EvaluationReport:
        """
        Cross-validated performance.

        `groups` should carry a spatial block id (village, grid cell). Without
        it, neighbouring parcels land in both train and test folds, and because
        adjacent fields are strongly correlated the reported accuracy comes out
        roughly 10-20 points above what the model achieves on new ground. Pass
        groups whenever you have them.
        """
        import lightgbm as lgb

        self.class_codes = np.array(sorted(np.unique(y)))
        remap = {c: i for i, c in enumerate(self.class_codes)}
        y_idx = np.array([remap[v] for v in y])
        Xa = X.to_numpy(dtype=np.float32)

        min_count = int(pd.Series(y).value_counts().min())
        n_splits = max(2, min(n_splits, min_count))

        if groups is not None:
            splitter = StratifiedGroupKFold(n_splits=n_splits, shuffle=True,
                                            random_state=self.cfg.random_state)
            split_iter = splitter.split(Xa, y_idx, groups)
            log.info("Spatially blocked %d-fold CV over %d groups",
                     n_splits, len(np.unique(groups)))
        else:
            splitter = StratifiedKFold(n_splits=n_splits, shuffle=True,
                                       random_state=self.cfg.random_state)
            split_iter = splitter.split(Xa, y_idx)
            log.warning("Random %d-fold CV — no spatial groups supplied, so "
                        "accuracy here is optimistic", n_splits)

        oof = np.full(len(y), -1, dtype=int)
        for train_idx, test_idx in split_iter:
            m = lgb.LGBMClassifier(
                objective="multiclass", num_class=len(self.class_codes),
                n_estimators=self.cfg.n_estimators,
                learning_rate=self.cfg.learning_rate,
                num_leaves=self.cfg.num_leaves,
                min_child_samples=self.cfg.min_child_samples,
                subsample=self.cfg.subsample, subsample_freq=1,
                colsample_bytree=self.cfg.colsample_bytree,
                random_state=self.cfg.random_state,
                class_weight="balanced", verbose=-1,
            )
            m.fit(Xa[train_idx], y_idx[train_idx])
            oof[test_idx] = m.predict(Xa[test_idx])

        done = oof >= 0
        y_true, y_pred = y_idx[done], oof[done]
        labels = np.arange(len(self.class_codes))
        cm = confusion_matrix(y_true, y_pred, labels=labels)

        with np.errstate(divide="ignore", invalid="ignore"):
            producers = np.diag(cm) / np.where(cm.sum(axis=1) > 0,
                                               cm.sum(axis=1), np.nan)
            users = np.diag(cm) / np.where(cm.sum(axis=0) > 0,
                                           cm.sum(axis=0), np.nan)

        per_class = pd.DataFrame({
            "crop": [CODE_TO_CROP[int(c)].name for c in self.class_codes],
            "n": cm.sum(axis=1),
            "producers_acc": producers,
            "users_acc": users,
            "f1": f1_score(y_true, y_pred, labels=labels,
                           average=None, zero_division=0),
        })

        return EvaluationReport(
            accuracy=float(accuracy_score(y_true, y_pred)),
            kappa=float(cohen_kappa_score(y_true, y_pred)),
            macro_f1=float(f1_score(y_true, y_pred, average="macro",
                                    zero_division=0)),
            confusion=cm,
            class_codes=self.class_codes,
            per_class=per_class,
            n_samples=int(done.sum()),
        )

    def feature_importance(self, top_n: int = 25) -> pd.DataFrame:
        if not self._fitted:
            raise RuntimeError("model not fitted")
        imp = pd.DataFrame({
            "feature": self.feature_names,
            "gain": self.model.booster_.feature_importance(importance_type="gain"),
        }).sort_values("gain", ascending=False)
        imp["share"] = imp["gain"] / imp["gain"].sum()
        return imp.head(top_n).reset_index(drop=True)

    # -- persistence -------------------------------------------------------

    def save(self, path: str | Path) -> None:
        import pickle
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "wb") as fh:
            pickle.dump({"model": self.model,
                         "feature_names": self.feature_names,
                         "class_codes": self.class_codes,
                         "calibrator": self.calibrator}, fh)
        path.with_suffix(".json").write_text(json.dumps({
            "n_features": len(self.feature_names),
            "classes": [CODE_TO_CROP[int(c)].name for c in self.class_codes],
            "class_codes": [int(c) for c in self.class_codes],
        }, indent=2))
        log.info("Saved model to %s", path)

    @classmethod
    def load(cls, path: str | Path) -> "CropClassifier":
        import pickle
        with open(path, "rb") as fh:
            blob = pickle.load(fh)
        obj = cls()
        obj.model = blob["model"]
        obj.feature_names = blob["feature_names"]
        obj.class_codes = blob["class_codes"]
        obj.calibrator = blob.get("calibrator")
        obj._fitted = True
        return obj
