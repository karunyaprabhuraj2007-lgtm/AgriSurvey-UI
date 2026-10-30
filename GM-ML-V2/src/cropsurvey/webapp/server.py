"""
LEGACY site-list web app, kept for the Akola client-sheet export.

For analysis, use `cropsurvey.webapp.periodic_server` instead — it takes any
coordinate, works only on real imagery, and produces the 15-day sequence.
This module remains because it builds the client's required workbook
(`_write_workbook`), which the newer app does not.

Local web app for testing the model on real coordinates.

    python3 -m cropsurvey.webapp.server --sites data/akola_sites.csv
    python3 -m cropsurvey.webapp.server --demo        # offline, no network

Then open http://127.0.0.1:8000

Analysis runs in a background thread per site and the page polls for progress,
because a single coordinate takes 20-90 seconds against live imagery and a
blocking request would simply time out. Results are cached to disk, so a site
analysed once reloads instantly and the cache survives a restart.
"""
from __future__ import annotations

import argparse
import json
import logging
import shutil
import threading
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from fastapi import (BackgroundTasks, FastAPI, File, HTTPException,
                     UploadFile)
from fastapi.responses import (FileResponse, HTMLResponse, JSONResponse,
                               StreamingResponse)

from ..config import OUTPUT_DIR, PROJECT_ROOT
from ..windows import (REFERENCE_YIELD_KG_HA, VEGETATION_INDEX_DOC,
                       assess_window, estimate_yield)

log = logging.getLogger(__name__)

STATIC_DIR = Path(__file__).parent / "static"

#: The two windows the Akola client sheet asks about.
CLIENT_WINDOWS = [
    ("july", date(2026, 7, 15), date(2026, 7, 25)),
    ("august", date(2026, 8, 15), date(2026, 8, 25)),
]
#: Season window wide enough to capture sowing through senescence.
SEASON_START = date(2026, 6, 1)
SEASON_END = date(2027, 1, 31)   # past cotton+tur senescence; a Nov cutoff truncates cotton and it then reads as tur


class SiteStore:
    """Sites, analysis results, uploaded photos. Everything on disk."""

    def __init__(self, sites_csv: Path, workdir: Path):
        self.workdir = Path(workdir)
        self.results_dir = self.workdir / "results"
        self.photos_dir = self.workdir / "photos"
        for d in (self.results_dir, self.photos_dir):
            d.mkdir(parents=True, exist_ok=True)

        df = pd.read_csv(sites_csv)
        for col in ("site_id", "lat", "lon"):
            if col not in df.columns:
                raise ValueError(f"sites file needs a {col!r} column; "
                                 f"found {list(df.columns)}")
        self.sites = df.to_dict(orient="records")
        self.status: dict[str, dict] = {}
        self._lock = threading.Lock()
        log.info("Loaded %d sites from %s", len(self.sites), sites_csv)

    def site(self, site_id: str) -> dict | None:
        return next((s for s in self.sites if s["site_id"] == site_id), None)

    def result_path(self, site_id: str) -> Path:
        return self.results_dir / site_id / "result.json"

    def cached(self, site_id: str) -> dict | None:
        p = self.result_path(site_id)
        if p.exists():
            try:
                return json.loads(p.read_text())
            except json.JSONDecodeError:
                return None
        return None

    def set_status(self, site_id: str, **kw) -> None:
        with self._lock:
            self.status.setdefault(site_id, {}).update(kw)

    def get_status(self, site_id: str) -> dict:
        with self._lock:
            return dict(self.status.get(site_id, {}))

    def photos(self, site_id: str) -> list[str]:
        d = self.photos_dir / site_id
        if not d.exists():
            return []
        return sorted(p.name for p in d.iterdir()
                      if p.suffix.lower() in
                      (".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"))


def _to_jsonable(obj: Any) -> Any:
    if isinstance(obj, (np.integer,)):
        return int(obj)
    if isinstance(obj, (np.floating,)):
        v = float(obj)
        return None if not np.isfinite(v) else v
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, (date, datetime)):
        return obj.isoformat()
    if isinstance(obj, float) and not np.isfinite(obj):
        return None
    return obj


