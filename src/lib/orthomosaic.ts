/**
 * AgriSurvey AI — Drone orthomosaic (GeoTIFF) loader
 *
 * Reads a georeferenced RGB GeoTIFF (e.g. from WebODM, Pix4D, DroneDeploy, Agisoft) in
 * the browser and resamples it onto a regular WGS84 lat/lon grid so it can be laid over
 * the field on a Leaflet map. Supports EPSG:4326, EPSG:3857 and WGS84 UTM (326xx/327xx).
 *
 * Drone orthomosaics are the only source in the platform that resolves individual plants
 * (typically 1–5 cm per pixel). Large files are read at reduced resolution for display;
 * GeoTIFFs with internal overviews (Cloud-Optimized GeoTIFF) load fastest.
 */

import { fromBlob } from 'geotiff';
import { AoiBounds, lonLatToUtm, utmToLonLat, utmZoneFromEpsg } from './sentinel-cog';

export interface Orthomosaic {
  fileName: string;
  url: string;
  bounds: AoiBounds;
  epsg: number;
  /** Ground size of one source pixel in metres */
  sourceGsdM: number;
  /** Ground size of one displayed pixel in metres (after any reduction for display) */
  displayGsdM: number;
  sourceWidth: number;
  sourceHeight: number;
  /** TIFF DateTime tag, when the processing software wrote one */
  capturedAt: string | null;
}

const R_MERC = 6378137;

type Forward = (lon: number, lat: number) => [number, number];
type Inverse = (x: number, y: number) => [number, number];

function projectionFor(epsg: number): { forward: Forward; inverse: Inverse; metresPerUnit: (lat: number) => number } {
  if (epsg === 4326) {
    return {
      forward: (lon, lat) => [lon, lat],
      inverse: (x, y) => [x, y],
      metresPerUnit: (lat) => 111320 * Math.cos((lat * Math.PI) / 180),
    };
  }
  if (epsg === 3857 || epsg === 900913) {
    return {
      forward: (lon, lat) => [(R_MERC * lon * Math.PI) / 180, R_MERC * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))],
      inverse: (x, y) => [(x / R_MERC) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R_MERC)) - Math.PI / 2) * (180 / Math.PI)],
      metresPerUnit: (lat) => Math.cos((lat * Math.PI) / 180),
    };
  }
  const utm = utmZoneFromEpsg(epsg);
  if (utm) {
    return {
      forward: (lon, lat) => lonLatToUtm(lon, lat, utm.zone, utm.south),
      inverse: (x, y) => utmToLonLat(x, y, utm.zone, utm.south),
      metresPerUnit: () => 1,
    };
  }
  throw new Error(
    `Unsupported coordinate system EPSG:${epsg}. Export the orthomosaic in WGS84 (EPSG:4326), Web Mercator (EPSG:3857) or WGS84 / UTM.`
  );
}

