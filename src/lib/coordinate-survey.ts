/**
 * AgriSurvey AI — Coordinate crop survey (pure logic, no network, no DOM)
 *
 * Answers a district "coordinate sheet" such as the Akola client sheet, per GPS point:
 *   column 3  Identify the crop
 *   column 4  Crop situation in assessment window 1 (default 15–25 July)
 *   column 5  Crop situation in assessment window 2 (default 15–25 August)
 *   column 6  Estimated yield, kg/ha
 *
 * The method is the TypeScript port of GM-ML-V2 `cropsurvey/windows.py` on top of the
 * phenology template matcher in `crop-phenology.ts`:
 *   - crop: the season's NDVI curve is matched against crop templates; when the curve is
 *     still green at the window end (cotton / tur in November) the long-duration templates
 *     are compared instead of refusing outright, and the answer is labelled "probable";
 *   - situation: mean NDVI of the clear passes inside each window (±3 days), described in
 *     field-officer words and placed on the field's own seasonal amplitude; no clear pass
 *     → the value is interpolated from the bracketing passes and labelled as an estimate;
 *   - yield: regional reference yield for the crop, scaled by where the field's seasonal
 *     NDVI integral ranks among the other surveyed fields of the same crop (0.70–1.30×).
 *
 * Nothing here is field-calibrated. Every cell written to the sheet says how it was derived.
 */

import {
  CROP_LABELS,
  MATCHER_SETTINGS,
  SEASONS,
  SOIL_BASE_NDVI,
  SeasonName,
  Verdict,
  decide,
  gapFill,
  matchCrop,
  phenologyMetrics,
  savgol,
  seasonWindow,
  CropScore,
  Phenology,
} from './crop-phenology';

const DAY_MS = 24 * 3600 * 1000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

// ---------------------------------------------------------------------------
// Input points
// ---------------------------------------------------------------------------

export interface SurveyPoint {
  /** Serial number from the sheet (column 1) */
  srNo: number;
  lat: number;
  lon: number;
  /** 1-based worksheet row the point was read from, so results go back into the same row */
  row?: number;
  /** Serial number of an earlier point within `duplicateRadiusM`; its result is reused */
  sameAs?: number;
}

export interface SheetLayout {
  headerRow: number;
  srCol: number;
  coordCol?: number;
  latCol?: number;
  lonCol?: number;
  cropCol: number;
  window1Col: number;
  window2Col: number;
  yieldCol: number;
  title?: string;
  headers: Record<string, string>;
}

export interface ParsedSheet {
  points: SurveyPoint[];
  layout: SheetLayout;
  warnings: string[];
}

type Cell = string | number | null | undefined;

const norm = (v: Cell) => String(v ?? '').trim().toLowerCase();

