"""
ISRO Bhoonidhi (NRSC) EO Data Hub client.

Bhoonidhi is India's national Earth-observation data hub and the right primary
source for a Maharashtra government audience: Resourcesat-2/2A LISS-III and
AWiFS optical, and EOS-04 C-band SAR.

The API is STAC-compatible. Endpoints and limits implemented here follow the
published specification at https://bhoonidhi.nrsc.gov.in/bhoonidhi-api/ :

    POST /auth/token     obtain and refresh bearer tokens (20 req/hour/IP)
    GET|POST /data/search   STAC item search
    GET  /download       fetch a product, Online == "Y" only (5 concurrent)

Register for a free account at https://bhoonidhi.nrsc.gov.in and export:

    export BHOONIDHI_USER="your_user_id"
    export BHOONIDHI_PASS="your_password"

Note on sensor choice. LISS-III is 23.5 m with a 5-day revisit; AWiFS is 56 m
with a 5-day revisit. Both are coarser than Sentinel-2's 10 m. For parcel-level
work on Maharashtra's small holdings, use Bhoonidhi optical for the regional
picture and fuse Sentinel-2 where parcel boundaries matter. EOS-04 SAR is the
one that earns its place outright, because it sees through monsoon cloud when
every optical sensor is blind.
"""
from __future__ import annotations

import json
import logging
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import numpy as np
import requests

from ..config import BHOONIDHI, RAW_DIR, SENSOR_BANDS
from .base import ImagerySource, ObservationStack, Scene

log = logging.getLogger(__name__)


#: Bhoonidhi collection identifiers this adapter understands, mapped onto the
#: generic sensor names used elsewhere in the pipeline.
COLLECTION_SENSORS = {
    "RS2_LISS3_L2": "liss3",
    "RS2A_LISS3_L2": "liss3",
    "RS2_AWIFS_L2": "awifs",
    "RS2A_AWIFS_L2": "awifs",
    "RS2_LISS4_L2": "liss4",
    "EOS-04_SAR-MRS_L2A": "sar",
    "EOS-04_SAR-CRS_L2A": "sar",
}

SAR_COLLECTIONS = {c for c, s in COLLECTION_SENSORS.items() if s == "sar"}


class BhoonidhiAuthError(RuntimeError):
    pass