def run_analysis(store: SiteStore, site_id: str, radius_km: float,
                 demo: bool = False) -> dict:
    """Analyse one site. Runs in a worker thread."""
    site = store.site(site_id)
    if site is None:
        raise ValueError(f"unknown site {site_id}")

    lat, lon = float(site["lat"]), float(site["lon"])
    out_dir = store.results_dir / site_id
    out_dir.mkdir(parents=True, exist_ok=True)

    store.set_status(site_id, state="running", step="searching imagery",
                     progress=10, error=None)

    from ..analyze import analyze_point

    searcher = loader = None
    if demo:
        from ..webapp.demo_source import demo_searcher, demo_loader
        searcher, loader = demo_searcher(lat, lon), demo_loader

    kw = {}
    if searcher is not None:
        kw["searcher"] = searcher
        kw["loader"] = loader

    store.set_status(site_id, step="reading satellite bands", progress=35)
    res = analyze_point(
        lat=lat, lon=lon, radius_km=radius_km,
        season="kharif", year=SEASON_START.year,
        start=SEASON_START, end=SEASON_END,
        output_dir=out_dir.parent, **kw,
    )

    # analyze_point names its folder from the coordinate; move it to the site id.
    produced = out_dir.parent / f"point_{lat:.4f}_{lon:.4f}"
    if produced.exists() and produced.resolve() != out_dir.resolve():
        for f in produced.iterdir():
            shutil.move(str(f), str(out_dir / f.name))
        produced.rmdir()

    store.set_status(site_id, step="assessing client windows", progress=75)

    curve = getattr(res, "_curve", None)
    windows: list[dict] = []
    if curve is not None and res.doys is not None:
        for label, w_from, w_to in CLIENT_WINDOWS:
            wa = assess_window(res.doys, curve, SEASON_START, SEASON_START,
                               w_from, w_to, label)
            windows.append({
                "label": wa.label,
                "from": w_from.isoformat(), "to": w_to.isoformat(),
                "n_observations": wa.n_observations,
                "mean_ndvi": _to_jsonable(wa.mean_ndvi),
                "situation": wa.situation, "detail": wa.detail,
                "cell": wa.as_cell(),
                "dates_observed": wa.dates_observed,
            })

    crop_name, crop_fit = (res.crop_match[0] if res.crop_match else (None, 0.0))
    runner = res.crop_match[1] if len(res.crop_match) > 1 else (None, 0.0)

    store.set_status(site_id, step="estimating yield", progress=88)
    # No crop, no yield. Reporting kg/ha for fallow ground is worse than
    # reporting nothing.
    NON_CROP = {"Fallow / bare", "Non-crop"}
    if res.no_crop or crop_name in NON_CROP or not crop_name:
        yld = {"estimate_kg_ha": None, "low_kg_ha": None, "high_kg_ha": None,
               "confidence": "n/a",
               "basis": "No crop was grown at this coordinate this season, "
                        "so no yield is estimated."}
    else:
        cohort = _cohort_integrals(store, crop_name)
        integral = res.phenology.get("integral", float("nan"))
        yld = estimate_yield(crop_name, integral, cohort, crop_fit)

    images = {name: f"/api/image/{site_id}/{Path(p).name}"
              for name, p in res.outputs.items()
              if Path(p).suffix.lower() == ".png"}

    payload = {
        "site_id": site_id,
        "sr_no": site.get("sr_no"),
        "lat": lat, "lon": lon, "radius_km": radius_km,
        "analysed_at": datetime.now(timezone.utc).isoformat(),
        "demo_mode": demo,
        "imagery": {
            "scenes_found": res.scenes_found,
            "scenes_used": res.scenes_used,
            "dates": [d.strftime("%Y-%m-%d") for d in res.dates],
            "mean_clear_fraction": _to_jsonable(
                float(np.mean(res.clear_fraction)) if res.clear_fraction else 0.0),
        },
        "area_ha": round(res.area_ha, 2),
        "ndvi": {k: _to_jsonable(v) for k, v in res.stats.items()},
        "land_cover": {k: _to_jsonable(v) for k, v in res.cover.items()},
        "truecolor_date": (res.rgb_date.strftime("%Y-%m-%d")
                           if getattr(res, "rgb_date", None) else None),
        "phenology": {k: _to_jsonable(v) for k, v in res.phenology.items()},
        "crop": {
            "best": crop_name, "fit": _to_jsonable(crop_fit),
            "runner_up": runner[0], "runner_up_fit": _to_jsonable(runner[1]),
            "margin": _to_jsonable(crop_fit - runner[1]),
            "truncated": res.truncated,
            "no_crop": res.no_crop,
            "alternatives": [{"crop": n, "fit": _to_jsonable(s)}
                             for n, s in res.crop_match[:6]],
        },
        "windows": windows,
        "yield": {k: _to_jsonable(v) for k, v in yld.items()},
        "condition": {k: _to_jsonable(v) for k, v in res.stress.items()},
        "warnings": res.warnings,
        "images": images,
    }

    (out_dir / "result.json").write_text(json.dumps(payload, indent=2,
                                                    default=_to_jsonable))
    store.set_status(site_id, state="done", step="complete", progress=100)
    return payload


