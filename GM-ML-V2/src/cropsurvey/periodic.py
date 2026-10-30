"""
Period analysis for a single coordinate — the entry point the UI calls.

    from cropsurvey.periodic import analyse_coordinate
    result = analyse_coordinate(lat=20.4749166, lon=77.1115283,
                                start=date(2026, 6, 1), end=date(2026, 11, 30))

Fetches every Sentinel-2 pass over the AOI, composites them into fixed 15-day
periods on one aligned grid, analyses growth and health per period, and
renders the image strip.

All imagery is real. There is no synthetic fallback on this path: if nothing
can be fetched, it raises rather than quietly substituting generated data,
because a demo that silently shows invented imagery is worse than one that
fails loudly.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from .composite import (Period, PeriodComposite, build_periods,
                        composite_series, series_curve)
from .config import OUTPUT_DIR
from .growth import (GrowthSummary, PeriodAnalysis, analyse_periods,
                     growth_table, summarise_growth)
from .sources.earthsearch import bbox_from_point, load_scene, search_scenes

log = logging.getLogger(__name__)


@dataclass
class PeriodicResult:
    lat: float
    lon: float
    radius_km: float
    bbox: tuple[float, float, float, float]
    start: date
    end: date
    period_days: int

    scenes_found: int = 0
    scenes_used: int = 0
    composites: list[PeriodComposite] = field(default_factory=list)
    analyses: list[PeriodAnalysis] = field(default_factory=list)
    summary: GrowthSummary | None = None
    crop_match: list[tuple[str, float]] = field(default_factory=list)
    crop_verdict: str = ""

    transform: object = None
    crs: object = None
    images: dict[str, str] = field(default_factory=dict)
    outputs: dict[str, Path] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    data_source: str = "Sentinel-2 L2A (Copernicus, via AWS Open Data)"

    @property
    def area_ha(self) -> float:
        for c in self.composites:
            if c.has_data and c.ndvi.size:
                h, w = c.ndvi.shape
                return h * w * 100.0 / 10_000.0
        return 0.0

    def to_dict(self) -> dict:
        return {
            "coordinate": {"lat": self.lat, "lon": self.lon,
                           "radius_km": self.radius_km,
                           "bbox": list(self.bbox)},
            "window": {"start": self.start.isoformat(),
                       "end": self.end.isoformat(),
                       "period_days": self.period_days,
                       "n_periods": len(self.analyses)},
            "data_source": self.data_source,
            "imagery": {"scenes_found": self.scenes_found,
                        "scenes_used": self.scenes_used},
            "area_ha": round(self.area_ha, 2),
            "periods": [a.to_dict() for a in self.analyses],
            "summary": (self.summary.__dict__ if self.summary else None),
            "crop": {"ranking": [{"crop": n, "fit": round(f, 4)}
                                 for n, f in self.crop_match[:6]],
                     "verdict": self.crop_verdict},
            "images": self.images,
            "warnings": self.warnings,
            "generated": datetime.now(timezone.utc).isoformat(),
        }


def analyse_coordinate(
    lat: float,
    lon: float,
    radius_km: float = 1.0,
    start: date | None = None,
    end: date | None = None,
    period_days: int = 15,
    max_cloud: float = 85.0,
    min_clear_fraction: float = 0.10,
    output_dir: Path | str | None = None,
    make_images: bool = True,
    searcher=search_scenes,
    loader=load_scene,
) -> PeriodicResult:
    """
    Analyse one coordinate as a sequence of 15-day periods.

    `max_cloud` is deliberately high and `min_clear_fraction` low: scene-level
    cloud describes a 110 km tile, and a field can be clear inside a mostly
    cloudy one. Compositing then picks the best pixel per period, so a scene
    that is 80% cloud can still contribute the one clear corner that matters.
    Filtering hard at the scene level throws that away.
    """
    end = end or date.today()
    start = start or (end - timedelta(days=180))
    if end <= start:
        raise ValueError("end must be after start")

    bbox = bbox_from_point(lat, lon, radius_km)
    res = PeriodicResult(lat=lat, lon=lon, radius_km=radius_km, bbox=bbox,
                         start=start, end=end, period_days=period_days)
    log.info("Coordinate %.6f, %.6f  r=%.1f km  %s to %s",
             lat, lon, radius_km, start, end)

    scenes = searcher(bbox, start, end, max_cloud=max_cloud)
    res.scenes_found = len(scenes)
    if not scenes:
        raise RuntimeError(
            f"No Sentinel-2 scenes found over {lat:.5f}, {lon:.5f} between "
            f"{start} and {end}. Widen the date range, or check the "
            f"coordinate is on land within the Sentinel-2 archive.")

    # --- read every scene onto one aligned grid ---------------------------
    arrays = []
    ref_shape = None
    for sc in scenes:
        try:
            a = loader(sc, bbox)
        except Exception as exc:                       # noqa: BLE001
            log.debug("%s unreadable: %s", sc.scene_id, exc)
            continue
        if "red" not in a.bands or "nir" not in a.bands:
            continue
        shape = a.bands["red"].shape
        if ref_shape is None:
            ref_shape = shape
            res.transform, res.crs = a.transform, a.crs
        elif shape != ref_shape:
            # Different grid means the pixels are not the same ground; a
            # composite built from mismatched grids is meaningless.
            log.debug("%s shape %s != %s, skipped", sc.scene_id, shape, ref_shape)
            continue
        if a.clear_fraction < min_clear_fraction:
            continue
        arrays.append(a)

    res.scenes_used = len(arrays)
    if not arrays:
        raise RuntimeError(
            f"Found {res.scenes_found} scenes but none had at least "
            f"{min_clear_fraction:.0%} clear pixels over this AOI. "
            f"Try a wider date range or a larger radius.")

    # --- composite into fixed periods -------------------------------------
    periods = build_periods(start, end, period_days)
    res.composites = composite_series(periods, arrays)
    res.analyses = analyse_periods(res.composites)
    res.summary = summarise_growth(res.analyses)

    empty = [a for a in res.analyses if not a.has_data]
    if empty:
        res.warnings.append(
            f"{len(empty)} of {len(res.analyses)} periods had no cloud-free "
            f"view: {', '.join(a.label for a in empty[:6])}"
            f"{' …' if len(empty) > 6 else ''}. Monsoon cloud. SAR would "
            f"cover these.")

    _identify_crop(res)

    if make_images:
        out = Path(output_dir or OUTPUT_DIR) / f"coord_{lat:.5f}_{lon:.5f}"
        _render(res, out)

    return res


def _identify_crop(res: PeriodicResult) -> None:
    """Match the composited growth curve against crop phenology priors."""
    from .analyze import _calibrated_priors
    from .config import CROP_CLASSES, SEASONS
    from .preprocess.timeseries import phenology_metrics

    days, vals = series_curve(res.composites)
    if len(days) < 4:
        res.crop_verdict = ("Too few periods with imagery to identify a crop "
                            "from the growth curve.")
        return

    m = phenology_metrics(vals.reshape(1, -1).astype(np.float32), days)
    peak_day = float(m["peak_doy"][0])
    length = float(m["season_length"][0])
    amp = float(m["amplitude"][0])
    peak_val = float(m["peak_value"][0])

    if peak_val < 0.30:
        res.crop_match = [("Fallow / bare", 0.90)]
        res.crop_verdict = (f"No crop. Peak NDVI reached only {peak_val:.2f} "
                            f"across the whole window.")
        return
    if amp < 0.18:
        res.crop_match = [("Non-crop", 0.85)]
        res.crop_verdict = (f"No sowing-to-harvest cycle (amplitude "
                            f"{amp:.2f}). Permanent cover, not a seasonal crop.")
        return

    # Express the peak as days since the kharif season opened.
    season_start_doy = SEASONS["kharif"].start_doy
    offset = res.start.timetuple().tm_yday - season_start_doy
    if offset < -180:
        offset += 365
    obs_peak = peak_day + offset

    # Which season does this observation window actually sit in? A June-to-
    # November window is kharif, and offering wheat or gram as the answer
    # there is wrong however well the curve shape happens to fit — those are
    # rabi crops sown in October. Without this penalty the matcher will
    # cheerfully report wheat for a monsoon soybean field.
    mid_doy = (res.start + (res.end - res.start) / 2).timetuple().tm_yday
    if 150 <= mid_doy <= 300:
        window_season = "kharif"
    elif mid_doy >= 300 or mid_doy <= 110:
        window_season = "rabi"
    else:
        window_season = "summer"

    priors = _calibrated_priors("kharif")
    scores = []
    for crop in CROP_CLASSES:
        pr = priors.get(crop.name)
        if pr is None:
            continue
        pk = float(np.exp(-((obs_peak - pr["peak_doy"]) ** 2) / (2 * 26.0 ** 2)))
        ln = float(np.exp(-((length - pr["length"]) ** 2) / (2 * 30.0 ** 2)))
        am = float(np.exp(-((amp - pr["amplitude"]) ** 2) / (2 * 0.16 ** 2)))
        fit = 0.34 * pk + 0.42 * ln + 0.24 * am
        # A penalty, not a veto: irrigation does shift real sowing dates
        # outside the textbook window, so an out-of-season crop can still
        # surface if nothing else fits.
        if crop.season not in (window_season, "annual", "any"):
            fit *= 0.45
        scores.append((crop.name, fit))

    res.crop_match = sorted(scores, key=lambda kv: -kv[1])
    if not res.crop_match:
        return
    best, fit = res.crop_match[0]
    runner, rfit = (res.crop_match[1] if len(res.crop_match) > 1 else ("", 0.0))
    margin = fit - rfit
    if margin < 0.05:
        res.crop_verdict = (f"{best} (fit {fit:.0%}), but {runner} fits almost "
                            f"as well — treat both as candidates and confirm "
                            f"in the field.")
    elif fit < 0.55:
        res.crop_verdict = (f"Closest match {best} at only {fit:.0%} — no crop "
                            f"profile fits this curve well.")
    else:
        res.crop_verdict = (f"{best} (fit {fit:.0%}, {margin:.0%} clear of "
                            f"{runner}).")


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------

def _stretch(a: np.ndarray, lo=2, hi=98) -> np.ndarray:
    f = a[np.isfinite(a)]
    if f.size == 0:
        return np.zeros_like(a)
    p_lo, p_hi = np.percentile(f, [lo, hi])
    if p_hi - p_lo < 1e-9:
        return np.zeros_like(a)
    return np.clip((a - p_lo) / (p_hi - p_lo), 0, 1)


def _render(res: PeriodicResult, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap

    ndvi_cmap = LinearSegmentedColormap.from_list(
        "ndvi", ["#8c510a", "#d8b365", "#f6e8c3", "#c7eae5", "#5ab4ac", "#01665e"])
    # Pixels with no clear observation are shown in neutral grey, never black
    # or as the colormap's lowest value — otherwise "no data" is mistaken for
    # bare ground, which is the opposite of what it means.
    ndvi_cmap = ndvi_cmap.copy()
    ndvi_cmap.set_bad("#c9cdc6")
    NODATA_RGB = 0.78

    def rgb_with_nodata(bands_dict):
        """Stack RGB, painting unobserved pixels neutral grey."""
        chans = [stretch_global(bands_dict[b]) for b in ("red", "green", "blue")]
        missing = ~np.isfinite(bands_dict["red"])
        img = np.dstack(chans)
        img = np.where(np.isfinite(img), img, NODATA_RGB)
        img[missing] = NODATA_RGB
        return img

    # A single global stretch across every period, so brightness differences
    # between images are real changes on the ground rather than per-image
    # rescaling. Without this the strip is visually meaningless.
    rgb_all = []
    for c in res.composites:
        if c.has_data and {"red", "green", "blue"}.issubset(c.bands):
            rgb_all.append(np.dstack([c.bands["red"], c.bands["green"],
                                      c.bands["blue"]]))
    global_lo = global_hi = None
    if rgb_all:
        allv = np.concatenate([r[np.isfinite(r)].ravel() for r in rgb_all])
        if allv.size:
            global_lo, global_hi = np.percentile(allv, [2, 98])

    def stretch_global(a):
        if global_lo is None or global_hi - global_lo < 1e-9:
            return _stretch(a)
        return np.clip((a - global_lo) / (global_hi - global_lo), 0, 1)

    # --- per-period images ------------------------------------------------
    for c, a in zip(res.composites, res.analyses):
        if not c.has_data:
            continue
        tag = f"p{c.period.index:02d}"

        if {"red", "green", "blue"}.issubset(c.bands):
            rgb = rgb_with_nodata(c.bands)
            fig, ax = plt.subplots(figsize=(4.2, 4.2), dpi=120)
            ax.imshow(rgb)
            ax.set_title(f"{c.period.label}\n{a.stage}", fontsize=9)
            ax.axis("off")
            fig.tight_layout()
            p = out / f"{tag}_truecolor.png"
            fig.savefig(p, bbox_inches="tight"); plt.close(fig)
            res.images[f"{tag}_truecolor"] = p.name

        fig, ax = plt.subplots(figsize=(4.2, 4.2), dpi=120)
        ax.imshow(np.ma.masked_invalid(c.ndvi), cmap=ndvi_cmap,
                  vmin=-0.1, vmax=0.9)
        ax.set_title(f"{c.period.label}\nNDVI {a.mean_ndvi:.3f}", fontsize=9)
        ax.axis("off")
        fig.tight_layout()
        p = out / f"{tag}_ndvi.png"
        fig.savefig(p, bbox_inches="tight"); plt.close(fig)
        res.images[f"{tag}_ndvi"] = p.name

    # --- the strip --------------------------------------------------------
    good = [(c, a) for c, a in zip(res.composites, res.analyses) if c.has_data]
    if good:
        n = len(good)
        fig, axes = plt.subplots(2, n, figsize=(2.1 * n, 5.0), dpi=120,
                                 squeeze=False)
        for i, (c, a) in enumerate(good):
            if {"red", "green", "blue"}.issubset(c.bands):
                axes[0][i].imshow(rgb_with_nodata(c.bands))
            axes[0][i].set_title(c.period.short_label, fontsize=8)
            axes[0][i].axis("off")
            axes[1][i].imshow(np.ma.masked_invalid(c.ndvi), cmap=ndvi_cmap,
                              vmin=-0.1, vmax=0.9)
            axes[1][i].set_xlabel(f"{a.mean_ndvi:.2f}", fontsize=7)
            axes[1][i].set_xticks([]); axes[1][i].set_yticks([])
            for s in axes[1][i].spines.values():
                s.set_visible(False)
        axes[0][0].set_ylabel("true colour", fontsize=8)
        axes[1][0].set_ylabel("NDVI", fontsize=8)
        fig.suptitle(f"15-day composites · {res.lat:.5f}, {res.lon:.5f}",
                     fontsize=11)
        fig.tight_layout()
        p = out / "period_strip.png"
        fig.savefig(p, bbox_inches="tight"); plt.close(fig)
        res.images["strip"] = p.name
        res.outputs["strip"] = p

    # --- growth curve -----------------------------------------------------
    days, vals = series_curve(res.composites)
    if len(days) >= 2:
        fig, ax = plt.subplots(figsize=(9, 3.6), dpi=120)
        labels = [a.label for a in res.analyses if a.has_data]
        ax.plot(days, vals, "-o", color="#1c5e4a", lw=2, ms=5)
        for a in res.analyses:
            if a.has_data and "stress_detected" in a.flags:
                d = float((a.start + timedelta(days=7) - res.start).days)
                ax.axvspan(d - 7, d + 7, color="#b3451c", alpha=0.12)
        ax.set_xticks(days)
        ax.set_xticklabels(labels, rotation=45, ha="right", fontsize=7)
        ax.set_ylabel("NDVI (vegetated pixels)")
        ax.set_title("Crop growth across 15-day periods", fontsize=11)
        ax.grid(alpha=0.25)
        fig.tight_layout()
        p = out / "growth_curve.png"
        fig.savefig(p); plt.close(fig)
        res.images["growth_curve"] = p.name
        res.outputs["growth_curve"] = p

    # --- data files -------------------------------------------------------
    import json
    tbl = growth_table(res.analyses)
    tbl.to_csv(out / "period_analysis.csv", index=False)
    res.outputs["csv"] = out / "period_analysis.csv"
    (out / "analysis.json").write_text(json.dumps(res.to_dict(), indent=2,
                                                  default=str))
    res.outputs["json"] = out / "analysis.json"
    log.info("Rendered %d period images to %s", len(res.images), out)
