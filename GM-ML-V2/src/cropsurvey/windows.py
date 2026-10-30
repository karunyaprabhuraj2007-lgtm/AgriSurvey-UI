"""
Assessment windows and yield estimation.

Built to answer exactly what the Akola client sheet asks for, per coordinate:

    column 3  Identify the crop
    column 4  Crop situation, 15-25 July 2026
    column 5  Crop situation, 15-25 August 2026
    column 6  Estimated yield, kg/ha

The two windows are ten days each, which in a monsoon month may contain one
usable Sentinel-2 pass or none at all. The honest handling is to widen the
search slightly, say how many clear observations actually fell in the window,
and report "no clear imagery" when there were none — rather than interpolating
a value and presenting it as an observation.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import numpy as np

from .config import CODE_TO_CROP, NAME_TO_CROP

log = logging.getLogger(__name__)


#: Reference yields for the Vidarbha region, kg/ha.
#:
#: Anchored on the ICAR-CRIDA district contingency plan for the PDKV Akola
#: zone, which reports a 2004-08 five-year average of cotton 258 kg lint/ha,
#: soybean 845, pigeonpea 830 and sorghum 856. Lint is converted to seed
#: cotton at a 34% ginning outturn, and a modest uplift is applied for variety
#: and practice improvement since that period.
#:
#: These are REGIONAL ANCHORS, not field measurements. Replace them with the
#: Akola district's own recent season figures before anything is submitted.
REFERENCE_YIELD_KG_HA = {
    "Cotton":               {"typical": 1100, "low": 600,  "high": 1800, "note": "seed cotton"},
    "Soybean":              {"typical": 1050, "low": 550,  "high": 1600},
    "Tur (pigeon pea)":     {"typical": 900,  "low": 450,  "high": 1400},
    "Jowar (sorghum)":      {"typical": 950,  "low": 500,  "high": 1500},
    "Bajra (pearl millet)": {"typical": 850,  "low": 450,  "high": 1300},
    "Gram (chickpea)":      {"typical": 1000, "low": 550,  "high": 1500},
    "Wheat":                {"typical": 1900, "low": 1100, "high": 2800, "note": "irrigated"},
    "Onion":                {"typical": 16000, "low": 9000, "high": 24000},
    "Sugarcane":            {"typical": 78000, "low": 50000, "high": 105000},
    "Grapes":               {"typical": 20000, "low": 12000, "high": 30000},
}

YIELD_SOURCE = ("ICAR-CRIDA district contingency plan, PDKV Akola zone "
                "(2004-08 five-year average), uplifted for variety and "
                "practice improvement. Regional anchor, not a field "
                "measurement.")


@dataclass
class WindowAssessment:
    """Crop condition over one date window."""
    label: str
    start: date
    end: date
    n_observations: int
    mean_ndvi: float
    clear_fraction: float
    situation: str
    detail: str
    dates_observed: list[str] = field(default_factory=list)

    def as_cell(self) -> str:
        """One-line text for the client's spreadsheet cell."""
        if self.n_observations == 0:
            return "No clear imagery in window"
        return f"{self.situation} (NDVI {self.mean_ndvi:.2f}, {self.n_observations} pass)"


