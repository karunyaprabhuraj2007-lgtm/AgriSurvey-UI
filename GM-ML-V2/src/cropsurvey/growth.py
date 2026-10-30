"""
Per-period crop growth and health analysis.

Answers, for each 15-day period, the four questions the problem statement
asks: what stage is the crop at, is it growing or declining, is it healthy,
and what changed since the last period.

The method throughout is **relative, not absolute**. An NDVI of 0.55 means
nothing on its own — it is excellent for bajra in week six and alarming for
irrigated wheat in week ten. Every judgement here is made against one of two
references: the field's own trajectory across the season, or the distribution
of other pixels in the same field at the same moment. That is what makes an
alert actionable rather than noise.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

import numpy as np

from .composite import PeriodComposite

log = logging.getLogger(__name__)


#: Growth stages, ordered. Thresholds are on NDVI *relative to the field's own
#: seasonal amplitude*, not absolute values, except for the bare-soil floor.
STAGES = ["No data", "Bare / pre-sowing", "Emergence", "Vegetative",
          "Canopy development", "Peak canopy", "Senescence",
          "Harvested / residue"]


@dataclass
class PeriodAnalysis:
    """Everything known about one 15-day period."""
    index: int
    start: date
    end: date
    label: str

    has_data: bool
    n_scenes: int
    coverage: float
    source_dates: list[str] = field(default_factory=list)

    mean_ndvi: float = float("nan")
    median_ndvi: float = float("nan")
    p10_ndvi: float = float("nan")
    p90_ndvi: float = float("nan")
    vegetated_fraction: float = float("nan")

    stage: str = "No data"
    growth_rate: float = float("nan")      # NDVI change per day since previous
    change_since_previous: float = float("nan")
    direction: str = ""                    # growing / stable / declining

    health: str = "Not assessed"
    stressed_fraction: float = float("nan")
    uniformity: float = float("nan")       # 1 - (IQR / median), higher is better

    reading: str = ""                      # plain-language summary
    flags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        def clean(v):
            if isinstance(v, float) and not np.isfinite(v):
                return None
            return v
        return {k: clean(v) for k, v in self.__dict__.items()}


def analyse_periods(
    composites: list[PeriodComposite],
    veg_threshold: float = 0.30,
    stress_z: float = -1.3,
) -> list[PeriodAnalysis]:
    """
    Analyse the whole season, period by period.

    Two passes are needed. The first establishes the field's own seasonal
    baseline and peak; the second judges each period against them. Growth
    stage cannot be assigned from a single period in isolation — the same
    NDVI reading means "still growing" on the way up and "senescing" on the
    way down, and only the whole series distinguishes them.
    """
    # --- pass 1: the field's own envelope ---------------------------------
    means = np.array([c.mean_ndvi() for c in composites], dtype=float)
    finite = np.isfinite(means)

    if finite.sum() == 0:
        return [_empty_analysis(c) for c in composites]

    season_peak = float(np.nanmax(means))
    season_base = float(np.nanpercentile(means[finite], 10))
    amplitude = season_peak - season_base
    peak_idx = int(np.nanargmax(np.where(finite, means, -np.inf)))

    # A vegetated mask from the peak composite, reused for every period so
    # the same pixels are compared through time.
    veg_mask = None
    peak_comp = composites[peak_idx]
    if peak_comp.has_data:
        m = peak_comp.ndvi > veg_threshold
        if m.sum() >= 25:
            veg_mask = m

    # --- pass 2: judge each period ----------------------------------------
    out: list[PeriodAnalysis] = []
    prev_mean = None
    prev_days = None

    for i, c in enumerate(composites):
        if not c.has_data:
            out.append(_empty_analysis(c))
            prev_mean, prev_days = None, None
            continue

        layer = c.ndvi if veg_mask is None else np.where(veg_mask, c.ndvi, np.nan)
        v = layer[np.isfinite(layer)]
        if v.size == 0:
            out.append(_empty_analysis(c))
            continue

        a = PeriodAnalysis(
            index=c.period.index, start=c.period.start, end=c.period.end,
            label=c.period.label, has_data=True, n_scenes=c.n_scenes,
            coverage=c.coverage,
            source_dates=[d.strftime("%d %b %Y") for d in c.source_dates],
            mean_ndvi=float(v.mean()),
            median_ndvi=float(np.median(v)),
            p10_ndvi=float(np.percentile(v, 10)),
            p90_ndvi=float(np.percentile(v, 90)),
            vegetated_fraction=float((v > veg_threshold).mean()),
        )

        # --- change since the previous period with data -------------------
        day = float((c.period.mid - composites[0].period.start).days)
        if prev_mean is not None and prev_days is not None:
            delta = a.mean_ndvi - prev_mean
            span = max(day - prev_days, 1.0)
            a.change_since_previous = delta
            a.growth_rate = delta / span
            if delta > 0.04:
                a.direction = "growing"
            elif delta < -0.04:
                a.direction = "declining"
            else:
                a.direction = "stable"
        prev_mean, prev_days = a.mean_ndvi, day

        # --- growth stage --------------------------------------------------
        a.stage = _stage(a.mean_ndvi, season_base, amplitude, i, peak_idx,
                         a.direction)

        # --- health, relative to the rest of the field at this moment ------
        med = float(np.median(v))
        mad = float(np.median(np.abs(v - med)))
        scale = 1.4826 * mad
        if scale > 1e-6 and v.size >= 50:
            z = (v - med) / scale
            a.stressed_fraction = float((z < stress_z).mean())
        q1, q3 = np.percentile(v, [25, 75])
        a.uniformity = float(1.0 - (q3 - q1) / max(abs(med), 1e-6))
        a.health = _health(a, amplitude)

        a.flags = _flags(a, c, amplitude)
        a.reading = _reading(a)
        out.append(a)

    log.info("Analysed %d periods, %d with imagery",
             len(out), sum(1 for a in out if a.has_data))
    return out


def _empty_analysis(c: PeriodComposite) -> PeriodAnalysis:
    return PeriodAnalysis(
        index=c.period.index, start=c.period.start, end=c.period.end,
        label=c.period.label, has_data=False, n_scenes=c.n_scenes,
        coverage=c.coverage, stage="No data", health="Not assessed",
        reading=("No cloud-free satellite view in this window. In the monsoon "
                 "this is routine; radar would fill the gap."),
        flags=["no_imagery"],
    )


def _stage(ndvi: float, base: float, amplitude: float,
           idx: int, peak_idx: int, direction: str) -> str:
    """Growth stage from position on the field's own curve."""
    if not np.isfinite(ndvi):
        return "No data"
    if ndvi < 0.18:
        return "Bare / pre-sowing"
    if amplitude < 0.08:
        # No real seasonal cycle — permanent cover rather than a crop.
        return "Vegetative" if ndvi > 0.45 else "Bare / pre-sowing"

    rel = (ndvi - base) / amplitude
    after_peak = idx > peak_idx

    if after_peak and direction == "declining":
        return "Harvested / residue" if rel < 0.30 else "Senescence"
    if rel < 0.18:
        return "Bare / pre-sowing"
    if rel < 0.38:
        return "Emergence"
    if rel < 0.62:
        return "Vegetative"
    if rel < 0.85:
        return "Canopy development"
    return "Peak canopy"


