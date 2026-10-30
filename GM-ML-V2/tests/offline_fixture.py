"""
Offline replica of Earth Search and the Sentinel-2 COG archive.

Builds real GeoTIFFs on local disk with correct CRS, transform, Sentinel-2
digital-number encoding (including the baseline 04.00 -1000 offset) and a
scene classification layer with realistic cloud. Then serves them through the
same `search_scenes` / `load_scene` interfaces the live code uses.

The point: every line of analyze.py except the HTTP call itself can be
exercised and verified without network access. If this passes, the only thing
left untested on the user's machine is whether the host is reachable.
"""
from __future__ import annotations

import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import from_origin

from cropsurvey.sources.earthsearch import (SCL_BARE, SCL_CLOUD_HIGH,
                                            SCL_CLOUD_SHADOW, SCL_VEGETATION,
                                            SCL_WATER, S2Scene, SceneArrays)

SCALE = 10000.0
BOA_OFFSET = -1000.0          # baseline 04.00


def _double_logistic(doy, sos, eos, vmin, vmax, k1=0.11, k2=0.13):
    return vmin + (vmax - vmin) * (
        1.0 / (1.0 + np.exp(-k1 * (doy - sos)))
        - 1.0 / (1.0 + np.exp(-k2 * (doy - eos))))


def build_fixture(
    root: Path,
    lat: float = 18.5204,
    lon: float = 73.8567,
    size: int = 120,
    n_dates: int = 14,
    start_doy: int = 160,
    step_days: int = 10,
    year: int = 2025,
    crop_sos: float = 175.0,
    crop_duration: float = 105.0,
    peak_vi: float = 0.82,
    seed: int = 11,
) -> list[S2Scene]:
    """
    Write a synthetic but radiometrically correct Sentinel-2 archive to disk.

    Default parameters describe a soybean-like crop: sown mid-June, 105 days,
    peak NDVI 0.82 — so a correct pipeline should recover roughly that
    phenology and shortlist soybean.
    """
    rng = np.random.default_rng(seed)
    root.mkdir(parents=True, exist_ok=True)

    # UTM 43N covers Pune. 10 m pixels.
    utm_x = 500000 + (lon - 75.0) * 105000
    utm_y = (lat / 90.0) * 10_000_000
    transform = from_origin(utm_x, utm_y, 10.0, 10.0)
    crs = "EPSG:32643"

    # A spatial pattern: two fields with slightly different vigour, a water
    # body, and a bare patch — so land-cover fractions have something to find.
    yy, xx = np.mgrid[0:size, 0:size]
    field_a = xx < size * 0.55
    water = ((xx - size * 0.82) ** 2 + (yy - size * 0.2) ** 2) < (size * 0.09) ** 2
    bare = (yy > size * 0.86) & ~water
    vigour = np.where(field_a, 1.0, 0.88).astype(np.float32)
    vigour += rng.normal(0, 0.04, (size, size)).astype(np.float32)
    # A stressed patch, so stress detection has a known target.
    stressed = ((xx - size * 0.25) ** 2 + (yy - size * 0.62) ** 2) < (size * 0.1) ** 2
    vigour[stressed] *= 0.55

    scenes: list[S2Scene] = []
    for i in range(n_dates):
        doy = start_doy + i * step_days
        acq = datetime(year, 1, 1, tzinfo=timezone.utc) + timedelta(days=doy - 1)

        base = _double_logistic(np.float32(doy), crop_sos,
                                crop_sos + crop_duration * 0.78, 0.14, peak_vi)
        ndvi = np.clip(base * vigour, -0.05, 0.95).astype(np.float32)
        ndvi[water] = -0.25
        ndvi[bare] = 0.11 + rng.normal(0, 0.02, bare.sum()).astype(np.float32)

        # Invert NDVI to consistent red/NIR reflectance, then to Sentinel-2 DN.
        nir = np.clip(0.18 + 0.42 * np.clip(ndvi, 0, None)
                      + rng.normal(0, 0.008, ndvi.shape), 0.02, 0.95)
        red = np.clip(nir * (1 - ndvi) / (1 + ndvi), 0.004, 0.6)
        green = np.clip(red * 1.22 + 0.02, 0.005, 0.6)
        blue = np.clip(red * 0.9, 0.003, 0.5)
        swir = np.clip(0.33 - 0.19 * np.clip(ndvi, 0, None), 0.01, 0.6)

        # Cloud: heavy in the monsoon months, as in reality.
        monsoon = 160 <= doy <= 260
        cloud_frac = float(np.clip(rng.beta(2, 5) + (0.35 if monsoon else 0.0),
                                   0, 0.95))
        scl = np.full((size, size), SCL_VEGETATION, dtype=np.uint8)
        scl[water] = SCL_WATER
        scl[bare] = SCL_BARE
        if cloud_frac > 0.02:
            cy, cx = rng.uniform(0, size, 2)
            r = math.sqrt(cloud_frac * size * size / math.pi)
            cloud = ((xx - cx) ** 2 + (yy - cy) ** 2) < r ** 2
            shadow = (((xx - cx - r * 0.5) ** 2
                       + (yy - cy - r * 0.5) ** 2) < (r * 0.8) ** 2) & ~cloud
            scl[cloud] = SCL_CLOUD_HIGH
            scl[shadow] = SCL_CLOUD_SHADOW

        sdir = root / f"S2_{acq:%Y%m%d}"
        sdir.mkdir(exist_ok=True)
        assets: dict[str, str] = {}

        def write(name: str, arr: np.ndarray, dtype: str, nodata) -> None:
            p = sdir / f"{name}.tif"
            with rasterio.open(p, "w", driver="GTiff", height=size, width=size,
                               count=1, dtype=dtype, crs=crs,
                               transform=transform, nodata=nodata) as dst:
                dst.write(arr.astype(dtype), 1)
            assets[name] = str(p)

        # Encode as Sentinel-2 L2A DN *including* the offset, so the reader
        # must undo it correctly to recover the reflectance we started from.
        for name, refl in (("red", red), ("green", green), ("blue", blue),
                           ("nir", nir), ("swir16", swir)):
            dn = np.round(refl * SCALE - BOA_OFFSET).astype(np.int32)
            dn = np.clip(dn, 1, 32767)
            write(name, dn, "uint16", 0)
        write("scl", scl, "uint8", 0)

        scenes.append(S2Scene(
            scene_id=f"S2A_FIXTURE_{acq:%Y%m%d}",
            acquired=acq,
            cloud_cover=cloud_frac * 100.0,
            assets=assets,
            boa_offset=BOA_OFFSET,
            epsg=32643,
            properties={"s2:processing_baseline": "05.00"},
        ))
    return scenes


