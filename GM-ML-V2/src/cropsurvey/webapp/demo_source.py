"""
Offline imagery for the web app's --demo mode.

Generates a plausible Sentinel-2 time series in memory, keyed on the
coordinate so each site looks different but the same site always looks the
same. Nothing is written to disk and no network is touched, so the UI can be
demonstrated on a laptop with no connection at all.

The crop assigned to each site is chosen by hashing the coordinate against the
kharif crop mix of the Akola region, so the spread across 44 sites resembles a
real district: cotton and soybean dominant, tur and jowar present, a few
fallow fields.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone

import numpy as np

from ..config import NAME_TO_CROP
from ..sources.earthsearch import (SCL_BARE, SCL_CLOUD_HIGH, SCL_CLOUD_SHADOW,
                                   SCL_VEGETATION, SCL_WATER, S2Scene,
                                   SceneArrays)

#: Kharif crop mix for the Akola / west Vidarbha region.
AKOLA_MIX = [
    ("Cotton", 0.34), ("Soybean", 0.31), ("Tur (pigeon pea)", 0.14),
    ("Jowar (sorghum)", 0.07), ("Bajra (pearl millet)", 0.04),
    ("Fallow / bare", 0.07), ("Non-crop", 0.03),
]


def _seed_for(lat: float, lon: float) -> int:
    h = hashlib.sha256(f"{lat:.6f},{lon:.6f}".encode()).hexdigest()
    return int(h[:8], 16)


def crop_for(lat: float, lon: float) -> str:
    rng = np.random.default_rng(_seed_for(lat, lon))
    names = [n for n, _ in AKOLA_MIX]
    probs = np.array([w for _, w in AKOLA_MIX], dtype=float)
    return str(rng.choice(names, p=probs / probs.sum()))


def demo_searcher(lat: float, lon: float):
    """A searcher returning synthetic scenes on a 5-day Sentinel-2 cadence."""
    def searcher(bbox, start, end, max_cloud=100.0, **kw):
        rng = np.random.default_rng(_seed_for(lat, lon))
        scenes = []
        cursor = start
        i = 0
        while cursor <= end:
            doy = cursor.timetuple().tm_yday
            monsoon = 160 <= doy <= 265
            cloud = float(np.clip(rng.beta(2, 5) + (0.38 if monsoon else 0.0),
                                  0, 0.97))
            if cloud * 100 < max_cloud:
                scenes.append(S2Scene(
                    scene_id=f"DEMO_{lat:.4f}_{lon:.4f}_{cursor:%Y%m%d}",
                    acquired=datetime(cursor.year, cursor.month, cursor.day,
                                      tzinfo=timezone.utc),
                    cloud_cover=cloud * 100.0,
                    assets={"red": "demo", "green": "demo", "blue": "demo",
                            "nir": "demo", "swir16": "demo", "scl": "demo"},
                    boa_offset=-1000.0, epsg=32643,
                    properties={"demo": True, "lat": lat, "lon": lon,
                                "cloud": cloud},
                ))
            cursor += timedelta(days=5)
            i += 1
        return scenes
    return searcher


def demo_loader(scene: S2Scene, bbox, bands=("blue", "green", "red",
                                             "nir", "swir1"),
                apply_mask: bool = True) -> SceneArrays:
    """Generate the AOI arrays for one synthetic scene."""
    from rasterio.transform import from_origin

    lat = float(scene.properties.get("lat", 20.5))
    lon = float(scene.properties.get("lon", 77.0))
    crop_name = crop_for(lat, lon)
    crop = NAME_TO_CROP[crop_name]

    size = 96
    rng = np.random.default_rng(_seed_for(lat, lon) + scene.acquired.timetuple().tm_yday)
    doy = float(scene.acquired.timetuple().tm_yday)

    if crop.duration_days > 0:
        sos = 152 + crop.sow_offset_days + (_seed_for(lat, lon) % 11) - 5
        eos = sos + crop.duration_days * 0.78
        base = 0.14 + (1 / (1 + np.exp(-0.11 * (doy - sos)))
                       - 1 / (1 + np.exp(-0.13 * (doy - eos)))) * (crop.peak_vi - 0.14)
    else:
        base = 0.16 if crop.code == 11 else 0.42

    yy, xx = np.mgrid[0:size, 0:size]
    vigour = 1.0 + 0.06 * np.sin(xx / 13.0) + 0.05 * np.cos(yy / 11.0)
    vigour += rng.normal(0, 0.03, (size, size))
    # A weaker corner on roughly a third of the sites, so the condition
    # layer has something real to find.
    if _seed_for(lat, lon) % 3 == 0:
        weak = ((xx - size * 0.3) ** 2 + (yy - size * 0.65) ** 2) < (size * 0.17) ** 2
        vigour[weak] *= 0.62

    ndvi = np.clip(base * vigour, -0.05, 0.95).astype(np.float32)

    nir = np.clip(0.18 + 0.42 * np.clip(ndvi, 0, None)
                  + rng.normal(0, 0.008, ndvi.shape), 0.02, 0.95)
    red = np.clip(nir * (1 - ndvi) / (1 + ndvi), 0.004, 0.6)
    arrays = {
        "red": red.astype(np.float32),
        "nir": nir.astype(np.float32),
        "green": np.clip(red * 1.22 + 0.02, 0.005, 0.6).astype(np.float32),
        "blue": np.clip(red * 0.9, 0.003, 0.5).astype(np.float32),
        "swir1": np.clip(0.33 - 0.19 * np.clip(ndvi, 0, None),
                         0.01, 0.6).astype(np.float32),
    }

    cloud_frac = float(scene.properties.get("cloud", 0.2))
    scl = np.full((size, size), SCL_VEGETATION, dtype=np.uint8)
    scl[ndvi < 0.18] = SCL_BARE
    if cloud_frac > 0.03:
        cy, cx = rng.uniform(0, size, 2)
        r = np.sqrt(cloud_frac * size * size / np.pi)
        cloud = ((xx - cx) ** 2 + (yy - cy) ** 2) < r ** 2
        shadow = (((xx - cx - r * 0.45) ** 2
                   + (yy - cy - r * 0.45) ** 2) < (r * 0.8) ** 2) & ~cloud
        scl[cloud] = SCL_CLOUD_HIGH
        scl[shadow] = SCL_CLOUD_SHADOW

    valid = ~np.isin(scl, (SCL_CLOUD_HIGH, SCL_CLOUD_SHADOW))
    for b in arrays:
        arrays[b] = np.where(valid, arrays[b], np.nan)

    transform = from_origin(500000 + (lon - 77) * 104000,
                            (lat / 90.0) * 10_000_000, 10.0, 10.0)
    return SceneArrays(scene=scene, bands={k: v for k, v in arrays.items()
                                           if k in bands},
                       scl=scl, valid=valid, transform=transform,
                       crs="EPSG:32643")
