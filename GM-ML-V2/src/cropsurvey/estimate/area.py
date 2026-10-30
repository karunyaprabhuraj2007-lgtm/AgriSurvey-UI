"""
Crop area estimation with confidence intervals.

This module is the difference between a hackathon demo and something a
government statistician will accept.

Counting classified pixels and multiplying by pixel size gives a *map* area.
Map area is biased, because the classifier makes mistakes and those mistakes
are not symmetric — a class the model over-predicts gets an inflated area and
no warning attached. The correction is standard and has been the accepted
practice in land-cover accounting for a decade: use the confusion matrix from
an independent reference sample to adjust the map area and attach a standard
error.

Reference: Olofsson, Foody, Herold, Stehman, Woodcock & Wulder (2014),
"Good practices for estimating area and assessing accuracy of land change",
Remote Sensing of Environment 148, 42-57.

Why this matters for Maharashtra: crop area drives subsidy allocation and
insurance payouts. "Cotton covers 412,000 ha" is not a usable answer. "Cotton
covers 412,000 ha, 95% CI 389,000-435,000" is, and it tells the department
how much to trust it.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import CODE_TO_CROP, NON_CROP_CODES

log = logging.getLogger(__name__)


@dataclass
class AreaEstimate:
    frame: pd.DataFrame
    total_mapped_area: float
    method: str

    def text(self) -> str:
        lines = [
            f"Crop area estimate ({self.method})",
            "-" * 72,
            self.frame.to_string(index=False,
                                 float_format=lambda v: f"{v:,.1f}"),
            "-" * 72,
            f"Total area assessed: {self.total_mapped_area:,.1f} ha",
        ]
        if self.method == "map count (biased)":
            lines.append(
                "WARNING: unadjusted map counts. These carry classifier bias "
                "and no uncertainty. Do not publish without a reference sample."
            )
        return "\n".join(lines)


def map_area(predicted_codes: np.ndarray,
             parcel_areas: np.ndarray) -> AreaEstimate:
    """
    Naive area by summing parcel areas per predicted class.

    Provided for comparison only. Use `adjusted_area` for anything reported.
    """
    df = pd.DataFrame({"code": predicted_codes.astype(int),
                       "area_ha": parcel_areas})
    agg = (df[df["code"] > 0]
           .groupby("code", as_index=False)["area_ha"].sum()
           .rename(columns={"area_ha": "map_area_ha"}))
    agg["crop"] = [CODE_TO_CROP[int(c)].name for c in agg["code"]]
    agg = agg[["code", "crop", "map_area_ha"]].sort_values(
        "map_area_ha", ascending=False)
    return AreaEstimate(agg.reset_index(drop=True),
                        float(agg["map_area_ha"].sum()),
                        "map count (biased)")


def adjusted_area(
    predicted_codes: np.ndarray,
    parcel_areas: np.ndarray,
    reference_predicted: np.ndarray,
    reference_true: np.ndarray,
    confidence_level: float = 0.95,
) -> AreaEstimate:
    """
    Stratified estimator of area with standard errors.

    Strata are the map classes. Within each stratum, the reference sample gives
    the proportion of area actually belonging to each true class; those
    proportions are weighted by stratum area and summed.

    Parameters
    ----------
    predicted_codes    : map class of every parcel in the population
    parcel_areas       : area (ha) of every parcel, same order
    reference_predicted: map class of each parcel in the reference sample
    reference_true     : ground-truth class of each reference parcel
    confidence_level   : for the reported interval

    Notes
    -----
    The reference sample must be *independent* of the training data. Reusing
    training points here produces an estimator that certifies its own errors
    as correct, which is worse than not estimating uncertainty at all.
    """
    if len(reference_predicted) != len(reference_true):
        raise ValueError("reference arrays must be the same length")
    if len(predicted_codes) != len(parcel_areas):
        raise ValueError("predicted_codes and parcel_areas must align")

    predicted_codes = predicted_codes.astype(int)
    classes = np.array(sorted(set(np.unique(reference_true).tolist())
                              | set(np.unique(reference_predicted).tolist())))
    classes = classes[classes > 0]
    if classes.size == 0:
        raise ValueError("no valid classes in the reference sample")

    # Stratum weights: share of total area mapped to each class.
    total_area = float(parcel_areas[predicted_codes > 0].sum())
    stratum_area = {
        int(c): float(parcel_areas[predicted_codes == c].sum()) for c in classes
    }
    weights = {c: (a / total_area if total_area > 0 else 0.0)
               for c, a in stratum_area.items()}

    n_i = {int(c): int((reference_predicted == c).sum()) for c in classes}

    rows = []
    z = 1.959963985 if abs(confidence_level - 0.95) < 1e-9 else _z_for(confidence_level)

    for target in classes:
        p_hat = 0.0
        var = 0.0
        thin_strata = []

        for stratum in classes:
            W = weights[int(stratum)]
            n = n_i[int(stratum)]
            if W == 0.0:
                continue
            if n < 2:
                if n == 1:
                    thin_strata.append(int(stratum))
                continue
            in_stratum = reference_predicted == stratum
            y = (reference_true[in_stratum] == target).astype(float)
            p_bar = float(y.mean())
            p_hat += W * p_bar
            # Finite-population correction omitted: parcel counts are large
            # relative to the sample, so it changes the interval negligibly
            # and omitting it is conservative.
            var += (W ** 2) * p_bar * (1.0 - p_bar) / (n - 1)

        area_hat = p_hat * total_area
        se_area = float(np.sqrt(max(var, 0.0)) * total_area)

        rows.append({
            "code": int(target),
            "crop": CODE_TO_CROP[int(target)].name,
            "map_area_ha": stratum_area[int(target)],
            "adjusted_area_ha": area_hat,
            "se_ha": se_area,
            "ci_lower_ha": max(area_hat - z * se_area, 0.0),
            "ci_upper_ha": area_hat + z * se_area,
            "rel_se_pct": (100.0 * se_area / area_hat) if area_hat > 0 else np.nan,
            "n_reference": n_i[int(target)],
        })
        if thin_strata:
            log.warning(
                "Class %s: strata %s have a single reference point, so their "
                "contribution to the variance cannot be estimated and is "
                "excluded. The interval is narrower than the truth.",
                CODE_TO_CROP[int(target)].name, thin_strata)

    df = pd.DataFrame(rows).sort_values("adjusted_area_ha", ascending=False)
    df["bias_ha"] = df["adjusted_area_ha"] - df["map_area_ha"]

    poor = df[df["rel_se_pct"] > 25]
    if len(poor):
        log.warning(
            "Relative standard error above 25%% for: %s. More reference "
            "points needed in those strata before these figures are usable.",
            ", ".join(poor["crop"]))

    return AreaEstimate(df.reset_index(drop=True), total_area,
                        f"stratified, design-based ({int(confidence_level * 100)}% CI)")


def _z_for(level: float) -> float:
    from scipy.stats import norm
    return float(norm.ppf(0.5 + level / 2.0))


def required_sample_size(expected_users_accuracy: dict[int, float],
                         target_se_pct: float = 5.0,
                         area_weights: dict[int, float] | None = None
                         ) -> pd.DataFrame:
    """
    How many ground-truth points you need per class.

    Answers the question a department will ask before funding a field campaign:
    "how many villages must we visit?" Uses the standard proportion-variance
    formula; the practical floor is 50-100 points per class regardless of what
    the arithmetic says, because rare classes break the asymptotics.
    """
    rows = []
    for code, ua in expected_users_accuracy.items():
        ua = float(np.clip(ua, 0.01, 0.999))
        w = (area_weights or {}).get(code, 1.0)
        target_se = target_se_pct / 100.0
        n = ua * (1.0 - ua) / (target_se ** 2) * max(w, 0.05)
        rows.append({
            "code": code,
            "crop": CODE_TO_CROP[int(code)].name,
            "assumed_users_acc": ua,
            "n_required": int(np.ceil(max(n, 50))),
        })
    df = pd.DataFrame(rows).sort_values("n_required", ascending=False)
    return df.reset_index(drop=True)
