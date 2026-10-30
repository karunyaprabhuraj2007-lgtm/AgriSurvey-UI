"""
Raster to parcel reduction.

The one operation every real source needs: given a georeferenced raster and a
set of field polygons, produce the mean reflectance of each polygon in each
band. Everything downstream works on parcels, not pixels, because that is the
unit a subsidy or an insurance claim is paid against.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)


def extract_parcel_means(
    raster_path: str | Path,
    parcels,
    band_names: list[str],
    band_indices: list[int] | None = None,
    all_touched: bool = False,
    min_pixels: int = 3,
) -> np.ndarray:
    """
    Mean value per parcel per band.

    Parameters
    ----------
    raster_path : georeferenced raster readable by rasterio
    parcels     : GeoDataFrame with a geometry column
    band_names  : names, used only for length and error messages
    band_indices: 1-based raster band numbers; defaults to 1..len(band_names)
    all_touched : include pixels merely touched by the polygon. Leave False —
                  True inflates small parcels with boundary pixels, which on
                  Maharashtra's holdings is most of the parcel.
    min_pixels  : parcels with fewer valid pixels return NaN rather than a
                  mean computed from one or two mixed pixels.

    Returns
    -------
    (n_parcels, n_bands) float32, NaN where a parcel could not be measured.
    """
    import rasterio
    from rasterio.mask import mask as rio_mask

    raster_path = Path(raster_path)
    if not raster_path.exists():
        raise FileNotFoundError(raster_path)

    band_indices = band_indices or list(range(1, len(band_names) + 1))
    if len(band_indices) != len(band_names):
        raise ValueError(
            f"{len(band_names)} band names but {len(band_indices)} indices")

    out = np.full((len(parcels), len(band_names)), np.nan, dtype=np.float32)

    with rasterio.open(raster_path) as src:
        if src.count < max(band_indices):
            raise ValueError(
                f"{raster_path.name} has {src.count} bands, "
                f"need band {max(band_indices)}")

        geoms = parcels.to_crs(src.crs).geometry if hasattr(parcels, "to_crs") \
            else parcels.geometry
        nodata = src.nodata
        skipped = 0

        for i, geom in enumerate(geoms):
            if geom is None or geom.is_empty:
                skipped += 1
                continue
            try:
                chip, _ = rio_mask(src, [geom], crop=True, filled=True,
                                   nodata=np.nan, all_touched=all_touched)
            except ValueError:
                # Polygon falls outside the raster footprint.
                skipped += 1
                continue

            chip = chip.astype(np.float32)
            if nodata is not None and not np.isnan(nodata):
                chip[chip == nodata] = np.nan

            for bi, raster_band in enumerate(band_indices):
                layer = chip[raster_band - 1]
                valid = np.isfinite(layer)
                if valid.sum() >= min_pixels:
                    out[i, bi] = float(layer[valid].mean())

    if skipped:
        log.warning("%d/%d parcels fell outside %s",
                    skipped, len(parcels), raster_path.name)
    measured = np.isfinite(out).any(axis=1).sum()
    log.info("Extracted %d/%d parcels from %s",
             measured, len(parcels), raster_path.name)
    return out


def scale_reflectance(dn: np.ndarray, scale: float = 1e-4,
                      offset: float = 0.0) -> np.ndarray:
    """
    Convert integer DN to reflectance.

    Sentinel-2 L2A from 2022 onward carries a -1000 offset alongside the 10000
    scale factor. Getting this wrong shifts every index and is a common silent
    bug: NDVI still looks plausible, it is just wrong.
    """
    return (dn.astype(np.float32) + offset) * scale