def _cohort_integrals(store: SiteStore, crop_name: str | None) -> np.ndarray | None:
    """NDVI integrals of already-analysed sites carrying the same crop."""
    if not crop_name:
        return None
    vals = []
    for s in store.sites:
        c = store.cached(s["site_id"])
        if not c:
            continue
        if (c.get("crop") or {}).get("best") == crop_name:
            v = (c.get("phenology") or {}).get("integral")
            if v is not None:
                vals.append(float(v))
    return np.array(vals) if len(vals) >= 5 else None


def build_app(store: SiteStore, radius_km: float = 1.0, demo: bool = False):
    app = FastAPI(title="Crop Survey — coordinate tester")

    @app.get("/", response_class=HTMLResponse)
    def index():
        return (STATIC_DIR / "index.html").read_text()

    @app.get("/api/config")
    def config():
        return {
            "demo_mode": demo,
            "radius_km": radius_km,
            "n_sites": len(store.sites),
            "windows": [{"label": l, "from": a.isoformat(), "to": b.isoformat()}
                        for l, a, b in CLIENT_WINDOWS],
            "season": {"from": SEASON_START.isoformat(),
                       "to": SEASON_END.isoformat()},
        }

    @app.get("/api/sites")
    def sites():
        out = []
        for s in store.sites:
            cached = store.cached(s["site_id"])
            out.append({
                "site_id": s["site_id"],
                "sr_no": s.get("sr_no"),
                "lat": float(s["lat"]), "lon": float(s["lon"]),
                "analysed": cached is not None,
                "crop": (cached or {}).get("crop", {}).get("best"),
                "n_photos": len(store.photos(s["site_id"])),
            })
        return out

    @app.get("/api/site/{site_id}")
    def site_detail(site_id: str):
        s = store.site(site_id)
        if s is None:
            raise HTTPException(404, f"no site {site_id}")
        return {"site": {k: _to_jsonable(v) for k, v in s.items()},
                "result": store.cached(site_id),
                "status": store.get_status(site_id),
                "photos": [f"/api/photo/{site_id}/{n}"
                           for n in store.photos(site_id)]}

    @app.post("/api/analyze/{site_id}")
    def analyze(site_id: str, background: BackgroundTasks, force: bool = False):
        if store.site(site_id) is None:
            raise HTTPException(404, f"no site {site_id}")
        if not force and store.cached(site_id):
            return {"state": "cached"}
        st = store.get_status(site_id)
        if st.get("state") == "running":
            return {"state": "running"}

        store.set_status(site_id, state="running", step="queued",
                         progress=1, error=None)

        def task():
            try:
                run_analysis(store, site_id, radius_km, demo)
            except Exception as exc:                        # noqa: BLE001
                log.error("analysis failed for %s: %s", site_id, exc)
                log.debug(traceback.format_exc())
                store.set_status(site_id, state="error", step="failed",
                                 progress=100, error=str(exc))

        background.add_task(task)
        return {"state": "started"}

    @app.get("/api/status/{site_id}")
    def status(site_id: str):
        return store.get_status(site_id) or {"state": "idle"}

    @app.get("/api/image/{site_id}/{name}")
    def image(site_id: str, name: str):
        p = (store.results_dir / site_id / name).resolve()
        if not str(p).startswith(str(store.results_dir.resolve())) or not p.exists():
            raise HTTPException(404, "not found")
        return FileResponse(p)

    @app.get("/api/photo/{site_id}/{name}")
    def photo(site_id: str, name: str):
        p = (store.photos_dir / site_id / name).resolve()
        if not str(p).startswith(str(store.photos_dir.resolve())) or not p.exists():
            raise HTTPException(404, "not found")
        return FileResponse(p)

    @app.post("/api/photo/{site_id}")
    async def upload_photo(site_id: str, files: list[UploadFile] = File(...)):
        if store.site(site_id) is None:
            raise HTTPException(404, f"no site {site_id}")
        d = store.photos_dir / site_id
        d.mkdir(parents=True, exist_ok=True)
        saved = []
        for f in files:
            name = Path(f.filename or "photo.jpg").name
            if Path(name).suffix.lower() not in (
                    ".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"):
                continue
            target = d / name
            i = 1
            while target.exists():
                target = d / f"{Path(name).stem}_{i}{Path(name).suffix}"
                i += 1
            target.write_bytes(await f.read())
            saved.append(target.name)
        return {"saved": saved,
                "photos": [f"/api/photo/{site_id}/{n}"
                           for n in store.photos(site_id)]}

    @app.get("/api/indices")
    def indices():
        return VEGETATION_INDEX_DOC

    @app.get("/api/export.csv")
    def export_csv():
        import io
        df = _deliverable_table(store)
        buf = io.StringIO()
        df.to_csv(buf, index=False)
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]), media_type="text/csv",
            headers={"Content-Disposition":
                     "attachment; filename=akola_crop_survey.csv"})

    @app.get("/api/export.xlsx")
    def export_xlsx():
        path = store.workdir / "akola_crop_survey.xlsx"
        _write_workbook(store, path)
        return FileResponse(
            path, filename="akola_crop_survey.xlsx",
            media_type="application/vnd.openxmlformats-officedocument."
                       "spreadsheetml.sheet")

    return app


