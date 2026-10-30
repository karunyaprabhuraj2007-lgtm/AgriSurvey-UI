/**
 * AgriSurvey AI — High-resolution dated satellite imagery (Esri World Imagery Wayback)
 *
 * Esri World Imagery is a mosaic of sub-metre commercial satellite and aerial captures
 * (mostly Maxar/Vantor WorldView, ~0.3–0.6 m). "Wayback" publishes every historical
 * version of that mosaic, and a metadata service per version that reports which capture
 * is shown at a given location: its acquisition date, provider, sensor and resolution.
 *
 * This module lists the distinct captures covering a point so the UI can show the
 * sharpest real imagery together with the date it was actually taken. These captures are
 * refreshed irregularly (often months to years apart), so they are not "live"; Sentinel-2
 * remains the frequent (≈5-day) but coarser (10 m) source.
 *
 * Usage terms: Esri World Imagery requires attribution and, for commercial/production
 * use, an appropriate Esri licence.
 */

const CONFIG_URL = 'https://s3-us-west-2.amazonaws.com/config.maptiles.arcgis.com/waybackconfig.json';

export interface WaybackRelease {
  releaseNum: number;
  /** Date the mosaic version was published (not the capture date) */
  releaseDate: string;
  /** Leaflet tile template */
  tileUrl: string;
  metadataUrl: string;
}

export interface WaybackCapture {
  release: WaybackRelease;
  /** Acquisition date of the imagery shown at this location (YYYY-MM-DD), if reported */
  captureDate: string | null;
  provider: string | null;
  sensor: string | null;
  resolutionM: number | null;
  accuracyM: number | null;
}

let releasesPromise: Promise<WaybackRelease[]> | null = null;

