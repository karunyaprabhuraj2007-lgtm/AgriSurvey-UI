"""
GIS outputs.

Everything a department can load into QGIS or ArcGIS without conversion, plus
the reports they will actually read. Exports carry the confidence and the
field-check flag alongside the class, because a map that hides its own
uncertainty gets trusted further than it should be.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import CODE_TO_CROP, CROP_COLOURS, OUTPUT_DIR

log = logging.getLogger(__name__)


def to_geodataframe(results: pd.DataFrame,
                    lon: np.ndarray | None = None,
                    lat: np.ndarray | None = None,
                    geometry=None):
    """Build a GeoDataFrame from classification results."""
    import geopandas as gpd
    from shapely.geometry import Point

    if geometry is None:
        if lon is None or lat is None:
            raise ValueError("supply either geometry or lon/lat")
        geometry = [Point(x, y) for x, y in zip(lon, lat)]
    gdf = gpd.GeoDataFrame(results.copy(), geometry=geometry, crs="EPSG:4326")
    gdf["colour"] = gdf["crop_code"].map(
        lambda c: CROP_COLOURS.get(int(c), "#cccccc"))
    return gdf


def export_geojson(gdf, path: str | Path | None = None,
                   name: str = "crop_classification") -> Path:
    path = Path(path or OUTPUT_DIR / f"{name}.geojson")
    path.parent.mkdir(parents=True, exist_ok=True)
    gdf.to_file(path, driver="GeoJSON")
    log.info("Wrote %s (%d features)", path, len(gdf))
    return path


def export_shapefile(gdf, path: str | Path | None = None,
                     name: str = "crop_classification") -> Path:
    """
    Shapefile export.

    Still the format most state departments ask for. Note the 10-character
    field-name limit, which silently truncates columns — names are shortened
    here explicitly so the truncation is predictable.
    """
    path = Path(path or OUTPUT_DIR / f"{name}.shp")
    path.parent.mkdir(parents=True, exist_ok=True)
    renames = {
        "parcel_id": "parcel_id", "crop_code": "crop_cd",
        "crop_name": "crop_nm", "confidence": "conf",
        "needs_field_check": "fld_check", "area_ha": "area_ha",
        "severity": "health", "vigour_zscore": "vig_z",
        "yield_index": "yld_idx",
    }
    out = gdf.rename(columns={k: v for k, v in renames.items()
                              if k in gdf.columns})
    long_names = [c for c in out.columns
                  if len(c) > 10 and c != out.geometry.name]
    if long_names:
        log.warning("Shapefile will truncate: %s", long_names)
    out.to_file(path, driver="ESRI Shapefile")
    log.info("Wrote %s", path)
    return path


def export_raster(classified: np.ndarray, transform, crs,
                  path: str | Path | None = None,
                  name: str = "crop_map") -> Path:
    """Write a classified array as a Cloud-Optimized GeoTIFF."""
    import rasterio
    from rasterio.enums import Resampling

    path = Path(path or OUTPUT_DIR / f"{name}.tif")
    path.parent.mkdir(parents=True, exist_ok=True)
    data = classified.astype(np.uint8)

    profile = {
        "driver": "GTiff", "height": data.shape[0], "width": data.shape[1],
        "count": 1, "dtype": "uint8", "crs": crs, "transform": transform,
        "compress": "deflate", "predictor": 2, "tiled": True,
        "blockxsize": 512, "blockysize": 512, "nodata": 0,
    }
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(data, 1)
        dst.write_colormap(1, {
            int(c): tuple(int(CROP_COLOURS[c].lstrip("#")[i:i + 2], 16)
                          for i in (0, 2, 4)) + (255,)
            for c in CROP_COLOURS
        })
        dst.update_tags(1, **{CODE_TO_CROP[c].name: str(c) for c in CODE_TO_CROP})
        dst.build_overviews([2, 4, 8, 16], Resampling.nearest)
    log.info("Wrote %s", path)
    return path


def export_department_report(
    area_estimate,
    classification_report_text: str,
    health_summary: str,
    district: str,
    season: str,
    year: int,
    path: str | Path | None = None,
) -> Path:
    """The human-readable summary a department receives."""
    path = Path(path or OUTPUT_DIR / f"report_{district}_{season}_{year}.txt")
    path.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    text = f"""
{'=' * 78}
CROP SURVEY REPORT
{district} district · {season} {year}
Generated {stamp}
{'=' * 78}

1. CROP AREA ESTIMATE
{'-' * 78}
{area_estimate.text()}

2. CLASSIFICATION ACCURACY
{'-' * 78}
{classification_report_text}

3. CROP CONDITION
{'-' * 78}
{health_summary}

{'=' * 78}
HOW TO READ THIS REPORT
{'-' * 78}
Adjusted area, not map area, is the figure to use. Map area counts what the
classifier labelled; adjusted area corrects that count using an independent
reference sample and reports the uncertainty that remains. Where the two
differ substantially, the classifier is systematically over- or
under-predicting that crop.

Parcels flagged for field check are those the model was not confident about,
or where cloud left too few usable observations. They are not errors — they
are the list of places a field officer should visit, ordered so that the
visits that most improve the statistics come first.

Confidence intervals widen where the reference sample is thin. A crop with a
relative standard error above 25% should not drive a payment decision until
more ground points are collected in that stratum.
{'=' * 78}
"""
    path.write_text(text.strip() + "\n")
    log.info("Wrote %s", path)
    return path


def export_summary_json(payload: dict, path: str | Path | None = None,
                        name: str = "survey_summary") -> Path:
    """Machine-readable summary for the API or a dashboard."""
    path = Path(path or OUTPUT_DIR / f"{name}.json")
    path.parent.mkdir(parents=True, exist_ok=True)

    def default(o):
        if isinstance(o, (np.integer,)):
            return int(o)
        if isinstance(o, (np.floating,)):
            return None if np.isnan(o) else float(o)
        if isinstance(o, np.ndarray):
            return o.tolist()
        if isinstance(o, (pd.Timestamp, datetime)):
            return o.isoformat()
        if isinstance(o, pd.DataFrame):
            return o.to_dict(orient="records")
        raise TypeError(f"not serialisable: {type(o)}")

    path.write_text(json.dumps(payload, indent=2, default=default))
    log.info("Wrote %s", path)
    return path
