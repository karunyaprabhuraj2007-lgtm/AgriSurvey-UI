"""
Period analysis web app — real Sentinel-2 imagery only.

    python3 -m cropsurvey.webapp.periodic_server

Then open http://127.0.0.1:8000

Enter any latitude and longitude, or pick one of the 44 Akola coordinates.
The server fetches every real Sentinel-2 pass over that point, composites
them into 15-day periods on one aligned grid, analyses crop growth and health
per period, and returns the image sequence.

There is no synthetic mode here. If imagery cannot be fetched the request
fails with the reason, because a crop survey that silently shows generated
imagery is worse than one that says it has nothing.
"""
from __future__ import annotations

import argparse
import json
import logging
import threading
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse

from ..config import OUTPUT_DIR, PROJECT_ROOT
from ..growth import growth_table
from ..periodic import analyse_coordinate
from ..windows import VEGETATION_INDEX_DOC

log = logging.getLogger(__name__)
STATIC_DIR = Path(__file__).parent / "static"


def job_key(lat: float, lon: float, start: date, end: date, days: int) -> str:
    return f"{lat:.5f}_{lon:.5f}_{start:%Y%m%d}_{end:%Y%m%d}_{days}"


class JobStore:
    """Analysis jobs, keyed by coordinate and window. Results cached on disk."""

    def __init__(self, workdir: Path):
        self.workdir = Path(workdir)
        self.results = self.workdir / "results"
        self.results.mkdir(parents=True, exist_ok=True)
        self.status: dict[str, dict] = {}
        self._lock = threading.Lock()

    def dir_for(self, key: str) -> Path:
        return self.results / key

    def cached(self, key: str) -> dict | None:
        p = self.dir_for(key) / "analysis.json"
        if p.exists():
            try:
                return json.loads(p.read_text())
            except json.JSONDecodeError:
                return None
        return None

    def set(self, key: str, **kw) -> None:
        with self._lock:
            self.status.setdefault(key, {}).update(kw)

    def get(self, key: str) -> dict:
        with self._lock:
            return dict(self.status.get(key, {}))


def load_akola_sites() -> list[dict]:
    p = PROJECT_ROOT / "data" / "akola_sites.csv"
    if not p.exists():
        return []
    df = pd.read_csv(p)
    return [{"site_id": r.site_id, "sr_no": int(r.sr_no),
             "lat": float(r.lat), "lon": float(r.lon)}
            for r in df.itertuples()]


def run_job(store: JobStore, key: str, lat: float, lon: float,
            radius_km: float, start: date, end: date, period_days: int) -> dict:
    out = store.dir_for(key)
    store.set(key, state="running", step="searching Sentinel-2 archive",
              progress=8, error=None)

    def progress(step: str, pct: int) -> None:
        store.set(key, step=step, progress=pct)

    progress("reading satellite bands", 30)
    res = analyse_coordinate(
        lat=lat, lon=lon, radius_km=radius_km,
        start=start, end=end, period_days=period_days,
        output_dir=store.results, make_images=True,
    )

    # analyse_coordinate names its folder by coordinate; normalise to the key
    produced = store.results / f"coord_{lat:.5f}_{lon:.5f}"
    if produced.exists() and produced.resolve() != out.resolve():
        if out.exists():
            import shutil
            shutil.rmtree(out)
        produced.rename(out)

    progress("writing results", 92)
    payload = res.to_dict()
    payload["key"] = key
    payload["images"] = {k: f"/api/image/{key}/{v}"
                         for k, v in res.images.items()}
    (out / "analysis.json").write_text(json.dumps(payload, indent=2,
                                                  default=str))
    store.set(key, state="done", step="complete", progress=100)
    return payload