def _health(a: PeriodAnalysis, amplitude: float) -> str:
    """
    Health from within-field spread and stressed share.

    Stage gates this. At emergence a field is mostly soil with scattered
    seedlings, so pixel-to-pixel spread is large by nature — judging it the
    same way as a closed canopy labels every healthy young crop "poor". The
    measure only becomes meaningful once there is a canopy to compare across.
    """
    if a.stage in ("Bare / pre-sowing", "No data", "Harvested / residue"):
        return "Not applicable"
    if a.stage == "Emergence":
        return "Too early to assess"
    sf = a.stressed_fraction
    if not np.isfinite(sf):
        return "Not assessed"
    if sf > 0.25:
        return "Poor — large stressed area"
    if sf > 0.12:
        return "Patchy — localised stress"
    if a.uniformity > 0.75:
        return "Good — uniform canopy"
    return "Fair"


def _flags(a: PeriodAnalysis, c: PeriodComposite, amplitude: float) -> list[str]:
    f: list[str] = []
    if a.coverage < 0.6:
        f.append("partial_coverage")
    if a.n_scenes == 1:
        f.append("single_pass")
    if (np.isfinite(a.stressed_fraction) and a.stressed_fraction > 0.2
            and a.stage not in ("Emergence", "Bare / pre-sowing",
                                "Harvested / residue", "No data")):
        f.append("stress_detected")
    if a.direction == "declining" and a.stage in ("Vegetative",
                                                  "Canopy development"):
        # Declining before peak is the signal worth acting on.
        f.append("unexpected_decline")
    if np.isfinite(a.vegetated_fraction) and a.vegetated_fraction < 0.25 \
            and a.stage not in ("Bare / pre-sowing", "Harvested / residue"):
        f.append("sparse_canopy")
    return f