export async function loadOrthomosaic(file: File, maxDisplayDim = 2400): Promise<Orthomosaic> {
  if (!/\.tiff?$/i.test(file.name) && file.type !== 'image/tiff') {
    throw new Error('Please choose a georeferenced GeoTIFF (.tif) orthomosaic.');
  }
  const tiff = await fromBlob(file);
  const image = await tiff.getImage(0);
  const geoKeys = (image.getGeoKeys?.() ?? {}) as Record<string, number>;
  const epsg = geoKeys.ProjectedCSTypeGeoKey || geoKeys.GeographicTypeGeoKey;
  if (!epsg) throw new Error('This TIFF has no map georeferencing (GeoTIFF keys). Export a georeferenced orthomosaic.');
  let bbox: number[];
  try {
    bbox = image.getBoundingBox();
  } catch {
    throw new Error('This TIFF has no map georeferencing (tie points). Export a georeferenced orthomosaic.');
  }
  const proj = projectionFor(epsg);

  const srcW = image.getWidth();
  const srcH = image.getHeight();
  const samples = image.getSamplesPerPixel();
  if (samples < 3) throw new Error('The orthomosaic must be an RGB image (3 or 4 bands).');

  // Geographic bounds from the four corners
  const corners = [
    proj.inverse(bbox[0], bbox[1]),
    proj.inverse(bbox[0], bbox[3]),
    proj.inverse(bbox[2], bbox[1]),
    proj.inverse(bbox[2], bbox[3]),
  ];
  const bounds: AoiBounds = {
    minLon: Math.min(...corners.map((c) => c[0])),
    maxLon: Math.max(...corners.map((c) => c[0])),
    minLat: Math.min(...corners.map((c) => c[1])),
    maxLat: Math.max(...corners.map((c) => c[1])),
  };
  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const sourceGsdM = ((bbox[2] - bbox[0]) / srcW) * proj.metresPerUnit(centerLat);

  // Read a reduced copy for display (geotiff.js uses internal overviews when present)
  const scale = Math.min(1, maxDisplayDim / Math.max(srcW, srcH));
  const readW = Math.max(1, Math.round(srcW * scale));
  const readH = Math.max(1, Math.round(srcH * scale));
  const sampleIdx = samples >= 4 ? [0, 1, 2, 3] : [0, 1, 2];
  const bands = (await image.readRasters({ samples: sampleIdx, width: readW, height: readH, resampleMethod: 'bilinear' })) as unknown as ArrayLike<number>[];

  // 8-bit is typical; stretch 16-bit or float exports to the display range
  const bits = (image.getBitsPerSample?.() as number) ?? 8;
  let lo = 0;
  let hi = 255;
  if (bits > 8) {
    const values: number[] = [];
    const step = Math.max(1, Math.floor(bands[0].length / 30000));
    for (let i = 0; i < bands[0].length; i += step) for (let b = 0; b < 3; b++) if (bands[b][i] > 0) values.push(bands[b][i]);
    values.sort((a, b) => a - b);
    lo = values[Math.floor(values.length * 0.01)] ?? 0;
    hi = values[Math.floor(values.length * 0.99)] ?? 1;
  }
  const to8 = (v: number) => (bits > 8 ? (255 * (v - lo)) / Math.max(1e-9, hi - lo) : v);

  // Resample onto a lat/lon grid with the same pixel count, so overlays align exactly
  const outW = readW;
  const outH = Math.max(1, Math.round(readW * ((bounds.maxLat - bounds.minLat) / ((bounds.maxLon - bounds.minLon) * Math.cos((centerLat * Math.PI) / 180)))));
  const rgba = new Uint8ClampedArray(outW * outH * 4);
  const pxW = (bbox[2] - bbox[0]) / readW;
  const pxH = (bbox[3] - bbox[1]) / readH;
  for (let row = 0; row < outH; row++) {
    const lat = bounds.maxLat - ((row + 0.5) / outH) * (bounds.maxLat - bounds.minLat);
    for (let col = 0; col < outW; col++) {
      const lon = bounds.minLon + ((col + 0.5) / outW) * (bounds.maxLon - bounds.minLon);
      const [x, y] = proj.forward(lon, lat);
      const sx = Math.floor((x - bbox[0]) / pxW);
      const sy = Math.floor((bbox[3] - y) / pxH);
      const o = (row * outW + col) * 4;
      if (sx < 0 || sy < 0 || sx >= readW || sy >= readH) continue; // transparent outside the image
      const i = sy * readW + sx;
      const r = bands[0][i];
      const g = bands[1][i];
      const b = bands[2][i];
      const alpha = sampleIdx.length === 4 ? bands[3][i] : r === 0 && g === 0 && b === 0 ? 0 : 255;
      rgba[o] = to8(r);
      rgba[o + 1] = to8(g);
      rgba[o + 2] = to8(b);
      rgba[o + 3] = bits > 8 && sampleIdx.length === 4 ? (alpha > 0 ? 255 : 0) : alpha;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context unavailable in this browser.');
  ctx.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, outW, outH), 0, 0);

  const dt = (image.fileDirectory as Record<string, unknown>)?.DateTime;
  const capturedAt =
    typeof dt === 'string' && /^\d{4}:\d{2}:\d{2}/.test(dt) ? `${dt.slice(0, 4)}-${dt.slice(5, 7)}-${dt.slice(8, 10)}` : null;

  return {
    fileName: file.name,
    url: canvas.toDataURL('image/png'),
    bounds,
    epsg,
    sourceGsdM,
    displayGsdM: sourceGsdM / scale,
    sourceWidth: srcW,
    sourceHeight: srcH,
    capturedAt,
  };
}