def _deliverable_table(store: SiteStore) -> pd.DataFrame:
    """The exact table the client sheet asks for."""
    rows = []
    for s in store.sites:
        sid = s["site_id"]
        c = store.cached(sid) or {}
        crop = c.get("crop") or {}
        wins = {w["label"]: w for w in c.get("windows", [])}
        y = c.get("yield") or {}

        crop_cell = crop.get("best") or "Not analysed"
        if crop.get("best"):
            if crop.get("no_crop"):
                pass            # "Fallow / bare" already says it
            elif crop.get("truncated"):
                crop_cell += " (uncertain — curve truncated)"
            elif (crop.get("margin") or 0) < 0.05 and crop.get("runner_up"):
                crop_cell += f" (or {crop['runner_up']})"

        est = y.get("estimate_kg_ha")
        if est:
            yield_cell = (f"{est:,} (range {y.get('low_kg_ha'):,}-"
                          f"{y.get('high_kg_ha'):,})")
        elif c:
            yield_cell = "Nil — no crop grown"
        else:
            yield_cell = "Not analysed"

        rows.append({
            "Sr. No.": s.get("sr_no", ""),
            "Coordinates": f"{float(s['lat']):.7f},{float(s['lon']):.7f}",
            "Identify the Crop": crop_cell,
            "Crop Situation 15-25 July 2026":
                wins.get("july", {}).get("cell", "Not analysed"),
            "Crop Situation 15-25 August 2026":
                wins.get("august", {}).get("cell", "Not analysed"),
            "Estimated Yield (kg/ha)": yield_cell,
            "Crop ID confidence": (f"{crop.get('fit', 0):.0%} fit, "
                                   f"{crop.get('margin', 0):.0%} margin"
                                   if crop.get("best") else ""),
            "Clear satellite passes": (c.get("imagery") or {}).get("scenes_used", ""),
            "Field photos": len(store.photos(sid)),
        })
    return pd.DataFrame(rows)