export function fetchWaybackReleases(): Promise<WaybackRelease[]> {
  if (!releasesPromise) {
    releasesPromise = fetch(CONFIG_URL)
      .then((r) => {
        if (!r.ok) throw new Error(`Wayback config HTTP ${r.status}`);
        return r.json();
      })
      .then((cfg: Record<string, { itemTitle: string; itemURL: string; metadataLayerUrl: string }>) =>
        Object.entries(cfg)
          .map(([num, v]) => ({
            releaseNum: Number(num),
            releaseDate: /(\d{4}-\d{2}-\d{2})/.exec(v.itemTitle)?.[1] ?? '',
            tileUrl: v.itemURL.replace('{level}', '{z}').replace('{row}', '{y}').replace('{col}', '{x}'),
            metadataUrl: v.metadataLayerUrl,
          }))
          .filter((r) => r.releaseDate && r.tileUrl && r.metadataUrl)
          .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
      );
    releasesPromise.catch(() => {
      releasesPromise = null;
    });
  }
  return releasesPromise;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

const pick = (attrs: Record<string, unknown>, ...names: string[]) => {
  const lower = Object.fromEntries(Object.entries(attrs).map(([k, v]) => [k.toLowerCase(), v]));
  for (const n of names) {
    const v = lower[n.toLowerCase()];
    if (v !== null && v !== undefined && v !== '') return v;
  }
  return null;
};

function parseDate(v: unknown): string | null {
  if (typeof v === 'number' && v > 1e11) return new Date(v).toISOString().slice(0, 10); // epoch ms
  const s = String(v ?? '');
  if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return null;
}

function toCapture(release: WaybackRelease, attrs: Record<string, unknown>): WaybackCapture {
  const res = Number(pick(attrs, 'SAMP_RES', 'Resolution'));
  const acc = Number(pick(attrs, 'SRC_ACC', 'Accuracy'));
  return {
    release,
    captureDate: parseDate(pick(attrs, 'SRC_DATE2', 'SRC_DATE', 'Date')),
    provider: (pick(attrs, 'NICE_DESC', 'NICE_NAME', 'Provider') as string | null) ?? null,
    sensor: (pick(attrs, 'SRC_DESC', 'Source') as string | null) ?? null,
    resolutionM: Number.isFinite(res) && res > 0 ? res : null,
    accuracyM: Number.isFinite(acc) && acc > 0 ? acc : null,
  };
}

/** Layer ids of each metadata service (one layer per zoom band); cached per service URL. */
const layerIdsCache = new Map<string, Promise<number[]>>();
/** Layer id that has returned the finest imagery so far; tried first for later releases. */
let preferredLayerId: number | null = null;

// Not cancellable: the result is shared by every caller through the cache
function layerIds(metadataUrl: string): Promise<number[]> {
  let p = layerIdsCache.get(metadataUrl);
  if (!p) {
    p = fetch(`${metadataUrl}?f=json`)
      .then((r) => r.json())
      .then((svc) => ((svc.layers || []) as { id: number }[]).map((l) => l.id));
    layerIdsCache.set(metadataUrl, p);
    p.catch(() => layerIdsCache.delete(metadataUrl));
  }
  return p;
}

async function queryLayer(release: WaybackRelease, layerId: number, lat: number, lon: number, signal?: AbortSignal) {
  const params = new URLSearchParams({
    f: 'json',
    where: '1=1',
    outFields: '*',
    geometry: JSON.stringify({ x: lon, y: lat, spatialReference: { wkid: 4326 } }),
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'false',
  });
  const r = await fetch(`${release.metadataUrl}/${layerId}/query?${params}`, { signal });
  if (!r.ok) return null;
  const data = await r.json();
  const attrs = data?.features?.[0]?.attributes as Record<string, unknown> | undefined;
  return attrs ? toCapture(release, attrs) : null;
}

/** The capture shown at full zoom for one release (finest resolution among its zoom-band layers). */
export async function queryCapture(release: WaybackRelease, lat: number, lon: number, signal?: AbortSignal): Promise<WaybackCapture | null> {
  if (preferredLayerId !== null) {
    const c = await queryLayer(release, preferredLayerId, lat, lon, signal).catch(() => null);
    if (c?.captureDate) return c;
  }
  const ids = await layerIds(release.metadataUrl);
  const results = await Promise.all(ids.map((id) => queryLayer(release, id, lat, lon, signal).then((c) => ({ id, c })).catch(() => ({ id, c: null }))));
  let best: { id: number; c: WaybackCapture } | null = null;
  for (const { id, c } of results) {
    if (!c?.captureDate) continue;
    if (!best || (c.resolutionM ?? Infinity) < (best.c.resolutionM ?? Infinity)) best = { id, c };
  }
  if (best) preferredLayerId = best.id;
  return best?.c ?? null;
}

/**
 * Distinct high-resolution captures covering a point, newest first. Scans the most recent
 * releases (each release shows whichever capture was current when it was published).
 */
export async function findCaptures(
  lat: number,
  lon: number,
  options: { maxReleases?: number; maxCaptures?: number; signal?: AbortSignal } = {}
): Promise<WaybackCapture[]> {
  const releases = (await fetchWaybackReleases()).slice(0, options.maxReleases ?? 80);
  const maxCaptures = options.maxCaptures ?? 8;
  const byDate = new Map<string, WaybackCapture>();
  let next = 0;

  // The newest release first, alone, so the preferred metadata layer is learned once
  const first = releases[next++];
  if (first) {
    const c = await queryCapture(first, lat, lon, options.signal);
    if (c?.captureDate) byDate.set(c.captureDate, c);
  }

  const worker = async () => {
    while (next < releases.length && byDate.size < maxCaptures) {
      const release = releases[next++];
      const c = await queryCapture(release, lat, lon, options.signal).catch(() => null);
      // Any release showing a capture displays the same imagery at this point; keep one
      if (c?.captureDate && !byDate.has(c.captureDate)) byDate.set(c.captureDate, c);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));

  return [...byDate.values()].sort((a, b) => b.captureDate!.localeCompare(a.captureDate!)).slice(0, maxCaptures);
}
