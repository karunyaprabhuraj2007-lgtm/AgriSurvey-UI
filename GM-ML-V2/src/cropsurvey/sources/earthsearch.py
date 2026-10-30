"""
Sentinel-2 L2A from AWS Open Data — the zero-credential path.

This is the source to use when someone hands you a coordinate and wants an
answer now. Element 84's Earth Search catalogues the Sentinel-2 Level-2A
archive held in AWS Open Data as Cloud-Optimized GeoTIFFs:

  * no account, no API key, no token
  * COGs support HTTP range requests, so a 10 x 10 km window costs a few MB
    rather than the 1.2 GB of a full tile
  * surface reflectance, already atmospherically corrected
  * a scene classification layer for cloud masking

Endpoint: https://earth-search.aws.element84.com/v1

Two radiometric details that silently corrupt results if missed
---------------------------------------------------------------
1. **The baseline 04.00 offset.** From January 2022, ESA added a -1000 offset
   to L2A digital numbers. Reflectance is (DN + offset) / 10000, not
   DN / 10000. Get it wrong and every index shifts; NDVI still looks
   plausible, it is simply wrong. The STAC item carries the offset, and this
   module reads it per scene rather than assuming.

2. **Mixed resolutions.** Red, green, blue and NIR are 10 m; SWIR and the
   scene classification layer are 20 m. They must be resampled onto a common
   grid before any index is computed, or arrays silently misalign.
"""
from __future__ import annotations

import logging
import math
import os
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any

import numpy as np
import requests

log = logging.getLogger(__name__)

EARTH_SEARCH_URL = "https://earth-search.aws.element84.com/v1/search"
COLLECTION = "sentinel-2-l2a"

#: STAC asset key for each generic band name.
ASSET_FOR_BAND = {
    "blue": "blue",
    "green": "green",
    "red": "red",
    "red_edge": "rededge1",
    "nir": "nir",
    "nir08": "nir08",
    "swir1": "swir16",
    "swir2": "swir22",
}

#: Scene Classification Layer values.
SCL_NODATA = 0
SCL_SATURATED = 1
SCL_DARK = 2
SCL_CLOUD_SHADOW = 3
SCL_VEGETATION = 4
SCL_BARE = 5
SCL_WATER = 6
SCL_UNCLASSIFIED = 7
SCL_CLOUD_MEDIUM = 8
SCL_CLOUD_HIGH = 9
SCL_CIRRUS = 10
SCL_SNOW = 11

#: Values that make a pixel unusable for reflectance analysis.
SCL_INVALID = (SCL_NODATA, SCL_SATURATED, SCL_CLOUD_SHADOW,
               SCL_CLOUD_MEDIUM, SCL_CLOUD_HIGH, SCL_CIRRUS, SCL_SNOW)


def configure_gdal() -> None:
    """
    GDAL settings that make windowed COG reads fast and anonymous.

    Without DISABLE_READDIR_ON_OPEN, GDAL lists the whole S3 prefix on every
    open, which turns a two-second read into a thirty-second one.
    """
    os.environ.setdefault("GDAL_DISABLE_READDIR_ON_OPEN", "EMPTY_DIR")
    os.environ.setdefault("AWS_NO_SIGN_REQUEST", "YES")
    os.environ.setdefault("GDAL_HTTP_MULTIPLEX", "YES")
    os.environ.setdefault("GDAL_HTTP_VERSION", "2")
    os.environ.setdefault("VSI_CACHE", "TRUE")
    os.environ.setdefault("VSI_CACHE_SIZE", "268435456")
    os.environ.setdefault("CPL_VSIL_CURL_ALLOWED_EXTENSIONS", ".tif,.TIF,.jp2")
    os.environ.setdefault("GDAL_HTTP_MAX_RETRY", "3")
    os.environ.setdefault("GDAL_HTTP_RETRY_DELAY", "2")


def bbox_from_point(lat: float, lon: float,
                    radius_km: float) -> tuple[float, float, float, float]:
    """
    Bounding box in EPSG:4326 around a point.

    Longitude degrees shrink with latitude, so the longitude half-width is
    divided by cos(lat). At Maharashtra's latitudes that is about a 5%
    correction — small, but it makes the box square on the ground, which
    matters when reporting area.
    """
    if not (-90 <= lat <= 90):
        raise ValueError(f"latitude {lat} out of range")
    if not (-180 <= lon <= 180):
        raise ValueError(f"longitude {lon} out of range")
    if radius_km <= 0:
        raise ValueError("radius_km must be positive")

    dlat = radius_km / 110.574
    dlon = radius_km / (111.320 * max(math.cos(math.radians(lat)), 1e-6))
    return (round(lon - dlon, 6), round(lat - dlat, 6),
            round(lon + dlon, 6), round(lat + dlat, 6))


