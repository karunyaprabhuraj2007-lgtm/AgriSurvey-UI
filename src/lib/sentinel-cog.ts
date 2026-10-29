/**
 * AgriSurvey AI — Sentinel-2 L2A Cloud-Optimized GeoTIFF (COG) reader
 *
 * Reads only the pixels covering an area of interest (AOI) straight from the public
 * Sentinel-2 COGs listed by Earth Search, using HTTP range requests. This replaces the
 * whole-tile thumbnail (~110 km wide, ~300 m per pixel) with the native 10 m bands for
 * the requested coordinates.
 *
 * - Bands are resampled (bilinear) from the scene's UTM grid onto a regular WGS84
 *   lat/lon grid, so the rendered image lines up exactly with map overlays.
 * - Reflectance = DN * scale + offset, honouring the processing-baseline 04.00 BOA offset.
 * - SCL classes 0, 1, 3, 8, 9, 10, 11 (no data, saturated, cloud shadow, cloud medium/high,
 *   cirrus, snow) are masked out of NDVI statistics.
 * - Contrast stretching / sharpening are display-only; statistics use unmodified reflectance.
 */

import { fromUrl, GeoTIFF } from 'geotiff';
import { SatelliteScene, SatelliteSceneAsset } from '@/types';

export interface AoiBounds {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface SceneClipStats {
  ndviMean: number | null;
  ndviMedian: number | null;
  ndviMin: number | null;
  ndviMax: number | null;
  ndviStd: number | null;
  /** Soil-adjusted vegetation index (L = 0.5) */
  saviMean: number | null;
  /** Green chlorophyll vegetation index, NIR / Green - 1 */
  gcviMean: number | null;
  /** Red-edge NDVI from B08 / B05 (null when the red-edge band is unavailable) */
  ndreMean: number | null;
  /** Enhanced Vegetation Index (less saturated than NDVI over dense canopy) */
  eviMean: number | null;
  /** Moisture index from B08 / B11 (null when the SWIR band is unavailable) */
  ndmiMean: number | null;
  /** McFeeters water index from B03 / B08; > 0 indicates open or standing water */
  ndwiMean: number | null;
  /** Pixels inside the survey area (circle or field boundary) */
  totalPixels: number;
  /** Pixels inside the area that passed the SCL / nodata mask */
  validPixels: number;
  validCoveragePct: number;
  cloudOrShadowPct: number;
  noDataPct: number;
}

/** Area whose statistics are reported: a circle around a point, or a field boundary. */
export type SurveyArea =
  | { kind: 'circle'; center: { lat: number; lon: number }; radiusKm: number }
  | { kind: 'polygon'; coordinates: [number, number][] }; // [lat, lon][]

export interface SceneClip {
  /** Extent of the rendered images (survey area plus any context margin) */
  bounds: AoiBounds;
  area: SurveyArea;
  width: number;
  height: number;
  /** Approximate ground size of one output pixel (metres); source bands are 10 m */
  outputPixelSizeM: number;
  epsg: number;
  trueColorUrl: string;
  falseColorUrl: string;
  ndviUrl: string;
  stats: SceneClipStats;
  reflectance: { scale: number; offset: number; source: string };
}

export type ClipImageMode = 'visual' | 'false_color' | 'ndvi';

export const clipUrl = (clip: SceneClip, mode: ClipImageMode) =>
  mode === 'ndvi' ? clip.ndviUrl : mode === 'false_color' ? clip.falseColorUrl : clip.trueColorUrl;

// ---------------------------------------------------------------------------
// WGS84 -> UTM (Transverse Mercator, Krüger series; sub-millimetre within a zone)
// ---------------------------------------------------------------------------

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const UTM_K0 = 0.9996;

const N = WGS84_F / (2 - WGS84_F);
const A_RECT = (WGS84_A / (1 + N)) * (1 + (N * N) / 4 + (N ** 4) / 64);
const ALPHA = [
  N / 2 - (2 * N * N) / 3 + (5 * N ** 3) / 16,
  (13 * N * N) / 48 - (3 * N ** 3) / 5,
  (61 * N ** 3) / 240,
];
const TWO_SQRT_N_OVER = (2 * Math.sqrt(N)) / (1 + N);

export function utmZoneFromEpsg(epsg: number): { zone: number; south: boolean } | null {
  if (epsg > 32600 && epsg <= 32660) return { zone: epsg - 32600, south: false };
  if (epsg > 32700 && epsg <= 32760) return { zone: epsg - 32700, south: true };
  return null;
}

export function epsgForLonLat(lon: number, lat: number): number {
  const zone = Math.min(60, Math.max(1, Math.floor((lon + 180) / 6) + 1));
  return (lat >= 0 ? 32600 : 32700) + zone;
}

export function lonLatToUtm(lon: number, lat: number, zone: number, south: boolean): [number, number] {
  const phi = (lat * Math.PI) / 180;
  const dLambda = ((lon - (zone * 6 - 183)) * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const t = Math.sinh(Math.atanh(sinPhi) - TWO_SQRT_N_OVER * Math.atanh(TWO_SQRT_N_OVER * sinPhi));
  const xiP = Math.atan2(t, Math.cos(dLambda));
  const etaP = Math.atanh(Math.sin(dLambda) / Math.sqrt(1 + t * t));
  let xi = xiP;
  let eta = etaP;
  for (let j = 1; j <= 3; j++) {
    xi += ALPHA[j - 1] * Math.sin(2 * j * xiP) * Math.cosh(2 * j * etaP);
    eta += ALPHA[j - 1] * Math.cos(2 * j * xiP) * Math.sinh(2 * j * etaP);
  }
  const easting = 500000 + UTM_K0 * A_RECT * eta;
  const northing = (south ? 10000000 : 0) + UTM_K0 * A_RECT * xi;
  return [easting, northing];
}

const BETA = [
  N / 2 - (2 * N * N) / 3 + (37 * N ** 3) / 96,
  (N * N) / 48 + (N ** 3) / 15,
  (17 * N ** 3) / 480,
];
const DELTA = [2 * N - (2 * N * N) / 3 - 2 * N ** 3, (7 * N * N) / 3 - (8 * N ** 3) / 5, (56 * N ** 3) / 15];

/** UTM -> WGS84 (inverse Krüger series). Returns [lon, lat] in degrees. */
export function utmToLonLat(easting: number, northing: number, zone: number, south: boolean): [number, number] {
  const xi = (northing - (south ? 10000000 : 0)) / (UTM_K0 * A_RECT);
  const eta = (easting - 500000) / (UTM_K0 * A_RECT);
  let xiP = xi;
  let etaP = eta;
  for (let j = 1; j <= 3; j++) {
    xiP -= BETA[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    etaP -= BETA[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
  }
  const chi = Math.asin(Math.sin(xiP) / Math.cosh(etaP));
  let phi = chi;
  for (let j = 1; j <= 3; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
  const lon = zone * 6 - 183 + (Math.atan2(Math.sinh(etaP), Math.cos(xiP)) * 180) / Math.PI;
  return [lon, (phi * 180) / Math.PI];
}

// ---------------------------------------------------------------------------
// AOI helpers
// ---------------------------------------------------------------------------

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;

/** Square AOI around a point; longitude span is corrected for latitude. */
export function aoiAroundPoint(lat: number, lon: number, radiusKm: number): AoiBounds {
  const dLat = radiusKm / KM_PER_DEG_LAT;
  const dLon = radiusKm / (KM_PER_DEG_LON_EQUATOR * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

// ---------------------------------------------------------------------------
// COG band reading
// ---------------------------------------------------------------------------

interface BandWindow {
  data: ArrayLike<number>;
  /** UTM coordinate of the window's top-left pixel corner */
  x0: number;
  y0: number;
  resX: number;
  resY: number; // positive, pixel height in metres
  width: number;
  height: number;
}

const tiffCache = new Map<string, Promise<GeoTIFF>>();

function openTiff(href: string): Promise<GeoTIFF> {
  let p = tiffCache.get(href);
  if (!p) {
    p = fromUrl(href, { allowFullFile: false });
    tiffCache.set(href, p);
    p.catch(() => tiffCache.delete(href));
  }
  return p;
}

async function readBandWindow(
  href: string,
  utmMin: [number, number],
  utmMax: [number, number],
  signal?: AbortSignal
): Promise<BandWindow> {
  const tiff = await openTiff(href);
  const image = await tiff.getImage(0);
  const [originX, originY] = image.getOrigin();
  const [resX, resYSigned] = image.getResolution();
  const resY = Math.abs(resYSigned);
  const imgW = image.getWidth();
  const imgH = image.getHeight();

  // One pixel of padding for bilinear interpolation at the edges
  const px0 = Math.max(0, Math.floor((utmMin[0] - originX) / resX) - 1);
  const px1 = Math.min(imgW, Math.ceil((utmMax[0] - originX) / resX) + 1);
  const py0 = Math.max(0, Math.floor((originY - utmMax[1]) / resY) - 1);
  const py1 = Math.min(imgH, Math.ceil((originY - utmMin[1]) / resY) + 1);

  if (px1 <= px0 || py1 <= py0) {
    throw new Error('The requested coordinates fall outside this satellite tile.');
  }

  const rasters = await image.readRasters({ window: [px0, py0, px1, py1], samples: [0], signal });
  const data = (rasters as unknown as ArrayLike<number>[])[0];
  return {
    data,
    x0: originX + px0 * resX,
    y0: originY - py0 * resY,
    resX,
    resY,
    width: px1 - px0,
    height: py1 - py0,
  };
}

/** Bilinear sample at UTM (x, y); returns NaN when any contributing pixel is nodata (0). */
function sampleBilinear(w: BandWindow, x: number, y: number): number {
  const fx = (x - w.x0) / w.resX - 0.5;
  const fy = (w.y0 - y) / w.resY - 0.5;
  const ix = Math.floor(fx);
  const iy = Math.floor(fy);
  if (ix < 0 || iy < 0 || ix + 1 >= w.width || iy + 1 >= w.height) return sampleNearest(w, x, y);
  const tx = fx - ix;
  const ty = fy - iy;
  const i = iy * w.width + ix;
  const a = w.data[i];
  const b = w.data[i + 1];
  const c = w.data[i + w.width];
  const d = w.data[i + w.width + 1];
  if (a === 0 || b === 0 || c === 0 || d === 0) return sampleNearest(w, x, y);
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

function sampleNearest(w: BandWindow, x: number, y: number): number {
  const ix = Math.floor((x - w.x0) / w.resX);
  const iy = Math.floor((w.y0 - y) / w.resY);
  if (ix < 0 || iy < 0 || ix >= w.width || iy >= w.height) return NaN;
  const v = w.data[iy * w.width + ix];
  return v === 0 ? NaN : v;
}

// ---------------------------------------------------------------------------
// Reflectance scaling
// ---------------------------------------------------------------------------

function reflectanceScaling(scene: SatelliteScene, asset: SatelliteSceneAsset) {
  // Earth Search's sentinel-2-l2a COGs are harmonised (offset already removed) when this flag
  // is true, even though their raster:bands metadata still lists offset -0.1. Applying it again
  // drives dark-surface reflectance negative and inflates NDVI.
  if (scene.boa_offset_applied === true) {
    return { scale: asset.scale ?? 0.0001, offset: 0, source: 'harmonised COGs, BOA offset already removed' };
  }
  if (asset.scale !== undefined) {
    return { scale: asset.scale, offset: asset.offset ?? 0, source: 'STAC raster:bands metadata' };
  }
  const baseline = parseFloat(scene.processing_baseline || '0');
  if (baseline >= 4) {
    return { scale: 0.0001, offset: -0.1, source: `Processing baseline ${scene.processing_baseline} BOA offset (-1000 DN)` };
  }
  return { scale: 0.0001, offset: 0, source: 'Default L2A scale (1/10000)' };
}

// SCL classes excluded from analysis
const SCL_INVALID = new Set([0, 1, 3, 8, 9, 10, 11]);
const SCL_CLOUD_OR_SHADOW = new Set([3, 8, 9, 10]);

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

function percentile(values: Float32Array, count: number, p: number): number {
  if (count === 0) return 0;
  const sorted = values.slice(0, count).sort();
  const idx = Math.min(count - 1, Math.max(0, Math.round((p / 100) * (count - 1))));
  return sorted[idx];
}

/** Collect a strided subsample of finite values for percentile estimation. */
function finiteSample(arr: Float32Array, maxSamples = 40000): { values: Float32Array; count: number } {
  const step = Math.max(1, Math.floor(arr.length / maxSamples));
  const values = new Float32Array(Math.ceil(arr.length / step));
  let count = 0;
  for (let i = 0; i < arr.length; i += step) {
    if (Number.isFinite(arr[i])) values[count++] = arr[i];
  }
  return { values, count };
}

/** 3x3 unsharp mask on RGB channels of an RGBA buffer (display only). */
function unsharp(rgba: Uint8ClampedArray, width: number, height: number, amount: number) {
  const src = new Uint8ClampedArray(rgba);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur =
          (src[i - 4 + c] + src[i + 4 + c] + src[i - width * 4 + c] + src[i + width * 4 + c] + 4 * src[i + c]) / 8;
        rgba[i + c] = src[i + c] + amount * (src[i + c] - blur);
      }
    }
  }
}

function toDataUrl(rgba: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable in this browser.');
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return canvas.toDataURL('image/png');
}

function renderComposite(
  r: Float32Array,
  g: Float32Array,
  b: Float32Array,
  width: number,
  height: number
): string {
  // One stretch shared by all three channels keeps the natural colour balance
  // (per-channel stretching tints vegetation and soil).
  const samples = [r, g, b].map((c) => finiteSample(c, 20000));
  const pooled = new Float32Array(samples.reduce((n, sm) => n + sm.count, 0));
  let k = 0;
  for (const sm of samples) for (let i = 0; i < sm.count; i++) pooled[k++] = sm.values[i];
  const lo = percentile(pooled, k, 1);
  const hi = Math.max(1e-3, percentile(pooled, k, 99) - lo);
  const gamma = 1 / 1.3;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    if (!Number.isFinite(r[i]) || !Number.isFinite(g[i]) || !Number.isFinite(b[i])) {
      rgba[o] = rgba[o + 1] = rgba[o + 2] = 0;
      rgba[o + 3] = 255;
      continue;
    }
    rgba[o] = 255 * Math.pow(Math.min(1, Math.max(0, (r[i] - lo) / hi)), gamma);
    rgba[o + 1] = 255 * Math.pow(Math.min(1, Math.max(0, (g[i] - lo) / hi)), gamma);
    rgba[o + 2] = 255 * Math.pow(Math.min(1, Math.max(0, (b[i] - lo) / hi)), gamma);
    rgba[o + 3] = 255;
  }
  unsharp(rgba, width, height, 0.6);
  return toDataUrl(rgba, width, height);
}

/** NDVI colour classes shared by the renderer and the on-screen legend. */
export const NDVI_CLASSES: { min: number; label: string; color: [number, number, number] }[] = [
  { min: -1, label: '< 0.0 Water / built-up', color: [70, 110, 160] },
  { min: 0.0, label: '0.0–0.2 Bare soil / tilled', color: [166, 97, 26] },
  { min: 0.2, label: '0.2–0.35 Sparse vegetation', color: [223, 194, 125] },
  { min: 0.35, label: '0.35–0.5 Moderate vegetation', color: [166, 217, 106] },
  { min: 0.5, label: '0.5–0.7 Dense vegetation', color: [26, 150, 65] },
  { min: 0.7, label: '> 0.7 Very dense canopy', color: [0, 90, 40] },
];
export const NDVI_MASKED_COLOR: [number, number, number] = [150, 150, 150];

function ndviColor(v: number): [number, number, number] {
  let c = NDVI_CLASSES[0].color;
  for (const cls of NDVI_CLASSES) if (v >= cls.min) c = cls.color;
  return c;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

const DEFAULT_MAX_OUTPUT_DIM = 1100;
/** Smallest output pixel; bands are 10 m, so this is at most a 4x bilinear upsample for display. */
const MIN_OUTPUT_PIXEL_M = 2.5;

export interface ClipOptions {
  /** Context margin around the survey area, in metres */
  marginM?: number;
  /** Longest side of the rendered images, in pixels */
  maxOutputDim?: number;
  signal?: AbortSignal;
}

function surveyAreaBounds(area: SurveyArea): AoiBounds {
  if (area.kind === 'circle') return aoiAroundPoint(area.center.lat, area.center.lon, area.radiusKm);
  const lats = area.coordinates.map((c) => c[0]);
  const lons = area.coordinates.map((c) => c[1]);
  return { minLat: Math.min(...lats), maxLat: Math.max(...lats), minLon: Math.min(...lons), maxLon: Math.max(...lons) };
}

export function surveyAreaCenter(area: SurveyArea): { lat: number; lon: number } {
  if (area.kind === 'circle') return area.center;
  const b = surveyAreaBounds(area);
  return { lat: (b.minLat + b.maxLat) / 2, lon: (b.minLon + b.maxLon) / 2 };
}

function pointInRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Read and render a Sentinel-2 scene for a survey area (circle or field polygon). */
export async function loadAreaClip(scene: SatelliteScene, area: SurveyArea, options: ClipOptions = {}): Promise<SceneClip> {
  const { red, green, blue, nir, scl, swir16, rededge1 } = scene.assets;
  if (!red || !green || !blue || !nir) {
    throw new Error('This scene does not list the 10 m Blue/Green/Red/NIR Cloud-Optimized GeoTIFF bands.');
  }
  for (const a of [red, green, blue, nir]) {
    if (!/^https?:\/\//.test(a.href)) {
      throw new Error('Band files for this scene are not available over HTTPS (requester-pays storage).');
    }
  }
  if (area.kind === 'polygon' && area.coordinates.length < 3) {
    throw new Error('A field boundary needs at least three points.');
  }

  const center = surveyAreaCenter(area);
  const epsg = scene.proj_epsg || epsgForLonLat(center.lon, center.lat);
  const utm = utmZoneFromEpsg(epsg);
  if (!utm) throw new Error(`Unsupported scene projection EPSG:${epsg}`);

  // Rendered extent: survey area plus margin, made square so north-up images are not distorted
  const areaBounds = surveyAreaBounds(area);
  const margin = options.marginM ?? 0;
  const kmPerDegLon = KM_PER_DEG_LON_EQUATOR * Math.cos((center.lat * Math.PI) / 180);
  const halfWidthKm = ((areaBounds.maxLon - areaBounds.minLon) * kmPerDegLon) / 2;
  const halfHeightKm = ((areaBounds.maxLat - areaBounds.minLat) * KM_PER_DEG_LAT) / 2;
  const halfKm = Math.max(halfWidthKm, halfHeightKm, 0.05) + margin / 1000;
  const bounds = aoiAroundPoint(center.lat, center.lon, halfKm);
  const sizeM = halfKm * 2000;
  const maxDim = options.maxOutputDim ?? DEFAULT_MAX_OUTPUT_DIM;
  const dim = Math.min(maxDim, Math.max(64, Math.round(sizeM / MIN_OUTPUT_PIXEL_M)));
  const width = dim;
  const height = dim;
  const outputPixelSizeM = sizeM / dim;
  const signal = options.signal;

  // UTM coordinates of each output pixel centre, and survey-area membership
  const n = width * height;
  const ux = new Float64Array(n);
  const uy = new Float64Array(n);
  const inArea = new Uint8Array(n);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const latStep = (bounds.maxLat - bounds.minLat) / height;
  const lonStep = (bounds.maxLon - bounds.minLon) / width;
  const [cx, cy] = lonLatToUtm(center.lon, center.lat, utm.zone, utm.south);
  const radiusM = area.kind === 'circle' ? area.radiusKm * 1000 : 0;
  for (let row = 0; row < height; row++) {
    const lat = bounds.maxLat - (row + 0.5) * latStep;
    for (let col = 0; col < width; col++) {
      const lon = bounds.minLon + (col + 0.5) * lonStep;
      const [x, y] = lonLatToUtm(lon, lat, utm.zone, utm.south);
      const i = row * width + col;
      ux[i] = x;
      uy[i] = y;
      if (area.kind === 'circle') {
        inArea[i] = (x - cx) ** 2 + (y - cy) ** 2 <= radiusM * radiusM ? 1 : 0;
      } else {
        inArea[i] = pointInRing(lat, lon, area.coordinates) ? 1 : 0;
      }
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const lo: [number, number] = [minX, minY];
  const hi: [number, number] = [maxX, maxY];
  const optional = (asset: SatelliteSceneAsset | undefined) =>
    asset && /^https?:\/\//.test(asset.href) ? readBandWindow(asset.href, lo, hi, signal).catch(() => null) : Promise.resolve(null);
  const [wRed, wGreen, wBlue, wNir, wScl, wSwir, wRedEdge] = await Promise.all([
    readBandWindow(red.href, lo, hi, signal),
    readBandWindow(green.href, lo, hi, signal),
    readBandWindow(blue.href, lo, hi, signal),
    readBandWindow(nir.href, lo, hi, signal),
    optional(scl),
    optional(swir16),
    optional(rededge1),
  ]);

  const sRed = reflectanceScaling(scene, red);
  const sGreen = reflectanceScaling(scene, green);
  const sBlue = reflectanceScaling(scene, blue);
  const sNir = reflectanceScaling(scene, nir);
  const sSwir = swir16 ? reflectanceScaling(scene, swir16) : null;
  const sRedEdge = rededge1 ? reflectanceScaling(scene, rededge1) : null;

  const R = new Float32Array(n);
  const G = new Float32Array(n);
  const B = new Float32Array(n);
  const NIR = new Float32Array(n);
  const NDVI = new Float32Array(n);
  const masked = new Uint8Array(n); // 0 valid, 1 cloud/shadow, 2 nodata/other invalid

  let total = 0;
  let cloud = 0;
  let nodata = 0;
  const ndviValues: number[] = [];
  let ndviSum = 0;
  let ndviSqSum = 0;
  let saviSum = 0;
  let saviCount = 0;
  let gcviSum = 0;
  let gcviCount = 0;
  let ndreSum = 0;
  let ndreCount = 0;
  let ndviMin = Infinity;
  let ndviMax = -Infinity;
  let eviSum = 0;
  let eviCount = 0;
  let ndmiSum = 0;
  let ndmiCount = 0;
  let ndwiSum = 0;
  let ndwiCount = 0;

  for (let i = 0; i < n; i++) {
    const x = ux[i];
    const y = uy[i];
    R[i] = sampleBilinear(wRed, x, y) * sRed.scale + sRed.offset;
    G[i] = sampleBilinear(wGreen, x, y) * sGreen.scale + sGreen.offset;
    B[i] = sampleBilinear(wBlue, x, y) * sBlue.scale + sBlue.offset;
    NIR[i] = sampleBilinear(wNir, x, y) * sNir.scale + sNir.offset;

    if (wScl) {
      const cls = sampleNearest(wScl, x, y);
      if (!Number.isFinite(cls)) masked[i] = 2;
      else if (SCL_CLOUD_OR_SHADOW.has(cls)) masked[i] = 1;
      else if (SCL_INVALID.has(cls)) masked[i] = 2;
    }
    if (!Number.isFinite(R[i]) || !Number.isFinite(NIR[i])) masked[i] = 2;

    const denom = NIR[i] + R[i];
    NDVI[i] = masked[i] === 0 && denom > 0 ? (NIR[i] - R[i]) / denom : NaN;
    if (masked[i] === 0 && !Number.isFinite(NDVI[i])) masked[i] = 2;

    if (!inArea[i]) continue;
    total++;
    if (masked[i] === 1) {
      cloud++;
      continue;
    }
    if (masked[i] === 2) {
      nodata++;
      continue;
    }
    const v = Math.max(-1, Math.min(1, NDVI[i]));
    ndviValues.push(v);
    ndviSum += v;
    ndviSqSum += v * v;
    const saviDen = NIR[i] + R[i] + 0.5;
    if (saviDen > 0) {
      saviSum += (1.5 * (NIR[i] - R[i])) / saviDen;
      saviCount++;
    }
    if (Number.isFinite(G[i]) && G[i] > 0.005) {
      gcviSum += NIR[i] / G[i] - 1;
      gcviCount++;
    }
    if (wRedEdge && sRedEdge) {
      const re = sampleBilinear(wRedEdge, x, y) * sRedEdge.scale + sRedEdge.offset;
      const ndreDen = NIR[i] + re;
      if (Number.isFinite(re) && ndreDen > 0) {
        ndreSum += (NIR[i] - re) / ndreDen;
        ndreCount++;
      }
    }
    if (v < ndviMin) ndviMin = v;
    if (v > ndviMax) ndviMax = v;

    const eviDen = NIR[i] + 6 * R[i] - 7.5 * B[i] + 1;
    if (Number.isFinite(B[i]) && eviDen > 0) {
      eviSum += Math.max(-1, Math.min(1, (2.5 * (NIR[i] - R[i])) / eviDen));
      eviCount++;
    }
    const ndwiDen = G[i] + NIR[i];
    if (Number.isFinite(G[i]) && ndwiDen > 0) {
      ndwiSum += (G[i] - NIR[i]) / ndwiDen;
      ndwiCount++;
    }
    if (wSwir && sSwir) {
      const sw = sampleBilinear(wSwir, x, y) * sSwir.scale + sSwir.offset;
      const ndmiDen = NIR[i] + sw;
      if (Number.isFinite(sw) && ndmiDen > 0) {
        ndmiSum += (NIR[i] - sw) / ndmiDen;
        ndmiCount++;
      }
    }
  }

  ndviValues.sort((a, b) => a - b);
  const valid = ndviValues.length;
  const stats: SceneClipStats = {
    ndviMean: valid ? ndviSum / valid : null,
    ndviMedian: valid ? ndviValues[Math.floor(valid / 2)] : null,
    ndviMin: valid ? ndviMin : null,
    ndviMax: valid ? ndviMax : null,
    ndviStd: valid ? Math.sqrt(Math.max(0, ndviSqSum / valid - (ndviSum / valid) ** 2)) : null,
    saviMean: saviCount ? saviSum / saviCount : null,
    gcviMean: gcviCount ? gcviSum / gcviCount : null,
    ndreMean: ndreCount ? ndreSum / ndreCount : null,
    eviMean: eviCount ? eviSum / eviCount : null,
    ndmiMean: ndmiCount ? ndmiSum / ndmiCount : null,
    ndwiMean: ndwiCount ? ndwiSum / ndwiCount : null,
    totalPixels: total,
    validPixels: valid,
    validCoveragePct: total ? (valid / total) * 100 : 0,
    cloudOrShadowPct: total ? (cloud / total) * 100 : 0,
    noDataPct: total ? (nodata / total) * 100 : 0,
  };

  // NDVI colour map
  const ndviRgba = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = masked[i] !== 0 ? NDVI_MASKED_COLOR : ndviColor(NDVI[i]);
    ndviRgba[i * 4] = r;
    ndviRgba[i * 4 + 1] = g;
    ndviRgba[i * 4 + 2] = b;
    ndviRgba[i * 4 + 3] = 255;
  }

  return {
    bounds,
    area,
    width,
    height,
    outputPixelSizeM,
    epsg,
    trueColorUrl: renderComposite(R, G, B, width, height),
    falseColorUrl: renderComposite(NIR, R, G, width, height),
    ndviUrl: toDataUrl(ndviRgba, width, height),
    stats,
    reflectance: sRed,
  };
}

/** Square clip around a point; statistics cover the circular search radius. */
export function loadSceneClip(
  scene: SatelliteScene,
  center: { lat: number; lon: number },
  radiusKm: number,
  signal?: AbortSignal
): Promise<SceneClip> {
  return loadAreaClip(scene, { kind: 'circle', center, radiusKm }, { signal });
}