def _write_workbook(store: SiteStore, path: Path) -> Path:
    """Multi-sheet workbook: the deliverable, the indices, and the raw data."""
    table = _deliverable_table(store)
    idx = pd.DataFrame(VEGETATION_INDEX_DOC)

    raw_rows = []
    for s in store.sites:
        c = store.cached(s["site_id"])
        if not c:
            continue
        flat = {"site_id": s["site_id"], "lat": c["lat"], "lon": c["lon"],
                "area_ha": c.get("area_ha"),
                "scenes_used": (c.get("imagery") or {}).get("scenes_used"),
                "dates": ", ".join((c.get("imagery") or {}).get("dates", []))}
        flat.update({f"ndvi_{k}": v for k, v in (c.get("ndvi") or {}).items()})
        flat.update({f"phen_{k}": v for k, v in (c.get("phenology") or {}).items()})
        flat.update({f"cover_{k}": v for k, v in (c.get("land_cover") or {}).items()})
        for w in c.get("windows", []):
            flat[f"{w['label']}_ndvi"] = w.get("mean_ndvi")
            flat[f"{w['label']}_obs"] = w.get("n_observations")
        raw_rows.append(flat)
    raw = pd.DataFrame(raw_rows)

    notes = pd.DataFrame({
        "Note": [
            "Crop identification is inferred from the shape of the seasonal "
            "NDVI curve. It is not a measurement. The fit and margin columns "
            "state how clear-cut each identification was.",
            "Where the margin is under 5 percent, the runner-up crop fits "
            "almost as well and both are named in the cell.",
            "Crop situation is reported from cloud-free Sentinel-2 passes "
            "inside each window, widened by up to 3 days. Where no clear pass "
            "fell in the window the cell says so rather than interpolating.",
            "Estimated yield is a regional reference yield scaled by this "
            "field's NDVI integral relative to peer fields of the same crop. "
            "The stated range is wide because satellite imagery does not "
            "observe variety, soil depth or rainfall timing.",
            f"Yield reference source: {REFERENCE_YIELD_KG_HA and ''}"
            "ICAR-CRIDA district contingency plan, PDKV Akola zone, 2004-08 "
            "five-year average, uplifted for variety and practice improvement. "
            "Replace with Akola's own recent season figures before submission.",
            "All imagery is Sentinel-2 L2A surface reflectance, 10 m, from the "
            "AWS Open Data archive. Cloud and shadow are masked per pixel using "
            "the scene classification layer.",
        ]})

    with pd.ExcelWriter(path, engine="openpyxl") as xw:
        table.to_excel(xw, sheet_name="Crop Survey", index=False)
        idx.to_excel(xw, sheet_name="Vegetation Indices", index=False)
        if not raw.empty:
            raw.to_excel(xw, sheet_name="Raw Data", index=False)
        notes.to_excel(xw, sheet_name="Method and Caveats", index=False)
    return path


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Crop survey coordinate tester")
    p.add_argument("--sites", default=str(PROJECT_ROOT / "data" / "akola_sites.csv"))
    p.add_argument("--workdir", default=str(OUTPUT_DIR / "webapp"))
    p.add_argument("--radius", type=float, default=1.0,
                   help="AOI radius in km around each coordinate (default 1)")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--demo", action="store_true",
                   help="use synthetic imagery — runs with no network at all")
    args = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
                        datefmt="%H:%M:%S")

    store = SiteStore(Path(args.sites), Path(args.workdir))
    app = build_app(store, radius_km=args.radius, demo=args.demo)

    mode = "DEMO (synthetic imagery)" if args.demo else "LIVE (Sentinel-2)"
    print(f"\n  Crop survey tester — {mode}")
    print(f"  {len(store.sites)} sites loaded")
    print(f"  open http://{args.host}:{args.port}\n")

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