@dataclass
class S2Scene:
    """One Sentinel-2 acquisition, with the hrefs needed to read it."""
    scene_id: str
    acquired: datetime
    cloud_cover: float
    assets: dict[str, str]
    boa_offset: float
    epsg: int | None = None
    properties: dict[str, Any] = field(default_factory=dict)

    @property
    def doy(self) -> int:
        return self.acquired.timetuple().tm_yday

    def href(self, band: str) -> str | None:
        return self.assets.get(ASSET_FOR_BAND.get(band, band))

    def __repr__(self) -> str:
        return (f"<S2 {self.acquired:%Y-%m-%d} cloud={self.cloud_cover:.0f}% "
                f"{self.scene_id[:28]}>")


def search_scenes(
    bbox: tuple[float, float, float, float],
    start: date,
    end: date,
    max_cloud: float = 60.0,
    limit: int = 200,
    url: str = EARTH_SEARCH_URL,
    session: requests.Session | None = None,
    timeout: int = 90,
) -> list[S2Scene]:
    """
    Query Earth Search for Sentinel-2 L2A scenes.

    `max_cloud` is deliberately generous by default. Scene-level cloud cover
    describes the whole 110 km tile; a field can be perfectly clear inside an
    80%-cloudy tile. Filtering hard at the scene level throws away usable
    observations, so the real filtering happens per pixel with the SCL.
    """
    session = session or requests.Session()
    body = {
        "collections": [COLLECTION],
        "bbox": list(bbox),
        "datetime": f"{start.isoformat()}T00:00:00Z/{end.isoformat()}T23:59:59Z",
        "query": {"eo:cloud_cover": {"lt": max_cloud}},
        "limit": min(limit, 100),
        "sortby": [{"field": "properties.datetime", "direction": "asc"}],
    }

    features: list[dict] = []
    next_body: dict | None = body
    next_url = url
    while next_body is not None and len(features) < limit:
        resp = session.post(next_url, json=next_body, timeout=timeout)
        if not resp.ok:
            raise RuntimeError(
                f"Earth Search returned {resp.status_code}: {resp.text[:300]}")
        page = resp.json()
        features.extend(page.get("features", []))
        next_body = None
        for link in page.get("links", []):
            if link.get("rel") == "next":
                next_url = link.get("href", url)
                next_body = link.get("body")
                break

    scenes = [_parse_feature(f) for f in features[:limit]]
    scenes = [s for s in scenes if s is not None]
    log.info("Earth Search: %d scenes %s to %s (cloud < %.0f%%)",
             len(scenes), start, end, max_cloud)
    return scenes


def _parse_feature(feature: dict) -> S2Scene | None:
    props = feature.get("properties", {})
    stamp = props.get("datetime")
    if not stamp:
        return None
    try:
        acquired = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
    except ValueError:
        log.debug("unparseable datetime %r", stamp)
        return None

    assets = {k: v.get("href") for k, v in feature.get("assets", {}).items()
              if isinstance(v, dict) and v.get("href")}

    # The baseline 04.00 reflectance offset. Earth Search exposes it directly;
    # when absent, infer from the processing baseline and acquisition date.
    offset = props.get("earthsearch:boa_offset_applied")
    if isinstance(offset, bool):
        boa_offset = 0.0 if offset else _infer_offset(props, acquired)
    else:
        boa_offset = _infer_offset(props, acquired)

    return S2Scene(
        scene_id=feature.get("id", "unknown"),
        acquired=acquired,
        cloud_cover=float(props.get("eo:cloud_cover", 0.0)),
        assets=assets,
        boa_offset=boa_offset,
        epsg=props.get("proj:epsg"),
        properties=props,
    )


def _infer_offset(props: dict, acquired: datetime) -> float:
    """
    Infer the BOA offset when the catalogue does not state it.

    ESA introduced the -1000 offset with processing baseline 04.00 on
    25 January 2022. Scenes before that have no offset.
    """
    baseline = props.get("s2:processing_baseline") or props.get("processing:version")
    if baseline:
        try:
            if float(str(baseline)) >= 4.0:
                return -1000.0
            return 0.0
        except ValueError:
            pass
    return -1000.0 if acquired >= datetime(2022, 1, 25, tzinfo=acquired.tzinfo) else 0.0


