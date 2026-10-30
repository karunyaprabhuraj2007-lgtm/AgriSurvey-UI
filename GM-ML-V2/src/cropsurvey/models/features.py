"""
Feature engineering: ObservationStack -> model matrix.

One function, one contract: given a stack, return an (n_parcels, n_features)
float matrix and the matching feature names. Every model in this package
consumes exactly this.
"""
from __future__ import annotations

import logging

import numpy as np
import pandas as pd

from ..preprocess.indices import compute_indices, compute_sar_features
from ..preprocess.timeseries import (interpolate_gaps, phenology_metrics,
                                     smooth_series, temporal_statistics)
from ..sources.base import ObservationStack

log = logging.getLogger(__name__)

#: Indices that get the full phenological treatment. The rest contribute
#: summary statistics only — computing ten metrics for seven correlated
#: indices produces a wide, redundant matrix that overfits on small label sets.
PHENOLOGY_INDICES = ("ndvi", "evi", "ndmi", "sar_ratio")


def build_features(
    stack: ObservationStack,
    include_raw_bands: bool = True,
    smooth: bool = True,
) -> tuple[pd.DataFrame, list[str]]:
    """
    Build the model matrix.

    Returns (DataFrame indexed by parcel_id, feature_names).
    """
    features: dict[str, np.ndarray] = {}

    series_sets: dict[str, np.ndarray] = {}
    series_sets.update(compute_indices(stack))
    series_sets.update(compute_sar_features(stack))

    if not series_sets:
        raise ValueError(
            "No indices could be computed. The stack has bands "
            f"{stack.band_names}, none of which form a known index.")

    for name, series in series_sets.items():
        filled = interpolate_gaps(series, stack.doys)
        if smooth:
            filled = smooth_series(filled)

        for stat_name, values in temporal_statistics(filled).items():
            features[f"{name}_{stat_name}"] = values

        if name in PHENOLOGY_INDICES:
            for metric, values in phenology_metrics(filled, stack.doys).items():
                features[f"{name}_{metric}"] = values

    if include_raw_bands:
        for band in stack.band_names:
            series = stack.band(band)
            filled = interpolate_gaps(series, stack.doys)
            stats = temporal_statistics(filled)
            for stat_name in ("mean", "std", "p25", "p75"):
                features[f"band_{band}_{stat_name}"] = stats[stat_name]

    # Cross-index features that carry real agronomic meaning.
    if "ndmi_peak_value" in features and "ndvi_peak_value" in features:
        # Moisture relative to greenness: low values flag a crop that is green
        # but drying — the earliest remotely-sensible sign of water stress.
        with np.errstate(invalid="ignore", divide="ignore"):
            features["moisture_greenness_ratio"] = (
                features["ndmi_peak_value"]
                / np.where(np.abs(features["ndvi_peak_value"]) > 1e-6,
                           features["ndvi_peak_value"], np.nan)
            ).astype(np.float32)

    if "ndvi_peak_doy" in features and "sar_ratio_peak_doy" in features:
        # Optical and radar peaks should coincide. When they do not, one of the
        # two is being driven by something other than canopy growth.
        features["optical_sar_peak_lag"] = (
            features["ndvi_peak_doy"] - features["sar_ratio_peak_doy"]
        ).astype(np.float32)

    df = pd.DataFrame(features, index=pd.Index(stack.parcel_ids, name="parcel_id"))

    # Drop all-NaN and zero-variance columns — they cost training time and
    # confuse feature-importance reporting.
    before = df.shape[1]
    df = df.loc[:, df.notna().any(axis=0)]
    with np.errstate(invalid="ignore"):
        variance = df.var(axis=0, skipna=True)
    df = df.loc[:, (variance.fillna(0) > 1e-12).to_numpy()]
    dropped = before - df.shape[1]
    if dropped:
        log.info("Dropped %d empty or constant features", dropped)

    log.info("Built %d features for %d parcels", df.shape[1], df.shape[0])
    return df, list(df.columns)


def quality_mask(stack: ObservationStack, min_valid: int) -> np.ndarray:
    """
    Which parcels have enough observations to classify honestly.

    Parcels failing this test are reported as 'insufficient data' rather than
    given a prediction. In a system that feeds subsidy and insurance decisions,
    abstaining is a feature, not a shortfall.
    """
    counts = stack.valid_counts()
    ok = counts >= min_valid
    if (~ok).any():
        log.info("%d/%d parcels below %d valid observations — will be "
                 "reported as insufficient data",
                 int((~ok).sum()), len(ok), min_valid)
    return ok
