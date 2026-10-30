"""
15-day period composites.

A single satellite pass over a monsoon district is usually part cloud. One
date tells you little; fifteen days of passes, combined pixel by pixel, give
a near-complete picture. This module builds one composite per fixed 15-day
period so the season reads as an evenly spaced sequence a person can scroll
through and compare.

Three decisions worth stating, because they determine whether the sequence is
honest:

**Fixed calendar periods, not "every 15 days from the first scene."** Period
boundaries are anchored to the requested start date, so period 3 covers the
same dates regardless of which scenes happened to be clear. Two coordinates
analysed months apart remain comparable.

**Maximum-NDVI compositing.** For each pixel, the value kept is the one from
the date with the highest NDVI in that period. This is the standard choice
for vegetation work: residual cloud, haze and shadow all *lower* NDVI, so
taking the maximum preferentially selects the clearest observation of that
pixel. The alternative, a mean, blends haze into every pixel.

**Every pixel is a real observation.** No interpolation across periods, no
synthetic fill. A period with no clear view of a pixel leaves it empty and
the period reports its own coverage. An empty period is reported as empty.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import numpy as np

log = logging.getLogger(__name__)


@dataclass
class Period:
    """One fixed 15-day window."""
    index: int
    start: date
    end: date

    @property
    def label(self) -> str:
        return f"{self.start:%d %b} – {self.end:%d %b}"

    @property
    def short_label(self) -> str:
        return f"{self.start:%d %b}"

    @property
    def mid(self) -> date:
        return self.start + timedelta(days=(self.end - self.start).days // 2)

    def contains(self, d: date) -> bool:
        return self.start <= d <= self.end


@dataclass
class PeriodComposite:
    """Composited imagery and derived layers for one period."""
    period: Period
    bands: dict[str, np.ndarray]        # composited reflectance, NaN where unseen
    ndvi: np.ndarray
    source_dates: list[datetime] = field(default_factory=list)
    n_scenes: int = 0
    coverage: float = 0.0               # share of AOI pixels with a real value
    best_date: datetime | None = None   # date contributing the most pixels

    @property
    def has_data(self) -> bool:
        return self.n_scenes > 0 and self.coverage > 0.0

    def mean_ndvi(self) -> float:
        if not self.has_data:
            return float("nan")
        v = self.ndvi[np.isfinite(self.ndvi)]
        return float(v.mean()) if v.size else float("nan")

    def vegetated_fraction(self, threshold: float = 0.30) -> float:
        if not self.has_data:
            return float("nan")
        v = self.ndvi[np.isfinite(self.ndvi)]
        return float((v > threshold).mean()) if v.size else float("nan")

    def summary(self) -> str:
        if not self.has_data:
            return f"{self.period.label}: no clear imagery"
        return (f"{self.period.label}: NDVI {self.mean_ndvi():.3f}, "
                f"{self.coverage:.0%} coverage, {self.n_scenes} pass"
                f"{'es' if self.n_scenes != 1 else ''}")


def build_periods(start: date, end: date, days: int = 15) -> list[Period]:
    """Fixed-length periods covering [start, end], anchored at start."""
    if end <= start:
        raise ValueError(f"end {end} must be after start {start}")
    periods: list[Period] = []
    cursor = start
    i = 0
    while cursor <= end:
        stop = min(cursor + timedelta(days=days - 1), end)
        periods.append(Period(index=i, start=cursor, end=stop))
        cursor = stop + timedelta(days=1)
        i += 1
    log.info("%d periods of %d days from %s to %s",
             len(periods), days, start, end)
    return periods


def composite_period(
    period: Period,
    scene_arrays: list,
    bands: tuple[str, ...] = ("red", "green", "blue", "nir", "swir1"),
) -> PeriodComposite:
    """
    Maximum-NDVI composite of every scene falling inside one period.

    `scene_arrays` are SceneArrays already masked for cloud and shadow and
    already on a common grid — alignment is guaranteed upstream by reading
    every band through the same window and output shape, so pixel (i, j) is
    the same patch of ground in every scene and every period.
    """
    in_period = [a for a in scene_arrays
                 if period.contains(a.scene.acquired.date())]

    if not in_period:
        return PeriodComposite(period=period, bands={},
                               ndvi=np.array([]), n_scenes=0, coverage=0.0)

    shape = None
    for a in in_period:
        if "red" in a.bands:
            shape = a.bands["red"].shape
            break
    if shape is None:
        return PeriodComposite(period=period, bands={},
                               ndvi=np.array([]), n_scenes=0, coverage=0.0)

    best_ndvi = np.full(shape, -np.inf, dtype=np.float32)
    best_idx = np.full(shape, -1, dtype=np.int16)

    ndvis = []
    for k, a in enumerate(in_period):
        if not {"red", "nir"}.issubset(a.bands):
            ndvis.append(np.full(shape, np.nan, dtype=np.float32))
            continue
        red, nir = a.bands["red"], a.bands["nir"]
        with np.errstate(divide="ignore", invalid="ignore"):
            den = nir + red
            nd = np.where(np.abs(den) > 1e-6, (nir - red) / den, np.nan)
        nd = nd.astype(np.float32)
        ndvis.append(nd)

        better = np.isfinite(nd) & (nd > best_ndvi)
        best_ndvi = np.where(better, nd, best_ndvi)
        best_idx = np.where(better, k, best_idx)

    seen = best_idx >= 0
    ndvi = np.where(seen, best_ndvi, np.nan).astype(np.float32)

    out_bands: dict[str, np.ndarray] = {}
    for b in bands:
        layer = np.full(shape, np.nan, dtype=np.float32)
        for k, a in enumerate(in_period):
            if b not in a.bands:
                continue
            take = (best_idx == k)
            if take.any():
                layer[take] = a.bands[b][take]
        if np.isfinite(layer).any():
            out_bands[b] = layer

    # Which date contributed the most pixels — used to label the image.
    best_date = None
    if seen.any():
        counts = np.bincount(best_idx[seen].astype(int),
                             minlength=len(in_period))
        best_date = in_period[int(counts.argmax())].scene.acquired

    comp = PeriodComposite(
        period=period, bands=out_bands, ndvi=ndvi,
        source_dates=[a.scene.acquired for a in in_period],
        n_scenes=len(in_period),
        coverage=float(seen.mean()),
        best_date=best_date,
    )
    log.debug("%s", comp.summary())
    return comp


def composite_series(
    periods: list[Period],
    scene_arrays: list,
    bands: tuple[str, ...] = ("red", "green", "blue", "nir", "swir1"),
) -> list[PeriodComposite]:
    """Composite every period. Periods with no clear imagery are kept, empty."""
    out = [composite_period(p, scene_arrays, bands) for p in periods]
    good = sum(1 for c in out if c.has_data)
    log.info("Composites: %d/%d periods have imagery", good, len(out))
    return out


def series_curve(composites: list[PeriodComposite],
                 vegetated_only: bool = True,
                 veg_threshold: float = 0.30) -> tuple[np.ndarray, np.ndarray]:
    """
    Mean NDVI per period, as (day_index, value).

    Restricting to vegetated pixels matters: averaging over water, bare soil
    and buildings suppresses the amplitude of the growth curve and biases
    every downstream judgement toward short, low-canopy crops.
    """
    days, vals = [], []
    veg_mask = None

    if vegetated_only:
        peaks = [c.ndvi for c in composites if c.has_data]
        if peaks:
            stack = np.stack([np.where(np.isfinite(p), p, -np.inf)
                              for p in peaks])
            peak = stack.max(axis=0)
            m = peak > veg_threshold
            if m.sum() >= 25:
                veg_mask = m

    base = composites[0].period.start
    for c in composites:
        if not c.has_data:
            continue
        layer = c.ndvi if veg_mask is None else np.where(veg_mask, c.ndvi, np.nan)
        v = layer[np.isfinite(layer)]
        if v.size == 0:
            continue
        days.append(float((c.period.mid - base).days))
        vals.append(float(v.mean()))

    return np.array(days, dtype=float), np.array(vals, dtype=float)