def _reading(a: PeriodAnalysis) -> str:
    """One or two sentences a field officer can act on."""
    bits = [f"{a.stage}."]
    if a.direction:
        if a.direction == "growing":
            bits.append(f"Canopy gaining ({a.change_since_previous:+.3f} NDVI "
                        f"since the last window).")
        elif a.direction == "declining":
            bits.append(f"Canopy declining ({a.change_since_previous:+.3f} "
                        f"NDVI).")
        else:
            bits.append("Little change since the last window.")
    if a.health not in ("Not applicable", "Not assessed"):
        bits.append(a.health + ".")
    if "unexpected_decline" in a.flags:
        bits.append("Decline before peak — worth a field visit.")
    if "partial_coverage" in a.flags:
        bits.append(f"Only {a.coverage:.0%} of the area was cloud-free.")
    return " ".join(bits)


# ---------------------------------------------------------------------------
# Season-level roll-up
# ---------------------------------------------------------------------------

@dataclass
class GrowthSummary:
    n_periods: int
    n_with_data: int
    peak_period: str
    peak_ndvi: float
    sowing_period: str
    harvest_period: str
    season_length_days: float
    total_growth: float
    mean_growth_rate: float
    worst_period: str
    overall_health: str
    narrative: str


def summarise_growth(analyses: list[PeriodAnalysis]) -> GrowthSummary:
    """Season-level reading built from the per-period results."""
    good = [a for a in analyses if a.has_data]
    if not good:
        return GrowthSummary(len(analyses), 0, "—", float("nan"), "—", "—",
                             float("nan"), float("nan"), float("nan"), "—",
                             "No imagery", "No cloud-free imagery in any period.")

    peak = max(good, key=lambda a: a.mean_ndvi)

    sowing = next((a for a in good
                   if a.stage in ("Emergence", "Vegetative")), None)
    harvest = next((a for a in good if a.index > peak.index
                    and a.stage in ("Senescence", "Harvested / residue")), None)

    length = float("nan")
    if sowing and harvest:
        length = float((harvest.end - sowing.start).days)

    base = float(np.nanpercentile([a.mean_ndvi for a in good], 10))
    total_growth = peak.mean_ndvi - base

    rates = [a.growth_rate for a in good
             if np.isfinite(a.growth_rate) and a.index <= peak.index]
    mean_rate = float(np.mean(rates)) if rates else float("nan")

    stressed = [a for a in good if np.isfinite(a.stressed_fraction)
                and a.stage not in ("Emergence", "Bare / pre-sowing",
                                    "Harvested / residue")]
    worst = max(stressed, key=lambda a: a.stressed_fraction) if stressed else None

    poor = sum(1 for a in good if a.health.startswith("Poor"))
    patchy = sum(1 for a in good if a.health.startswith("Patchy"))
    if poor >= 2:
        overall = "Poor — stress across multiple periods"
    elif poor or patchy >= 2:
        overall = "Mixed — stress in some periods"
    else:
        overall = "Good"

    parts = [
        f"Peak canopy in {peak.label} at NDVI {peak.mean_ndvi:.3f}.",
    ]
    if sowing:
        parts.append(f"Crop first detected growing in {sowing.label}.")
    if harvest:
        parts.append(f"Senescence from {harvest.label}.")
    if np.isfinite(length):
        parts.append(f"Growing season about {length:.0f} days.")
    if worst and worst.stressed_fraction > 0.12:
        parts.append(f"Worst stress in {worst.label}, "
                     f"{worst.stressed_fraction:.0%} of the canopy below "
                     f"the field's own norm.")
    missing = len(analyses) - len(good)
    if missing:
        parts.append(f"{missing} of {len(analyses)} periods had no cloud-free "
                     f"view.")

    return GrowthSummary(
        n_periods=len(analyses), n_with_data=len(good),
        peak_period=peak.label, peak_ndvi=peak.mean_ndvi,
        sowing_period=sowing.label if sowing else "—",
        harvest_period=harvest.label if harvest else "—",
        season_length_days=length, total_growth=total_growth,
        mean_growth_rate=mean_rate,
        worst_period=worst.label if worst else "—",
        overall_health=overall, narrative=" ".join(parts),
    )


def growth_table(analyses: list[PeriodAnalysis]):
    """Per-period table — the headline deliverable for the problem statement."""
    import pandas as pd

    rows = []
    for a in analyses:
        rows.append({
            "Period": a.label,
            "Passes": a.n_scenes,
            "Coverage": f"{a.coverage:.0%}" if a.has_data else "—",
            "NDVI": f"{a.mean_ndvi:.3f}" if np.isfinite(a.mean_ndvi) else "—",
            "Stage": a.stage,
            "Change": (f"{a.change_since_previous:+.3f}"
                       if np.isfinite(a.change_since_previous) else "—"),
            "Direction": a.direction or "—",
            "Health": a.health,
            "Stressed": (f"{a.stressed_fraction:.0%}"
                         if np.isfinite(a.stressed_fraction) else "—"),
        })
    return pd.DataFrame(rows)
