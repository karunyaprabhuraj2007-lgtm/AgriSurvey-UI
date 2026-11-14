/**
 * AgriSurvey AI — Coordinate crop survey runner and Excel round-trip
 *
 * Reads a district coordinate sheet (.xlsx or .csv), analyses every point on real
 * Sentinel-2 L2A imagery (Earth Search STAC + COG range reads, no credentials), and writes
 * the answers back into the same workbook with the raw data, index documentation, method
 * notes and satellite image chips the client asked for.
 *
 * Interpretation logic lives in src/lib/coordinate-survey.ts (pure, testable offline).
 */

import type ExcelJSNamespace from 'exceljs';
import { SatelliteScene } from '@/types';
import { stacSatelliteService } from './stac.service';
import { loadAreaClip, SceneClip, SurveyArea } from '@/lib/sentinel-cog';
import { CROP_LABELS, SEASONS, SeasonName, seasonWindow } from '@/lib/crop-phenology';
import {
  AssessmentWindow,
  METHOD_NOTES,
  ParsedSheet,
  PassRead,
  PointImages,
  PointObservation,
  PointResult,
  SurveyPoint,
  VEGETATION_INDEX_DOC,
  WINDOW_TOLERANCE_DAYS,
  YIELD_SOURCE,
  applyYields,
  interpretPoint,
  markDuplicates,
  parseSurveyRows,
} from '@/lib/coordinate-survey';

type Cell = string | number | null | undefined;

