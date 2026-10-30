"""
Synthetic Maharashtra imagery.

This exists so the pipeline runs end to end with zero credentials — on a
laptop, on demo day, with the venue wifi down. It is not a toy: the crop
signatures come from a double-logistic phenology model, the standard
parametric form for vegetation index time series (Zhang et al. 2003), with
per-crop parameters from config.CROP_CLASSES.

What it reproduces faithfully:
  * crop-specific green-up, peak and senescence timing
  * monsoon cloud loss concentrated in June-September
  * SAR continuing to observe through that cloud
  * sensor noise and per-parcel sowing-date jitter

What it cannot reproduce: real spectral confusion between crops that genuinely
look alike. Accuracy on synthetic data is therefore an upper bound, and the
README says so. Treat it as a pipeline test, never as a result.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

import numpy as np
import pandas as pd

from ..config import (CROP_CLASSES, CODE_TO_CROP, SEASONS, SENSOR_BANDS,
                      MAHARASHTRA_DISTRICTS)
from .base import ImagerySource, ObservationStack, Scene

log = logging.getLogger(__name__)


def double_logistic(doy: np.ndarray, sos: float, eos: float,
                    vmin: float, vmax: float,
                    greenup_rate: float, senesce_rate: float) -> np.ndarray:
    """
    Double-logistic vegetation index curve.

    sos / eos are the inflection points of green-up and senescence in day-of-
    year. The difference of two sigmoids gives the characteristic rise, plateau
    and fall of a growing crop.
    """
    rise = 1.0 / (1.0 + np.exp(-greenup_rate * (doy - sos)))
    fall = 1.0 / (1.0 + np.exp(-senesce_rate * (doy - eos)))
    return vmin + (vmax - vmin) * (rise - fall)


def _vi_to_reflectance(vi: np.ndarray, rng: np.random.Generator
                       ) -> dict[str, np.ndarray]:
    """
    Invert NDVI to a plausible set of band reflectances.

    NDVI = (nir - red) / (nir + red). Fixing nir from the VI and solving for
    red keeps the synthetic bands mutually consistent, so indices computed
    downstream behave like real ones rather than being independent noise.
    """
    vi = np.clip(vi, -0.05, 0.95)
    nir = 0.18 + 0.42 * np.clip(vi, 0, None) + rng.normal(0, 0.012, vi.shape)
    nir = np.clip(nir, 0.02, 0.95)
    red = nir * (1.0 - vi) / (1.0 + vi)
    red = np.clip(red + rng.normal(0, 0.006, vi.shape), 0.005, 0.6)

    green = red * 1.25 + 0.02 * np.clip(vi, 0, None) + rng.normal(0, 0.006, vi.shape)
    blue = red * 0.92 + rng.normal(0, 0.005, vi.shape)
    red_edge = red + (nir - red) * 0.45 + rng.normal(0, 0.010, vi.shape)
    # SWIR falls as canopy water content rises.
    swir1 = np.clip(0.34 - 0.20 * np.clip(vi, 0, None)
                    + rng.normal(0, 0.012, vi.shape), 0.01, 0.6)
    swir2 = np.clip(swir1 * 0.74 + rng.normal(0, 0.010, vi.shape), 0.005, 0.5)

    return {
        "blue": np.clip(blue, 0.002, 0.5),
        "green": np.clip(green, 0.005, 0.6),
        "red": red,
        "red_edge": np.clip(red_edge, 0.01, 0.8),
        "nir": nir,
        "swir1": swir1,
        "swir2": swir2,
    }


def _sar_backscatter(vi: np.ndarray, crop_code: int,
                     rng: np.random.Generator) -> dict[str, np.ndarray]:
    """
    Approximate C-band backscatter in dB.

    VH rises with canopy volume scattering, so it tracks biomass. VV is more
    sensitive to surface roughness and moisture. The VH/VV ratio is the
    workhorse feature for crop discrimination under cloud.
    """
    veg = np.clip(vi, 0, None)
    vh = -24.0 + 10.0 * veg + rng.normal(0, 1.1, vi.shape)
    vv = -15.5 + 5.0 * veg + rng.normal(0, 1.3, vi.shape)
    # Flooded transplanting (rice-like) gives very low early backscatter;
    # sugarcane's dense vertical structure raises VH.
    if crop_code == 3:
        vh += 2.0
    return {"vv": vv, "vh": vh}


class SyntheticSource(ImagerySource):
    """Generates a realistic parcel time series for a district and season."""

    name = "synthetic"

    def __init__(
        self,
        n_parcels: int = 1200,
        sensor: str = "sentinel2",
        revisit_days: int = 5,
        seed: int = 42,
        include_sar: bool = True,
        crop_mix: dict[int, float] | None = None,
    ):
        self.n_parcels = n_parcels
        self.sensor = sensor
        self.revisit_days = revisit_days
        self.seed = seed
        self.include_sar = include_sar
        self.crop_mix = crop_mix
        self.rng = np.random.default_rng(seed)
        self._truth: pd.DataFrame | None = None

    # -- helpers -----------------------------------------------------------

    def _season_doys(self, season: str) -> np.ndarray:
        s = SEASONS[season]
        if s.spans_year_end:
            doys = np.concatenate([
                np.arange(s.start_doy, 366, self.revisit_days),
                np.arange(1, s.end_doy + 1, self.revisit_days) + 365,
            ])
        else:
            doys = np.arange(s.start_doy, s.end_doy + 1, self.revisit_days)
        return doys.astype(float)

    def _default_mix(self, season: str) -> dict[int, float]:
        """
        Crop mix roughly reflecting Maharashtra's cropping pattern.

        Kharif is dominated by cotton and soybean; rabi by gram, wheat and
        onion; sugarcane and grapes are annual and appear in both.
        """
        if season == "kharif":
            mix = {1: 0.26, 2: 0.24, 4: 0.11, 5: 0.08, 6: 0.05,
                   3: 0.09, 10: 0.02, 11: 0.10, 12: 0.05}
        elif season == "rabi":
            mix = {7: 0.24, 8: 0.19, 9: 0.12, 5: 0.07,
                   3: 0.10, 10: 0.03, 11: 0.17, 12: 0.08}
        else:
            mix = {5: 0.14, 6: 0.10, 3: 0.12, 10: 0.04, 11: 0.45, 12: 0.15}
        total = sum(mix.values())
        return {k: v / total for k, v in mix.items()}

    # -- ImagerySource -----------------------------------------------------

    def search(self, bbox, start: date, end: date,
               max_cloud: float = 1.0, limit: int = 500) -> list[Scene]:
        scenes: list[Scene] = []
        cursor = start
        idx = 0
        while cursor <= end and len(scenes) < limit:
            doy = cursor.timetuple().tm_yday
            # Monsoon cloud: near-total loss July-August.
            monsoon = 1.0 if 160 <= doy <= 270 else 0.0
            cloud = float(np.clip(
                self.rng.beta(2, 6) + 0.55 * monsoon, 0, 1))
            scenes.append(Scene(
                scene_id=f"SYN_{self.sensor.upper()}_{cursor:%Y%m%d}_{idx:03d}",
                source=self.name, sensor=self.sensor,
                acquired=datetime(cursor.year, cursor.month, cursor.day),
                bbox=bbox, cloud_cover=cloud, is_sar=False,
            ))
            if self.include_sar:
                scenes.append(Scene(
                    scene_id=f"SYN_SAR_{cursor:%Y%m%d}_{idx:03d}",
                    source=self.name, sensor="sar",
                    acquired=datetime(cursor.year, cursor.month, cursor.day),
                    bbox=bbox, cloud_cover=None, is_sar=True,
                ))
            cursor += timedelta(days=self.revisit_days)
            idx += 1
        return scenes

    def generate(self, season: str = "kharif",
                 district: str = "Pune") -> tuple[ObservationStack, pd.DataFrame]:
        """
        Build the stack and the matching ground truth.

        Returns (stack, truth) where truth has columns
        parcel_id, crop_code, crop_name, district, area_ha, lon, lat.
        """
        if season not in SEASONS:
            raise ValueError(f"unknown season {season!r}; "
                             f"choose from {sorted(SEASONS)}")
        rng = self.rng
        doys = self._season_doys(season)
        n_t = len(doys)
        n_p = self.n_parcels

        mix = self.crop_mix or self._default_mix(season)
        codes = np.array(sorted(mix))
        probs = np.array([mix[c] for c in codes], dtype=float)
        probs = probs / probs.sum()
        labels = rng.choice(codes, size=n_p, p=probs)

        bands = SENSOR_BANDS[self.sensor]
        all_bands = list(bands) + (["vv", "vh"] if self.include_sar else [])
        values = np.full((n_p, n_t, len(all_bands)), np.nan, dtype=np.float32)

        season_start = SEASONS[season].start_doy

        for code in codes:
            crop = CODE_TO_CROP[int(code)]
            sel = np.flatnonzero(labels == code)
            if sel.size == 0:
                continue

            # Per-parcel sowing jitter: farmers do not sow on the same day.
            jitter = rng.normal(0, 9, size=sel.size)[:, None]
            sos = season_start + crop.sow_offset_days + jitter
            if SEASONS[season].spans_year_end:
                sos = np.where(sos > 365, sos, sos)
            dur = max(crop.duration_days, 30)
            eos = sos + dur * 0.78

            vmax = crop.peak_vi + rng.normal(0, 0.05, size=sel.size)[:, None]
            vmin = 0.13 + rng.normal(0, 0.02, size=sel.size)[:, None]

            grid = np.broadcast_to(doys, (sel.size, n_t))
            vi = double_logistic(grid, sos, eos, vmin, vmax,
                                 crop.greenup_rate, crop.senesce_rate)

            if crop.code == 11:                 # fallow / bare soil
                # Low, flat, slight response to monsoon weed flush.
                vi = (vmin + 0.06 * np.exp(-((grid % 365 - 215) ** 2) / 2200.0)
                      + rng.normal(0, 0.03, vi.shape))
            elif crop.code == 12:               # non-crop: trees, built-up, water
                # Permanently vegetated or built surfaces: moderate and stable,
                # with no sowing-to-harvest cycle at all. The absence of
                # seasonal amplitude is what distinguishes it from a crop.
                vi = 0.44 + rng.normal(0, 0.05, size=(sel.size, 1)) \
                     + rng.normal(0, 0.025, vi.shape)
            if crop.code == 3:                  # sugarcane: ratoon dip
                vi -= 0.08 * np.sin(grid / 60.0)

            refl = _vi_to_reflectance(vi, rng)
            for bi, b in enumerate(bands):
                values[sel, :, bi] = refl[b].astype(np.float32)

            if self.include_sar:
                sar = _sar_backscatter(vi, int(code), rng)
                values[sel, :, len(bands) + 0] = sar["vv"].astype(np.float32)
                values[sel, :, len(bands) + 1] = sar["vh"].astype(np.float32)

        # Cloud loss — optical bands only. This is the whole reason SAR is here.
        monsoon = ((doys % 365 >= 160) & (doys % 365 <= 270))
        p_cloud = np.where(monsoon, 0.72, 0.18)
        cloudy = rng.random((n_p, n_t)) < p_cloud[None, :]
        for bi, b in enumerate(all_bands):
            if b in ("vv", "vh"):
                continue
            layer = values[:, :, bi]
            layer[cloudy] = np.nan
            values[:, :, bi] = layer

        parcel_ids = np.array([f"MH-{district[:3].upper()}-{i:06d}"
                               for i in range(n_p)])

        lat0, lon0 = MAHARASHTRA_DISTRICTS.get(district, (18.52, 73.86))
        truth = pd.DataFrame({
            "parcel_id": parcel_ids,
            "crop_code": labels.astype(int),
            "crop_name": [CODE_TO_CROP[int(c)].name for c in labels],
            "district": district,
            "season": season,
            # Maharashtra holdings are small; lognormal around ~1.2 ha.
            "area_ha": np.round(rng.lognormal(0.1, 0.65, n_p), 3),
            "lon": lon0 + rng.normal(0, 0.16, n_p),
            "lat": lat0 + rng.normal(0, 0.16, n_p),
        })
        self._truth = truth

        stack = ObservationStack(
            parcel_ids=parcel_ids,
            doys=doys,
            band_names=all_bands,
            values=values,
            sensor_of_step=[self.sensor] * n_t,
        )
        log.info("Synthetic %s/%s: %s", district, season, stack.summary())
        return stack, truth

    def load_parcel_timeseries(self, parcels, scenes) -> ObservationStack:
        stack, _ = self.generate()
        return stack

    @property
    def truth(self) -> pd.DataFrame:
        if self._truth is None:
            raise RuntimeError("call generate() before accessing truth")
        return self._truth