class BhoonidhiClient:
    """Thin authenticated wrapper over the Bhoonidhi REST API."""

    def __init__(self, config=BHOONIDHI, session: requests.Session | None = None):
        self.cfg = config
        self.session = session or requests.Session()
        self._access_token: str | None = None
        self._refresh_token: str | None = None
        self._expires_at: float = 0.0
        self._load_cached_token()

    # -- token handling ----------------------------------------------------
    #
    # Token requests are capped at 20 per hour per IP. A naive client that
    # logs in on every call will lock itself out mid-demo, so tokens are
    # cached to disk and refreshed rather than re-issued.

    def _load_cached_token(self) -> None:
        p = Path(self.cfg.token_cache)
        if not p.exists():
            return
        try:
            blob = json.loads(p.read_text())
            if blob.get("expires_at", 0) > time.time() + 60:
                self._access_token = blob.get("access_token")
                self._refresh_token = blob.get("refresh_token")
                self._expires_at = blob["expires_at"]
                log.debug("Reusing cached Bhoonidhi token")
        except (json.JSONDecodeError, KeyError, OSError) as exc:
            log.debug("Ignoring unreadable token cache: %s", exc)

    def _save_cached_token(self) -> None:
        try:
            Path(self.cfg.token_cache).write_text(json.dumps({
                "access_token": self._access_token,
                "refresh_token": self._refresh_token,
                "expires_at": self._expires_at,
            }))
        except OSError as exc:
            log.warning("Could not cache Bhoonidhi token: %s", exc)

    def _request_token(self, payload: dict[str, str]) -> None:
        url = f"{self.cfg.base_url}/auth/token"
        resp = self.session.post(url, json=payload, timeout=60)
        if resp.status_code == 429:
            raise BhoonidhiAuthError(
                "Bhoonidhi token rate limit hit (20/hour/IP). Wait before retrying — "
                "the cached token on disk is reused automatically, so this usually "
                "means the cache directory is not writable."
            )
        if not resp.ok:
            raise BhoonidhiAuthError(
                f"Bhoonidhi auth failed ({resp.status_code}): {resp.text[:300]}")
        blob = resp.json()
        self._access_token = blob["access_token"]
        self._refresh_token = blob.get("refresh_token", self._refresh_token)
        self._expires_at = time.time() + float(blob.get("expires_in", 3600))
        self._save_cached_token()

    def authenticate(self) -> None:
        if not (self.cfg.user_id and self.cfg.password):
            raise BhoonidhiAuthError(
                "Set BHOONIDHI_USER and BHOONIDHI_PASS. Register free at "
                "https://bhoonidhi.nrsc.gov.in")
        self._request_token({
            "userId": self.cfg.user_id,
            "password": self.cfg.password,
            "grant_type": "password",
        })
        log.info("Authenticated with Bhoonidhi as %s", self.cfg.user_id)

    def _ensure_token(self) -> str:
        if self._access_token and time.time() < self._expires_at - 60:
            return self._access_token
        if self._refresh_token:
            try:
                self._request_token({
                    "userId": self.cfg.user_id or "",
                    "refresh_token": self._refresh_token,
                    "grant_type": "refresh_token",
                })
                return self._access_token  # type: ignore[return-value]
            except BhoonidhiAuthError:
                log.info("Refresh failed, logging in again")
        self.authenticate()
        return self._access_token  # type: ignore[return-value]

    def _headers(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self._ensure_token()}",
                "Content-Type": "application/json"}

    # -- catalogue ---------------------------------------------------------

    def search(
        self,
        collections: list[str],
        bbox: tuple[float, float, float, float],
        start: date,
        end: date,
        limit: int = 500,
        online_only: bool = True,
    ) -> list[dict[str, Any]]:
        """STAC item search. Returns raw STAC features."""
        body: dict[str, Any] = {
            "collections": collections,
            "bbox": list(bbox),
            "datetime": (f"{start.isoformat()}T00:00:00Z/"
                         f"{end.isoformat()}T23:59:59Z"),
            "limit": min(limit, 500),
        }
        if online_only:
            # Products with Online == "N" are in deep archive and cannot be
            # pulled through the API; filtering here avoids a queue of
            # downloads that will never complete.
            body["filter-lang"] = "cql2-json"
            body["filter"] = {"op": "eq",
                              "args": [{"property": "Online"}, "Y"]}

        items: list[dict[str, Any]] = []
        url = f"{self.cfg.base_url}/data/search"
        while url and len(items) < limit:
            resp = self.session.post(url, json=body,
                                     headers=self._headers(), timeout=120)
            if not resp.ok:
                raise RuntimeError(
                    f"Bhoonidhi search failed ({resp.status_code}): {resp.text[:300]}")
            page = resp.json()
            items.extend(page.get("features", []))
            url = None
            for link in page.get("links", []):
                if link.get("rel") == "next":
                    url = link.get("href")
                    body = link.get("body", body)
                    break
        return items[:limit]

    def download(self, item_id: str, collection: str,
                 dest_dir: Path | None = None) -> Path:
        """Download one product. Honours the 5-concurrent limit upstream."""
        dest_dir = Path(dest_dir or RAW_DIR / "bhoonidhi")
        dest_dir.mkdir(parents=True, exist_ok=True)
        out = dest_dir / f"{item_id}.zip"
        if out.exists() and out.stat().st_size > 0:
            log.info("Already downloaded: %s", out.name)
            return out

        url = f"{self.cfg.base_url}/download"
        resp = self.session.get(
            url, params={"id": item_id, "collection": collection},
            headers={"Authorization": f"Bearer {self._ensure_token()}"},
            stream=True, timeout=1800,
        )
        if resp.status_code == 412:
            raise RuntimeError(
                "Bhoonidhi returned 412 — more than 5 concurrent downloads for "
                "this user/IP. Lower BhoonidhiConfig.max_concurrent_downloads.")
        if not resp.ok:
            raise RuntimeError(
                f"Download failed ({resp.status_code}): {resp.text[:300]}")

        tmp = out.with_suffix(".part")
        with open(tmp, "wb") as fh:
            for chunk in resp.iter_content(chunk_size=1 << 20):
                if chunk:
                    fh.write(chunk)
        tmp.rename(out)
        log.info("Downloaded %s (%.1f MB)", out.name, out.stat().st_size / 1e6)
        return out