def make_offline_searcher(scenes: list[S2Scene]):
    def searcher(bbox, start, end, max_cloud=100.0, **kw):
        return [s for s in scenes
                if start <= s.acquired.date() <= end
                and s.cloud_cover < max_cloud]
    return searcher


def offline_loader(scene: S2Scene, bbox, bands=("blue", "green", "red",
                                                "nir", "swir1"),
                   apply_mask: bool = True) -> SceneArrays:
    """Load from local files using the same reflectance maths as the live path."""
    from cropsurvey.sources.earthsearch import ASSET_FOR_BAND, SCL_INVALID

    arrays: dict[str, np.ndarray] = {}
    transform = crs = None
    shape = None
    for band in bands:
        key = ASSET_FOR_BAND.get(band, band)
        href = scene.assets.get(key)
        if not href:
            continue
        with rasterio.open(href) as src:
            raw = src.read(1)
            if transform is None:
                transform, crs, shape = src.transform, src.crs, raw.shape
        refl = (raw.astype(np.float32) + scene.boa_offset) / SCALE
        refl[raw == 0] = np.nan
        arrays[band] = refl

    valid = np.ones(shape, dtype=bool)
    scl = None
    if apply_mask and "scl" in scene.assets:
        with rasterio.open(scene.assets["scl"]) as src:
            scl = src.read(1)
        valid = ~np.isin(scl, SCL_INVALID)
    for b in arrays:
        arrays[b] = np.where(valid, arrays[b], np.nan)

    return SceneArrays(scene=scene, bands=arrays, scl=scl, valid=valid,
                       transform=transform, crs=crs)