def read_window(
    href: str,
    bbox_4326: tuple[float, float, float, float],
    out_shape: tuple[int, int] | None = None,
    resampling: str = "bilinear",
) -> tuple[np.ndarray, Any, Any]:
    """
    Read only the AOI window from a remote COG.

    Returns (array, transform, crs). This is the function that makes the whole
    approach viable: a full Sentinel-2 band is ~1.2 GB, while a 10 km window
    is a few megabytes fetched by HTTP range request.
    """
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import transform_bounds
    from rasterio.windows import from_bounds as window_from_bounds

    configure_gdal()
    path = href if href.startswith("/vsi") else f"/vsicurl/{href}"
    method = getattr(Resampling, resampling, Resampling.bilinear)

    with rasterio.open(path) as src:
        bounds = transform_bounds("EPSG:4326", src.crs, *bbox_4326,
                                  densify_pts=21)
        window = window_from_bounds(*bounds, transform=src.transform)
        window = window.round_offsets().round_lengths()

        # Clip to the raster: a point near a tile edge otherwise asks for
        # pixels that do not exist and rasterio pads them silently.
        window = window.intersection(
            rasterio.windows.Window(0, 0, src.width, src.height))
        if window.width < 1 or window.height < 1:
            raise ValueError(
                "AOI does not overlap this scene — the catalogue returned a "
                "tile whose footprint only touches the bounding box corner.")

        shape = out_shape or (int(window.height), int(window.width))
        data = src.read(1, window=window, out_shape=shape, resampling=method)
        transform = src.window_transform(window)
        if out_shape is not None:
            sx = window.width / shape[1]
            sy = window.height / shape[0]
            transform = transform * rasterio.Affine.scale(sx, sy)
        return data, transform, src.crs


@dataclass
class SceneArrays:
    """Reflectance bands plus mask for one scene over the AOI."""
    scene: S2Scene
    bands: dict[str, np.ndarray]
    scl: np.ndarray | None
    valid: np.ndarray
    transform: Any
    crs: Any

    @property
    def clear_fraction(self) -> float:
        return float(self.valid.mean()) if self.valid.size else 0.0

    @property
    def shape(self) -> tuple[int, int]:
        return self.valid.shape


def load_scene(
    scene: S2Scene,
    bbox: tuple[float, float, float, float],
    bands: tuple[str, ...] = ("blue", "green", "red", "nir", "swir1"),
    apply_mask: bool = True,
) -> SceneArrays:
    """
    Read the requested bands for one scene, as surface reflectance, masked.

    All bands are resampled onto the 10 m grid of the first band read, so
    arrays returned here are guaranteed to align pixel for pixel.
    """
    arrays: dict[str, np.ndarray] = {}
    transform = crs = None
    ref_shape: tuple[int, int] | None = None

    for band in bands:
        href = scene.href(band)
        if not href:
            log.debug("%s: no asset for band %s", scene.scene_id, band)
            continue
        try:
            raw, tf, cs = read_window(href, bbox, out_shape=ref_shape)
        except Exception as exc:                       # noqa: BLE001
            log.warning("%s: could not read %s (%s)", scene.scene_id, band, exc)
            continue
        if ref_shape is None:
            ref_shape = raw.shape
            transform, crs = tf, cs
        # DN -> surface reflectance, with the per-scene offset.
        refl = (raw.astype(np.float32) + scene.boa_offset) / 10000.0
        refl[raw == 0] = np.nan                        # 0 is nodata in L2A
        arrays[band] = refl

    if not arrays:
        raise RuntimeError(f"{scene.scene_id}: no bands could be read")

    scl = None
    valid = np.ones(ref_shape, dtype=bool)
    scl_href = scene.assets.get("scl")
    if apply_mask and scl_href:
        try:
            scl, _, _ = read_window(scl_href, bbox, out_shape=ref_shape,
                                    resampling="nearest")
            valid = ~np.isin(scl, SCL_INVALID)
        except Exception as exc:                       # noqa: BLE001
            log.warning("%s: SCL unreadable (%s); keeping all pixels, so "
                        "cloud may contaminate this date", scene.scene_id, exc)

    for band in arrays:
        arrays[band] = np.where(valid, arrays[band], np.nan)

    return SceneArrays(scene=scene, bands=arrays, scl=scl, valid=valid,
                       transform=transform, crs=crs)


def scl_summary(scl: np.ndarray) -> dict[str, float]:
    """Fraction of the AOI in each scene-classification category."""
    names = {
        SCL_NODATA: "no_data", SCL_SATURATED: "saturated", SCL_DARK: "dark",
        SCL_CLOUD_SHADOW: "cloud_shadow", SCL_VEGETATION: "vegetation",
        SCL_BARE: "bare_soil", SCL_WATER: "water",
        SCL_UNCLASSIFIED: "unclassified", SCL_CLOUD_MEDIUM: "cloud_medium",
        SCL_CLOUD_HIGH: "cloud_high", SCL_CIRRUS: "cirrus", SCL_SNOW: "snow",
    }
    total = scl.size
    if total == 0:
        return {}
    return {name: float((scl == code).sum()) / total
            for code, name in names.items()}
