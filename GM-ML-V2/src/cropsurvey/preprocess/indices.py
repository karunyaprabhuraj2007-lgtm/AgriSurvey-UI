"""
Vegetation and water indices.

Index choice is not decoration. Each one here answers a question the others
cannot, and the set is kept deliberately small — twenty correlated indices add
noise and training time without adding information.
"""
from __future__ import annotations

import numpy as np

from ..sources.base import ObservationStack


def _safe_ratio(num: np.ndarray, den: np.ndarray) -> np.ndarray:
    """Normalised difference with a guarded denominator."""
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(np.abs(den) > 1e-6, num / den, np.nan)
    return out.astype(np.float32)


def ndvi(red: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """Workhorse greenness. Saturates above LAI ~3, hence EVI below."""
    return _safe_ratio(nir - red, nir + red)


def evi(blue: np.ndarray, red: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """
    Enhanced Vegetation Index.

    Does not saturate over dense canopy, which matters for sugarcane and
    irrigated wheat where NDVI flattens at 0.85 and stops discriminating.
    """
    den = nir + 6.0 * red - 7.5 * blue + 1.0
    return np.clip(2.5 * _safe_ratio(nir - red, den), -1.0, 1.5)


def savi(red: np.ndarray, nir: np.ndarray, L: float = 0.5) -> np.ndarray:
    """
    Soil-Adjusted Vegetation Index.

    Early kharif in Maharashtra is mostly bare soil with sparse seedlings.
    SAVI suppresses the soil background that inflates early-season NDVI and
    makes cotton look like it emerged a fortnight early.
    """
    return _safe_ratio((nir - red) * (1.0 + L), nir + red + L)


def ndwi(green: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """Open water / surface moisture (McFeeters)."""
    return _safe_ratio(green - nir, green + nir)


def ndmi(nir: np.ndarray, swir1: np.ndarray) -> np.ndarray:
    """
    Canopy water content.

    The most useful single stress indicator available: a crop under water
    stress loses canopy moisture before it loses greenness, so NDMI turns
    down days to weeks before NDVI does.
    """
    return _safe_ratio(nir - swir1, nir + swir1)


def ndre(red_edge: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """
    Normalised Difference Red Edge — chlorophyll, and nitrogen by proxy.

    Needs a red-edge band, so Sentinel-2 and the MAPIR RE filter only.
    LISS-III has none.
    """
    return _safe_ratio(nir - red_edge, nir + red_edge)


def gcvi(green: np.ndarray, nir: np.ndarray) -> np.ndarray:
    """Green Chlorophyll Vegetation Index — tracks biomass linearly."""
    with np.errstate(divide="ignore", invalid="ignore"):
        out = np.where(np.abs(green) > 1e-6, nir / green - 1.0, np.nan)
    return np.clip(out, -1.0, 15.0).astype(np.float32)


#: Index name -> (function, required bands)
INDEX_REGISTRY = {
    "ndvi": (ndvi, ("red", "nir")),
    "evi":  (evi,  ("blue", "red", "nir")),
    "savi": (savi, ("red", "nir")),
    "ndwi": (ndwi, ("green", "nir")),
    "ndmi": (ndmi, ("nir", "swir1")),
    "ndre": (ndre, ("red_edge", "nir")),
    "gcvi": (gcvi, ("green", "nir")),
}


def compute_indices(stack: ObservationStack,
                    which: list[str] | None = None) -> dict[str, np.ndarray]:
    """
    Compute every index the stack's bands support.

    Indices whose bands are absent are skipped silently — that is the correct
    behaviour when the same code runs over Sentinel-2 and LISS-III, which have
    different band sets.
    """
    which = which or list(INDEX_REGISTRY)
    have = set(stack.band_names)
    out: dict[str, np.ndarray] = {}

    for name in which:
        if name not in INDEX_REGISTRY:
            raise KeyError(f"unknown index {name!r}; "
                           f"have {sorted(INDEX_REGISTRY)}")
        fn, needed = INDEX_REGISTRY[name]
        if not set(needed).issubset(have):
            continue
        out[name] = fn(*[stack.band(b) for b in needed])
    return out


def sar_ratio(vh: np.ndarray, vv: np.ndarray) -> np.ndarray:
    """
    VH/VV cross-polarisation ratio in dB.

    The single most informative SAR feature for crop type. Volume scattering
    from a developed canopy raises VH relative to VV, so this ratio traces the
    growth curve the way NDVI does — but through cloud, which is why it
    carries the kharif season.
    """
    return (vh - vv).astype(np.float32)


def compute_sar_features(stack: ObservationStack) -> dict[str, np.ndarray]:
    if not {"vv", "vh"}.issubset(stack.band_names):
        return {}
    vv, vh = stack.band("vv"), stack.band("vh")
    return {
        "sar_vv": vv,
        "sar_vh": vh,
        "sar_ratio": sar_ratio(vh, vv),
        # Radar Vegetation Index, bounded 0-1, robust to calibration drift.
        "sar_rvi": np.clip(
            4.0 * (10 ** (vh / 10.0))
            / ((10 ** (vv / 10.0)) + (10 ** (vh / 10.0)) + 1e-9),
            0, 1).astype(np.float32),
    }
