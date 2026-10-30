/**
 * AgriSurvey AI — Photograph metadata (EXIF / XMP)
 *
 * Reads what the camera actually recorded: GPS position and its reported accuracy,
 * capture time, camera make/model and, for DJI drones, flight altitude and RTK status.
 * Nothing is filled in when a tag is missing — the record says the value is unavailable.
 * A geotag supports verification but does not by itself prove where a photo was taken.
 */

import exifr from 'exifr';

export interface PhotoMetadata {
  latitude: number | null;
  longitude: number | null;
  /** Reported horizontal GPS error in metres (EXIF GPSHPositioningError), if present */
  gpsAccuracyM: number | null;
  /** Camera-clock capture time: ISO with offset when the camera recorded one, otherwise local time without zone */
  capturedAt: string | null;
  cameraMake: string | null;
  cameraModel: string | null;
  /** Height above take-off point (DJI XMP RelativeAltitude) */
  relativeAltitudeM: number | null;
  /** DJI XMP RtkFlag: 50 = RTK fixed, 34 = float, 16 = single point */
  rtkStatus: 'FIXED' | 'FLOAT' | 'NONE' | null;
  gimbalPitchDeg: number | null;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const pad = (n: number) => String(n).padStart(2, '0');

function captureTime(dt: unknown, offset: unknown): string | null {
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return null;
  // exifr builds the Date from the camera's wall-clock fields in the browser's zone; read them back unchanged
  const local = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
  return typeof offset === 'string' && /^[+-]\d{2}:\d{2}$/.test(offset) ? `${local}${offset}` : local;
}

export async function readPhotoMetadata(file: Blob): Promise<PhotoMetadata> {
  let t: Record<string, unknown> = {};
  try {
    // Camera metadata lives in the header segments; avoid loading whole multi-MB photos
    const head = await file.slice(0, 1024 * 1024).arrayBuffer();
    t = ((await exifr.parse(head, { gps: true, xmp: true, tiff: true, exif: true, ifd1: false })) as Record<string, unknown>) ?? {};
  } catch {
    t = {};
  }
  const lat = num(t.latitude);
  const lon = num(t.longitude);
  const validFix = lat !== null && lon !== null && !(lat === 0 && lon === 0) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  const rtk = num(t.RtkFlag);
  return {
    latitude: validFix ? lat : null,
    longitude: validFix ? lon : null,
    gpsAccuracyM: num(t.GPSHPositioningError),
    capturedAt: captureTime(t.DateTimeOriginal ?? t.CreateDate ?? t.ModifyDate, t.OffsetTimeOriginal ?? t.OffsetTime),
    cameraMake: typeof t.Make === 'string' ? t.Make.trim() : null,
    cameraModel: typeof t.Model === 'string' ? t.Model.trim() : null,
    relativeAltitudeM: num(t.RelativeAltitude),
    rtkStatus: rtk === null ? null : rtk === 50 ? 'FIXED' : rtk === 34 ? 'FLOAT' : 'NONE',
    gimbalPitchDeg: num(t.GimbalPitchDegree),
  };
}

/** Short human description of where a photo's location came from. */
export function locationSourceLabel(m: Pick<PhotoMetadata, 'latitude' | 'rtkStatus' | 'gpsAccuracyM'>): string {
  if (m.latitude === null) return 'No GPS in file';
  if (m.rtkStatus === 'FIXED') return 'Camera GPS (RTK fixed)';
  if (m.gpsAccuracyM !== null) return `Camera GPS (±${m.gpsAccuracyM.toFixed(1)} m)`;
  return 'Camera GPS (accuracy not reported)';
}
