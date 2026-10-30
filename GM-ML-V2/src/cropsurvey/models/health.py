"""
Crop health and stress detection.

The design decision that matters here: health is measured *relative to peers*,
never against an absolute threshold. An NDVI of 0.55 is excellent for bajra in
week six and alarming for irrigated wheat in week ten. Comparing a parcel to
other parcels of the same crop, in the same district, at the same growth stage
is the only framing that produces an actionable alert rather than noise.

Outputs are deliberately phrased as "anomaly" and "needs inspection", not as a
diagnosis. Remote sensing can see that a field is underperforming; it cannot
see why. Pest, disease, water stress and nutrient deficiency are separated by a
person standing in the field, and the system's job is to send them to the right
one of ten thousand parcels.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import CODE_TO_CROP
from ..preprocess.indices import compute_indices
from ..preprocess.timeseries import interpolate_gaps, smooth_series
from ..sources.base import ObservationStack

log = logging.getLogger(__name__)

SEVERITY_ORDER = ["normal", "watch", "stressed", "severe"]


@dataclass
class HealthResult:
    frame: pd.DataFrame

    def summary(self) -> str:
        counts = self.frame["severity"].value_counts()
        parts = [f"{counts.get(s, 0)} {s}" for s in SEVERITY_ORDER]
        flagged = int((self.frame["severity"] != "normal").sum())
        return (f"{len(self.frame)} parcels | " + ", ".join(parts) +
                f" | {flagged} need attention")

    def priority_list(self, top_n: int = 50) -> pd.DataFrame:
        """Worst parcels first — the inspection queue for field staff."""
        return (self.frame
                .sort_values(["vigour_zscore", "area_ha"],
                             ascending=[True, False])
                .head(top_n)
                .reset_index(drop=True))


class HealthMonitor:
    """Peer-relative crop condition assessment."""

    def __init__(self,
                 watch_z: float = -0.8,
                 stressed_z: float = -1.5,
                 severe_z: float = -2.2,
                 min_peers: int = 15):
        self.watch_z = watch_z
        self.stressed_z = stressed_z
        self.severe_z = severe_z
        self.min_peers = min_peers

    def assess(self,
               stack: ObservationStack,
               crop_codes: np.ndarray,
               districts: np.ndarray | None = None,
               areas: np.ndarray | None = None) -> HealthResult:
        indices = compute_indices(stack, ["ndvi", "ndmi"])
        if "ndvi" not in indices:
            raise ValueError("health assessment needs red and nir bands")

        ndvi = smooth_series(interpolate_gaps(indices["ndvi"], stack.doys))
        has_moisture = "ndmi" in indices
        ndmi = (smooth_series(interpolate_gaps(indices["ndmi"], stack.doys))
                if has_moisture else None)

        n = stack.n_parcels
        districts = districts if districts is not None else np.array(["all"] * n)
        areas = areas if areas is not None else np.ones(n, dtype=float)

        with np.errstate(invalid="ignore"):
            vigour = np.nanmax(ndvi, axis=1).astype(np.float32)
            # Mean, not sum. A sum over a gappy series is lower simply because
            # fewer dates were observed, which made cloudy parcels look
            # stressed — cloud cover is not a crop condition.
            n_obs = np.isfinite(ndvi).sum(axis=1)
            integral = np.where(
                n_obs > 0,
                np.nanmean(np.clip(ndvi, 0, None), axis=1),
                np.nan).astype(np.float32)
            moisture = (np.nanmean(ndmi, axis=1).astype(np.float32)
                        if ndmi is not None else np.full(n, np.nan, np.float32))
            # Late-season decline: the last fifth of the series versus the peak.
            tail = max(1, ndvi.shape[1] // 5)
            late = np.nanmean(ndvi[:, -tail:], axis=1).astype(np.float32)

        df = pd.DataFrame({
            "parcel_id": stack.parcel_ids,
            "crop_code": crop_codes.astype(int),
            "crop_name": [CODE_TO_CROP[int(c)].name if int(c) in CODE_TO_CROP
                          else "Unknown" for c in crop_codes],
            "district": districts,
            "area_ha": areas,
            "peak_ndvi": vigour,
            "ndvi_integral": integral,
            "mean_ndmi": moisture,
            "late_season_ndvi": late,
        })

        # Peer normalisation within crop x district.
        df["vigour_zscore"] = np.nan
        df["moisture_zscore"] = np.nan
        df["peer_group_size"] = 0

        for (code, dist), grp in df.groupby(["crop_code", "district"],
                                            dropna=False):
            if int(code) <= 0:
                continue
            idx = grp.index
            df.loc[idx, "peer_group_size"] = len(grp)
            if len(grp) < self.min_peers:
                # Too few peers for a stable z-score. Leave NaN rather than
                # compute one from six parcels and call it an anomaly.
                continue
            for col, src in (("vigour_zscore", "ndvi_integral"),
                             ("moisture_zscore", "mean_ndmi")):
                vals = grp[src].to_numpy(dtype=float)
                if not np.isfinite(vals).any():
                    continue
                # Median/MAD rather than mean/std: robust to the handful of
                # genuinely failed fields that would otherwise drag the
                # reference down and hide the rest.
                med = np.nanmedian(vals)
                mad = np.nanmedian(np.abs(vals - med))
                scale = 1.4826 * mad
                if scale < 1e-6:
                    continue
                df.loc[idx, col] = ((vals - med) / scale).astype(np.float32)

        df["severity"] = "normal"
        z = df["vigour_zscore"]
        df.loc[z <= self.watch_z, "severity"] = "watch"
        df.loc[z <= self.stressed_z, "severity"] = "stressed"
        df.loc[z <= self.severe_z, "severity"] = "severe"
        df.loc[z.isna(), "severity"] = "normal"

        # Moisture falling faster than greenness is the early-warning case:
        # the canopy is still green but the plant is drying.
        early_warning = (
            (df["moisture_zscore"] <= -1.2) & (df["vigour_zscore"] > self.watch_z)
        )
        df.loc[early_warning, "severity"] = "watch"
        df["early_water_stress"] = early_warning

        df["flag_reason"] = ""
        df.loc[df["severity"] != "normal", "flag_reason"] = "below peer vigour"
        df.loc[early_warning, "flag_reason"] = "canopy moisture falling before greenness"
        df.loc[df["peer_group_size"] < self.min_peers, "flag_reason"] = \
            "too few peers to assess"

        log.info("Health: %s",
                 ", ".join(f"{k}={v}" for k, v in
                           df["severity"].value_counts().items()))
        return HealthResult(df)


def detect_sowing_delay(stack: ObservationStack,
                        crop_codes: np.ndarray,
                        expected_sos_doy: dict[int, float]) -> pd.DataFrame:
    """
    Flag parcels sown significantly later than the district norm.

    Delayed sowing is the single best early predictor of a poor kharif, and it
    is visible weeks before any yield effect. For a disaster-management use
    case this is the alert worth having in July, not the yield estimate in
    November.
    """
    from ..preprocess.timeseries import phenology_metrics

    indices = compute_indices(stack, ["ndvi"])
    ndvi = smooth_series(interpolate_gaps(indices["ndvi"], stack.doys))
    metrics = phenology_metrics(ndvi, stack.doys)

    sos = metrics["sos_doy"]
    expected = np.array([expected_sos_doy.get(int(c), np.nan)
                         for c in crop_codes], dtype=float)
    delay = sos - expected

    return pd.DataFrame({
        "parcel_id": stack.parcel_ids,
        "crop_code": crop_codes.astype(int),
        "observed_sos_doy": sos,
        "expected_sos_doy": expected,
        "delay_days": delay,
        "delayed": delay > 14,
    })
