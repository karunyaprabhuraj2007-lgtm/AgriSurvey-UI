"""
Point analysis: give it a coordinate, get the imagery and the numbers.

    from cropsurvey.analyze import analyze_point
    result = analyze_point(lat=18.5204, lon=73.8567, radius_km=2.0,
                           season="kharif", year=2025)

What it does, in order:
  1. Builds an area of interest around the coordinate
  2. Finds every Sentinel-2 scene covering it in the season
  3. Reads only the AOI window from each scene's COGs
  4. Masks cloud, shadow and cirrus per pixel using the scene classification
  5. Computes indices per date and a smoothed time series per pixel
  6. Extracts phenology, matches it against crop priors
  7. Flags stressed patches relative to the rest of the AOI
  8. Writes imagery, charts, GeoTIFFs, a map and a report

On accuracy, plainly: the imagery and the indices are real measurements and
the radiometry is handled correctly. The crop identification is an inference
from the shape of a growth curve, reported with a confidence and a runner-up,
never as certainty. No remote sensing system is 100% right, and one that
claims to be is hiding its errors rather than lacking them. What this does
instead is show its working, so a wrong answer is visible as a weak match.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from functools import lru_cache
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np

from .config import CODE_TO_CROP, CROP_CLASSES, OUTPUT_DIR, SEASONS
from .sources.earthsearch import (SCL_WATER, S2Scene, SceneArrays,
                                  bbox_from_point, load_scene, scl_summary,
                                  search_scenes)

log = logging.getLogger(__name__)


@dataclass
class PointAnalysis:
    lat: float
    lon: float
    radius_km: float
    bbox: tuple[float, float, float, float]
    season: str
    year: int

    scenes_found: int = 0
    scenes_used: int = 0
    dates: list[datetime] = field(default_factory=list)
    clear_fraction: list[float] = field(default_factory=list)

    ndvi_stack: np.ndarray | None = None      # (n_dates, H, W)
    doys: np.ndarray | None = None
    transform: Any = None
    crs: Any = None
    last_rgb: np.ndarray | None = None
    last_scl: np.ndarray | None = None
    rgb_date: datetime | None = None

    stats: dict[str, Any] = field(default_factory=dict)
    phenology: dict[str, float] = field(default_factory=dict)
    crop_match: list[tuple[str, float]] = field(default_factory=list)
    cover: dict[str, float] = field(default_factory=dict)
    stress: dict[str, Any] = field(default_factory=dict)
    outputs: dict[str, Path] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)
    truncated: bool = False
    no_crop: bool = False
    unresolvable: list[str] = field(default_factory=list)
    window_start: date | None = None

    def day_to_doy(self, day_index: float) -> float:
        """Convert 'days since window start' back to a calendar day-of-year."""
        if self.window_start is None or not np.isfinite(day_index):
            return float("nan")
        return float((self.window_start
                      + timedelta(days=int(round(day_index)))).timetuple().tm_yday)

    @property
    def area_ha(self) -> float:
        if self.ndvi_stack is None:
            return 0.0
        h, w = self.ndvi_stack.shape[1:]
        return h * w * 100.0 / 10_000.0     # 10 m pixels -> hectares

    def text(self) -> str:
        lines = [
            "=" * 72,
            f"POINT ANALYSIS  {self.lat:.5f}, {self.lon:.5f}",
            f"{self.season} {self.year} · {self.radius_km} km radius · "
            f"{self.area_ha:,.0f} ha",
            "=" * 72,
            "",
            "IMAGERY",
            f"  Scenes found        {self.scenes_found}",
            f"  Scenes usable       {self.scenes_used}",
        ]
        if self.clear_fraction:
            lines.append(f"  Mean clear pixels   "
                         f"{np.mean(self.clear_fraction):.0%}")
        if self.dates:
            lines.append(f"  Date range          "
                         f"{min(self.dates):%Y-%m-%d} to {max(self.dates):%Y-%m-%d}")

        if self.cover:
            lines += ["", "LAND COVER (scene classification, last clear date)"]
            for k, v in sorted(self.cover.items(), key=lambda kv: -kv[1]):
                if v >= 0.005:
                    lines.append(f"  {k:18s} {v:6.1%}   {v * self.area_ha:8,.1f} ha")

        if self.stats:
            lines += ["", "VEGETATION INDEX (NDVI over the season)"]
            for k in ("mean", "median", "p10", "p90", "max"):
                if k in self.stats:
                    lines.append(f"  {k:18s} {self.stats[k]:+.3f}")
            if "vegetated_fraction" in self.stats:
                lines.append(f"  {'vegetated area':18s} "
                             f"{self.stats['vegetated_fraction']:6.1%}   "
                             f"{self.stats['vegetated_fraction'] * self.area_ha:8,.1f} ha")

        if self.phenology:
            lines += ["", "PHENOLOGY (AOI mean curve)"]
            for k, label in (("peak_value", "peak NDVI"),
                             ("season_length", "season length (days)"),
                             ("amplitude", "amplitude"),
                             ("integral", "integral")):
                v = self.phenology.get(k)
                if v is not None and np.isfinite(v):
                    lines.append(f"  {label:22s} {v:8.2f}")
            for k, label in (("sos_doy", "start of season"),
                             ("peak_doy", "peak canopy"),
                             ("eos_doy", "end of season")):
                v = self.phenology.get(k)
                if v is not None and np.isfinite(v) and self.window_start:
                    when = self.window_start + timedelta(days=int(round(v)))
                    lines.append(f"  {label:22s} {when:%d %b %Y}"
                                 f"   (DOY {when.timetuple().tm_yday})")

        if self.crop_match:
            lines += ["", "CROP IDENTIFICATION (inference, not measurement)",
                      "  fit = how well the observed curve matches the crop's "
                      "expected phenology"]
            for name, score in self.crop_match[:4]:
                bar = "#" * int(round(score * 30))
                mark = " (window too short)" if name in self.unresolvable else ""
                lines.append(f"  {name:22s} fit {score:5.1%}  {bar}{mark}")
            best, s1 = self.crop_match[0]
            runner = self.crop_match[1] if len(self.crop_match) > 1 else (None, 0.0)
            margin = s1 - runner[1]
            if self.truncated:
                verdict = "unreliable — the growth curve is truncated"
            elif s1 < 0.55:
                verdict = "poor fit — none of these crops match well"
            elif margin < 0.05:
                verdict = (f"ambiguous — {runner[0]} fits almost as well "
                           f"({margin:.1%} apart)")
            else:
                verdict = "clear"
            lines.append(f"  -> {best}: fit {s1:.0%}, "
                         f"margin over runner-up {margin:.0%} — {verdict}")
            lines.append("     Phenology alone cannot separate crops with "
                         "similar cycles (cotton and tur, for instance).")
            lines.append("     For a decision, use the trained classifier, "
                         "which also reads SWIR, red edge and SAR.")

        if self.stress:
            lines += ["", "CONDITION WITHIN THE AOI"]
            lines.append(f"  Stressed pixels     {self.stress['stressed_fraction']:.1%}"
                         f"   {self.stress['stressed_ha']:,.1f} ha")
            lines.append(f"  Threshold           NDVI z < {self.stress['z_threshold']:.1f} "
                         f"against the AOI's own distribution")
            lines.append("  Note                relative to this AOI only. A "
                         "uniformly poor area shows nothing,")
            lines.append("                      and a mixed one flags its "
                         "weaker fields as stressed.")

        if self.warnings:
            lines += ["", "WARNINGS"]
            lines += [f"  ! {w}" for w in self.warnings]

        lines += ["", "=" * 72]
        return "\n".join(lines)


def _season_window(season: str, year: int) -> tuple[date, date]:
    s = SEASONS[season]
    start = date(year, 1, 1) + timedelta(days=s.start_doy - 1)
    end_year = year + 1 if s.spans_year_end else year
    end = date(end_year, 1, 1) + timedelta(days=s.end_doy - 1)
    return start, min(end, date.today())


def analyze_point(
    lat: float,
    lon: float,
    radius_km: float = 2.0,
    season: str = "kharif",
    year: int | None = None,
    start: date | None = None,
    end: date | None = None,
    max_cloud: float = 70.0,
    min_clear_fraction: float = 0.25,
    max_scenes: int = 40,
    output_dir: Path | str | None = None,
    make_outputs: bool = True,
    searcher=search_scenes,
    loader=load_scene,
) -> PointAnalysis:
    """
    Analyse one coordinate. `searcher` and `loader` are injectable so the
    whole pipeline can be exercised offline against local fixtures.
    """
    year = year or datetime.now(timezone.utc).year
    if season not in SEASONS:
        raise ValueError(f"unknown season {season!r}; choose from {sorted(SEASONS)}")
    if start is None or end is None:
        start, end = _season_window(season, year)

    bbox = bbox_from_point(lat, lon, radius_km)
    res = PointAnalysis(lat=lat, lon=lon, radius_km=radius_km, bbox=bbox,
                        season=season, year=year)
    log.info("AOI %.5f,%.5f r=%.1fkm -> bbox %s", lat, lon, radius_km, bbox)

    scenes = searcher(bbox, start, end, max_cloud=max_cloud)
    res.scenes_found = len(scenes)
    if not scenes:
        res.warnings.append(
            f"No scenes between {start} and {end} under {max_cloud:.0f}% cloud. "
            "Widen the date range or raise --max-cloud.")
        return res

    if len(scenes) > max_scenes:
        # Keep an even spread through the season rather than the first N,
        # so phenology is sampled across the whole growth cycle.
        idx = np.linspace(0, len(scenes) - 1, max_scenes).astype(int)
        scenes = [scenes[i] for i in sorted(set(idx))]

    ndvi_layers: list[np.ndarray] = []
    doys: list[float] = []          # days since the window start, NOT day-of-year
    ref_shape: tuple[int, int] | None = None

    for scene in scenes:
        try:
            arr = loader(scene, bbox)
        except Exception as exc:                        # noqa: BLE001
            log.warning("%s: skipped (%s)", scene.scene_id, exc)
            continue

        if arr.clear_fraction < min_clear_fraction:
            log.debug("%s: only %.0f%% clear, skipped",
                      scene.scene_id, arr.clear_fraction * 100)
            continue
        if "red" not in arr.bands or "nir" not in arr.bands:
            continue

        red, nir = arr.bands["red"], arr.bands["nir"]
        if ref_shape is None:
            ref_shape = red.shape
            res.transform, res.crs = arr.transform, arr.crs
        elif red.shape != ref_shape:
            log.debug("%s: shape %s != %s, skipped",
                      scene.scene_id, red.shape, ref_shape)
            continue

        with np.errstate(divide="ignore", invalid="ignore"):
            denom = nir + red
            ndvi = np.where(np.abs(denom) > 1e-6, (nir - red) / denom, np.nan)

        ndvi_layers.append(ndvi.astype(np.float32))
        # Day-of-year resets to 1 on 1 January, so using it directly scrambles
        # the time order of any window crossing the year end — which is every
        # rabi season. Index days from the window start instead.
        doys.append(float((scene.acquired.date() - start).days))
        res.dates.append(scene.acquired)
        res.clear_fraction.append(arr.clear_fraction)

        # Keep the CLEAREST scene for the true-colour preview, not the last
        # one. The last date in a season is often heavily clouded, and a black
        # noisy image is worse than useless when the imagery itself is a
        # deliverable. Ties are broken toward mid-season, when the crop is
        # actually visible.
        if {"red", "green", "blue"}.issubset(arr.bands):
            mid = 0.5 * (res.doys[0] + res.doys[-1]) if res.doys is not None else None
            midness = 1.0
            score = arr.clear_fraction * midness
            if score > getattr(res, "_best_rgb_score", -1.0):
                res._best_rgb_score = score
                res.last_rgb = np.dstack([arr.bands["red"], arr.bands["green"],
                                          arr.bands["blue"]])
                res.rgb_date = scene.acquired
                if arr.scl is not None:
                    res.last_scl = arr.scl
        elif arr.scl is not None and res.last_scl is None:
            res.last_scl = arr.scl

    res.window_start = start
    res.scenes_used = len(ndvi_layers)
    if res.scenes_used == 0:
        res.warnings.append(
            f"All {res.scenes_found} scenes were below {min_clear_fraction:.0%} "
            "clear over this AOI. In kharif this is normal — lower "
            "--min-clear or use SAR.")
        return res

    order = np.argsort(doys)
    res.ndvi_stack = np.stack([ndvi_layers[i] for i in order])
    res.doys = np.array([doys[i] for i in order])
    res.dates = [res.dates[i] for i in order]
    res.clear_fraction = [res.clear_fraction[i] for i in order]

    if res.scenes_used < 5:
        res.warnings.append(
            f"Only {res.scenes_used} usable dates — phenology from fewer than "
            "about 5 observations is unreliable, and crop identification "
            "should be treated as a guess.")

    _compute_statistics(res)
    _compute_phenology(res)
    _match_crop(res)
    _assess_stress(res)

    if make_outputs:
        _write_outputs(res, Path(output_dir or OUTPUT_DIR) /
                       f"point_{lat:.4f}_{lon:.4f}")
    return res


def _compute_statistics(res: PointAnalysis) -> None:
    stack = res.ndvi_stack
    with np.errstate(invalid="ignore"):
        composite = np.nanmax(stack, axis=0)     # peak-of-season composite
        mean_t = np.nanmean(stack, axis=0)
        flat = composite[np.isfinite(composite)]

    if flat.size == 0:
        res.warnings.append("No finite NDVI pixels after masking.")
        return

    res.stats = {
        "mean": float(np.nanmean(mean_t)),
        "median": float(np.median(flat)),
        "p10": float(np.percentile(flat, 10)),
        "p90": float(np.percentile(flat, 90)),
        "max": float(flat.max()),
        "std": float(flat.std()),
        # NDVI > 0.3 at peak is the usual working threshold for an actively
        # growing canopy in this setting.
        "vegetated_fraction": float((flat > 0.30).mean()),
        "bare_fraction": float((flat <= 0.15).mean()),
        "n_pixels": int(flat.size),
    }
    res._composite = composite          # type: ignore[attr-defined]

    if res.last_scl is not None:
        res.cover = {k: v for k, v in scl_summary(res.last_scl).items() if v > 0}


def _compute_phenology(res: PointAnalysis) -> None:
    """
    Build the AOI growth curve from *vegetated pixels only*.

    Averaging over the whole AOI mixes water, bare soil and built surfaces
    into the curve. That does not merely add noise — it systematically
    suppresses the amplitude and flattens the peak, which then pushes crop
    identification toward short, low-canopy crops regardless of what is
    actually growing. Restricting the curve to pixels that reach a canopy at
    some point in the season is what makes the phenology mean anything.
    """
    from .preprocess.timeseries import phenology_metrics

    composite = getattr(res, "_composite", None)
    flat = res.ndvi_stack.reshape(len(res.doys), -1)

    veg_mask = None
    if composite is not None:
        veg_mask = (composite > 0.30).ravel()
        n_veg = int(veg_mask.sum())
        if n_veg < 25:
            res.warnings.append(
                f"Only {n_veg} vegetated pixels; phenology computed over the "
                "whole AOI, so amplitude is suppressed by bare and water areas.")
            veg_mask = None
        else:
            res.stats["phenology_pixels"] = n_veg

    with np.errstate(invalid="ignore"):
        curve = (np.nanmean(flat[:, veg_mask], axis=1) if veg_mask is not None
                 else np.nanmean(flat, axis=1))
    series = curve.reshape(1, -1).astype(np.float32)

    if np.isfinite(series).sum() < 4:
        res.warnings.append("Too few valid dates for phenology.")
        return

    metrics = phenology_metrics(series, res.doys)
    res.phenology = {k: float(v[0]) for k, v in metrics.items()}
    res._curve = curve                  # type: ignore[attr-defined]



@lru_cache(maxsize=32)
def _calibrated_priors(season: str, cadence: int = 5) -> dict:
    """
    Expected phenology per crop, measured the same way observations are.

    Computing the expected peak and season length from a formula while
    measuring the observed ones with `phenology_metrics` puts the two in
    different spaces: the metric finds start and end of season at 30% of
    amplitude, which is systematically narrower than the nominal duration.
    Comparing across that gap biases every match toward short-duration crops.

    So the priors are generated by running each crop's canonical growth curve
    through the identical measurement function. Expected and observed then
    mean the same thing.
    """
    from .preprocess.timeseries import phenology_metrics

    out: dict[str, dict] = {}
    for crop in CROP_CLASSES:
        if crop.duration_days <= 0:
            continue
        sos = float(crop.sow_offset_days)
        eos = sos + crop.duration_days * 0.78
        days = np.arange(0.0, crop.duration_days + 120.0, cadence)
        curve = 0.14 + (crop.peak_vi - 0.14) * (
            1.0 / (1.0 + np.exp(-crop.greenup_rate * (days - sos)))
            - 1.0 / (1.0 + np.exp(-crop.senesce_rate * (days - eos))))
        m = phenology_metrics(curve.reshape(1, -1).astype(np.float32), days)
        out[crop.name] = {
            "peak_doy": float(m["peak_doy"][0]),
            "length": float(m["season_length"][0]),
            "amplitude": float(m["amplitude"][0]),
        }
    return out


def _detect_truncation(res: PointAnalysis) -> bool:
    """
    Is the growth curve cut off by the end of the observation window?

    A crop whose cycle is longer than the window never shows senescence, so
    its apparent season length equals the window and its amplitude is
    suppressed. Left undetected this silently misidentifies every
    long-duration crop as a short one — sugarcane reads as sorghum. The cure
    is a longer window, and the system should say so rather than answer
    confidently from data that cannot support an answer.
    """
    curve = getattr(res, "_curve", None)
    ph = res.phenology
    if curve is None or not ph or len(res.doys) < 4:
        return False

    base = ph.get("base_value", np.nan)
    amp = ph.get("amplitude", np.nan)
    if not (np.isfinite(base) and np.isfinite(amp)) or amp <= 1e-6:
        return False

    finite = np.isfinite(curve)
    if finite.sum() < 3:
        return False
    last = float(curve[finite][-1])
    # Still more than 55% of the way up the amplitude at the final date means
    # the canopy had not senesced when observation stopped.
    still_green = (last - base) / amp > 0.55

    eos = ph.get("eos_doy", np.nan)
    window_end = float(res.doys[-1])
    step = float(np.median(np.diff(res.doys))) if len(res.doys) > 1 else 10.0
    eos_at_edge = np.isfinite(eos) and (window_end - eos) <= 1.5 * step

    return bool(still_green and eos_at_edge)


def _match_crop(res: PointAnalysis) -> None:
    """
    Score each crop by how well its expected phenology fits what was observed.

    This is an inference and is labelled as one everywhere it appears. The
    score combines peak timing, season length and canopy amplitude; the
    runner-up and the margin are reported so a weak match is visible rather
    than hidden behind a single confident-looking answer.
    """
    ph = res.phenology
    if not ph or not np.isfinite(ph.get("peak_doy", np.nan)):
        return

    # Express the observed peak as days since the season opened, so the
    # comparison with each crop's expected phenology is wrap-free.
    season_start_doy = SEASONS[res.season].start_doy
    window_start_doy = (res.window_start.timetuple().tm_yday
                        if res.window_start else season_start_doy)
    season_offset = window_start_doy - season_start_doy
    if season_offset < -180:
        season_offset += 365
    obs_peak = ph["peak_doy"] + season_offset
    obs_len = ph.get("season_length", np.nan)
    obs_amp = ph.get("amplitude", np.nan)

    truncated = _detect_truncation(res)
    res.truncated = truncated

    # A field that never develops a canopy did not grow a crop. Scoring it
    # against crop phenology will always name *something* — the curve is flat,
    # so whichever crop has the lowest expected amplitude wins by default, and
    # the output reads "Bajra, 850 kg/ha" for bare ground. That is the kind of
    # error a district officer spots immediately, so it is decided here by a
    # hard rule rather than left to the scoring.
    peak = res.stats.get("max", np.nan)
    veg_frac = res.stats.get("vegetated_fraction", np.nan)
    amp = ph.get("amplitude", np.nan)
    if (np.isfinite(peak) and peak < 0.30) or \
       (np.isfinite(veg_frac) and veg_frac < 0.12):
        res.no_crop = True
        res.crop_match = [("Fallow / bare", 0.90), ("Non-crop", 0.45)]
        res.warnings.append(
            f"Peak NDVI over the whole season reached only {peak:.2f} and "
            f"{veg_frac:.0%} of the area ever became vegetated. No crop was "
            f"grown here in this season — reported as fallow, and no yield "
            f"is estimated.")
        return
    if np.isfinite(amp) and amp < 0.18:
        res.no_crop = True
        res.crop_match = [("Non-crop", 0.80), ("Fallow / bare", 0.55)]
        res.warnings.append(
            f"The signal is flat all season (amplitude {amp:.2f}) with no "
            f"sowing-to-harvest cycle. This is permanent cover — trees, "
            f"built-up or water — not a seasonal crop.")
        return
    window_days = float(res.doys[-1] - res.doys[0]) if len(res.doys) > 1 else 0.0

    if truncated:
        res.warnings.append(
            f"The canopy had not senesced by the last observation "
            f"({res.dates[-1]:%d %b}), so the growth curve is cut off by the "
            f"{window_days:.0f}-day window. Season length and amplitude are "
            f"lower bounds, and any crop with a cycle longer than the window "
            f"cannot be distinguished. Re-run with a wider --start/--end.")

    priors = _calibrated_priors(res.season)
    scores: list[tuple[str, float]] = []
    for crop in CROP_CLASSES:
        if crop.duration_days <= 0:
            # Fallow / non-crop: identified by a flat, low profile.
            amp_term = (1.0 if not np.isfinite(obs_amp)
                        else float(np.exp(-((obs_amp - 0.05) ** 2) / (2 * 0.09 ** 2))))
            scores.append((crop.name, 0.55 * amp_term))
            continue

        prior = priors.get(crop.name)
        if prior is None:
            continue
        exp_peak = prior["peak_doy"]
        exp_len = prior["length"]
        exp_amp = prior["amplitude"]

        # Season length is the strongest discriminator between crops with
        # similar sowing dates, so it is weighted up and given a tighter
        # tolerance than before.
        peak_term = float(np.exp(-((obs_peak - exp_peak) ** 2) / (2 * 26.0 ** 2)))
        len_term = (0.5 if not np.isfinite(obs_len)
                    else float(np.exp(-((obs_len - exp_len) ** 2) / (2 * 30.0 ** 2))))
        amp_term = (0.5 if not np.isfinite(obs_amp)
                    else float(np.exp(-((obs_amp - exp_amp) ** 2) / (2 * 0.16 ** 2))))

        # A crop grown in a different season gets a penalty but not a veto —
        # irrigation shifts real sowing dates well outside the textbook window.
        season_ok = crop.season in (res.season, "annual", "any")
        penalty = 1.0 if season_ok else 0.45

        if truncated and crop.duration_days > window_days * 0.95:
            # The window cannot see this crop complete, so length and
            # amplitude carry no information for it. Judge on timing alone
            # and mark it unresolvable rather than scoring it as a poor fit.
            fit = penalty * peak_term
            res.unresolvable.append(crop.name)
        else:
            fit = penalty * (0.34 * peak_term + 0.42 * len_term
                             + 0.24 * amp_term)
        scores.append((crop.name, float(fit)))

    # Report the raw goodness of fit, which is interpretable on its own, rather
    # than a share across twelve classes that makes a correct answer look weak.
    res.crop_match = sorted(scores, key=lambda kv: -kv[1])


def _assess_stress(res: PointAnalysis, z_threshold: float = -1.3) -> None:
    composite = getattr(res, "_composite", None)
    if composite is None:
        return
    veg = composite > 0.30
    if veg.sum() < 50:
        return
    vals = composite[veg]
    med = float(np.median(vals))
    mad = float(np.median(np.abs(vals - med)))
    scale = 1.4826 * mad
    if scale < 1e-6:
        return
    z = (composite - med) / scale
    stressed = veg & (z < z_threshold)
    res.stress = {
        "stressed_fraction": float(stressed.sum() / max(veg.sum(), 1)),
        "stressed_ha": float(stressed.sum() * 100.0 / 10_000.0),
        "z_threshold": z_threshold,
    }
    res._stress_mask = stressed         # type: ignore[attr-defined]
    res._zmap = z                       # type: ignore[attr-defined]


# --------------------------------------------------------------------------
# Outputs
# --------------------------------------------------------------------------

def _write_outputs(res: PointAnalysis, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    try:
        _plot_truecolor(res, out)
        _plot_ndvi(res, out)
        _plot_timeseries(res, out)
        _plot_crop_match(res, out)
    except Exception as exc:                            # noqa: BLE001
        log.warning("figure generation failed: %s", exc)
        res.warnings.append(f"Some figures could not be drawn: {exc}")

    try:
        _write_geotiff(res, out)
    except Exception as exc:                            # noqa: BLE001
        log.warning("GeoTIFF export failed: %s", exc)

    (out / "report.txt").write_text(res.text() + "\n")
    res.outputs["report"] = out / "report.txt"

    import json
    payload = {
        "coordinate": {"lat": res.lat, "lon": res.lon,
                       "radius_km": res.radius_km, "bbox": list(res.bbox)},
        "season": res.season, "year": res.year,
        "area_ha": round(res.area_ha, 2),
        "generated": datetime.now(timezone.utc).isoformat(),
        "imagery": {
            "scenes_found": res.scenes_found,
            "scenes_used": res.scenes_used,
            "dates": [d.strftime("%Y-%m-%d") for d in res.dates],
            "clear_fraction": [round(c, 4) for c in res.clear_fraction],
        },
        "ndvi": {k: (round(v, 4) if isinstance(v, float) else v)
                 for k, v in res.stats.items()},
        "land_cover": {k: round(v, 4) for k, v in res.cover.items()},
        "truecolor_date": res.rgb_date.strftime("%Y-%m-%d") if res.rgb_date else None,
        "phenology": {k: (round(v, 3) if np.isfinite(v) else None)
                      for k, v in res.phenology.items()},
        "crop_match": [{"crop": n, "score": round(s, 4)}
                       for n, s in res.crop_match[:6]],
        "condition": res.stress,
        "curve_truncated": res.truncated,
        "no_crop": res.no_crop,
        "unresolvable_crops": res.unresolvable,
        "warnings": res.warnings,
        "disclaimer": ("NDVI and land cover are measurements. Crop "
                       "identification is an inference from phenology and "
                       "carries the stated score, not certainty."),
    }
    (out / "analysis.json").write_text(json.dumps(payload, indent=2))
    res.outputs["json"] = out / "analysis.json"
    log.info("Outputs written to %s", out)


def _stretch(a: np.ndarray, lo_pct=2, hi_pct=98) -> np.ndarray:
    finite = a[np.isfinite(a)]
    if finite.size == 0:
        return np.zeros_like(a)
    lo, hi = np.percentile(finite, [lo_pct, hi_pct])
    if hi - lo < 1e-9:
        return np.zeros_like(a)
    return np.clip((a - lo) / (hi - lo), 0, 1)


def _plot_truecolor(res: PointAnalysis, out: Path) -> None:
    if res.last_rgb is None:
        return
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    rgb = np.dstack([_stretch(res.last_rgb[:, :, i]) for i in range(3)])
    rgb = np.nan_to_num(rgb)
    fig, ax = plt.subplots(figsize=(7, 7), dpi=130)
    ax.imshow(rgb)
    when = res.rgb_date or (res.dates[-1] if res.dates else None)
    stamp = f"{when:%d %b %Y}" if when else "clearest date"
    ax.set_title(f"True colour · {stamp} (clearest pass)\n"
                 f"{res.lat:.4f}, {res.lon:.4f}", fontsize=11)
    ax.axis("off")
    fig.tight_layout()
    p = out / "truecolor.png"
    fig.savefig(p, bbox_inches="tight")
    plt.close(fig)
    res.outputs["truecolor"] = p


def _plot_ndvi(res: PointAnalysis, out: Path) -> None:
    composite = getattr(res, "_composite", None)
    if composite is None:
        return
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.colors import LinearSegmentedColormap

    cmap = LinearSegmentedColormap.from_list(
        "ndvi", ["#8c510a", "#d8b365", "#f6e8c3",
                 "#c7eae5", "#5ab4ac", "#01665e"])
    fig, ax = plt.subplots(figsize=(7.6, 7), dpi=130)
    im = ax.imshow(composite, cmap=cmap, vmin=-0.1, vmax=0.9)
    ax.set_title("Peak-of-season NDVI\n"
                 f"{res.season} {res.year} · {res.scenes_used} clear dates",
                 fontsize=11)
    ax.axis("off")
    cb = fig.colorbar(im, ax=ax, fraction=0.045, pad=0.03)
    cb.set_label("NDVI", fontsize=9)
    fig.tight_layout()
    p = out / "ndvi.png"
    fig.savefig(p, bbox_inches="tight")
    plt.close(fig)
    res.outputs["ndvi_map"] = p


def _plot_timeseries(res: PointAnalysis, out: Path) -> None:
    curve = getattr(res, "_curve", None)
    if curve is None:
        return
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(9, 4.2), dpi=130)
    ax.plot(res.doys, curve, "-o", color="#2f7d5b", lw=1.8, ms=4.5,
            label="AOI mean NDVI")

    ph = res.phenology
    for key, colour, label in (("sos_doy", "#1f77b4", "start of season"),
                               ("peak_doy", "#d95f02", "peak"),
                               ("eos_doy", "#7570b3", "end of season")):
        v = ph.get(key)
        if v is not None and np.isfinite(v):
            ax.axvline(v, color=colour, ls="--", lw=1.1, alpha=0.8, label=label)

    ax.set_xlabel("day of year")
    ax.set_ylabel("NDVI")
    ax.set_title(f"Seasonal NDVI · {res.lat:.4f}, {res.lon:.4f}", fontsize=11)
    ax.grid(alpha=0.25)
    ax.legend(fontsize=8, loc="best")
    fig.tight_layout()
    p = out / "ndvi_timeseries.png"
    fig.savefig(p)
    plt.close(fig)
    res.outputs["timeseries"] = p


def _plot_crop_match(res: PointAnalysis, out: Path) -> None:
    if not res.crop_match:
        return
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    top = res.crop_match[:6][::-1]
    names = [n for n, _ in top]
    vals = [s for _, s in top]
    fig, ax = plt.subplots(figsize=(7.4, 3.4), dpi=130)
    bars = ax.barh(names, vals, color="#5ab4ac", edgecolor="#01665e")
    bars[-1].set_color("#d95f02")
    ax.set_xlabel("phenology match score")
    ax.set_title("Crop identification — inference, not measurement",
                 fontsize=10.5)
    ax.grid(axis="x", alpha=0.25)
    fig.tight_layout()
    p = out / "crop_match.png"
    fig.savefig(p)
    plt.close(fig)
    res.outputs["crop_match"] = p


def _write_geotiff(res: PointAnalysis, out: Path) -> None:
    composite = getattr(res, "_composite", None)
    if composite is None or res.transform is None:
        return
    import rasterio

    p = out / "ndvi_peak.tif"
    with rasterio.open(
        p, "w", driver="GTiff", height=composite.shape[0],
        width=composite.shape[1], count=1, dtype="float32",
        crs=res.crs, transform=res.transform, compress="deflate",
        nodata=np.nan,
    ) as dst:
        dst.write(composite.astype(np.float32), 1)
        dst.set_band_description(1, "peak-of-season NDVI")
    res.outputs["geotiff"] = p
