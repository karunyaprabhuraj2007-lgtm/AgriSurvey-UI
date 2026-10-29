/**
 * AgriSurvey AI — Field Surveillance (15-day Sentinel-2 growth monitoring)
 *
 * For one field (boundary polygon, or point + radius) this service:
 * 1. Lists every Sentinel-2 L2A pass over the field for the season (Earth Search STAC).
 * 2. Splits the season into fixed 15-day periods and, per period, reads the clearest pass
 *    over the field at 10 m (trying the next-best pass when the field is clouded).
 * 3. Derives growth stages, period-to-period change, alerts and a rule-based seasonal
 *    crop-pattern indicator from the real NDVI / EVI / NDMI / NDWI series.
 * 4. Exports a traceable PDF / CSV report.
 *
 * Nothing here is a trained model. Stage and crop-pattern outputs are rule-based
 * interpretations of measured indices and must be confirmed in the field.
 */

import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { SatelliteScene } from '@/types';
import { stacSatelliteService } from './stac.service';
import { loadAreaClip, SceneClip, SurveyArea, surveyAreaCenter } from '@/lib/sentinel-cog';
import { calculateGeodesicAreaSquareMeters } from '@/lib/geospatial';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SurveillanceField {
  id: string;
  name: string;
  area: SurveyArea;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD, or '' to always run up to today
  intervalDays: number;
  declaredCrop?: string;
  plotId?: string;
  village?: string;
  createdAt: string;
}

export interface MonitoringPeriod {
  index: number;
  start: string;
  end: string;
}

export type PeriodStatus = 'ok' | 'partly_cloudy' | 'cloudy' | 'no_pass' | 'error';

export interface PeriodResult {
  period: MonitoringPeriod;
  status: PeriodStatus;
  scene?: SatelliteScene;
  clip?: SceneClip;
  /** Passes inside the period (all, before any cloud filtering by field) */
  passesInPeriod: number;
  passesTried: number;
  error?: string;
}

export type GrowthStage =
  | 'Bare soil / pre-sowing'
  | 'Sparse / mixed cover'
  | 'Emergence / establishment'
  | 'Vegetative growth'
  | 'Peak canopy (flowering / reproductive)'
  | 'Stable canopy'
  | 'Maturity / senescence'
  | 'Harvested / bare'
  | 'Insufficient data';

export interface PeriodGrowth {
  periodIndex: number;
  ndvi: number | null;
  evi: number | null;
  ndmi: number | null;
  ndwi: number | null;
  deltaNdvi: number | null;
  stage: GrowthStage;
}

export interface SurveillanceAlert {
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  periodIndex?: number;
}

export interface CropPatternIndicator {
  pattern: string;
  typicalCrops: string;
  explanation: string;
  declaredCropAgreement: 'consistent' | 'differs' | 'not_declared' | 'undetermined';
}

export interface GrowthAnalysis {
  perPeriod: PeriodGrowth[];
  latest?: PeriodGrowth & { period: MonitoringPeriod; acquired: string; daysSinceObservation: number };
  peak?: { ndvi: number; acquired: string };
  validObservations: number;
  currentStage: GrowthStage;
  trend: 'rising' | 'falling' | 'stable' | 'unknown';
  alerts: SurveillanceAlert[];
  cropPattern: CropPatternIndicator;
  summary: string;
}

// ---------------------------------------------------------------------------
// Thresholds (configurable; not calibrated for specific crops or regions)
// ---------------------------------------------------------------------------

export const SURVEILLANCE_THRESHOLDS = {
  /** Minimum clear share of the field for a period to count as observed */
  minClearPct: 50,
  /** Below this, a period is reported as partly cloudy (still used, with caution) */
  goodClearPct: 80,
  bareSoilNdvi: 0.25,
  vegetatedNdvi: 0.45,
  denseCanopyNdvi: 0.5,
  /** Minimum NDVI rise from season low to peak to call a seasonal crop cycle */
  minSeasonalAmplitude: 0.2,
  /** NDVI change between consecutive observations treated as meaningful */
  changeNdvi: 0.05,
  /** Unexpected drop that triggers an inspection alert */
  alertDropNdvi: 0.15,
  /** Vegetated canopy with NDMI below this is flagged for possible moisture stress */
  moistureStressNdmi: 0.0,
  staleDays: 20,
};