/** "20.47,77.11" / "20.47 N, 77.11 E" / "20.47; 77.11" → [lat, lon] */
export function parseLatLon(text: Cell): [number, number] | null {
  const nums = String(text ?? '').match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lat = Number(nums[0]);
  const lon = Number(nums[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

/**
 * Read survey points from a sheet given as rows of cell values (row 0 = worksheet row 1).
 * Finds the header row by its "coordinates" / "lat" column (typos such as "Cordinates"
 * included) and the answer columns by their header text, falling back to the column order
 * of the Akola template.
 */
export function parseSurveyRows(rows: Cell[][]): ParsedSheet {
  const warnings: string[] = [];
  let headerIdx = -1;
  let coordCol: number | undefined;
  let latCol: number | undefined;
  let lonCol: number | undefined;

  // A header cell counts only if coordinates actually follow it within the next few rows
  // (a merged title such as "Coordinates of Crops for …" spans the same columns but is not one).
  const coordsBelow = (r: number, c: number) => rows.slice(r + 1, r + 6).some((row) => parseLatLon(row?.[c]) !== null);
  const numberBelow = (r: number, c: number) =>
    rows.slice(r + 1, r + 6).some((row) => row?.[c] !== null && row?.[c] !== undefined && row?.[c] !== '' && Number.isFinite(Number(row?.[c])));

  // When several rows qualify (merged title above the real header), the one nearest the
  // data wins.
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const row = rows[r] ?? [];
    let lat: number | undefined;
    let lon: number | undefined;
    let coord: number | undefined;
    for (let c = 0; c < row.length; c++) {
      const h = norm(row[c]);
      if (h.length > 60 || parseLatLon(row[c]) !== null) continue;
      if (coord === undefined && /co-?ordinate|cordinate|coordinat|lat\s*[,/&]\s*lon|gps\s*(point|location)/.test(h) && coordsBelow(r, c)) coord = c;
      else if (lat === undefined && /^lat(itude)?\b/.test(h) && numberBelow(r, c)) lat = c;
      else if (lon === undefined && /^(lon|lng|long)(gitude)?\b/.test(h) && numberBelow(r, c)) lon = c;
    }
    if (coord !== undefined) {
      headerIdx = r;
      coordCol = coord;
      latCol = lonCol = undefined;
    } else if (lat !== undefined && lon !== undefined) {
      headerIdx = r;
      latCol = lat;
      lonCol = lon;
      coordCol = undefined;
    }
    // Stop once data rows begin
    if (headerIdx >= 0 && r > headerIdx) break;
  }

  // No header: take the first column whose cells look like "lat,lon"
  if (headerIdx < 0) {
    outer: for (let r = 0; r < Math.min(rows.length, 30); r++) {
      const row = rows[r] ?? [];
      for (let c = 0; c < row.length; c++) {
        if (typeof row[c] === 'string' && parseLatLon(row[c]) && /,|;/.test(String(row[c]))) {
          headerIdx = r - 1;
          coordCol = c;
          break outer;
        }
      }
    }
    if (headerIdx < -1) headerIdx = -1;
    warnings.push('No header row found; coordinates were detected from the cell contents.');
  }

  const header = rows[headerIdx] ?? [];
  const headers: Record<string, string> = {};
  header.forEach((h, c) => {
    if (h !== null && h !== undefined && String(h).trim()) headers[String(c)] = String(h).trim();
  });

  const find = (re: RegExp, after = -1) => {
    for (let c = after + 1; c < header.length; c++) if (re.test(norm(header[c]))) return c;
    return -1;
  };
  const anchor = coordCol ?? lonCol ?? 1;
  const srColFound = find(/^(sr|s)\.?\s*(no|number)|serial|^#$/);
  const srCol = srColFound >= 0 ? srColFound : 0;
  let cropCol = find(/crop(?!.*situation)(?!.*yield)/);
  if (cropCol < 0 || cropCol === anchor) cropCol = anchor + 1;
  let window1Col = find(/situation|condition|status/);
  if (window1Col < 0) window1Col = cropCol + 1;
  let window2Col = find(/situation|condition|status/, window1Col);
  if (window2Col < 0) window2Col = window1Col + 1;
  let yieldCol = find(/yield/);
  if (yieldCol < 0) yieldCol = window2Col + 1;

  if (window2Col >= 0 && headers[String(window2Col)] && /july\s+to\s+25(th)?\s+aug/i.test(headers[String(window2Col)])) {
    warnings.push(
      `Column "${headers[String(window2Col)]}" says July to August, but the sheet's note asks for 15–25 August. ` +
        'The second window defaults to 15–25 August; confirm with the issuing office.'
    );
  }

  const points: SurveyPoint[] = [];
  const seen = new Set<number>();
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r] ?? [];
    let ll: [number, number] | null = null;
    if (coordCol !== undefined) ll = parseLatLon(row[coordCol]);
    else if (latCol !== undefined && lonCol !== undefined) {
      const lat = Number(row[latCol]);
      const lon = Number(row[lonCol]);
      ll = Number.isFinite(lat) && Number.isFinite(lon) && row[latCol] !== '' && row[lonCol] !== '' ? [lat, lon] : null;
    }
    if (!ll) continue;
    const srRaw = Number(row[srCol]);
    let srNo = Number.isFinite(srRaw) && srRaw > 0 ? Math.round(srRaw) : points.length + 1;
    if (seen.has(srNo)) {
      warnings.push(`Serial number ${srNo} appears more than once (row ${r + 1}); renumbered.`);
      srNo = Math.max(...seen) + 1;
    }
    seen.add(srNo);
    points.push({ srNo, lat: ll[0], lon: ll[1], row: r + 1 });
  }
  if (points.length === 0) warnings.push('No coordinates were found in the sheet.');

  const title = rows
    .slice(0, Math.max(0, headerIdx))
    .flat()
    .find((v) => typeof v === 'string' && v.trim().length > 10) as string | undefined;

  return {
    points,
    layout: { headerRow: headerIdx + 1, srCol, coordCol, latCol, lonCol, cropCol, window1Col, window2Col, yieldCol, title, headers },
    warnings,
  };
}

export function distanceM(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const R = 6371008.8;
  const p1 = (a.lat * Math.PI) / 180;
  const p2 = (b.lat * Math.PI) / 180;
  const dp = p2 - p1;
  const dl = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Mark points that repeat an earlier point within `radiusM` (same 10 m pixel neighbourhood). */
export function markDuplicates(points: SurveyPoint[], radiusM = 10): SurveyPoint[] {
  const out: SurveyPoint[] = [];
  for (const p of points) {
    const twin = out.find((q) => q.sameAs === undefined && distanceM(p, q) <= radiusM);
    out.push({ ...p, sameAs: twin?.srNo });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

/** One clear Sentinel-2 reading of the sampled area around a point. */
export interface PointObservation {
  date: string; // YYYY-MM-DD
  sceneId: string;
  tile?: string;
  clearPct: number;
  validPixels: number;
  ndvi: number;
  evi: number | null;
  savi: number | null;
  ndmi: number | null;
  ndwi: number | null;
  ndre: number | null;
  gcvi: number | null;
}

/** Every pass that was read, clear or not (the "raw data" the client asked for). */
export interface PassRead {
  date: string;
  sceneId: string;
  tile?: string;
  tileCloudPct: number;
  clearPct: number | null;
  ndviMedian: number | null;
  used: boolean;
  note?: string;
}

export interface AssessmentWindow {
  label: string;
  start: string; // YYYY-MM-DD
  end: string;
}

export function defaultWindows(year: number): AssessmentWindow[] {
  return [
    { label: `15–25 July ${year}`, start: `${year}-07-15`, end: `${year}-07-25` },
    { label: `15–25 August ${year}`, start: `${year}-08-15`, end: `${year}-08-25` },
  ];
}

// ---------------------------------------------------------------------------
// Crop identification
// ---------------------------------------------------------------------------

export type CropConfidence = 'moderate' | 'low' | 'none';

export interface CropIdentification {
  /** Crop key from CROP_PROFILES, or null when not determined */
  crop: string | null;
  /** Text for the sheet cell */
  cell: string;
  confidence: CropConfidence;
  status: Verdict['status'] | 'long_duration' | 'double_crop' | 'perennial';
  message: string;
  scores: CropScore[];
  phenology: Phenology | null;
  /** Seasonal NDVI integral (biomass proxy) used to rank yield */
  integral: number | null;
  clearDates: number;
  grid: number[];
  curve: number[] | null;
  windowStart: string;
  windowEnd: string;
}

const label = (c: string) => CROP_LABELS[c] ?? c;

interface WindowFit {
  grid: number[];
  curve: number[] | null;
  phenology: Phenology | null;
  scores: CropScore[];
  verdict: Verdict;
  n: number;
}

/** classifySeason() generalised to any [start, end] window and crop list. */
export function classifyWindow(start: string, end: string, obs: { date: string; ndvi: number }[], crops: string[]): WindowFit {
  const startMs = utc(start);
  const lengthDays = Math.round((utc(end) - startMs) / DAY_MS);
  const inWin = obs.filter((o) => o.date >= start && o.date <= end && Number.isFinite(o.ndvi)).sort((a, b) => a.date.localeCompare(b.date));
  const t = inWin.map((o) => Math.round((utc(o.date) - startMs) / DAY_MS));
  const grid: number[] = [];
  for (let d = 0; d <= lengthDays; d += MATCHER_SETTINGS.gridStepDays) grid.push(d);
  const filled = gapFill(t, inWin.map((o) => o.ndvi), grid);
  if (!filled) {
    return {
      grid,
      curve: null,
      phenology: null,
      scores: [],
      n: inWin.length,
      verdict: { status: 'insufficient_observations', crop: null, message: `Only ${inWin.length} clear dates; no growth curve.` },
    };
  }
  const curve = savgol(filled, MATCHER_SETTINGS.savgolWindow, MATCHER_SETTINGS.savgolOrder);
  const phenology = phenologyMetrics(grid, curve, MATCHER_SETTINGS.phenologyAmplitudeFraction, MATCHER_SETTINGS.truncationNdviFraction, SOIL_BASE_NDVI);
  const scores = matchCrop(grid, curve, crops);
  const edges = {
    start: t.length > 0 && t[0] <= MATCHER_SETTINGS.edgeObservedDays,
    end: t.length > 0 && lengthDays - t[t.length - 1] <= MATCHER_SETTINGS.edgeObservedDays,
  };
  return { grid, curve, phenology, scores, n: inWin.length, verdict: decide(scores, phenology, inWin.length, edges) };
}

const LONG_DURATION = ['cotton', 'tur'];
const SHORT_KHARIF = ['soybean', 'maize', 'jowar', 'bajra', 'rice'];

function pickAmong(scores: CropScore[], crops: string[]) {
  const s = scores.filter((x) => crops.includes(x.crop));
  const best = s[0] as CropScore | undefined;
  const margin = best && s.length > 1 ? best.fit - s[1].fit : best?.fit ?? 0;
  return { best, second: s[1], margin };
}

/**
 * Identify the crop at a point for a season. Uses the matcher's verdict when it commits,
 * and two narrowly-scoped fallbacks when the season runs past the window:
 *   - still green at the window end, no harvest dip → long-duration kharif crop
 *     (cotton vs tur, by template fit), labelled "probable";
 *   - a short crop harvested, then a second green-up → the first crop is classified on the
 *     window cut at the harvest trough, and the second crop is noted.
 */
export function identifyCrop(
  obs: { date: string; ndvi: number }[],
  season: SeasonName,
  year: number,
  today = isoOf(Date.now()),
  /** Crops to consider (defaults to every template for the season) */
  allowedCrops?: string[]
): CropIdentification {
  const w = seasonWindow(season, year);
  const end = w.end < today ? w.end : today;
  const crops = allowedCrops?.length ? SEASONS[season].crops.filter((c) => allowedCrops.includes(c)) : SEASONS[season].crops;
  const longDuration = LONG_DURATION.filter((c) => crops.includes(c));
  const shortKharif = SHORT_KHARIF.filter((c) => crops.includes(c));
  const full = classifyWindow(w.start, w.end, obs, crops);
  const v = full.verdict;
  const base = {
    scores: full.scores,
    phenology: full.phenology,
    integral: full.phenology ? full.phenology.integral : null,
    clearDates: full.n,
    grid: full.grid,
    curve: full.curve,
    windowStart: w.start,
    windowEnd: end,
  };

  if (v.status === 'matched' && v.crop) {
    const strong = (full.scores[0]?.fit ?? 0) >= 0.75 && (v.margin ?? 0) >= 0.06;
    return { ...base, crop: v.crop, cell: label(v.crop), confidence: strong ? 'moderate' : 'low', status: 'matched', message: v.message };
  }
  if (v.status === 'ambiguous' && v.crop) {
    const others = (v.candidates ?? []).filter((c) => c !== v.crop).map(label);
    return {
      ...base,
      crop: v.crop,
      cell: `${label(v.crop)} — probable (${others.join(' / ') || 'another crop'} fits almost as well)`,
      confidence: 'low',
      status: 'ambiguous',
      message: v.message,
    };
  }

  if (v.status === 'truncated_window' && full.phenology && full.curve) {
    const ph = full.phenology;
    const curve = full.curve;
    const iPeak = full.grid.indexOf(ph.peakDay);

    if (ph.truncatedStart && ph.truncatedEnd) {
      const { best } = pickAmong(full.scores, ['sugarcane']);
      return {
        ...base,
        crop: 'sugarcane',
        cell: 'Sugarcane or other perennial — probable, green all season',
        confidence: 'low',
        status: 'perennial',
        message: `Canopy was already green at the first clear date and still green at the last (peak NDVI ${ph.peakValue.toFixed(2)}). That fits sugarcane, an orchard or other perennial cover${best ? ` (sugarcane template fit ${best.fit.toFixed(2)})` : ''}; a kharif window cannot confirm it.`,
      };
    }

    if (ph.truncatedEnd && iPeak >= 0) {
      // Harvest trough after the peak, then a second rise?
      let iTrough = iPeak;
      for (let i = iPeak + 1; i < curve.length; i++) if (curve[i] < curve[iTrough]) iTrough = i;
      const rebound = curve[curve.length - 1] - curve[iTrough];
      const dip = ph.peakValue - curve[iTrough];
      if (iTrough > iPeak && iTrough < curve.length - 2 && dip >= 0.2 && rebound >= 0.12) {
        const troughDate = isoOf(utc(w.start) + full.grid[iTrough] * DAY_MS);
        const first = classifyWindow(w.start, troughDate, obs, shortKharif);
        const pick = pickAmong(first.scores, shortKharif);
        if (pick.best && pick.best.fit >= MATCHER_SETTINGS.minFit) {
          const amb = pick.margin < MATCHER_SETTINGS.ambiguousMargin && pick.second;
          return {
            ...base,
            crop: pick.best.crop,
            cell: `${label(pick.best.crop)}${amb ? ` or ${label(pick.second!.crop)}` : ''}, then a second crop sown from ${fmtDay(troughDate)}`,
            confidence: 'low',
            status: 'double_crop',
            integral: first.phenology?.integral ?? base.integral,
            message: `NDVI peaked at ${ph.peakValue.toFixed(2)}, fell to ${curve[iTrough].toFixed(2)} around ${fmtDay(troughDate)} (harvest) and rose again by ${rebound.toFixed(2)}, so the plot carries a short kharif crop followed by a second sowing. First crop: ${label(pick.best.crop)} fit ${pick.best.fit.toFixed(2)}.`,
          };
        }
      }

      // Still green at the window end with no harvest dip: long-duration kharif crop
      const pick = pickAmong(full.scores, longDuration);
      if (pick.best && ph.peakValue >= 0.45 && pick.best.fit >= MATCHER_SETTINGS.minFit - 0.1) {
        const amb = pick.margin < MATCHER_SETTINGS.ambiguousMargin;
        return {
          ...base,
          crop: pick.best.crop,
          cell: amb
            ? `${label(pick.best.crop)} or ${label(pick.second.crop)} — long-duration crop, still in field`
            : `${label(pick.best.crop)} — probable, long-duration crop still in field`,
          confidence: 'low',
          status: 'long_duration',
          message: `The field was still green at the last clear date (NDVI ${curve[curve.length - 1].toFixed(2)}), so the season is longer than the window and short crops such as soybean are ruled out. Among long-duration crops, ${label(pick.best.crop)} fits ${pick.best.fit.toFixed(2)}${pick.second ? ` vs ${label(pick.second.crop)} ${pick.second.fit.toFixed(2)}` : ''}. Cotton and tur have similar curves; confirm in the field.`,
        };
      }
    }
  }

  const cell =
    v.status === 'no_match' && /fallow|bare|non-crop/i.test(v.message)
      ? 'No crop detected (fallow / bare / non-crop)'
      : v.status === 'insufficient_observations'
      ? `Not determined (${full.n} clear dates; monsoon cloud)`
      : 'Not determined (no crop template fits)';
  return { ...base, crop: null, cell, confidence: 'none', status: v.status, message: v.message };
}

// ---------------------------------------------------------------------------
// Window condition (windows.py: assess_window / _describe)
// ---------------------------------------------------------------------------

export interface WindowAssessment {
  window: AssessmentWindow;
  basis: 'observed' | 'adjacent' | 'interpolated' | 'none';
  observations: PointObservation[];
  ndvi: number | null;
  ndmi: number | null;
  ndwi: number | null;
  evi: number | null;
  situation: string;
  /** Text for the sheet cell */
  cell: string;
  detail: string;
}

export const WINDOW_TOLERANCE_DAYS = 3;
const INTERPOLATE_MAX_GAP_DAYS = 15;

function describeNdvi(ndvi: number): string {
  if (ndvi < 0.18) return 'Bare / not sown';
  if (ndvi < 0.32) return 'Just sown or very early emergence';
  if (ndvi < 0.48) return 'Early vegetative';
  if (ndvi < 0.62) return 'Active vegetative growth';
  if (ndvi < 0.75) return 'Good canopy development';
  return 'Full canopy, vigorous';
}

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null && Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
};

export function assessWindow(
  window: AssessmentWindow,
  obs: PointObservation[],
  seasonal: { min: number; max: number } | null,
  tolerance = WINDOW_TOLERANCE_DAYS
): WindowAssessment {
  const from = isoOf(utc(window.start) - tolerance * DAY_MS);
  const to = isoOf(utc(window.end) + tolerance * DAY_MS);
  const sorted = [...obs].sort((a, b) => a.date.localeCompare(b.date));
  const inside = sorted.filter((o) => o.date >= window.start && o.date <= window.end);
  const near = sorted.filter((o) => o.date >= from && o.date <= to);
  const used = inside.length ? inside : near;

  let ndvi: number | null;
  let basis: WindowAssessment['basis'];
  let detail: string;
  let ndmi: number | null = null;
  let ndwi: number | null = null;
  let evi: number | null = null;

  if (used.length) {
    basis = inside.length ? 'observed' : 'adjacent';
    ndvi = mean(used.map((o) => o.ndvi));
    ndmi = mean(used.map((o) => o.ndmi));
    ndwi = mean(used.map((o) => o.ndwi));
    evi = mean(used.map((o) => o.evi));
    detail = `Clear Sentinel-2 pass${used.length > 1 ? 'es' : ''} on ${used.map((o) => fmtDay(o.date)).join(', ')}.`;
    if (!inside.length) detail += ` No clear pass fell inside ${window.label}; nearest within ${tolerance} days used.`;
  } else {
    const mid = (utc(window.start) + utc(window.end)) / 2;
    const before = [...sorted].reverse().find((o) => utc(o.date) < utc(window.start));
    const after = sorted.find((o) => utc(o.date) > utc(window.end));
    if (
      before &&
      after &&
      (utc(window.start) - utc(before.date)) / DAY_MS <= INTERPOLATE_MAX_GAP_DAYS &&
      (utc(after.date) - utc(window.end)) / DAY_MS <= INTERPOLATE_MAX_GAP_DAYS
    ) {
      const f = (mid - utc(before.date)) / (utc(after.date) - utc(before.date));
      ndvi = before.ndvi + f * (after.ndvi - before.ndvi);
      const lerp = (a: number | null, b: number | null) => (a !== null && b !== null ? a + f * (b - a) : null);
      ndmi = lerp(before.ndmi, after.ndmi);
      ndwi = lerp(before.ndwi, after.ndwi);
      evi = lerp(before.evi, after.evi);
      basis = 'interpolated';
      detail = `No cloud-free pass in or near the window (monsoon cloud). Estimated by interpolating the clear passes on ${fmtDay(before.date)} and ${fmtDay(after.date)}.`;
    } else {
      return {
        window,
        basis: 'none',
        observations: [],
        ndvi: null,
        ndmi: null,
        ndwi: null,
        evi: null,
        situation: 'No clear imagery',
        cell: 'No cloud-free satellite pass in window (monsoon cloud); field check needed',
        detail: `No cloud-free Sentinel-2 pass between ${fmtDay(from)} and ${fmtDay(to)}, and no clear passes within ${INTERPOLATE_MAX_GAP_DAYS} days on both sides to interpolate from. Sentinel-1 radar would cover this gap.`,
      };
    }
  }

  const v = ndvi as number;
  let situation = describeNdvi(v);
  if (seasonal && seasonal.max - seasonal.min > 0.08) {
    const rel = (v - seasonal.min) / (seasonal.max - seasonal.min);
    if (rel < 0.25 && v > 0.3) situation += ', well below this field’s seasonal peak';
    else if (rel > 0.85 && v > 0.45) situation += ', at or near seasonal peak';
    detail += ` ${Math.round(Math.max(0, Math.min(1, rel)) * 100)}% of this field’s seasonal NDVI range.`;
  }
  const flags: string[] = [];
  if (ndwi !== null && ndwi > 0.05) flags.push('surface water / waterlogging signal');
  if (ndmi !== null && v >= 0.45 && ndmi < 0) flags.push('possible moisture stress');
  if (flags.length) situation += `; ${flags.join('; ')}`;
  const idx = [`NDVI ${v.toFixed(2)}`, ndmi !== null ? `NDMI ${ndmi.toFixed(2)}` : '', evi !== null ? `EVI ${evi.toFixed(2)}` : '']
    .filter(Boolean)
    .join(', ');
  detail += ` ${idx}.`;
  const src =
    basis === 'interpolated'
      ? 'estimated between clear passes'
      : `${used.length} clear pass${used.length > 1 ? 'es' : ''}${basis === 'adjacent' ? ' just outside window' : ''}`;
  return {
    window,
    basis,
    observations: used,
    ndvi: v,
    ndmi,
    ndwi,
    evi,
    situation,
    cell: `${situation} (NDVI ${v.toFixed(2)}, ${src})`,
    detail: detail.trim(),
  };
}

// ---------------------------------------------------------------------------
// Yield (windows.py: estimate_yield)
// ---------------------------------------------------------------------------

/**
 * Regional reference yields, kg/ha (Vidarbha / PDKV Akola zone), from GM-ML-V2 windows.py.
 * Anchored on the ICAR-CRIDA district contingency plan for the PDKV Akola zone (2004–08
 * five-year average: cotton 258 kg lint/ha, soybean 845, pigeonpea 830, sorghum 856), lint
 * converted to seed cotton at 34% ginning outturn, with a modest uplift for variety and
 * practice improvement. REGIONAL ANCHORS, not field measurements: replace with the district's
 * own recent figures before submission.
 */
export const REFERENCE_YIELD_KG_HA: Record<string, { typical: number; low: number; high: number; note?: string }> = {
  cotton: { typical: 1100, low: 600, high: 1800, note: 'seed cotton (kapas)' },
  soybean: { typical: 1050, low: 550, high: 1600 },
  tur: { typical: 900, low: 450, high: 1400 },
  jowar: { typical: 950, low: 500, high: 1500 },
  bajra: { typical: 850, low: 450, high: 1300 },
  gram: { typical: 1000, low: 550, high: 1500 },
  wheat: { typical: 1900, low: 1100, high: 2800, note: 'irrigated' },
  onion: { typical: 16000, low: 9000, high: 24000 },
  sugarcane: { typical: 78000, low: 50000, high: 105000 },
};

export const YIELD_SOURCE =
  'ICAR-CRIDA district contingency plan, PDKV Akola zone (2004–08 five-year average), uplifted for variety and practice improvement. Regional anchor, not a field measurement.';

export interface YieldEstimate {
  estimate: number | null;
  low: number | null;
  high: number | null;
  percentile: number | null;
  confidence: CropConfidence;
  basis: string;
}

export function estimateYield(crop: string | null, integral: number | null, cohort: number[], cropConfidence: CropConfidence): YieldEstimate {
  if (!crop) return { estimate: null, low: null, high: null, percentile: null, confidence: 'none', basis: 'Crop not identified, so no yield is estimated.' };
  const ref = REFERENCE_YIELD_KG_HA[crop];
  if (!ref) {
    return { estimate: null, low: null, high: null, percentile: null, confidence: 'none', basis: `No regional reference yield is held for ${label(crop)}.` };
  }
  let factor = 1;
  let percentile: number | null = null;
  const peers = cohort.filter((x) => Number.isFinite(x));
  if (integral !== null && Number.isFinite(integral) && peers.length >= 5) {
    percentile = peers.filter((x) => x < integral).length / peers.length;
    factor = 0.7 + 0.6 * percentile;
  }
  const est = ref.typical * factor;
  const spread = cropConfidence === 'moderate' ? 0.38 : 0.52;
  const low = Math.max(ref.low * 0.85, est * (1 - spread));
  const high = Math.min(ref.high * 1.15, est * (1 + spread));
  const parts = [`Reference ${ref.typical.toLocaleString('en-IN')} kg/ha for ${label(crop)}${ref.note ? ` (${ref.note})` : ''}`];
  if (percentile !== null) parts.push(`scaled to the ${Math.round(percentile * 100)}th percentile of ${peers.length} surveyed ${label(crop)} fields by seasonal NDVI integral`);
  else parts.push(`unscaled — fewer than 5 surveyed ${label(crop)} fields to rank against`);
  if (cropConfidence !== 'moderate') parts.push('range widened because the crop identification is not clear-cut');
  return {
    estimate: Math.round(est / 10) * 10,
    low: Math.round(low / 10) * 10,
    high: Math.round(high / 10) * 10,
    percentile,
    confidence: percentile !== null && cropConfidence === 'moderate' ? 'moderate' : 'low',
    basis: parts.join('; ') + '.',
  };
}

// ---------------------------------------------------------------------------
// Per-point result and batch assembly
// ---------------------------------------------------------------------------

export interface PointImages {
  window: string;
  date: string;
  trueColor: string; // PNG data URL
  ndvi: string;
}

export interface PointResult {
  point: SurveyPoint;
  status: 'done' | 'error';
  error?: string;
  observations: PointObservation[];
  passes: PassRead[];
  crop: CropIdentification | null;
  windows: WindowAssessment[];
  yield: YieldEstimate | null;
  images: PointImages[];
}

/** Assess windows and crop for one point from its observations (yield needs the batch). */
export function interpretPoint(
  point: SurveyPoint,
  observations: PointObservation[],
  passes: PassRead[],
  windows: AssessmentWindow[],
  season: SeasonName,
  year: number,
  today?: string,
  allowedCrops?: string[]
): PointResult {
  const crop = identifyCrop(observations.map((o) => ({ date: o.date, ndvi: o.ndvi })), season, year, today, allowedCrops);
  const vals = observations.map((o) => o.ndvi);
  const seasonal = vals.length >= 3 ? { min: Math.min(...vals), max: Math.max(...vals) } : null;
  return {
    point,
    status: 'done',
    observations,
    passes,
    crop,
    windows: windows.map((w) => assessWindow(w, observations, seasonal)),
    yield: null,
    images: [],
  };
}

/** Yield needs the cohort of fields with the same crop, so it is filled in once all points are done. */
export function applyYields(results: PointResult[]): PointResult[] {
  const primary = results.filter((r) => r.status === 'done' && r.point.sameAs === undefined && r.crop?.crop);
  return results.map((r) => {
    if (r.status !== 'done' || !r.crop) return r;
    const cohort = primary
      .filter((p) => p !== r && p.crop!.crop === r.crop!.crop && p.crop!.integral !== null)
      .map((p) => p.crop!.integral as number);
    return { ...r, yield: estimateYield(r.crop.crop, r.crop.integral, cohort, r.crop.confidence) };
  });
}

export const VEGETATION_INDEX_DOC: { index: string; formula: string; bands: string; resolution: string; usedFor: string; limitation: string }[] = [
  {
    index: 'NDVI',
    formula: '(NIR − Red) / (NIR + Red)',
    bands: 'Sentinel-2 B08, B04',
    resolution: '10 m',
    usedFor: 'Primary greenness and biomass proxy. Drives crop identification (growth-curve shape), the window crop situation and the yield scaling.',
    limitation: 'Saturates above about LAI 3, so it stops separating dense canopies. Inflated by bright soil early in the season.',
  },
  {
    index: 'EVI',
    formula: '2.5 × (NIR − Red) / (NIR + 6·Red − 7.5·Blue + 1)',
    bands: 'B08, B04, B02',
    resolution: '10 m',
    usedFor: 'Greenness where NDVI saturates (dense cotton, sugarcane). Reported per window.',
    limitation: 'More sensitive to residual atmospheric effects than NDVI.',
  },
  {
    index: 'SAVI',
    formula: '1.5 × (NIR − Red) / (NIR + Red + 0.5)',
    bands: 'B08, B04',
    resolution: '10 m',
    usedFor: 'Early kharif, when fields are mostly bare soil with sparse seedlings and NDVI reads the soil.',
    limitation: 'Soil factor L fixed at 0.5, not tuned per field.',
  },
  {
    index: 'NDMI',
    formula: '(NIR − SWIR1) / (NIR + SWIR1)',
    bands: 'B08, B11',
    resolution: '20 m, resampled to 10 m',
    usedFor: 'Canopy water content; flags possible moisture stress (NDMI < 0 under a green canopy) in the window situation.',
    limitation: 'SWIR is 20 m, coarser than NDVI.',
  },
  {
    index: 'NDWI (McFeeters)',
    formula: '(Green − NIR) / (Green + NIR)',
    bands: 'B03, B08',
    resolution: '10 m',
    usedFor: 'Surface water / waterlogging (NDWI > 0.05 flagged in the window situation).',
    limitation: 'Confuses shadow with water.',
  },
  {
    index: 'NDRE',
    formula: '(NIR − RedEdge1) / (NIR + RedEdge1)',
    bands: 'B08, B05',
    resolution: '20 m, resampled to 10 m',
    usedFor: 'Chlorophyll (nitrogen status by proxy) in dense canopy. Reported in raw data.',
    limitation: 'Needs a red-edge band.',
  },
  {
    index: 'GCVI',
    formula: 'NIR / Green − 1',
    bands: 'B08, B03',
    resolution: '10 m',
    usedFor: 'Tracks biomass more linearly than NDVI at high canopy. Reported in raw data.',
    limitation: 'Unbounded, sensitive to calibration error.',
  },
];

export const METHOD_NOTES = [
  'Imagery: Copernicus Sentinel-2 Level-2A surface reflectance (ESA), read from the AWS Open Data COGs listed by the Element 84 Earth Search STAC catalogue. Native 10 m bands; only the pixels around each point are read.',
  'Cloud handling: per-pixel Scene Classification Layer mask (no data, saturated, cloud shadow, medium/high cloud, cirrus, snow removed). A pass is used for a point only if at least 50% of the sampled pixels are clear; the median NDVI of the clear pixels is the observation.',
  'Reflectance: processing-baseline 04.00 BOA offset handled per scene from STAC metadata.',
  'Crop identification: the season NDVI series (kharif window 10 Jun – 27 Nov) is gap-filled to a 5-day grid, Savitzky–Golay smoothed and matched against double-logistic crop templates (soybean, cotton, tur, rice, maize, jowar, bajra, sugarcane) with ±25 days sowing shift. Fit = 1 − RMSE / curve amplitude. The matcher abstains when there are fewer than 6 clear dates, when the best fit is below 0.5, or labels the result ambiguous when the two best crops fit within 0.04.',
  'Long-duration crops: a field still green at the last clear date cannot be soybean; it is compared against cotton and tur only and labelled "probable". Cotton and tur have similar growth curves and are not reliably separable from NDVI alone.',
  'Crop situation: mean index values of the clear passes inside each assessment window (±3 days if none inside). With no clear pass, the value is interpolated between clear passes no more than 15 days either side and labelled as an estimate; otherwise reported as no clear imagery.',
  'Yield: regional reference yield for the identified crop, scaled 0.70–1.30× by the percentile of the field’s seasonal NDVI integral among the other surveyed fields of the same crop (needs at least 5). This is an indicative yield class, not a measurement; the range reflects that variety, soil depth, management and rainfall timing are not observed by satellite.',
  'Duplicate points: points within 10 m of an earlier point fall in the same 10 m pixel neighbourhood and reuse that point’s result.',
  'Not field-calibrated: the crop templates and NDVI thresholds are indicative and have not been re-fitted on surveyed Akola parcels. Ground photographs and officer verification are required before these results are used for any decision.',
];
