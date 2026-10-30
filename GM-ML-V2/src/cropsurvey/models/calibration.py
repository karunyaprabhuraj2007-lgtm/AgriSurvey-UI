"""
Probability calibration and uncertainty.

This is the most under-appreciated part of the whole model, and for this
system it is load-bearing.

The pipeline abstains below a confidence threshold and sends those parcels to
a field officer. That rule is only as good as the confidence number. An
uncalibrated classifier that says 0.85 when it is right 60% of the time will
wave through a third of its errors, and a department paying subsidies on the
output will not find out until an audit. Gradient boosting with class weights
is systematically overconfident, so the raw probability is not usable as a
decision threshold without correction.

What this module provides:

  * **Isotonic / Platt calibration** fitted on held-out data
  * **Expected Calibration Error** and a reliability table to measure it
  * **Selective prediction** — the accuracy/coverage trade-off, which is the
    curve that actually sets the abstain threshold
  * **Entropy and margin** as complementary uncertainty signals
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression

log = logging.getLogger(__name__)


@dataclass
class CalibrationReport:
    ece: float
    mce: float
    brier: float
    reliability: pd.DataFrame
    n_samples: int
    method: str

    def text(self) -> str:
        lines = [
            f"Calibration ({self.method})",
            "-" * 58,
            f"  Expected calibration error : {self.ece:.4f}",
            f"  Maximum calibration error  : {self.mce:.4f}",
            f"  Brier score                : {self.brier:.4f}",
            f"  Samples                    : {self.n_samples}",
            "",
            self.reliability.to_string(index=False,
                                       float_format=lambda v: f"{v:.3f}"),
        ]
        if self.ece > 0.10:
            lines.append("\n  ECE above 0.10 — the confidence numbers do not "
                         "mean what they say. Do not use them as an abstain "
                         "threshold until calibrated.")
        elif self.ece < 0.05:
            lines.append("\n  ECE under 0.05 — confidence is trustworthy "
                         "enough to drive the field-check threshold.")
        return "\n".join(lines)


def expected_calibration_error(probs: np.ndarray, y_true: np.ndarray,
                               n_bins: int = 10) -> CalibrationReport:
    """
    Reliability of the top-1 confidence.

    Bins predictions by confidence and compares mean confidence with observed
    accuracy in each bin. A perfectly calibrated model sits on the diagonal:
    of the predictions it makes at 0.8 confidence, 80% are correct.
    """
    conf = probs.max(axis=1)
    pred = probs.argmax(axis=1)
    correct = (pred == y_true).astype(float)

    edges = np.linspace(0.0, 1.0, n_bins + 1)
    rows, ece, mce, total = [], 0.0, 0.0, len(y_true)

    for lo, hi in zip(edges[:-1], edges[1:]):
        m = (conf > lo) & (conf <= hi) if lo > 0 else (conf >= lo) & (conf <= hi)
        n = int(m.sum())
        if n == 0:
            continue
        acc = float(correct[m].mean())
        avg = float(conf[m].mean())
        gap = abs(acc - avg)
        ece += (n / total) * gap
        mce = max(mce, gap)
        rows.append({"bin": f"{lo:.1f}-{hi:.1f}", "n": n,
                     "mean_confidence": avg, "accuracy": acc,
                     "gap": acc - avg})

    onehot = np.zeros_like(probs)
    onehot[np.arange(len(y_true)), y_true] = 1.0
    brier = float(np.mean(np.sum((probs - onehot) ** 2, axis=1)))

    return CalibrationReport(ece=float(ece), mce=float(mce), brier=brier,
                             reliability=pd.DataFrame(rows),
                             n_samples=total, method="uncalibrated")


class ProbabilityCalibrator:
    """
    One-vs-rest calibration of a multiclass probability matrix.

    Isotonic is the default: it is non-parametric and corrects the
    characteristic S-shaped distortion of boosted trees, which Platt scaling
    cannot. It needs more data though, so below ~500 calibration samples
    Platt is the safer choice and this class says so rather than silently
    overfitting a step function.
    """

    def __init__(self, method: str = "isotonic"):
        if method not in ("isotonic", "sigmoid"):
            raise ValueError("method must be 'isotonic' or 'sigmoid'")
        self.method = method
        self.calibrators: list = []
        self.n_classes = 0

    def fit(self, probs: np.ndarray, y_true: np.ndarray) -> "ProbabilityCalibrator":
        self.n_classes = probs.shape[1]
        if len(y_true) < 500 and self.method == "isotonic":
            log.warning(
                "Only %d calibration samples. Isotonic regression tends to "
                "overfit below ~500 — consider method='sigmoid'.", len(y_true))

        self.calibrators = []
        for c in range(self.n_classes):
            target = (y_true == c).astype(int)
            p = probs[:, c]
            if target.sum() < 3 or target.sum() == len(target):
                self.calibrators.append(None)   # too few examples to calibrate
                continue
            if self.method == "isotonic":
                m = IsotonicRegression(out_of_bounds="clip", y_min=0, y_max=1)
                m.fit(p, target)
            else:
                m = LogisticRegression(C=1e6, solver="lbfgs")
                m.fit(p.reshape(-1, 1), target)
            self.calibrators.append(m)
        return self

    def transform(self, probs: np.ndarray) -> np.ndarray:
        out = np.zeros_like(probs)
        for c, m in enumerate(self.calibrators):
            if m is None:
                out[:, c] = probs[:, c]
            elif self.method == "isotonic":
                out[:, c] = m.predict(probs[:, c])
            else:
                out[:, c] = m.predict_proba(probs[:, c].reshape(-1, 1))[:, 1]
        # Renormalise: one-vs-rest calibration does not preserve the simplex.
        s = out.sum(axis=1, keepdims=True)
        return np.divide(out, s, out=np.full_like(out, 1.0 / self.n_classes),
                         where=s > 1e-9)

    def fit_transform(self, probs: np.ndarray, y_true: np.ndarray) -> np.ndarray:
        return self.fit(probs, y_true).transform(probs)


def uncertainty_signals(probs: np.ndarray) -> pd.DataFrame:
    """
    Three complementary views of uncertainty.

    They disagree in informative ways. Low margin with low entropy means the
    model is torn between exactly two crops — cotton and tur, typically — and
    a field visit resolves it quickly. High entropy means it has no idea at
    all, which usually points to missing or cloud-wrecked data rather than a
    hard discrimination.
    """
    p = np.clip(probs, 1e-12, 1.0)
    sort = np.sort(p, axis=1)
    entropy = -np.sum(p * np.log(p), axis=1)
    max_entropy = np.log(p.shape[1])
    return pd.DataFrame({
        "confidence": sort[:, -1],
        "margin": sort[:, -1] - sort[:, -2],
        "entropy": entropy,
        "normalised_entropy": entropy / max_entropy,
    })


def selective_prediction_curve(probs: np.ndarray, y_true: np.ndarray,
                               steps: int = 20) -> pd.DataFrame:
    """
    Accuracy against coverage — the curve that sets the abstain threshold.

    Reading it: "if we only publish the 70% of parcels we are most confident
    about, those are 94% correct, and the remaining 30% go to field staff."
    That is the sentence a department needs in order to size a field campaign,
    and it cannot be derived from overall accuracy alone.
    """
    conf = probs.max(axis=1)
    correct = (probs.argmax(axis=1) == y_true).astype(float)
    order = np.argsort(-conf)
    c_sorted, k_sorted = conf[order], correct[order]

    rows = []
    for frac in np.linspace(1.0 / steps, 1.0, steps):
        n = max(1, int(round(frac * len(y_true))))
        rows.append({
            "coverage": n / len(y_true),
            "n_published": n,
            "n_to_field": len(y_true) - n,
            "accuracy": float(k_sorted[:n].mean()),
            "min_confidence": float(c_sorted[n - 1]),
        })
    return pd.DataFrame(rows)


def recommend_threshold(probs: np.ndarray, y_true: np.ndarray,
                        target_accuracy: float = 0.95) -> dict:
    """
    The lowest confidence threshold that still meets a target accuracy.

    Turns a policy decision ("we need 95% accuracy on anything we publish")
    into an operational number, and reports the cost of meeting it as the
    share of parcels that must be visited.
    """
    curve = selective_prediction_curve(probs, y_true, steps=50)
    ok = curve[curve["accuracy"] >= target_accuracy]
    if ok.empty:
        best = curve.loc[curve["accuracy"].idxmax()]
        return {
            "achievable": False,
            "target_accuracy": target_accuracy,
            "best_accuracy": float(best["accuracy"]),
            "message": (f"Target {target_accuracy:.0%} is not reachable at any "
                        f"coverage — the best is {best['accuracy']:.1%}. More "
                        f"ground truth is needed before publishing at that "
                        f"standard."),
        }
    row = ok.loc[ok["coverage"].idxmax()]
    return {
        "achievable": True,
        "target_accuracy": target_accuracy,
        "threshold": float(row["min_confidence"]),
        "coverage": float(row["coverage"]),
        "accuracy": float(row["accuracy"]),
        "field_check_share": 1.0 - float(row["coverage"]),
        "message": (f"Publish predictions above {row['min_confidence']:.3f} "
                    f"confidence: that covers {row['coverage']:.0%} of parcels "
                    f"at {row['accuracy']:.1%} accuracy, leaving "
                    f"{1 - row['coverage']:.0%} for field verification."),
    }