def assess_window(
    doys: np.ndarray,
    curve: np.ndarray,
    window_start: date,
    stack_start: date,
    w_from: date,
    w_to: date,
    label: str,
    tolerance_days: int = 3,
) -> WindowAssessment:
    """
    Summarise the growth curve inside one date window.

    `tolerance_days` widens the window slightly, because a ten-day window in
    the monsoon frequently contains no cloud-free pass at all. Any widening is
    reported in `detail` so the reader knows the observation is adjacent to
    the requested window rather than inside it.
    """
    d0 = (w_from - stack_start).days - tolerance_days
    d1 = (w_to - stack_start).days + tolerance_days

    in_window = (doys >= d0) & (doys <= d1) & np.isfinite(curve)
    n = int(in_window.sum())

    if n == 0:
        return WindowAssessment(
            label=label, start=w_from, end=w_to, n_observations=0,
            mean_ndvi=float("nan"), clear_fraction=0.0,
            situation="No clear imagery",
            detail=(f"No cloud-free Sentinel-2 observation between "
                    f"{w_from:%d %b} and {w_to:%d %b} (±{tolerance_days} d). "
                    f"Monsoon cloud. SAR would cover this gap."),
        )

    vals = curve[in_window]
    mean_ndvi = float(np.nanmean(vals))
    obs_days = doys[in_window]
    dates_obs = [(stack_start + timedelta(days=int(d))).strftime("%d %b")
                 for d in obs_days]

    # Where the window sits on the season's own curve.
    finite = np.isfinite(curve)
    season_peak = float(np.nanmax(curve[finite])) if finite.any() else np.nan
    season_base = float(np.nanpercentile(curve[finite], 10)) if finite.any() else np.nan
    amp = season_peak - season_base

    if np.isfinite(amp) and amp > 0.08:
        rel = (mean_ndvi - season_base) / amp
    else:
        rel = np.nan

    situation, detail = _describe(mean_ndvi, rel, dates_obs, tolerance_days,
                                  w_from, w_to, obs_days, d0, d1)

    return WindowAssessment(
        label=label, start=w_from, end=w_to, n_observations=n,
        mean_ndvi=mean_ndvi, clear_fraction=float(n) / max(len(doys), 1),
        situation=situation, detail=detail, dates_observed=dates_obs,
    )


def _describe(ndvi: float, rel: float, dates_obs: list[str],
              tol: int, w_from: date, w_to: date,
              obs_days: np.ndarray, d0: int, d1: int) -> tuple[str, str]:
    """Turn numbers into the words a district officer would use."""
    if not np.isfinite(ndvi):
        return "No clear imagery", "No valid pixels."

    if ndvi < 0.18:
        situation = "Bare / not sown"
    elif ndvi < 0.32:
        situation = "Just sown or very early emergence"
    elif ndvi < 0.48:
        situation = "Early vegetative"
    elif ndvi < 0.62:
        situation = "Active vegetative growth"
    elif ndvi < 0.75:
        situation = "Good canopy development"
    else:
        situation = "Full canopy, vigorous"

    # Relative position refines the absolute reading: 0.5 NDVI on the way up
    # in July means something different from 0.5 on the way down in October.
    if np.isfinite(rel):
        if rel < 0.25 and ndvi > 0.3:
            situation += ", below this field's own seasonal peak"
        elif rel > 0.85:
            situation += ", at or near peak"

    bits = [f"Observed {', '.join(dates_obs)}.", f"Mean NDVI {ndvi:.3f}."]
    if np.isfinite(rel):
        bits.append(f"{rel:.0%} of this field's seasonal amplitude.")
    inside = [d for d in obs_days if d0 + tol <= d <= d1 - tol]
    if not inside:
        bits.append(f"Nearest pass fell outside the exact "
                    f"{w_from:%d %b}-{w_to:%d %b} window, within {tol} days.")
    return situation, " ".join(bits)


def estimate_yield(
    crop_name: str,
    ndvi_integral: float,
    cohort_integrals: np.ndarray | None = None,
    crop_fit: float = 1.0,
) -> dict:
    """
    Indicative yield in kg/ha.

    Method: take the crop's regional reference yield, then scale it by where
    this field's seasonal NDVI integral sits against its peers growing the
    same crop. The integral is a biomass proxy and correlates with yield; it
    is not a measurement of yield.

    The returned range is wide on purpose. Yield depends on variety, soil
    depth, management and the timing of rainfall relative to flowering, none
    of which a satellite observes. A narrow interval here would be false
    precision, and a client who later weighs the harvest would notice.
    """
    ref = REFERENCE_YIELD_KG_HA.get(crop_name)
    if ref is None:
        return {"estimate_kg_ha": None, "low_kg_ha": None, "high_kg_ha": None,
                "confidence": "none",
                "basis": f"No reference yield held for {crop_name}."}

    factor = 1.0
    percentile = None
    if cohort_integrals is not None and np.isfinite(ndvi_integral):
        peers = cohort_integrals[np.isfinite(cohort_integrals)]
        if peers.size >= 5:
            percentile = float((peers < ndvi_integral).mean())
            # Map percentile onto 0.70-1.30 of the reference yield. A wider
            # mapping would imply the satellite resolves yield differences it
            # cannot actually see.
            factor = 0.70 + 0.60 * percentile

    est = ref["typical"] * factor
    # Uncertainty widens when the crop identification itself was weak.
    spread = 0.38 if crop_fit >= 0.75 else 0.52
    low = max(ref["low"] * 0.85, est * (1 - spread))
    high = min(ref["high"] * 1.15, est * (1 + spread))

    confidence = ("moderate" if percentile is not None and crop_fit >= 0.75
                  else "low")

    basis = [f"Reference {ref['typical']:,} kg/ha for {crop_name}"]
    if ref.get("note"):
        basis.append(f"({ref['note']})")
    if percentile is not None:
        basis.append(f"scaled to the {percentile:.0%} percentile of peer "
                     f"fields by NDVI integral")
    else:
        basis.append("unscaled — too few peer fields of this crop to rank against")
    if crop_fit < 0.75:
        basis.append("widened because the crop identification was not clear-cut")

    return {
        "estimate_kg_ha": round(est),
        "low_kg_ha": round(low),
        "high_kg_ha": round(high),
        "percentile": percentile,
        "confidence": confidence,
        "basis": "; ".join(basis) + ".",
        "source": YIELD_SOURCE,
    }