class BhoonidhiSource(ImagerySource):
    """ImagerySource adapter over BhoonidhiClient."""

    name = "bhoonidhi"

    def __init__(self, collections: list[str] | None = None,
                 client: BhoonidhiClient | None = None):
        self.collections = collections or ["RS2A_LISS3_L2", "EOS-04_SAR-MRS_L2A"]
        self.client = client or BhoonidhiClient()

    def available(self) -> tuple[bool, str]:
        cfg = self.client.cfg
        if not (cfg.user_id and cfg.password):
            return False, ("BHOONIDHI_USER / BHOONIDHI_PASS not set. "
                           "Register free at https://bhoonidhi.nrsc.gov.in")
        return True, "credentials present"

    def search(self, bbox, start, end, max_cloud=1.0, limit=500) -> list[Scene]:
        features = self.client.search(self.collections, bbox, start, end, limit)
        scenes: list[Scene] = []
        for ft in features:
            props = ft.get("properties", {})
            collection = ft.get("collection", "")
            sensor = COLLECTION_SENSORS.get(collection, "liss3")
            is_sar = collection in SAR_COLLECTIONS

            cloud = props.get("eo:cloud_cover", props.get("CloudCover"))
            cloud = float(cloud) / 100.0 if cloud is not None else None
            # SAR is unaffected by cloud; never filter it on a cloud figure.
            if not is_sar and cloud is not None and cloud > max_cloud:
                continue

            stamp = props.get("datetime") or props.get("AcquisitionDate")
            try:
                acquired = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
            except (TypeError, ValueError):
                log.debug("Skipping item with unparseable date: %r", stamp)
                continue

            scenes.append(Scene(
                scene_id=ft.get("id", "unknown"),
                source=self.name,
                sensor=sensor,
                acquired=acquired,
                bbox=tuple(ft.get("bbox", bbox)),  # type: ignore[arg-type]
                cloud_cover=cloud,
                is_sar=is_sar,
                metadata={"collection": collection, **props},
            ))
        scenes.sort(key=lambda s: s.acquired)
        log.info("Bhoonidhi: %d scenes (%d SAR) between %s and %s",
                 len(scenes), sum(s.is_sar for s in scenes), start, end)
        return scenes

    def load_parcel_timeseries(self, parcels, scenes) -> ObservationStack:
        """
        Download each scene and reduce it to per-parcel means.

        Left as an explicit error rather than a silent stub: wiring raster
        extraction to Bhoonidhi's product layout requires unzipping the
        delivered archive and locating band GeoTIFFs, which differs per
        product level. Use `cropsurvey.sources.raster.extract_parcel_means`
        once products are on disk.
        """
        raise NotImplementedError(
            "Bhoonidhi products download as archives whose internal layout "
            "varies by product level. Download with BhoonidhiClient.download(), "
            "unzip, then call cropsurvey.sources.raster.extract_parcel_means() "
            "on the band GeoTIFFs. See README section 'Working with real "
            "Bhoonidhi products'."
        )


def describe_access() -> str:
    """Human-readable guide, printed by `cropsurvey sources --help-access`."""
    return """
How to get satellite imagery of crops
=====================================

1. ISRO Bhoonidhi (primary, Indian)
   Register free: https://bhoonidhi.nrsc.gov.in
   API spec:      https://bhoonidhi.nrsc.gov.in/bhoonidhi-api/
   Gives you:     Resourcesat-2/2A LISS-III (23.5 m, 5-day),
                  AWiFS (56 m, 5-day), LISS-IV (5.8 m, limited swath),
                  EOS-04 C-band SAR (cloud-penetrating).
   Set BHOONIDHI_USER and BHOONIDHI_PASS, then:
       cropsurvey search --source bhoonidhi --district Pune --season kharif

2. Copernicus Sentinel-2 (fusion partner, 10 m)
   Register free: https://dataspace.copernicus.eu
   Why you still want it: 10 m resolution resolves Maharashtra's small
   holdings, which 23.5 m LISS-III cannot. Use Bhoonidhi for the regional
   picture and institutional credibility, Sentinel-2 where parcel
   boundaries decide the answer.

3. Bhuvan WMS (basemaps and thematic layers, no login)
   https://bhuvan-vec2.nrsc.gov.in/bhuvan/wms
   Land-use/land-cover and administrative layers to underlay your maps.

4. Your own drone (MAPIR Survey3)
   Highest resolution, your ground truth, and the thing no other team has.
   See cropsurvey.sources.drone.

5. No credentials yet
   The synthetic source reproduces Maharashtra crop phenology so the whole
   pipeline runs today:
       cropsurvey run --source synthetic --district Pune --season kharif
"""
