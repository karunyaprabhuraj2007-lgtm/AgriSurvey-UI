"""
Interactive web map.

What judges and officers actually look at. Three toggleable layers — crop type,
health, and the field-check queue — over a Bhuvan basemap, which is both the
right optics for a government audience and genuinely the better reference for
Indian administrative boundaries.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

from ..config import BHUVAN, CODE_TO_CROP, CROP_COLOURS, OUTPUT_DIR

log = logging.getLogger(__name__)

SEVERITY_COLOURS = {
    "normal": "#2e7d32",
    "watch": "#f9a825",
    "stressed": "#ef6c00",
    "severe": "#c62828",
}


def build_map(gdf, centre: tuple[float, float] | None = None,
              zoom: int = 11, title: str = "Crop Survey",
              add_bhuvan: bool = True):
    """Build a folium map with crop, health and field-check layers."""
    import folium

    if centre is None:
        centre = (float(gdf.geometry.y.mean()), float(gdf.geometry.x.mean()))

    m = folium.Map(location=list(centre), zoom_start=zoom,
                   tiles="OpenStreetMap", control_scale=True)

    if add_bhuvan:
        # Bhuvan WMS needs no API key. If the service is slow or unreachable
        # the layer simply stays blank — the rest of the map still works.
        try:
            folium.raster_layers.WmsTileLayer(
                url=BHUVAN.wms_url,
                layers="lulc:MH_LULC50K_1112",
                name="Bhuvan land use (ISRO)",
                fmt="image/png", transparent=True,
                version=BHUVAN.wms_version, overlay=True, control=True,
                show=False,
            ).add_to(m)
        except Exception as exc:          # noqa: BLE001 - optional layer
            log.warning("Could not add Bhuvan WMS layer: %s", exc)

    folium.TileLayer(
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/"
              "World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr="Esri", name="Satellite imagery", overlay=False, control=True,
    ).add_to(m)

    _crop_layer(m, gdf)
    if "severity" in gdf.columns:
        _health_layer(m, gdf)
    if "needs_field_check" in gdf.columns:
        _field_check_layer(m, gdf)

    folium.LayerControl(collapsed=False).add_to(m)
    _add_legend(m, gdf, title)
    return m


def _popup(row) -> str:
    bits = [f"<b>{row.get('parcel_id', '')}</b>",
            f"Crop: {row.get('crop_name', 'n/a')}"]
    if pd.notna(row.get("confidence")):
        bits.append(f"Confidence: {row['confidence']:.2f}")
    if "area_ha" in row and pd.notna(row.get("area_ha")):
        bits.append(f"Area: {row['area_ha']:.2f} ha")
    if "severity" in row:
        bits.append(f"Condition: {row['severity']}")
    if "vigour_zscore" in row and pd.notna(row.get("vigour_zscore")):
        bits.append(f"Peer z-score: {row['vigour_zscore']:+.2f}")
    if "yield_index" in row and pd.notna(row.get("yield_index")):
        bits.append(f"Yield index: {row['yield_index']:.0f}/100")
    if row.get("needs_field_check"):
        bits.append("<b style='color:#c62828'>Flagged for field check</b>")
    return "<div style='font-family:sans-serif;font-size:12px;"\
           "line-height:1.5'>" + "<br>".join(bits) + "</div>"


def _crop_layer(m, gdf) -> None:
    import folium
    fg = folium.FeatureGroup(name="Crop classification", show=True)
    for _, row in gdf.iterrows():
        folium.CircleMarker(
            location=[row.geometry.y, row.geometry.x],
            radius=4,
            color=CROP_COLOURS.get(int(row.get("crop_code", 0)), "#999999"),
            fill=True, fill_opacity=0.82, weight=0.6,
            popup=folium.Popup(_popup(row), max_width=280),
            tooltip=str(row.get("crop_name", "")),
        ).add_to(fg)
    fg.add_to(m)


def _health_layer(m, gdf) -> None:
    import folium
    fg = folium.FeatureGroup(name="Crop condition", show=False)
    for _, row in gdf.iterrows():
        sev = row.get("severity", "normal")
        folium.CircleMarker(
            location=[row.geometry.y, row.geometry.x],
            radius=5 if sev in ("stressed", "severe") else 3.5,
            color=SEVERITY_COLOURS.get(sev, "#999999"),
            fill=True, fill_opacity=0.85, weight=0.6,
            popup=folium.Popup(_popup(row), max_width=280),
            tooltip=f"{row.get('crop_name', '')} — {sev}",
        ).add_to(fg)
    fg.add_to(m)


def _field_check_layer(m, gdf) -> None:
    import folium
    sel = gdf[gdf["needs_field_check"].fillna(False).astype(bool)]
    if sel.empty:
        return
    fg = folium.FeatureGroup(
        name=f"Field check queue ({len(sel)})", show=False)
    for _, row in sel.iterrows():
        folium.Marker(
            location=[row.geometry.y, row.geometry.x],
            icon=folium.Icon(color="red", icon="info-sign"),
            popup=folium.Popup(_popup(row), max_width=280),
        ).add_to(fg)
    fg.add_to(m)


def _add_legend(m, gdf, title: str) -> None:
    import folium

    present = sorted({int(c) for c in gdf.get("crop_code", pd.Series(dtype=int))
                      if int(c) > 0})
    crop_rows = "".join(
        f"<div style='display:flex;align-items:center;gap:6px;margin:2px 0'>"
        f"<span style='width:12px;height:12px;border-radius:2px;"
        f"background:{CROP_COLOURS.get(c, '#999')};display:inline-block'></span>"
        f"<span>{CODE_TO_CROP[c].name}</span></div>"
        for c in present
    )
    health_rows = "".join(
        f"<div style='display:flex;align-items:center;gap:6px;margin:2px 0'>"
        f"<span style='width:12px;height:12px;border-radius:50%;"
        f"background:{col};display:inline-block'></span>"
        f"<span>{sev}</span></div>"
        for sev, col in SEVERITY_COLOURS.items()
    ) if "severity" in gdf.columns else ""

    html = f"""
    <div style="position:fixed;bottom:24px;left:24px;z-index:9999;
                background:rgba(255,255,255,0.96);padding:14px 16px;
                border:1px solid #ccc;border-radius:8px;
                font-family:system-ui,sans-serif;font-size:12px;
                max-height:65vh;overflow-y:auto;box-shadow:0 2px 8px rgba(0,0,0,.15)">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px">{title}</div>
      <div style="font-weight:600;margin:6px 0 4px">Crop</div>
      {crop_rows}
      {'<div style="font-weight:600;margin:10px 0 4px">Condition</div>' if health_rows else ''}
      {health_rows}
      <div style="margin-top:10px;padding-top:8px;border-top:1px solid #eee;
                  color:#666;max-width:220px;line-height:1.45">
        Classified from satellite time series. Parcels in the field-check
        layer are low-confidence and should be verified on the ground before
        any payment decision.
      </div>
    </div>
    """
    m.get_root().html.add_child(folium.Element(html))


def save_map(m, path: str | Path | None = None,
             name: str = "crop_survey_map") -> Path:
    path = Path(path or OUTPUT_DIR / f"{name}.html")
    path.parent.mkdir(parents=True, exist_ok=True)
    m.save(str(path))
    log.info("Wrote %s", path)
    return path