// ---------------------------------------------------------------------------
// Saved fields (browser storage; survives reloads on this device only)
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'agrisurvey_surveillance_fields';

function readStore(): SurveillanceField[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SurveillanceField[]) : [];
  } catch {
    return [];
  }
}

function writeStore(fields: SurveillanceField[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fields));
  } catch {
    // Storage unavailable (private mode / quota); the session still works in memory
  }
}

export function listSavedFields(): SurveillanceField[] {
  return readStore();
}

export function saveField(field: SurveillanceField): void {
  const all = readStore().filter((f) => f.id !== field.id);
  writeStore([field, ...all]);
}

export function deleteField(id: string): void {
  writeStore(readStore().filter((f) => f.id !== id));
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

export function fieldAreaHectares(area: SurveyArea): number {
  if (area.kind === 'circle') return (Math.PI * (area.radiusKm * 1000) ** 2) / 10000;
  return calculateGeodesicAreaSquareMeters(area.coordinates) / 10000;
}

/** Outline of the survey area as [lat, lon][] (circles become a 48-gon). */
export function fieldOutline(area: SurveyArea): [number, number][] {
  if (area.kind === 'polygon') return area.coordinates;
  const { lat, lon } = area.center;
  const dLat = area.radiusKm / 110.574;
  const dLon = area.radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: 48 }, (_, i) => {
    const a = (i / 48) * 2 * Math.PI;
    return [lat + dLat * Math.sin(a), lon + dLon * Math.cos(a)] as [number, number];
  });
}

export function describeArea(area: SurveyArea): string {
  const c = surveyAreaCenter(area);
  const where = `${c.lat.toFixed(5)}° N, ${c.lon.toFixed(5)}° E`;
  if (area.kind === 'circle') return `${Math.round(area.radiusKm * 1000)} m radius around ${where}`;
  return `${area.coordinates.length}-point field boundary centred at ${where}`;
}

// ---------------------------------------------------------------------------
// Periods & imagery
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 3600 * 1000;
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** 15-day (intervalDays) periods counted back from the end date, so the last period ends today. */
export function buildPeriods(startDate: string, endDate: string, intervalDays: number): MonitoringPeriod[] {
  const start = new Date(`${startDate}T00:00:00Z`).getTime();
  const periods: Omit<MonitoringPeriod, 'index'>[] = [];
  for (let t = new Date(`${endDate}T00:00:00Z`).getTime(); t >= start && periods.length < 60; t -= intervalDays * DAY_MS) {
    periods.unshift({ start: iso(new Date(Math.max(start, t - (intervalDays - 1) * DAY_MS))), end: iso(new Date(t)) });
  }
  // Fold a short leading remainder (under half a period) into the first full period
  if (periods.length > 1) {
    const firstDays = (new Date(`${periods[0].end}T00:00:00Z`).getTime() - start) / DAY_MS + 1;
    if (firstDays < intervalDays / 2) periods.splice(0, 2, { start: periods[0].start, end: periods[1].end });
  }
  return periods.map((p, index) => ({ index, ...p }));
}

export function effectiveEndDate(field: SurveillanceField): string {
  const today = iso(new Date());
  return field.endDate && field.endDate < today ? field.endDate : today;
}