#: The indices documentation the client explicitly asked for.
VEGETATION_INDEX_DOC = [
    {"index": "NDVI", "formula": "(NIR - Red) / (NIR + Red)",
     "bands": "Sentinel-2 B8, B4", "resolution_m": 10,
     "used_for": "Primary greenness and biomass proxy. Drives crop "
                 "identification, condition assessment and the yield scaling.",
     "limitation": "Saturates above about LAI 3, so it stops separating "
                   "dense canopies. Inflated by bright soil early in the season."},
    {"index": "EVI", "formula": "2.5 x (NIR - Red) / (NIR + 6xRed - 7.5xBlue + 1)",
     "bands": "B8, B4, B2", "resolution_m": 10,
     "used_for": "Greenness where NDVI saturates — dense cotton and sugarcane.",
     "limitation": "More sensitive to residual atmospheric effects than NDVI."},
    {"index": "SAVI", "formula": "(NIR - Red) x 1.5 / (NIR + Red + 0.5)",
     "bands": "B8, B4", "resolution_m": 10,
     "used_for": "Early kharif, when fields are mostly bare soil with sparse "
                 "seedlings and NDVI reads the soil rather than the crop.",
     "limitation": "The soil factor L is fixed at 0.5 rather than tuned per field."},
    {"index": "NDMI", "formula": "(NIR - SWIR1) / (NIR + SWIR1)",
     "bands": "B8, B11", "resolution_m": "20, resampled to 10",
     "used_for": "Canopy water content. The earliest water-stress signal — it "
                 "turns down days to weeks before NDVI does.",
     "limitation": "SWIR is 20 m, so it is coarser than the NDVI it is "
                   "compared against."},
    {"index": "NDWI", "formula": "(Green - NIR) / (Green + NIR)",
     "bands": "B3, B8", "resolution_m": 10,
     "used_for": "Surface water and waterlogging detection.",
     "limitation": "Confuses shadow with water."},
    {"index": "NDRE", "formula": "(NIR - RedEdge) / (NIR + RedEdge)",
     "bands": "B8, B5", "resolution_m": "20, resampled to 10",
     "used_for": "Chlorophyll, and nitrogen status by proxy. Works in dense "
                 "canopy where NDVI has saturated.",
     "limitation": "Needs a red-edge band, so unavailable from LISS-III."},
    {"index": "GCVI", "formula": "(NIR / Green) - 1",
     "bands": "B8, B3", "resolution_m": 10,
     "used_for": "Tracks biomass more linearly than NDVI at high canopy.",
     "limitation": "Unbounded, so sensitive to calibration error."},
    {"index": "VH/VV ratio", "formula": "VH(dB) - VV(dB)",
     "bands": "Sentinel-1 / EOS-04 SAR", "resolution_m": "10-25",
     "used_for": "Crop structure through cloud. Carries the kharif season "
                 "when optical imagery is unusable.",
     "limitation": "Sensitive to soil moisture and surface roughness as well "
                   "as canopy, so it is noisier than an optical index."},
    {"index": "RVI", "formula": "4 x VH / (VV + VH), in linear power",
     "bands": "SAR", "resolution_m": "10-25",
     "used_for": "Bounded radar vegetation index, robust to calibration drift.",
     "limitation": "Less discriminating between crop types than the VH/VV ratio."},
]
