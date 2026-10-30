"""
MAPIR Survey3 drone imagery ingest.

Your Survey3 is the part of this system no competing team has, and the way to
make it count is not "we also flew a drone" — it is using the drone as the
calibration and validation layer for the satellite classifier:

  1. Ground truth at scale. One flight over 40 ha gives thousands of labelled
     pixels at 2-5 cm, far more training data than walking the field.
  2. Resolution bridging. Degrade drone imagery to the satellite grid and you
     can measure directly how much mixed-pixel error the satellite suffers on
     Maharashtra's small holdings — a number a government statistician will
     respect and no satellite-only team can produce.
  3. Dispute resolution. When a farmer contests a subsidy classification, the
     drone flies that parcel. That is an operational story, not a demo.

MAPIR specifics that matter
---------------------------
The Survey3 is a filtered camera, not a calibrated radiometer. Raw DN values
are useless for cross-date comparison until converted to reflectance against
the MAPIR calibration target photographed on each flight. This module
implements that conversion — skip it and your NDVI drifts with the sunlight.

Survey3 filter variants and what they give you:
  OCN  (Orange/Cyan/NIR) — the usual NDVI filter
  RGN  (Red/Green/NIR)   — NDVI with a true red band, preferred here
  RE   (Red Edge)        — red edge, good for stress detection
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path

import numpy as np

from ..config import SENSOR_BANDS
from .base import ImagerySource, ObservationStack, Scene

log = logging.getLogger(__name__)


#: Reflectance of the four MAPIR calibration target panels, as published by
#: MAPIR for the V2 ground target. Verify against the card shipped with your
#: camera — panel reflectance differs between target revisions.
MAPIR_TARGET_REFLECTANCE = {
    "white": 0.87,
    "light_grey": 0.51,
    "dark_grey": 0.23,
    "black": 0.0187,
}


@dataclass
class CalibrationPanel:
    """One panel sampled from the calibration target photo."""
    name: str
    mean_dn: dict[str, float]     # band -> mean digital number

    @property
    def reflectance(self) -> float:
        return MAPIR_TARGET_REFLECTANCE[self.name]


class MapirCalibrator:
    """
    Empirical line calibration: DN -> surface reflectance.

    Fits reflectance = slope * DN + intercept per band using the calibration
    panels. Two panels are the minimum; four give a usable residual check.
    """

    def __init__(self, panels: list[CalibrationPanel]):
        if len(panels) < 2:
            raise ValueError(
                "Need at least 2 calibration panels for an empirical line fit. "
                "Photograph the full MAPIR target before and after each flight.")
        self.panels = panels
        self.coefficients: dict[str, tuple[float, float]] = {}
        self.r_squared: dict[str, float] = {}
        self._fit()

    def _fit(self) -> None:
        bands = set(self.panels[0].mean_dn)
        for p in self.panels[1:]:
            bands &= set(p.mean_dn)
        for band in sorted(bands):
            dn = np.array([p.mean_dn[band] for p in self.panels], dtype=float)
            rho = np.array([p.reflectance for p in self.panels], dtype=float)
            slope, intercept = np.polyfit(dn, rho, 1)
            pred = slope * dn + intercept
            ss_res = float(np.sum((rho - pred) ** 2))
            ss_tot = float(np.sum((rho - rho.mean()) ** 2))
            r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else 1.0
            self.coefficients[band] = (float(slope), float(intercept))
            self.r_squared[band] = r2
            if r2 < 0.95:
                log.warning(
                    "Calibration fit for %s is poor (R2=%.3f). Check the target "
                    "was evenly lit and not saturated or shadowed.", band, r2)

    def apply(self, dn: np.ndarray, band: str) -> np.ndarray:
        if band not in self.coefficients:
            raise KeyError(f"no calibration for band {band!r}; "
                           f"have {sorted(self.coefficients)}")
        slope, intercept = self.coefficients[band]
        return np.clip(slope * dn.astype(np.float32) + intercept, 0.0, 1.2)

    def report(self) -> str:
        lines = ["MAPIR empirical-line calibration",
                 f"  panels: {', '.join(p.name for p in self.panels)}"]
        for band, (s, i) in self.coefficients.items():
            lines.append(f"  {band:9s} rho = {s:.3e} * DN + {i:+.4f}   "
                         f"R2={self.r_squared[band]:.4f}")
        return "\n".join(lines)


class DroneSource(ImagerySource):
    """
    Reads processed drone orthomosaics.

    Expected input: an orthomosaic GeoTIFF produced by OpenDroneMap, WebODM or
    Pix4D from the Survey3 captures, already georeferenced. This class does not
    do photogrammetry — use OpenDroneMap for that, it is free and self-hosted.
    """

    name = "drone"

    def __init__(self, filter_type: str = "rgn",
                 calibrator: MapirCalibrator | None = None):
        key = f"mapir_s3_{filter_type.lower()}"
        if key not in SENSOR_BANDS:
            raise ValueError(
                f"unknown MAPIR filter {filter_type!r}; "
                f"supported: ocn, rgn")
        self.sensor = key
        self.bands = SENSOR_BANDS[key]
        self.calibrator = calibrator

    def available(self) -> tuple[bool, str]:
        if self.calibrator is None:
            return True, ("no calibrator set — DN values will be used raw, which "
                          "is fine within one flight but not across dates")
        return True, "calibrated"

    def search(self, bbox, start: date, end: date,
               max_cloud: float = 1.0, limit: int = 500) -> list[Scene]:
        raise NotImplementedError(
            "Drone imagery is not searchable — register flights explicitly "
            "with register_flight().")

    def register_flight(self, ortho_path: str | Path, flown: datetime,
                        bbox: tuple[float, float, float, float]) -> Scene:
        p = Path(ortho_path)
        if not p.exists():
            raise FileNotFoundError(f"orthomosaic not found: {p}")
        return Scene(
            scene_id=f"DRONE_{flown:%Y%m%d_%H%M}",
            source=self.name, sensor=self.sensor, acquired=flown,
            bbox=bbox, cloud_cover=0.0, is_sar=False,
            local_path=str(p),
            metadata={"calibrated": self.calibrator is not None},
        )

    def load_parcel_timeseries(self, parcels, scenes) -> ObservationStack:
        from .raster import extract_parcel_means

        if not scenes:
            raise ValueError("no drone scenes registered")
        per_step = []
        doys = []
        for sc in sorted(scenes, key=lambda s: s.acquired):
            if sc.local_path is None:
                raise ValueError(f"{sc.scene_id} has no local_path")
            means = extract_parcel_means(sc.local_path, parcels, self.bands)
            if self.calibrator is not None:
                for bi, band in enumerate(self.bands):
                    means[:, bi] = self.calibrator.apply(means[:, bi], band)
            per_step.append(means)
            doys.append(float(sc.doy))

        values = np.stack(per_step, axis=1).astype(np.float32)
        return ObservationStack(
            parcel_ids=np.asarray(parcels["parcel_id"]),
            doys=np.asarray(doys, dtype=float),
            band_names=list(self.bands),
            values=values,
            sensor_of_step=[self.sensor] * len(doys),
        )


def degrade_to_satellite_grid(drone_values: np.ndarray,
                              factor: int) -> np.ndarray:
    """
    Block-average drone pixels to a coarser grid.

    Use this to quantify mixed-pixel error: classify the drone imagery at full
    resolution, degrade it to 10 m (Sentinel-2) or 23.5 m (LISS-III), classify
    again, and report how much accuracy you lose. That number is the honest
    answer to "can satellite data really resolve our field sizes", and it is
    the kind of result that wins a hackathon on rigour rather than polish.
    """
    if factor < 2:
        return drone_values
    h, w = drone_values.shape[:2]
    h2, w2 = (h // factor) * factor, (w // factor) * factor
    trimmed = drone_values[:h2, :w2]
    if trimmed.ndim == 2:
        return trimmed.reshape(h2 // factor, factor,
                               w2 // factor, factor).mean(axis=(1, 3))
    c = trimmed.shape[2]
    return trimmed.reshape(h2 // factor, factor,
                           w2 // factor, factor, c).mean(axis=(1, 3))
