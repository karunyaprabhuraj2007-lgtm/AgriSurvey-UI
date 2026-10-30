"""
Temporal processing: gap filling, smoothing, and phenology extraction.

This is where most of the accuracy actually comes from. A crop is identified by
*when* it is green, not by how green it is on any one date — and in a monsoon
climate most dates are missing. Getting the interpolation and the phenological
metrics right matters more than the choice of classifier.
"""
from __future__ import annotations

import logging

import numpy as np
from scipy.signal import savgol_filter

from ..config import PROCESSING

log = logging.getLogger(__name__)


def interpolate_gaps(series: np.ndarray, doys: np.ndarray,
                     max_gap_days: int = 45) -> np.ndarray:
    """
    Linearly interpolate missing timesteps per parcel.

    Gaps longer than `max_gap_days` are left as NaN rather than bridged. This
    is deliberate: interpolating across a two-month monsoon blackout invents a
    growth curve, and a classifier trained on invented curves reports
    confidence it has not earned.

    series : (n_parcels, n_timesteps)
    """
    out = series.astype(np.float32).copy()
    n_p, n_t = out.shape

    for i in range(n_p):
        row = out[i]
        valid = np.isfinite(row)
        n_valid = int(valid.sum())
        if n_valid == 0:
            continue
        if n_valid == n_t:
            continue

        vd = doys[valid]
        vv = row[valid]
        filled = np.interp(doys, vd, vv, left=np.nan, right=np.nan)

        # Blank out interpolated points sitting inside an over-long gap.
        if n_valid >= 2:
            idx = np.flatnonzero(valid)
            for a, b in zip(idx[:-1], idx[1:]):
                if doys[b] - doys[a] > max_gap_days:
                    filled[a + 1:b] = np.nan
        out[i] = filled
    return out


def smooth_series(series: np.ndarray,
                  window: int | None = None,
                  polyorder: int | None = None) -> np.ndarray:
    """
    Savitzky-Golay smoothing, applied only where enough valid points exist.

    SG is preferred to a moving average because it preserves the amplitude and
    timing of the peak, and peak timing is the feature that separates cotton
    from soybean.
    """
    window = window or PROCESSING.smooth_window
    polyorder = polyorder or PROCESSING.smooth_polyorder
    if window % 2 == 0:
        window += 1

    out = series.astype(np.float32).copy()
    for i in range(out.shape[0]):
        row = out[i]
        valid = np.isfinite(row)
        if valid.sum() < window:
            continue
        sm = savgol_filter(row[valid], window_length=window,
                           polyorder=min(polyorder, window - 1))
        row[valid] = sm.astype(np.float32)
        out[i] = row
    return out


def phenology_metrics(series: np.ndarray, doys: np.ndarray) -> dict[str, np.ndarray]:
    """
    Per-parcel phenological descriptors.

    These are the features that carry crop-type information. A 180-day cotton
    crop and a 105-day soybean crop differ far more in the timing and width of
    their green phase than in peak greenness, which is why amplitude alone
    classifies poorly.

    Returns one (n_parcels,) array per metric.
    """
    n_p, n_t = series.shape
    nan = np.full(n_p, np.nan, dtype=np.float32)

    peak_value = np.copy(nan)
    peak_doy = np.copy(nan)
    amplitude = np.copy(nan)
    integral = np.copy(nan)
    sos_doy = np.copy(nan)
    eos_doy = np.copy(nan)
    length = np.copy(nan)
    greenup_rate = np.copy(nan)
    senesce_rate = np.copy(nan)
    base_value = np.copy(nan)
    n_valid = np.zeros(n_p, dtype=np.float32)

    for i in range(n_p):
        row = series[i]
        valid = np.isfinite(row)
        k = int(valid.sum())
        n_valid[i] = k
        if k < 4:
            continue

        d = doys[valid].astype(float)
        v = row[valid].astype(float)

        pk = int(np.argmax(v))
        peak_value[i] = v[pk]
        peak_doy[i] = d[pk]
        base_value[i] = float(np.percentile(v, 10))
        amplitude[i] = v[pk] - base_value[i]

        # Integral above the baseline — a biomass proxy, and the strongest
        # single predictor in the yield model.
        integral[i] = float(np.trapezoid(np.clip(v - base_value[i], 0, None), d))

        # Start/end of season at 30% of amplitude, the usual convention.
        thresh = base_value[i] + 0.30 * amplitude[i]
        above = v >= thresh
        if above.any():
            first, last = int(np.argmax(above)), int(len(above) - 1 - np.argmax(above[::-1]))
            sos_doy[i] = d[first]
            eos_doy[i] = d[last]
            length[i] = d[last] - d[first]

            if pk > first:
                greenup_rate[i] = (v[pk] - v[first]) / max(d[pk] - d[first], 1.0)
            if last > pk:
                senesce_rate[i] = (v[pk] - v[last]) / max(d[last] - d[pk], 1.0)

    return {
        "peak_value": peak_value,
        "peak_doy": peak_doy,
        "base_value": base_value,
        "amplitude": amplitude,
        "integral": integral,
        "sos_doy": sos_doy,
        "eos_doy": eos_doy,
        "season_length": length,
        "greenup_rate": greenup_rate,
        "senescence_rate": senesce_rate,
        "n_valid_obs": n_valid,
    }


def temporal_statistics(series: np.ndarray) -> dict[str, np.ndarray]:
    """Distribution summary of a series, ignoring NaN."""
    with np.errstate(invalid="ignore"):
        return {
            "mean": np.nanmean(series, axis=1).astype(np.float32),
            "std": np.nanstd(series, axis=1).astype(np.float32),
            "min": np.nanmin(series, axis=1).astype(np.float32),
            "max": np.nanmax(series, axis=1).astype(np.float32),
            "p25": np.nanpercentile(series, 25, axis=1).astype(np.float32),
            "median": np.nanmedian(series, axis=1).astype(np.float32),
            "p75": np.nanpercentile(series, 75, axis=1).astype(np.float32),
        }


def resample_to_regular_grid(series: np.ndarray, doys: np.ndarray,
                             step_days: int | None = None
                             ) -> tuple[np.ndarray, np.ndarray]:
    """
    Resample an irregular series onto a fixed cadence.

    Required by the temporal CNN, which needs a fixed-length input. The
    gradient-boosting model does not need this — it consumes the phenology
    metrics above, which are already fixed-length.
    """
    step_days = step_days or PROCESSING.composite_days
    grid = np.arange(float(doys.min()), float(doys.max()) + 1, step_days)
    out = np.full((series.shape[0], len(grid)), np.nan, dtype=np.float32)

    for i in range(series.shape[0]):
        valid = np.isfinite(series[i])
        if valid.sum() < 2:
            continue
        out[i] = np.interp(grid, doys[valid], series[i][valid],
                           left=np.nan, right=np.nan).astype(np.float32)
    return out, grid