async function analysePeriod(
  field: SurveillanceField,
  period: MonitoringPeriod,
  passes: SatelliteScene[],
  signal?: AbortSignal
): Promise<PeriodResult> {
  const inPeriod = passes.filter((s) => {
    const day = s.acquisition_datetime.slice(0, 10);
    return day >= period.start && day <= period.end;
  });
  if (inPeriod.length === 0) return { period, status: 'no_pass', passesInPeriod: 0, passesTried: 0 };

  // Least-cloudy tiles first; the tile figure is only a hint, so check the field itself.
  const candidates = [...inPeriod].sort((a, b) => a.cloud_cover_percentage - b.cloud_cover_percentage).slice(0, 3);
  let best: { scene: SatelliteScene; clip: SceneClip } | null = null;
  let tried = 0;
  let lastError: string | undefined;

  for (const scene of candidates) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    tried++;
    try {
      const clip = await loadAreaClip(scene, field.area, { marginM: 250, maxOutputDim: 640, signal });
      if (!best || clip.stats.validCoveragePct > best.clip.stats.validCoveragePct) best = { scene, clip };
      if (clip.stats.validCoveragePct >= SURVEILLANCE_THRESHOLDS.goodClearPct) break;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  if (!best) return { period, status: 'error', passesInPeriod: inPeriod.length, passesTried: tried, error: lastError };
  const clear = best.clip.stats.validCoveragePct;
  const status: PeriodStatus =
    clear >= SURVEILLANCE_THRESHOLDS.goodClearPct
      ? 'ok'
      : clear >= SURVEILLANCE_THRESHOLDS.minClearPct
      ? 'partly_cloudy'
      : 'cloudy';
  return { period, status, scene: best.scene, clip: best.clip, passesInPeriod: inPeriod.length, passesTried: tried };
}

export interface RunProgress {
  stage: 'searching' | 'reading' | 'done';
  completedPeriods: number;
  totalPeriods: number;
  passesFound?: number;
}

/**
 * Run the full season analysis. Results are delivered per period through onPeriod as
 * soon as each one finishes, so the UI can fill in progressively.
 */
export async function runSurveillance(
  field: SurveillanceField,
  handlers: {
    onProgress?: (p: RunProgress) => void;
    onPeriod?: (r: PeriodResult) => void;
  } = {},
  signal?: AbortSignal
): Promise<PeriodResult[]> {
  const endDate = effectiveEndDate(field);
  const periods = buildPeriods(field.startDate, endDate, field.intervalDays);
  handlers.onProgress?.({ stage: 'searching', completedPeriods: 0, totalPeriods: periods.length });

  const passes = await stacSatelliteService.searchSeason({
    point: surveyAreaCenter(field.area),
    startDate: field.startDate,
    endDate,
    maxCloudCover: 90,
    signal,
  });

  const results: PeriodResult[] = new Array(periods.length);
  let completed = 0;
  handlers.onProgress?.({ stage: 'reading', completedPeriods: 0, totalPeriods: periods.length, passesFound: passes.length });

  // Newest periods first so the current condition appears early; 3 periods in parallel.
  const queue = [...periods].reverse();
  const worker = async () => {
    while (queue.length) {
      const period = queue.shift()!;
      const result = await analysePeriod(field, period, passes, signal);
      results[period.index] = result;
      completed++;
      handlers.onPeriod?.(result);
      handlers.onProgress?.({ stage: 'reading', completedPeriods: completed, totalPeriods: periods.length, passesFound: passes.length });
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  handlers.onProgress?.({ stage: 'done', completedPeriods: completed, totalPeriods: periods.length, passesFound: passes.length });
  return results;
}

// ---------------------------------------------------------------------------
// Growth interpretation
// ---------------------------------------------------------------------------

const isUsable = (r?: PeriodResult) =>
  !!r?.clip && r.clip.stats.ndviMean !== null && (r.status === 'ok' || r.status === 'partly_cloudy');

const KHARIF_CROPS = ['soybean', 'cotton', 'maize', 'paddy', 'rice', 'tur', 'arhar', 'bajra', 'groundnut', 'moong', 'udid', 'urad'];
const RABI_CROPS = ['wheat', 'gram', 'chana', 'jowar', 'onion', 'mustard', 'safflower', 'sunflower'];
const PERENNIAL_CROPS = ['sugarcane', 'banana', 'grape', 'pomegranate', 'orchard', 'mango', 'turmeric'];

function expectedPattern(crop: string): 'kharif' | 'rabi' | 'perennial' | null {
  const c = crop.toLowerCase();
  if (PERENNIAL_CROPS.some((k) => c.includes(k))) return 'perennial';
  if (KHARIF_CROPS.some((k) => c.includes(k))) return 'kharif';
  if (RABI_CROPS.some((k) => c.includes(k))) return 'rabi';
  return null;
}

function classifyPattern(
  series: { date: string; ndvi: number; ndwi: number | null }[],
  declaredCrop?: string
): CropPatternIndicator {
  const T = SURVEILLANCE_THRESHOLDS;
  const undetermined = (pattern: string, explanation: string): CropPatternIndicator => ({
    pattern,
    typicalCrops: '—',
    explanation,
    declaredCropAgreement: declaredCrop ? 'undetermined' : 'not_declared',
  });

  if (series.length < 4) {
    return undetermined('Insufficient observations', 'At least 4 clear 15-day observations are needed to read a seasonal pattern.');
  }
  const max = Math.max(...series.map((s) => s.ndvi));
  if (max < T.vegetatedNdvi) {
    return {
      ...undetermined(
        'No significant crop growth detected',
        `Highest NDVI in the period was ${max.toFixed(2)}, consistent with fallow, bare, built-up or very sparse cover.`
      ),
      typicalCrops: 'Fallow / bare / non-agricultural',
      // A declared crop with no observed growth is a discrepancy worth a field visit
      declaredCropAgreement: declaredCrop ? 'differs' : 'not_declared',
    };
  }

  const first = new Date(series[0].date).getTime();
  const last = new Date(series[series.length - 1].date).getTime();
  const spanDays = (last - first) / DAY_MS;
  const vegetated = series.filter((s) => s.ndvi >= T.vegetatedNdvi);
  const minNdvi = Math.min(...series.map((s) => s.ndvi));
  const peak = series.reduce((a, b) => (b.ndvi > a.ndvi ? b : a));
  const peakMonth = new Date(peak.date).getUTCMonth() + 1;

  let key: 'kharif' | 'rabi' | 'perennial' | 'summer';
  let pattern: string;
  let typicalCrops: string;
  let explanation: string;

  if (spanDays >= 240 && minNdvi >= 0.35 && vegetated.length / series.length >= 0.75) {
    key = 'perennial';
    pattern = 'Long-duration / perennial crop pattern';
    typicalCrops = 'e.g. sugarcane, banana, orchards';
    explanation = `Canopy stayed green (NDVI ≥ ${minNdvi.toFixed(2)}) across ${Math.round(spanDays)} days without a harvest drop.`;
  } else if (max - minNdvi < T.minSeasonalAmplitude) {
    return {
      ...undetermined(
        'Green but no distinct crop cycle',
        `NDVI stayed between ${minNdvi.toFixed(2)} and ${max.toFixed(2)} without a clear sowing-to-peak rise; this fits trees, grassland, mixed cover or a crop sown before the selected season.`
      ),
      typicalCrops: 'Trees / grassland / mixed cover, or extend the season dates',
    };
  } else if (peakMonth >= 7 && peakMonth <= 10) {
    key = 'kharif';
    pattern = 'Kharif (monsoon) seasonal crop pattern';
    typicalCrops = 'e.g. soybean, cotton, maize, tur, paddy';
    explanation = `NDVI peaked at ${peak.ndvi.toFixed(2)} on ${peak.date}, within the July–October kharif window.`;
  } else if (peakMonth >= 11 || peakMonth <= 3) {
    key = 'rabi';
    pattern = 'Rabi (winter) seasonal crop pattern';
    typicalCrops = 'e.g. wheat, gram, jowar, onion';
    explanation = `NDVI peaked at ${peak.ndvi.toFixed(2)} on ${peak.date}, within the November–March rabi window.`;
  } else {
    key = 'summer';
    pattern = 'Summer / irrigated crop pattern';
    typicalCrops = 'e.g. summer groundnut, fodder, vegetables';
    explanation = `NDVI peaked at ${peak.ndvi.toFixed(2)} on ${peak.date}, in the April–June summer window.`;
  }

  // Standing water before green-up is consistent with transplanted paddy
  const beforePeak = series.filter((s) => s.date < peak.date);
  if (beforePeak.some((s) => (s.ndwi ?? -1) > 0 && s.ndvi < 0.3)) {
    explanation += ' Standing water was detected before green-up, which is consistent with transplanted paddy.';
    if (key === 'kharif') typicalCrops = 'e.g. paddy (standing water seen), soybean, cotton, maize';
  }

  let declaredCropAgreement: CropPatternIndicator['declaredCropAgreement'] = 'not_declared';
  if (declaredCrop) {
    const expected = expectedPattern(declaredCrop);
    declaredCropAgreement = expected === null ? 'undetermined' : expected === key ? 'consistent' : 'differs';
  }
  return { pattern, typicalCrops, explanation, declaredCropAgreement };
}

export function analyseGrowth(results: PeriodResult[], field: SurveillanceField): GrowthAnalysis {
  const T = SURVEILLANCE_THRESHOLDS;
  const perPeriod: PeriodGrowth[] = [];
  const alerts: SurveillanceAlert[] = [];
  let prevValid: PeriodGrowth | null = null;
  let prevStage: GrowthStage | null = null;
  let peakSoFar = -Infinity;
  let peak: GrowthAnalysis['peak'];
  const series: { date: string; ndvi: number; ndwi: number | null }[] = [];

  results.forEach((r, i) => {
    if (!r || !isUsable(r)) {
      perPeriod.push({ periodIndex: i, ndvi: null, evi: null, ndmi: null, ndwi: null, deltaNdvi: null, stage: 'Insufficient data' });
      return;
    }
    const s = r.clip!.stats;
    const ndvi = s.ndviMean!;
    const delta = prevValid?.ndvi != null ? ndvi - prevValid.ndvi : null;
    const hadCrop = peakSoFar >= T.denseCanopyNdvi;

    let stage: GrowthStage;
    if (ndvi < T.bareSoilNdvi) stage = hadCrop ? 'Harvested / bare' : 'Bare soil / pre-sowing';
    else if (delta !== null && delta > T.changeNdvi) stage = ndvi < T.vegetatedNdvi ? 'Emergence / establishment' : 'Vegetative growth';
    else if (delta !== null && delta < -T.changeNdvi && hadCrop) stage = 'Maturity / senescence';
    else if (ndvi >= T.denseCanopyNdvi && ndvi >= 0.9 * Math.max(peakSoFar, ndvi)) stage = 'Peak canopy (flowering / reproductive)';
    else if (ndvi < T.vegetatedNdvi) stage = 'Sparse / mixed cover';
    else stage = 'Stable canopy';

    // An early drop (crop never reached a dense canopy) or a sharp drop while still growing
    if (delta !== null && delta <= -T.alertDropNdvi && prevStage !== 'Maturity / senescence') {
      alerts.push({
        severity: hadCrop ? 'warning' : 'critical',
        title: `Sharp NDVI drop in period ${i + 1}`,
        detail: `NDVI fell by ${Math.abs(delta).toFixed(2)} (from ${prevValid!.ndvi!.toFixed(2)} to ${ndvi.toFixed(2)}) between ${
          prevValid ? results[prevValid.periodIndex].scene!.acquisition_datetime.slice(0, 10) : ''
        } and ${r.scene!.acquisition_datetime.slice(0, 10)}. This can be harvest, crop damage, waterlogging or stress — verify in the field.`,
        periodIndex: i,
      });
    }
    if (s.ndmiMean !== null && s.ndmiMean < T.moistureStressNdmi && ndvi >= T.vegetatedNdvi) {
      alerts.push({
        severity: 'warning',
        title: `Possible moisture stress in period ${i + 1}`,
        detail: `Canopy moisture index (NDMI ${s.ndmiMean.toFixed(2)}) is low for a green canopy (NDVI ${ndvi.toFixed(2)}). Check irrigation / soil moisture.`,
        periodIndex: i,
      });
    }

    const g: PeriodGrowth = { periodIndex: i, ndvi, evi: s.eviMean, ndmi: s.ndmiMean, ndwi: s.ndwiMean, deltaNdvi: delta, stage };
    perPeriod.push(g);
    prevValid = g;
    prevStage = stage;
    if (ndvi > peakSoFar) {
      peakSoFar = ndvi;
      peak = { ndvi, acquired: r.scene!.acquisition_datetime.slice(0, 10) };
    }
    series.push({ date: r.scene!.acquisition_datetime.slice(0, 10), ndvi, ndwi: s.ndwiMean });
  });

  const validObservations = series.length;
  const latestGrowth = [...perPeriod].reverse().find((p) => p.ndvi !== null);
  let latest: GrowthAnalysis['latest'];
  if (latestGrowth) {
    const r = results[latestGrowth.periodIndex];
    const acquired = r.scene!.acquisition_datetime;
    latest = {
      ...latestGrowth,
      period: r.period,
      acquired,
      daysSinceObservation: Math.floor((Date.now() - new Date(acquired).getTime()) / DAY_MS),
    };
    if (latest.daysSinceObservation > T.staleDays) {
      alerts.push({
        severity: 'info',
        title: 'Latest clear observation is old',
        detail: `The newest cloud-free view of this field is ${latest.daysSinceObservation} days old (${acquired.slice(0, 10)}). Current conditions may differ.`,
      });
    }
  }

  const gaps = results.filter((r) => r && !isUsable(r)).length;
  if (gaps > 0) {
    alerts.push({
      severity: 'info',
      title: `${gaps} of ${results.length} periods without a clear view`,
      detail: 'Cloud, shadow or missing passes left these 15-day periods unobserved. No values were substituted for them.',
    });
  }

  const trend: GrowthAnalysis['trend'] =
    latest?.deltaNdvi == null
      ? 'unknown'
      : latest.deltaNdvi > T.changeNdvi
      ? 'rising'
      : latest.deltaNdvi < -T.changeNdvi
      ? 'falling'
      : 'stable';

  const cropPattern = classifyPattern(series, field.declaredCrop);
  if (cropPattern.declaredCropAgreement === 'differs') {
    alerts.push({
      severity: 'warning',
      title: 'Declared crop differs from the observed seasonal pattern',
      detail: `Declared "${field.declaredCrop}", but the NDVI pattern looks like: ${cropPattern.pattern}. Send for field verification.`,
    });
  }

  const currentStage = latest?.stage ?? 'Insufficient data';
  const summary = latest
    ? `As of ${latest.acquired.slice(0, 10)}, the field is at "${currentStage}" with mean NDVI ${latest.ndvi!.toFixed(2)}` +
      (latest.deltaNdvi != null ? ` (${latest.deltaNdvi >= 0 ? '+' : ''}${latest.deltaNdvi.toFixed(2)} vs previous clear observation, trend ${trend})` : '') +
      (peak ? `. Season peak so far: ${peak.ndvi.toFixed(2)} on ${peak.acquired}.` : '.')
    : 'No clear satellite observation of this field is available for the selected season.';

  return { perPeriod, latest, peak, validObservations, currentStage, trend, alerts, cropPattern, summary };
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

const fmt = (v: number | null | undefined, d = 3) => (v === null || v === undefined ? '—' : v.toFixed(d));

const STATUS_LABEL: Record<PeriodStatus, string> = {
  ok: 'Clear',
  partly_cloudy: 'Partly cloudy',
  cloudy: 'Cloudy (not used)',
  no_pass: 'No pass',
  error: 'Read error',
};
export const periodStatusLabel = (s: PeriodStatus) => STATUS_LABEL[s];

export function exportCsv(field: SurveillanceField, results: PeriodResult[], analysis: GrowthAnalysis): string {
  const header = [
    'period', 'period_start', 'period_end', 'status', 'scene_id', 'acquired_utc', 'tile_cloud_pct',
    'field_clear_pct', 'ndvi_mean', 'ndvi_median', 'evi_mean', 'ndmi_mean', 'ndwi_mean', 'delta_ndvi', 'growth_stage',
  ];
  const rows = results.map((r, i) => {
    const s = r.clip?.stats;
    const g = analysis.perPeriod[i];
    return [
      i + 1, r.period.start, r.period.end, STATUS_LABEL[r.status], r.scene?.scene_id ?? '', r.scene?.acquisition_datetime ?? '',
      r.scene?.cloud_cover_percentage ?? '', s ? s.validCoveragePct.toFixed(1) : '',
      isUsable(r) ? fmt(s?.ndviMean) : '', isUsable(r) ? fmt(s?.ndviMedian) : '', isUsable(r) ? fmt(s?.eviMean) : '',
      isUsable(r) ? fmt(s?.ndmiMean) : '', isUsable(r) ? fmt(s?.ndwiMean) : '', fmt(g?.deltaNdvi), g?.stage ?? '',
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',');
  });
  const meta = [
    `# AgriSurvey AI field surveillance export`,
    `# Field: ${field.name} (${describeArea(field.area)})`,
    `# Source: Copernicus Sentinel-2 L2A via Earth Search STAC (AWS Open Data); 10 m bands, SCL cloud/shadow masked`,
    `# Generated: ${new Date().toISOString()}`,
  ];
  return [...meta, header.join(','), ...rows].join('\n');
}

export function generatePdfReport(field: SurveillanceField, results: PeriodResult[], analysis: GrowthAnalysis): jsPDF {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const margin = 40;
  let y = margin;

  doc.setFillColor(6, 78, 59);
  doc.rect(0, 0, pageW, 70, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(16);
  doc.text('AgriSurvey AI — Field Surveillance Report', margin, 32);
  doc.setFontSize(9);
  doc.text(`Generated ${new Date().toLocaleString()} · Sentinel-2 L2A 15-day growth monitoring`, margin, 50);
  doc.setTextColor(15, 23, 42);
  y = 92;

  const end = effectiveEndDate(field);
  autoTable(doc, {
    startY: y,
    theme: 'grid',
    styles: { fontSize: 8.5, cellPadding: 4 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 140 } },
    body: [
      ['Field', field.name],
      ['Location', describeArea(field.area)],
      ['Area (calculated)', `${fieldAreaHectares(field.area).toFixed(2)} ha (geodesic)`],
      ['Declared crop', field.declaredCrop || 'Not declared'],
      ['Reporting period', `${field.startDate} to ${end} in ${field.intervalDays}-day periods`],
      ['Clear observations', `${analysis.validObservations} of ${results.length} periods`],
      ['Data source', 'Copernicus Sentinel-2 L2A (Earth Search STAC, AWS Open Data), 10 m bands, SCL cloud/shadow mask'],
      ['Verification status', 'Unverified remote observation — requires field verification'],
    ],
  });
  y = (doc as any).lastAutoTable.finalY + 18;

  doc.setFontSize(12);
  doc.text('Current growth status', margin, y);
  y += 14;
  doc.setFontSize(9);
  const summaryLines = doc.splitTextToSize(analysis.summary, pageW - margin * 2);
  doc.text(summaryLines, margin, y);
  y += summaryLines.length * 11 + 6;
  const patternLines = doc.splitTextToSize(
    `Seasonal pattern indicator (rule-based, not a validated crop classifier): ${analysis.cropPattern.pattern} — ${analysis.cropPattern.typicalCrops}. ${analysis.cropPattern.explanation}`,
    pageW - margin * 2
  );
  doc.text(patternLines, margin, y);
  y += patternLines.length * 11 + 8;

  // Latest images
  const latestResult = analysis.latest ? results[analysis.latest.periodIndex] : undefined;
  if (latestResult?.clip) {
    const size = 170;
    const clip = latestResult.clip;
    doc.addImage(clip.trueColorUrl, 'PNG', margin, y, size, size);
    doc.addImage(clip.ndviUrl, 'PNG', margin + size + 16, y, size, size);
    // Field boundary on both images
    const outline = fieldOutline(field.area).map(([lat, lon]) => [
      ((lon - clip.bounds.minLon) / (clip.bounds.maxLon - clip.bounds.minLon)) * size,
      ((clip.bounds.maxLat - lat) / (clip.bounds.maxLat - clip.bounds.minLat)) * size,
    ]);
    doc.setDrawColor(250, 204, 21);
    doc.setLineWidth(1.2);
    for (const x0 of [margin, margin + size + 16]) {
      outline.forEach(([px, py], i) => {
        const [qx, qy] = outline[(i + 1) % outline.length];
        doc.line(x0 + px, y + py, x0 + qx, y + qy);
      });
    }
    doc.setFontSize(8);
    doc.text(`True colour, ${latestResult.scene!.acquisition_datetime.slice(0, 10)}`, margin, y + size + 11);
    doc.text(`NDVI, ${latestResult.scene!.acquisition_datetime.slice(0, 10)} (grey = masked)`, margin + size + 16, y + size + 11);
    doc.text('Images include a 250 m margin around the field.', margin + 2 * (size + 16), y + 12, { maxWidth: pageW - margin * 2 - 2 * (size + 16) });
    y += size + 26;
  }

  autoTable(doc, {
    startY: y,
    theme: 'striped',
    headStyles: { fillColor: [6, 78, 59], fontSize: 7.5 },
    styles: { fontSize: 7.5, cellPadding: 3 },
    head: [['#', 'Period', 'Status', 'Acquired', 'Clear %', 'NDVI', 'EVI', 'NDMI', 'NDVI change', 'Stage']],
    body: results.map((r, i) => {
      const s = r.clip?.stats;
      const g = analysis.perPeriod[i];
      const usable = isUsable(r);
      return [
        i + 1,
        `${r.period.start} – ${r.period.end}`,
        STATUS_LABEL[r.status],
        r.scene?.acquisition_datetime.slice(0, 10) ?? '—',
        s ? s.validCoveragePct.toFixed(0) : '—',
        usable ? fmt(s?.ndviMean, 2) : '—',
        usable ? fmt(s?.eviMean, 2) : '—',
        usable ? fmt(s?.ndmiMean, 2) : '—',
        fmt(g?.deltaNdvi, 2),
        g?.stage ?? '—',
      ];
    }),
  });
  y = (doc as any).lastAutoTable.finalY + 16;

  if (analysis.alerts.length) {
    autoTable(doc, {
      startY: y,
      theme: 'grid',
      headStyles: { fillColor: [180, 83, 9], fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 3 },
      head: [['Severity', 'Alert', 'Detail']],
      body: analysis.alerts.map((a) => [a.severity.toUpperCase(), a.title, a.detail]),
    });
    y = (doc as any).lastAutoTable.finalY + 16;
  }

  if (y > doc.internal.pageSize.getHeight() - 120) {
    doc.addPage();
    y = margin;
  }
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  const limits = doc.splitTextToSize(
    'Limitations: Sentinel-2 resolves 10 m per pixel; it shows canopy condition, not individual plants, and cannot identify crop species visually. ' +
      'Growth stages and the seasonal pattern are rule-based interpretations of NDVI/EVI/NDMI with fixed thresholds that are not calibrated for specific crops; ' +
      'they are not trained-model predictions. A low index value does not by itself establish disease, nutrient deficiency or the cause of stress. ' +
      'Periods without a clear view are reported as such and no values are substituted. This report is not an official damage certification or eligibility decision.',
    pageW - margin * 2
  );
  doc.text(limits, margin, y);
  return doc;
}
