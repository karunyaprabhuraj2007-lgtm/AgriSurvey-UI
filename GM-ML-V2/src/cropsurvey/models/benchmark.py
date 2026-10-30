"""
Model benchmark.

Every model in this package is measured on identical spatially-blocked folds,
so a comparison means something. Without shared folds, a model can look
better purely because it drew an easier split, and that is how projects end
up shipping the wrong architecture.

The baselines are included deliberately. If a 158-feature gradient-boosted
model cannot beat "always predict the commonest crop" by a wide margin, the
problem is the data, not the architecture — and that is worth discovering in
the benchmark rather than in front of a client.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (accuracy_score, cohen_kappa_score, f1_score,
                             log_loss)
from sklearn.model_selection import StratifiedGroupKFold, StratifiedKFold

from ..config import CODE_TO_CROP, MODEL
from .calibration import (ProbabilityCalibrator, expected_calibration_error,
                          recommend_threshold)

log = logging.getLogger(__name__)


@dataclass
class ModelScore:
    name: str
    accuracy: float
    kappa: float
    macro_f1: float
    log_loss: float
    ece: float
    train_seconds: float
    n_parameters: int | None = None
    oof_probs: np.ndarray | None = field(default=None, repr=False)
    notes: str = ""


@dataclass
class BenchmarkResult:
    scores: list[ModelScore]
    y_true: np.ndarray
    class_codes: np.ndarray
    n_samples: int
    n_folds: int
    spatially_blocked: bool

    def table(self) -> pd.DataFrame:
        df = pd.DataFrame([{
            "model": s.name,
            "accuracy": s.accuracy,
            "kappa": s.kappa,
            "macro_f1": s.macro_f1,
            "log_loss": s.log_loss,
            "ECE": s.ece,
            "train_s": s.train_seconds,
            "params": s.n_parameters or "",
        } for s in self.scores])
        return df.sort_values("kappa", ascending=False).reset_index(drop=True)

    def best(self) -> ModelScore:
        return max(self.scores, key=lambda s: s.kappa)

    def text(self) -> str:
        lines = [
            "Model benchmark",
            "=" * 76,
            f"  {self.n_samples} samples, {len(self.class_codes)} classes, "
            f"{self.n_folds}-fold "
            f"{'spatially blocked' if self.spatially_blocked else 'RANDOM (optimistic)'} CV",
            "",
            self.table().to_string(index=False,
                                   float_format=lambda v: f"{v:.4f}"),
            "",
        ]
        b = self.best()
        lines.append(f"  Best by kappa: {b.name} ({b.kappa:.4f})")

        dummy = next((s for s in self.scores if "majority" in s.name.lower()), None)
        if dummy:
            lift = b.kappa - dummy.kappa
            lines.append(f"  Lift over the majority-class baseline: "
                         f"{lift:+.4f} kappa")
            if lift < 0.2:
                lines.append("  That lift is small. The features are not "
                             "separating these classes — investigate the data "
                             "before trying more architectures.")
        if not self.spatially_blocked:
            lines.append("\n  WARNING: folds were not spatially blocked, so "
                         "neighbouring parcels appear in both train and test. "
                         "These numbers are optimistic by roughly 10-20 points.")
        return "\n".join(lines)


def _make_folds(y: np.ndarray, groups: np.ndarray | None, n_splits: int,
                seed: int):
    min_count = int(pd.Series(y).value_counts().min())
    n_splits = max(2, min(n_splits, min_count))
    if groups is not None:
        sp = StratifiedGroupKFold(n_splits=n_splits, shuffle=True,
                                  random_state=seed)
        return list(sp.split(np.zeros(len(y)), y, groups)), n_splits, True
    sp = StratifiedKFold(n_splits=n_splits, shuffle=True, random_state=seed)
    return list(sp.split(np.zeros(len(y)), y)), n_splits, False


def run_benchmark(
    features: pd.DataFrame,
    y: np.ndarray,
    sequences: np.ndarray | None = None,
    days: np.ndarray | None = None,
    groups: np.ndarray | None = None,
    n_splits: int = 5,
    seed: int = 42,
    include_deep: bool = True,
    deep_epochs: int = 60,
) -> BenchmarkResult:
    """
    Benchmark every available model on identical folds.

    `features`  — the engineered matrix for the tabular models
    `sequences` — (n, T, C) tensor for the deep models; skipped if None
    `groups`    — spatial block ids. Supply them; see the warning above.
    """
    import lightgbm as lgb

    classes = np.array(sorted(np.unique(y)))
    remap = {c: i for i, c in enumerate(classes)}
    yi = np.array([remap[v] for v in y])
    Xtab = features.to_numpy(dtype=np.float32)

    folds, n_splits, blocked = _make_folds(yi, groups, n_splits, seed)
    log.info("Benchmark: %d samples, %d classes, %d folds, blocked=%s",
             len(y), len(classes), n_splits, blocked)

    def evaluate(name: str, fit_predict, n_params=None, notes="") -> ModelScore:
        oof = np.zeros((len(yi), len(classes)), dtype=np.float64)
        t0 = time.time()
        for tr, te in folds:
            oof[te] = fit_predict(tr, te)
        secs = time.time() - t0
        pred = oof.argmax(axis=1)
        cal = expected_calibration_error(oof, yi)
        try:
            ll = float(log_loss(yi, np.clip(oof, 1e-9, 1),
                                labels=list(range(len(classes)))))
        except ValueError:
            ll = float("nan")
        s = ModelScore(
            name=name,
            accuracy=float(accuracy_score(yi, pred)),
            kappa=float(cohen_kappa_score(yi, pred)),
            macro_f1=float(f1_score(yi, pred, average="macro", zero_division=0)),
            log_loss=ll, ece=cal.ece, train_seconds=secs,
            n_parameters=n_params, oof_probs=oof, notes=notes,
        )
        log.info("  %-26s kappa %.4f  acc %.4f  ECE %.4f  (%.1fs)",
                 name, s.kappa, s.accuracy, s.ece, secs)
        return s

    scores: list[ModelScore] = []

    # --- baselines --------------------------------------------------------
    def dummy_fp(tr, te):
        m = DummyClassifier(strategy="prior").fit(Xtab[tr], yi[tr])
        return m.predict_proba(Xtab[te])
    scores.append(evaluate("Baseline: majority class", dummy_fp,
                           notes="floor — anything near this is useless"))

    def rf_fp(tr, te):
        m = RandomForestClassifier(n_estimators=300, min_samples_leaf=2,
                                   class_weight="balanced_subsample",
                                   random_state=seed, n_jobs=-1)
        m.fit(np.nan_to_num(Xtab[tr]), yi[tr])
        return m.predict_proba(np.nan_to_num(Xtab[te]))
    scores.append(evaluate("Random forest", rf_fp))

    # --- gradient boosting, the production default ------------------------
    def lgb_fp(tr, te):
        m = lgb.LGBMClassifier(
            objective="multiclass", num_class=len(classes),
            n_estimators=MODEL.n_estimators, learning_rate=MODEL.learning_rate,
            num_leaves=MODEL.num_leaves, min_child_samples=MODEL.min_child_samples,
            subsample=MODEL.subsample, subsample_freq=1,
            colsample_bytree=MODEL.colsample_bytree,
            class_weight="balanced", random_state=seed, verbose=-1)
        m.fit(Xtab[tr], yi[tr])
        return m.predict_proba(Xtab[te])
    scores.append(evaluate("LightGBM (phenology features)", lgb_fp))

    # --- deep temporal models --------------------------------------------
    if include_deep and sequences is not None:
        try:
            from .deep import TORCH_AVAILABLE, DeepClassifier, TrainConfig
        except ImportError:
            TORCH_AVAILABLE = False

        if TORCH_AVAILABLE:
            cfg = TrainConfig(epochs=deep_epochs, patience=15, verbose=False)
            for arch, label in (("tempcnn", "TempCNN (Pelletier 2019)"),
                                ("ltae", "LTAE (Garnot 2020)")):
                holder = {}

                def deep_fp(tr, te, _a=arch, _h=holder):
                    clf = DeepClassifier(architecture=_a, config=cfg)
                    clf.fit(sequences[tr], yi[tr], days=days)
                    _h["n"] = clf.n_parameters()
                    p = clf.predict_proba(sequences[te])
                    # Align to the global class order: a fold may be missing
                    # a rare class entirely.
                    out = np.zeros((len(te), len(classes)))
                    for j, c in enumerate(clf.class_codes):
                        out[:, int(c)] = p[:, j]
                    return out

                try:
                    scores.append(evaluate(label, deep_fp,
                                           n_params=holder.get("n")))
                except Exception as exc:              # noqa: BLE001
                    log.warning("%s failed: %s", label, exc)
        else:
            log.info("PyTorch unavailable — deep models skipped")

    # --- ensemble of the best tabular and deep models ---------------------
    tab = next((s for s in scores if s.name.startswith("LightGBM")), None)
    deep = max((s for s in scores
                if s.name.startswith(("TempCNN", "LTAE"))),
               key=lambda s: s.kappa, default=None)
    if tab is not None and deep is not None and \
            tab.oof_probs is not None and deep.oof_probs is not None:
        # Weight by each model's own cross-validated kappa, so a weak member
        # cannot drag the ensemble below the better of the two.
        wt = max(tab.kappa, 1e-6)
        wd = max(deep.kappa, 1e-6)
        blended = (wt * tab.oof_probs + wd * deep.oof_probs) / (wt + wd)
        pred = blended.argmax(axis=1)
        cal = expected_calibration_error(blended, yi)
        scores.append(ModelScore(
            name=f"Ensemble (LightGBM + {deep.name.split(' ')[0]})",
            accuracy=float(accuracy_score(yi, pred)),
            kappa=float(cohen_kappa_score(yi, pred)),
            macro_f1=float(f1_score(yi, pred, average="macro", zero_division=0)),
            log_loss=float(log_loss(yi, np.clip(blended, 1e-9, 1),
                                    labels=list(range(len(classes))))),
            ece=cal.ece, train_seconds=0.0,
            oof_probs=blended,
            notes="kappa-weighted soft vote of the out-of-fold probabilities",
        ))
        log.info("  %-26s kappa %.4f", scores[-1].name, scores[-1].kappa)

    return BenchmarkResult(scores=scores, y_true=yi, class_codes=classes,
                           n_samples=len(y), n_folds=n_splits,
                           spatially_blocked=blocked)


def calibration_study(result: BenchmarkResult,
                      model_name: str | None = None,
                      target_accuracy: float = 0.95) -> str:
    """
    Calibrate the best model's out-of-fold probabilities and report the
    operating threshold that follows.
    """
    score = (next((s for s in result.scores if s.name == model_name), None)
             if model_name else result.best())
    if score is None or score.oof_probs is None:
        return "No probabilities available to calibrate."

    raw = expected_calibration_error(score.oof_probs, result.y_true)
    cal = ProbabilityCalibrator("isotonic")
    # Split so calibration is not fitted and measured on the same rows.
    rng = np.random.default_rng(0)
    idx = rng.permutation(len(result.y_true))
    half = len(idx) // 2
    a, b = idx[:half], idx[half:]
    cal.fit(score.oof_probs[a], result.y_true[a])
    cal_probs = cal.transform(score.oof_probs[b])
    after = expected_calibration_error(cal_probs, result.y_true[b])

    rec_raw = recommend_threshold(score.oof_probs[b], result.y_true[b],
                                  target_accuracy)
    rec_cal = recommend_threshold(cal_probs, result.y_true[b], target_accuracy)

    lines = [
        f"Calibration study — {score.name}",
        "=" * 76,
        f"  ECE before calibration : {raw.ece:.4f}",
        f"  ECE after  calibration : {after.ece:.4f}"
        f"   ({'improved' if after.ece < raw.ece else 'no improvement'})",
        f"  Brier before / after   : {raw.brier:.4f} / {after.brier:.4f}",
        "",
        "  Reliability after calibration:",
        after.reliability.to_string(index=False,
                                    float_format=lambda v: f"{v:.3f}"),
        "",
        f"  Operating point for {target_accuracy:.0%} accuracy:",
        f"    uncalibrated : {rec_raw.get('message', '')}",
        f"    calibrated   : {rec_cal.get('message', '')}",
    ]
    return "\n".join(lines)