def build_app(store: JobStore) -> FastAPI:
    app = FastAPI(title="Crop Survey — 15-day period analysis")
    sites = load_akola_sites()

    @app.get("/", response_class=HTMLResponse)
    def index():
        return (STATIC_DIR / "periodic.html").read_text()

    @app.get("/api/config")
    def config():
        today = date.today()
        return {
            "mode": "live",
            "data_source": "Sentinel-2 L2A · Copernicus via AWS Open Data",
            "period_days": 15,
            "n_akola_sites": len(sites),
            "default_start": (today - timedelta(days=180)).isoformat(),
            "default_end": today.isoformat(),
            "max_date": today.isoformat(),
        }

    @app.get("/api/akola")
    def akola():
        return sites

    @app.post("/api/analyze")
    def analyze(background: BackgroundTasks,
                lat: float, lon: float,
                start: str, end: str,
                radius_km: float = 1.0, period_days: int = 15,
                force: bool = False):
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            raise HTTPException(400, "coordinate out of range")
        try:
            s = date.fromisoformat(start)
            e = date.fromisoformat(end)
        except ValueError:
            raise HTTPException(400, "dates must be YYYY-MM-DD")
        if e <= s:
            raise HTTPException(400, "end date must be after start date")
        if (e - s).days < period_days * 2:
            raise HTTPException(
                400, f"window must span at least {period_days * 2} days "
                     f"to give more than one period")

        key = job_key(lat, lon, s, e, period_days)
        if not force and store.cached(key):
            return {"state": "cached", "key": key}
        if store.get(key).get("state") == "running":
            return {"state": "running", "key": key}

        store.set(key, state="running", step="queued", progress=2, error=None)

        def task():
            try:
                run_job(store, key, lat, lon, radius_km, s, e, period_days)
            except Exception as exc:                   # noqa: BLE001
                log.error("job %s failed: %s", key, exc)
                log.debug(traceback.format_exc())
                store.set(key, state="error", step="failed", progress=100,
                          error=str(exc))

        background.add_task(task)
        return {"state": "started", "key": key}

    @app.get("/api/status/{key}")
    def status(key: str):
        return store.get(key) or {"state": "idle"}

    @app.get("/api/result/{key}")
    def result(key: str):
        c = store.cached(key)
        if c is None:
            raise HTTPException(404, "no result yet")
        return c

    @app.get("/api/image/{key}/{name}")
    def image(key: str, name: str):
        p = (store.dir_for(key) / name).resolve()
        if not str(p).startswith(str(store.results.resolve())) or not p.exists():
            raise HTTPException(404, "not found")
        return FileResponse(p)

    @app.get("/api/indices")
    def indices():
        return VEGETATION_INDEX_DOC

    @app.get("/api/export/{key}.csv")
    def export_csv(key: str):
        c = store.cached(key)
        if c is None:
            raise HTTPException(404, "no result")
        import io
        rows = []
        for p in c.get("periods", []):
            rows.append({
                "Period": p.get("label"),
                "Start": p.get("start"), "End": p.get("end"),
                "Satellite passes": p.get("n_scenes"),
                "Cloud-free coverage": p.get("coverage"),
                "Observation dates": "; ".join(p.get("source_dates") or []),
                "Mean NDVI": p.get("mean_ndvi"),
                "Vegetated fraction": p.get("vegetated_fraction"),
                "Growth stage": p.get("stage"),
                "Change since previous": p.get("change_since_previous"),
                "Direction": p.get("direction"),
                "Health": p.get("health"),
                "Stressed fraction": p.get("stressed_fraction"),
                "Reading": p.get("reading"),
            })
        buf = io.StringIO()
        pd.DataFrame(rows).to_csv(buf, index=False)
        buf.seek(0)
        return StreamingResponse(
            iter([buf.getvalue()]), media_type="text/csv",
            headers={"Content-Disposition":
                     f"attachment; filename=period_analysis_{key}.csv"})

    return app


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="Crop survey — 15-day period analysis from real imagery")
    p.add_argument("--workdir", default=str(OUTPUT_DIR / "periodic"))
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s %(message)s",
        datefmt="%H:%M:%S")

    store = JobStore(Path(args.workdir))
    app = build_app(store)

    print("\n  Crop survey — 15-day period analysis")
    print("  Real Sentinel-2 imagery. No synthetic fallback.")
    print(f"  open http://{args.host}:{args.port}\n")

    import uvicorn
    uvicorn.run(app, host=args.host, port=args.port, log_level="warning")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