const DAY_MS = 24 * 3600 * 1000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`).getTime();
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Pass is used for a point only if this share of the sampled pixels is clear. */
export const MIN_POINT_CLEAR_PCT = 50;
const GOOD_POINT_CLEAR_PCT = 80;
/** Season series sampling: the clearest pass in each 10-day bin. */
const BIN_DAYS = 10;
const MAX_TRIES_PER_BIN = 3;
const MAX_READS_PER_WINDOW = 5;

let excelModule: Promise<typeof ExcelJSNamespace> | null = null;
async function excel(): Promise<typeof ExcelJSNamespace> {
  if (!excelModule) excelModule = import('exceljs').then((m) => ((m as unknown as { default?: typeof ExcelJSNamespace }).default ?? m) as typeof ExcelJSNamespace);
  return excelModule;
}

// ---------------------------------------------------------------------------
// Reading the sheet
// ---------------------------------------------------------------------------

export interface LoadedSheet extends ParsedSheet {
  fileName: string;
  kind: 'xlsx' | 'csv';
  sheetName?: string;
  /** Original file bytes, kept so the answers can be written into the same workbook */
  buffer: ArrayBuffer;
}

function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cur);
      cur = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cur);
      rows.push(row);
      row = [];
      cur = '';
    } else cur += ch;
  }
  if (cur || row.length) {
    row.push(cur);
    rows.push(row);
  }
  // A CSV with separate lat / lon columns is handled by parseSurveyRows; numbers stay text-safe.
  return rows.map((r) => r.map((c) => (typeof c === 'string' && /^-?\d+(\.\d+)?$/.test(c.trim()) ? Number(c) : c)));
}

function cellValue(cell: ExcelJSNamespace.Cell): Cell {
  const v = cell.value as unknown;
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null && 'result' in v) {
    const r = (v as { result?: unknown }).result;
    return typeof r === 'number' || typeof r === 'string' ? r : cell.text;
  }
  return cell.text;
}

export function worksheetRows(ws: ExcelJSNamespace.Worksheet): Cell[][] {
  const rows: Cell[][] = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const out: Cell[] = [];
    for (let c = 1; c <= Math.max(ws.columnCount, row.cellCount); c++) out.push(cellValue(row.getCell(c)));
    rows.push(out);
  }
  return rows;
}

export async function loadSurveySheet(file: File): Promise<LoadedSheet> {
  const buffer = await file.arrayBuffer();
  const isCsv = /\.csv$/i.test(file.name) || file.type === 'text/csv';
  if (isCsv) {
    const parsed = parseSurveyRows(parseCsv(new TextDecoder().decode(buffer)));
    return { ...parsed, points: markDuplicates(parsed.points), fileName: file.name, kind: 'csv', buffer };
  }
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  let best: { ws: ExcelJSNamespace.Worksheet; parsed: ParsedSheet } | null = null;
  wb.eachSheet((ws) => {
    const parsed = parseSurveyRows(worksheetRows(ws));
    if (!best || parsed.points.length > best.parsed.points.length) best = { ws, parsed };
  });
  if (!best) throw new Error('The workbook has no worksheets.');
  const { ws, parsed } = best as { ws: ExcelJSNamespace.Worksheet; parsed: ParsedSheet };
  return { ...parsed, points: markDuplicates(parsed.points), fileName: file.name, kind: 'xlsx', sheetName: ws.name, buffer };
}

// ---------------------------------------------------------------------------
// Imagery per point
// ---------------------------------------------------------------------------

export interface SurveyRunOptions {
  season: SeasonName;
  year: number;
  windows: AssessmentWindow[];
  /** Radius of the sampled circle around each coordinate, metres */
  radiusM: number;
  /** Crop templates to consider; empty = all templates for the season */
  crops?: string[];
  concurrency?: number;
  signal?: AbortSignal;
  onPointStart?: (p: SurveyPoint) => void;
  onPointDone?: (r: PointResult, completed: number, total: number) => void;
  onPointProgress?: (srNo: number, read: number, planned: number) => void;
  /** Injected data access (tests); defaults to Earth Search STAC + COG reads */
  deps?: SurveyDeps;
}

export interface SurveyDeps {
  searchSeason: typeof stacSatelliteService.searchSeason;
  loadClip: typeof loadAreaClip;
}

const defaultDeps: SurveyDeps = {
  searchSeason: (p) => stacSatelliteService.searchSeason(p),
  loadClip: loadAreaClip,
};

function toObservation(scene: SatelliteScene, clip: SceneClip): PointObservation | null {
  const s = clip.stats;
  if (s.ndviMedian === null || s.validCoveragePct < MIN_POINT_CLEAR_PCT) return null;
  const r = (x: number | null, d = 4) => (x === null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));
  return {
    date: scene.acquisition_datetime.slice(0, 10),
    sceneId: scene.scene_id,
    tile: scene.mgrs_tile,
    clearPct: Number(s.validCoveragePct.toFixed(1)),
    validPixels: s.validPixels,
    ndvi: Number(s.ndviMedian.toFixed(4)),
    evi: r(s.eviMean),
    savi: r(s.saviMean),
    ndmi: r(s.ndmiMean),
    ndwi: r(s.ndwiMean),
    ndre: r(s.ndreMean),
    gcvi: r(s.gcviMean),
  };
}

async function pointImagery(point: SurveyPoint, opts: SurveyRunOptions) {
  const w = seasonWindow(opts.season, opts.year);
  const today = isoOf(Date.now());
  const end = w.end < today ? w.end : today;
  if (w.start > today) throw new Error(`The ${opts.season} ${opts.year} season has not started yet.`);
  const area: SurveyArea = { kind: 'circle', center: { lat: point.lat, lon: point.lon }, radiusKm: opts.radiusM / 1000 };

  const deps = opts.deps ?? defaultDeps;
  const scenes = await deps.searchSeason({
    point: { lat: point.lat, lon: point.lon },
    startDate: w.start,
    endDate: end,
    maxCloudCover: 95,
    signal: opts.signal,
  });

  const passes: PassRead[] = [];
  const observations = new Map<string, PointObservation>();
  const images: PointImages[] = [];
  const day = (s: SatelliteScene) => s.acquisition_datetime.slice(0, 10);

  const read = async (scene: SatelliteScene) => {
    if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const entry: PassRead = {
      date: day(scene),
      sceneId: scene.scene_id,
      tile: scene.mgrs_tile,
      tileCloudPct: Number(scene.cloud_cover_percentage.toFixed(1)),
      clearPct: null,
      ndviMedian: null,
      used: false,
    };
    passes.push(entry);
    try {
      const clip = await deps.loadClip(scene, area, { marginM: 120, maxOutputDim: 160, signal: opts.signal });
      entry.clearPct = Number(clip.stats.validCoveragePct.toFixed(1));
      entry.ndviMedian = clip.stats.ndviMedian === null ? null : Number(clip.stats.ndviMedian.toFixed(4));
      const obs = toObservation(scene, clip);
      if (!obs) entry.note = `Only ${entry.clearPct}% of sampled pixels clear`;
      else {
        const prev = observations.get(obs.date);
        if (!prev || obs.clearPct > prev.clearPct) observations.set(obs.date, obs);
        entry.used = true;
      }
      return { clip, obs };
    } catch (err) {
      if (opts.signal?.aborted) throw err;
      entry.note = err instanceof Error ? err.message : String(err);
      return { clip: null, obs: null };
    }
  };

  // 1. Assessment windows: read every pass in window ± tolerance, clearest tiles first.
  const tol = WINDOW_TOLERANCE_DAYS * DAY_MS;
  const ranges = opts.windows.map((win) => ({ win, from: isoOf(utc(win.start) - tol), to: isoOf(utc(win.end) + tol) }));
  const inRange = (s: SatelliteScene) => ranges.some((r) => day(s) >= r.from && day(s) <= r.to);

  // 2. Season series: the clearest pass per 10-day bin outside the windows.
  const bins = new Map<number, SatelliteScene[]>();
  for (const s of scenes) {
    if (inRange(s)) continue;
    const b = Math.floor((utc(day(s)) - utc(w.start)) / (BIN_DAYS * DAY_MS));
    bins.set(b, [...(bins.get(b) ?? []), s]);
  }
  const planned =
    ranges.reduce((n, r) => n + Math.min(MAX_READS_PER_WINDOW, scenes.filter((s) => day(s) >= r.from && day(s) <= r.to).length), 0) + bins.size;
  let done = 0;
  const tick = () => opts.onPointProgress?.(point.srNo, ++done, planned);

  for (const r of ranges) {
    const cands = scenes
      .filter((s) => day(s) >= r.from && day(s) <= r.to)
      .sort((a, b) => a.cloud_cover_percentage - b.cloud_cover_percentage)
      .slice(0, MAX_READS_PER_WINDOW);
    let bestImg: { scene: SatelliteScene; clip: SceneClip; inside: boolean } | null = null;
    for (const s of cands) {
      const { clip, obs } = await read(s);
      tick();
      if (clip && obs) {
        const inside = day(s) >= r.win.start && day(s) <= r.win.end;
        if (!bestImg || (inside && !bestImg.inside) || (inside === bestImg.inside && clip.stats.validCoveragePct > bestImg.clip.stats.validCoveragePct)) {
          bestImg = { scene: s, clip, inside };
        }
      }
    }
    if (bestImg) images.push({ window: r.win.label, date: day(bestImg.scene), trueColor: bestImg.clip.trueColorUrl, ndvi: bestImg.clip.ndviUrl });
  }

  const binList = [...bins.values()];
  const worker = async () => {
    while (binList.length) {
      const cands = binList.shift()!.sort((a, b) => a.cloud_cover_percentage - b.cloud_cover_percentage).slice(0, MAX_TRIES_PER_BIN);
      for (const s of cands) {
        const { clip } = await read(s);
        if (clip && clip.stats.validCoveragePct >= GOOD_POINT_CLEAR_PCT) break;
      }
      tick();
    }
  };
  await Promise.all([worker(), worker()]);

  passes.sort((a, b) => a.date.localeCompare(b.date));
  return {
    observations: [...observations.values()].sort((a, b) => a.date.localeCompare(b.date)),
    passes,
    images,
    scenesFound: scenes.length,
  };
}

/** Analyse every point; points marked `sameAs` reuse their twin's imagery. */
export async function runCoordinateSurvey(points: SurveyPoint[], opts: SurveyRunOptions): Promise<PointResult[]> {
  const results = new Map<number, PointResult>();
  const primaries = points.filter((p) => p.sameAs === undefined);
  const queue = [...primaries];
  let completed = 0;
  const total = points.length;

  const finishTwins = (primary: PointResult) => {
    for (const twin of points.filter((p) => p.sameAs === primary.point.srNo)) {
      const r: PointResult = { ...primary, point: twin };
      results.set(twin.srNo, r);
      completed++;
      opts.onPointDone?.(r, completed, total);
    }
  };

  const worker = async () => {
    while (queue.length) {
      const p = queue.shift()!;
      opts.onPointStart?.(p);
      let r: PointResult;
      try {
        const img = await pointImagery(p, opts);
        r = interpretPoint(p, img.observations, img.passes, opts.windows, opts.season, opts.year, undefined, opts.crops);
        r.images = img.images;
        if (img.scenesFound === 0) {
          r = { ...r, status: 'error', error: 'No Sentinel-2 passes found over this coordinate for the season.' };
        }
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        const msg = err instanceof Error ? err.message : String(err);
        r = {
          point: p,
          status: 'error',
          error: /failed to fetch|fetch failed|networkerror|load failed|ENOTFOUND|ECONNRE/i.test(msg)
            ? 'Could not reach the Sentinel-2 archive (Earth Search / AWS). Check the connection and use "Retry failed points".'
            : msg,
          observations: [],
          passes: [],
          crop: null,
          windows: [],
          yield: null,
          images: [],
        };
      }
      results.set(p.srNo, r);
      completed++;
      opts.onPointDone?.(r, completed, total);
      finishTwins(r);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 3, primaries.length)) }, worker));
  return applyYields(points.map((p) => results.get(p.srNo)!).filter(Boolean));
}

// ---------------------------------------------------------------------------
// Writing the answers back
// ---------------------------------------------------------------------------

export interface ExportContext {
  sheet: LoadedSheet;
  results: PointResult[];
  windows: AssessmentWindow[];
  season: SeasonName;
  year: number;
  radiusM: number;
  crops?: string[];
  generatedBy?: string;
}

const cropName = (k: string | null | undefined) => (k ? CROP_LABELS[k] ?? k : '');

function styleHeader(row: ExcelJSNamespace.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
  row.alignment = { vertical: 'middle', wrapText: true };
}

function addTable(wb: ExcelJSNamespace.Workbook, name: string, columns: { header: string; key: string; width: number }[], rows: Record<string, unknown>[]) {
  const ws = wb.addWorksheet(name);
  ws.columns = columns;
  styleHeader(ws.getRow(1));
  for (const r of rows) ws.addRow(r).alignment = { vertical: 'top', wrapText: true };
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  return ws;
}

function dataUrlBase64(url: string) {
  return url.replace(/^data:image\/png;base64,/, '');
}

/** Filled copy of the client's workbook (or a new one for CSV input). */
export async function buildFilledWorkbook(ctx: ExportContext): Promise<Blob> {
  const ExcelJS = await excel();
  const wb = new ExcelJS.Workbook();
  const L =
    ctx.sheet.kind === 'xlsx' ? ctx.sheet.layout : { ...ctx.sheet.layout, cropCol: 2, window1Col: 3, window2Col: 4, yieldCol: 5 };
  let ws: ExcelJSNamespace.Worksheet;
  const rowOf = new Map<PointResult, number | undefined>(ctx.results.map((r) => [r, r.point.row]));

  if (ctx.sheet.kind === 'xlsx') {
    await wb.xlsx.load(ctx.sheet.buffer.slice(0));
    ws = (ctx.sheet.sheetName && wb.getWorksheet(ctx.sheet.sheetName)) || wb.worksheets[0];
  } else {
    ws = wb.addWorksheet('Crop survey');
    ws.addRow(['Sr. No.', 'Coordinates', 'Identify the Crop', `Crop situation ${ctx.windows[0]?.label ?? ''}`, `Crop situation ${ctx.windows[1]?.label ?? ''}`, 'Estimated Yield (kg/ha)']);
    styleHeader(ws.getRow(1));
    ctx.results.forEach((r, i) => {
      ws.addRow([r.point.srNo, `${r.point.lat},${r.point.lon}`]);
      rowOf.set(r, i + 2);
    });
  }

  for (const r of ctx.results) {
    const rowNo = rowOf.get(r);
    if (!rowNo) continue;
    const row = ws.getRow(rowNo);
    const set = (col: number, value: string | number) => {
      const c = row.getCell(col + 1);
      c.value = value;
      c.alignment = { vertical: 'top', wrapText: true };
    };
    if (r.status === 'error') {
      set(L.cropCol, `Not analysed: ${r.error}`);
      continue;
    }
    set(L.cropCol, r.crop?.cell ?? 'Not determined');
    if (r.windows[0]) set(L.window1Col, r.windows[0].cell);
    if (r.windows[1]) set(L.window2Col, r.windows[1].cell);
    if (r.yield?.estimate != null) {
      set(L.yieldCol, r.yield.estimate);
      row.getCell(L.yieldCol + 1).note = `Indicative. Range ${r.yield.low}–${r.yield.high} kg/ha, ${r.yield.confidence} confidence. ${r.yield.basis}`;
    } else set(L.yieldCol, 'Not estimated (crop not identified)');
    row.commit();
  }
  for (const col of [L.cropCol, L.window1Col, L.window2Col]) {
    const c = ws.getColumn(col + 1);
    c.width = Math.max(c.width ?? 10, col === L.cropCol ? 34 : 46);
  }
  ws.getColumn(L.yieldCol + 1).width = Math.max(ws.getColumn(L.yieldCol + 1).width ?? 10, 16);

  // Point details
  const w1 = ctx.windows[0]?.label ?? 'Window 1';
  const w2 = ctx.windows[1]?.label ?? 'Window 2';
  addTable(
    wb,
    'Point details',
    [
      { header: 'Sr. No.', key: 'sr', width: 8 },
      { header: 'Latitude', key: 'lat', width: 12 },
      { header: 'Longitude', key: 'lon', width: 12 },
      { header: 'Same location as Sr.', key: 'same', width: 10 },
      { header: 'Crop (sheet answer)', key: 'crop', width: 30 },
      { header: 'Crop key', key: 'cropKey', width: 12 },
      { header: 'Crop result type', key: 'cropStatus', width: 16 },
      { header: 'Crop confidence', key: 'cropConf', width: 12 },
      { header: 'Crop reasoning', key: 'cropMsg', width: 60 },
      { header: 'Template fits (top 3)', key: 'fits', width: 34 },
      { header: 'Clear dates in season', key: 'nClear', width: 10 },
      { header: 'Season peak NDVI', key: 'peak', width: 10 },
      { header: 'Peak date', key: 'peakDate', width: 12 },
      { header: 'Green-up (SOS) date', key: 'sos', width: 12 },
      { header: 'Season length (days)', key: 'len', width: 10 },
      { header: `${w1}: situation`, key: 'w1', width: 40 },
      { header: `${w1}: basis`, key: 'w1b', width: 12 },
      { header: `${w1}: NDVI`, key: 'w1n', width: 9 },
      { header: `${w1}: NDMI`, key: 'w1m', width: 9 },
      { header: `${w1}: detail`, key: 'w1d', width: 60 },
      { header: `${w2}: situation`, key: 'w2', width: 40 },
      { header: `${w2}: basis`, key: 'w2b', width: 12 },
      { header: `${w2}: NDVI`, key: 'w2n', width: 9 },
      { header: `${w2}: NDMI`, key: 'w2m', width: 9 },
      { header: `${w2}: detail`, key: 'w2d', width: 60 },
      { header: 'Yield estimate (kg/ha)', key: 'y', width: 12 },
      { header: 'Yield low', key: 'yl', width: 10 },
      { header: 'Yield high', key: 'yh', width: 10 },
      { header: 'Yield confidence', key: 'yc', width: 10 },
      { header: 'Yield basis', key: 'yb', width: 60 },
      { header: 'Error', key: 'err', width: 30 },
    ],
    ctx.results.map((r) => {
      const ph = r.crop?.phenology;
      const dayIso = (d: number | undefined) => (d === undefined || !r.crop ? '' : isoOf(utc(r.crop.windowStart) + d * DAY_MS));
      return {
        sr: r.point.srNo,
        lat: r.point.lat,
        lon: r.point.lon,
        same: r.point.sameAs ?? '',
        crop: r.crop?.cell ?? '',
        cropKey: r.crop?.crop ?? '',
        cropStatus: r.crop?.status ?? '',
        cropConf: r.crop?.confidence ?? '',
        cropMsg: r.crop?.message ?? '',
        fits: (r.crop?.scores ?? []).slice(0, 3).map((s) => `${cropName(s.crop)} ${s.fit.toFixed(2)}`).join('; '),
        nClear: r.observations.length,
        peak: ph ? Number(ph.peakValue.toFixed(3)) : '',
        peakDate: dayIso(ph?.peakDay),
        sos: dayIso(ph?.sos),
        len: ph ? Math.round(ph.length) : '',
        w1: r.windows[0]?.cell ?? '',
        w1b: r.windows[0]?.basis ?? '',
        w1n: r.windows[0]?.ndvi != null ? Number(r.windows[0].ndvi.toFixed(3)) : '',
        w1m: r.windows[0]?.ndmi != null ? Number(r.windows[0].ndmi.toFixed(3)) : '',
        w1d: r.windows[0]?.detail ?? '',
        w2: r.windows[1]?.cell ?? '',
        w2b: r.windows[1]?.basis ?? '',
        w2n: r.windows[1]?.ndvi != null ? Number(r.windows[1].ndvi.toFixed(3)) : '',
        w2m: r.windows[1]?.ndmi != null ? Number(r.windows[1].ndmi.toFixed(3)) : '',
        w2d: r.windows[1]?.detail ?? '',
        y: r.yield?.estimate ?? '',
        yl: r.yield?.low ?? '',
        yh: r.yield?.high ?? '',
        yc: r.yield?.confidence ?? '',
        yb: r.yield?.basis ?? '',
        err: r.error ?? '',
      };
    })
  );

  // Raw data
  const primaries = ctx.results.filter((r) => r.point.sameAs === undefined);
  addTable(
    wb,
    'Raw observations',
    [
      { header: 'Sr. No.', key: 'sr', width: 8 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Sentinel-2 scene', key: 'scene', width: 34 },
      { header: 'MGRS tile', key: 'tile', width: 10 },
      { header: 'Clear pixels %', key: 'clear', width: 10 },
      { header: 'Valid pixels', key: 'px', width: 10 },
      { header: 'NDVI (median)', key: 'ndvi', width: 10 },
      { header: 'EVI', key: 'evi', width: 8 },
      { header: 'SAVI', key: 'savi', width: 8 },
      { header: 'NDMI', key: 'ndmi', width: 8 },
      { header: 'NDWI', key: 'ndwi', width: 8 },
      { header: 'NDRE', key: 'ndre', width: 8 },
      { header: 'GCVI', key: 'gcvi', width: 8 },
    ],
    primaries.flatMap((r) =>
      r.observations.map((o) => ({
        sr: r.point.srNo,
        date: o.date,
        scene: o.sceneId,
        tile: o.tile ?? '',
        clear: o.clearPct,
        px: o.validPixels,
        ndvi: o.ndvi,
        evi: o.evi ?? '',
        savi: o.savi ?? '',
        ndmi: o.ndmi ?? '',
        ndwi: o.ndwi ?? '',
        ndre: o.ndre ?? '',
        gcvi: o.gcvi ?? '',
      }))
    )
  );
  addTable(
    wb,
    'All passes read',
    [
      { header: 'Sr. No.', key: 'sr', width: 8 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Sentinel-2 scene', key: 'scene', width: 34 },
      { header: 'MGRS tile', key: 'tile', width: 10 },
      { header: 'Tile cloud % (metadata)', key: 'cloud', width: 12 },
      { header: 'Clear pixels at point %', key: 'clear', width: 12 },
      { header: 'NDVI median', key: 'ndvi', width: 10 },
      { header: 'Used', key: 'used', width: 8 },
      { header: 'Note', key: 'note', width: 50 },
    ],
    primaries.flatMap((r) =>
      r.passes.map((p) => ({
        sr: r.point.srNo,
        date: p.date,
        scene: p.sceneId,
        tile: p.tile ?? '',
        cloud: p.tileCloudPct,
        clear: p.clearPct ?? '',
        ndvi: p.ndviMedian ?? '',
        used: p.used ? 'yes' : 'no',
        note: p.note ?? '',
      }))
    )
  );

  addTable(
    wb,
    'Vegetation indices',
    [
      { header: 'Index', key: 'index', width: 16 },
      { header: 'Formula', key: 'formula', width: 40 },
      { header: 'Sentinel-2 bands', key: 'bands', width: 18 },
      { header: 'Resolution', key: 'resolution', width: 18 },
      { header: 'Used for', key: 'usedFor', width: 60 },
      { header: 'Limitation', key: 'limitation', width: 50 },
    ],
    VEGETATION_INDEX_DOC
  );

  const m = wb.addWorksheet('Method & limitations');
  m.getColumn(1).width = 28;
  m.getColumn(2).width = 110;
  const kv: [string, string][] = [
    ['Generated', new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC'],
    ['Generated by', ctx.generatedBy ?? 'AgriSurvey AI — Coordinate Crop Survey module'],
    ['Source sheet', `${ctx.sheet.fileName}${ctx.sheet.sheetName ? ` (worksheet "${ctx.sheet.sheetName}")` : ''}`],
    ['Points', `${ctx.results.length} (${ctx.results.filter((r) => r.point.sameAs !== undefined).length} repeat an earlier point within 10 m)`],
    ['Season window', `${ctx.season} ${ctx.year}: ${seasonWindow(ctx.season, ctx.year).start} to ${seasonWindow(ctx.season, ctx.year).end}`],
    ...ctx.windows.map((w, i) => [`Assessment window ${i + 1}`, `${w.label} (${w.start} to ${w.end}, ±${WINDOW_TOLERANCE_DAYS} days if no clear pass inside)`] as [string, string]),
    ['Crops considered', (ctx.crops?.length ? ctx.crops : SEASONS[ctx.season].crops).map(cropName).join(', ')],
    ['Sampled area per point', `Circle of ${ctx.radiusM} m radius (${Math.round((Math.PI * ctx.radiusM ** 2) / 100)} pixels of 10 m)`],
    ['Yield reference source', YIELD_SOURCE],
    ...ctx.sheet.warnings.map((w) => ['Sheet note', w] as [string, string]),
    ...METHOD_NOTES.map((n, i) => [`Method ${i + 1}`, n] as [string, string]),
    ['Photographs', 'The "Satellite images" sheet holds the Sentinel-2 true-colour and NDVI chips for each assessment window. Ground photographs from the field survey must be added separately; satellite chips are not a substitute for them.'],
    ['Attribution', 'Contains modified Copernicus Sentinel data (2026), processed by AgriSurvey AI.'],
  ];
  kv.forEach(([k, v]) => {
    const row = m.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    row.alignment = { vertical: 'top', wrapText: true };
  });

  // Satellite image chips
  const imgWs = wb.addWorksheet('Satellite images');
  imgWs.columns = [
    { header: 'Sr. No.', key: 'sr', width: 8 },
    { header: 'Coordinates', key: 'll', width: 22 },
    { header: 'Window', key: 'win', width: 18 },
    { header: 'Pass date', key: 'date', width: 12 },
    { header: 'True colour', key: 'tc', width: 22 },
    { header: 'NDVI', key: 'nd', width: 22 },
  ];
  styleHeader(imgWs.getRow(1));
  let imgRow = 2;
  for (const r of primaries) {
    for (const im of r.images) {
      const row = imgWs.getRow(imgRow);
      row.values = [r.point.srNo, `${r.point.lat.toFixed(6)}, ${r.point.lon.toFixed(6)}`, im.window, im.date];
      row.height = 120;
      row.alignment = { vertical: 'middle', wrapText: true };
      try {
        const tc = wb.addImage({ base64: dataUrlBase64(im.trueColor), extension: 'png' });
        const nd = wb.addImage({ base64: dataUrlBase64(im.ndvi), extension: 'png' });
        imgWs.addImage(tc, { tl: { col: 4, row: imgRow - 1 }, ext: { width: 150, height: 150 } });
        imgWs.addImage(nd, { tl: { col: 5, row: imgRow - 1 }, ext: { width: 150, height: 150 } });
      } catch {
        row.getCell(5).value = 'image unavailable';
      }
      imgRow++;
    }
  }
  if (imgRow === 2) imgWs.addRow(['', 'No clear window imagery was captured.']);

  const out = await wb.xlsx.writeBuffer();
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function resultsGeoJson(results: PointResult[]): string {
  return JSON.stringify(
    {
      type: 'FeatureCollection',
      features: results.map((r) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [r.point.lon, r.point.lat] },
        properties: {
          sr_no: r.point.srNo,
          same_as: r.point.sameAs ?? null,
          crop: r.crop?.crop ?? null,
          crop_text: r.crop?.cell ?? null,
          crop_confidence: r.crop?.confidence ?? null,
          window1: r.windows[0]?.cell ?? null,
          window1_ndvi: r.windows[0]?.ndvi ?? null,
          window2: r.windows[1]?.cell ?? null,
          window2_ndvi: r.windows[1]?.ndvi ?? null,
          yield_kg_ha: r.yield?.estimate ?? null,
          yield_low: r.yield?.low ?? null,
          yield_high: r.yield?.high ?? null,
          clear_observations: r.observations.length,
          error: r.error ?? null,
        },
      })),
    },
    null,
    2
  );
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
