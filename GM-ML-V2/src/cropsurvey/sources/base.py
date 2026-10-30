"""
Common interface for every imagery source.

The point of this abstraction: the classifier never knows whether a pixel came
from Resourcesat, Sentinel-2 or your own drone. Adding a sensor means writing
one adapter, not touching the models.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import numpy as np


@dataclass
class Scene:
    """One acquisition over one area."""
    scene_id: str
    source: str                 # "bhoonidhi" | "copernicus" | "drone" | "synthetic"
    sensor: str                 # key into config.SENSOR_BANDS, or "sar"
    acquired: datetime
    bbox: tuple[float, float, float, float]
    cloud_cover: float | None = None
    is_sar: bool = False
    download_url: str | None = None
    local_path: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def doy(self) -> int:
        return self.acquired.timetuple().tm_yday

    def __repr__(self) -> str:
        cc = f" cloud={self.cloud_cover:.0%}" if self.cloud_cover is not None else ""
        return (f"<Scene {self.scene_id} {self.sensor} "
                f"{self.acquired:%Y-%m-%d}{cc}>")


@dataclass
class ObservationStack:
    """
    Parcel-level time series — the single structure every model consumes.

    values : (n_parcels, n_timesteps, n_bands) float32, NaN where unobserved
    doys   : (n_timesteps,) day-of-year of each step
    """
    parcel_ids: np.ndarray
    doys: np.ndarray
    band_names: list[str]
    values: np.ndarray
    sensor_of_step: list[str] = field(default_factory=list)

    def __post_init__(self) -> None:
        n_p, n_t, n_b = self.values.shape
        if n_p != len(self.parcel_ids):
            raise ValueError(
                f"values has {n_p} parcels but parcel_ids has {len(self.parcel_ids)}")
        if n_t != len(self.doys):
            raise ValueError(
                f"values has {n_t} timesteps but doys has {len(self.doys)}")
        if n_b != len(self.band_names):
            raise ValueError(
                f"values has {n_b} bands but band_names has {len(self.band_names)}")

    @property
    def n_parcels(self) -> int:
        return self.values.shape[0]

    @property
    def n_steps(self) -> int:
        return self.values.shape[1]

    def band(self, name: str) -> np.ndarray:
        """(n_parcels, n_timesteps) for one band."""
        if name not in self.band_names:
            raise KeyError(
                f"band {name!r} not in stack; have {self.band_names}")
        return self.values[:, :, self.band_names.index(name)]

    def valid_counts(self) -> np.ndarray:
        """Number of timesteps per parcel with at least one finite band."""
        return np.isfinite(self.values).any(axis=2).sum(axis=1)

    def summary(self) -> str:
        vc = self.valid_counts()
        filled = np.isfinite(self.values).mean()
        return (f"{self.n_parcels} parcels x {self.n_steps} steps x "
                f"{len(self.band_names)} bands | "
                f"{filled:.0%} observed | "
                f"valid steps per parcel: min {vc.min()}, "
                f"median {int(np.median(vc))}, max {vc.max()}")


class ImagerySource(ABC):
    """Base class for all imagery providers."""

    name: str = "base"
    is_sar: bool = False

    @abstractmethod
    def search(
        self,
        bbox: tuple[float, float, float, float],
        start: date,
        end: date,
        max_cloud: float = 1.0,
        limit: int = 500,
    ) -> list[Scene]:
        """Find available scenes. Must not download anything."""

    @abstractmethod
    def load_parcel_timeseries(
        self,
        parcels,
        scenes: list[Scene],
    ) -> ObservationStack:
        """Reduce scenes to per-parcel mean reflectance per timestep."""

    def available(self) -> tuple[bool, str]:
        """
        Whether this source can actually be used right now.

        Returns (ok, reason). The pipeline calls this before anything else so
        that a missing credential produces a clear message at the start of a
        run rather than a stack trace twenty minutes in.
        """
        return True, "available"
