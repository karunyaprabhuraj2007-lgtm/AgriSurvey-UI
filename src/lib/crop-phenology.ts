/**
 * AgriSurvey AI — Crop identification by phenology template matching
 *
 * TypeScript port of the single-point crop matcher from the GREEN-MINDS-ML `cropsurvey`
 * package (src/cropsurvey/point.py, preprocess/timeseries.py, config/cropsurvey.yaml),
 * so the website runs the same method as the Python package, on real Sentinel-2 data.
 *
 * Method: the field's NDVI time series over a season window is gap-filled onto a 5-day
 * grid, Savitzky–Golay smoothed, and compared with a double-logistic growth template per
 * crop (Zhang et al. 2003). Each template may shift ±25 days (sowing date) and is linearly
 * rescaled (a field mixes crop and non-crop pixels). fit = 1 − RMSE / curve amplitude.
 *
 * The matcher refuses to answer when there are too few clear dates, when the season runs
 * past the window edge (e.g. sugarcane in a kharif window), when no template fits, or when
 * the two best crops fit almost equally well (e.g. cotton vs tur).
 *
 * Limitations (from the package's LIMITATIONS.md): the templates are INDICATIVE shapes, not
 * agronomic calibrations, and have not been re-fitted on surveyed Maharashtra parcels. Fit
 * scores are not probabilities and no accuracy has been measured on real fields.
 */

// ---------------------------------------------------------------------------
// Configuration (config/cropsurvey.yaml)
// ---------------------------------------------------------------------------

export type SeasonName = 'kharif' | 'rabi';

export const SEASONS: Record<SeasonName, { start: string; end: string; crops: string[] }> = {
  kharif: { start: '06-10', end: '11-27', crops: ['soybean', 'cotton', 'tur', 'rice', 'maize', 'jowar', 'bajra', 'sugarcane'] },
  rabi: { start: '10-15', end: '04-15', crops: ['wheat', 'gram', 'rabi_jowar', 'onion', 'sugarcane'] },
};

export interface CropProfile {
  sos: number; // days after window start at half green-up
  length: number;
  peak: number;
  kUp: number;
  kDown: number;
}

export const CROP_PROFILES: Record<string, CropProfile> = {
  soybean: { sos: 22, length: 85, peak: 0.82, kUp: 0.14, kDown: 0.16 },
  cotton: { sos: 30, length: 135, peak: 0.72, kUp: 0.08, kDown: 0.07 },
  tur: { sos: 34, length: 132, peak: 0.7, kUp: 0.08, kDown: 0.07 },
  rice: { sos: 45, length: 95, peak: 0.84, kUp: 0.12, kDown: 0.12 },
  maize: { sos: 24, length: 92, peak: 0.8, kUp: 0.12, kDown: 0.12 },
  jowar: { sos: 26, length: 96, peak: 0.7, kUp: 0.11, kDown: 0.1 },
  bajra: { sos: 28, length: 70, peak: 0.62, kUp: 0.14, kDown: 0.14 },
  sugarcane: { sos: -70, length: 330, peak: 0.86, kUp: 0.04, kDown: 0.05 },
  wheat: { sos: 45, length: 95, peak: 0.8, kUp: 0.12, kDown: 0.14 },
  gram: { sos: 30, length: 85, peak: 0.62, kUp: 0.12, kDown: 0.12 },
  rabi_jowar: { sos: 18, length: 100, peak: 0.64, kUp: 0.1, kDown: 0.1 },
  onion: { sos: 60, length: 90, peak: 0.55, kUp: 0.1, kDown: 0.12 },
};

export const CROP_LABELS: Record<string, string> = {
  soybean: 'Soybean',
  cotton: 'Cotton',
  tur: 'Tur (pigeon pea)',
  rice: 'Rice (paddy)',
  maize: 'Maize',
  jowar: 'Jowar (kharif sorghum)',
  bajra: 'Bajra (pearl millet)',
  sugarcane: 'Sugarcane',
  wheat: 'Wheat',
  gram: 'Gram (chickpea)',
  rabi_jowar: 'Rabi jowar',
  onion: 'Onion',
};

export const SOIL_BASE_NDVI = 0.15;

export const MATCHER_SETTINGS = {
  minClearDates: 6,
  ambiguousMargin: 0.04,
  minFit: 0.5,
  shiftSearchDays: 25,
  truncationNdviFraction: 0.6,
  phenologyAmplitudeFraction: 0.5,
  savgolWindow: 7,
  savgolOrder: 2,
  gridStepDays: 5,
  /**
   * A window edge counts as observed only if a clear date falls within this many days of
   * it. Otherwise gap-filling would copy the first/last clear value to the edge (e.g. after
   * monsoon cloud) and the truncation test would be judging an invented value.
   */
  edgeObservedDays: 20,
  /**
   * A curve that never rises above `bareMaxPeakNdvi` and varies by less than
   * `bareMaxAmplitude` has no crop season (fallow, bare soil, built-up). Without this rule a
   * flat curve passes the truncation test (its first value is ~its peak). The weakest
   * template (onion) rises 0.40 to a 0.55 peak, so these limits sit well below any crop.
   */
  bareMaxPeakNdvi: 0.35,
  bareMaxAmplitude: 0.12,
};

export const METHOD_NAME = 'GREEN-MINDS-ML phenology template matcher (indicative templates, not field-calibrated)';

// ---------------------------------------------------------------------------
// Season windows
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 3600 * 1000;
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

/** Window for `season` starting in `year`; rabi (15 Oct → 15 Apr) ends the next year. */
export function seasonWindow(season: SeasonName, year: number): { start: string; end: string; lengthDays: number } {
  const s = SEASONS[season];
  const start = `${year}-${s.start}`;
  let end = `${year}-${s.end}`;
  if (end <= start) end = `${year + 1}-${s.end}`;
  return { start, end, lengthDays: Math.round((utc(end).getTime() - utc(start).getTime()) / DAY_MS) };
}

/** The most recent season window that has at least `minElapsedFraction` of its length behind it. */
export function defaultSeason(today = new Date(), minElapsedFraction = 0.6): { season: SeasonName; year: number } {
  const candidates: { season: SeasonName; year: number; start: number }[] = [];
  for (const y of [today.getUTCFullYear(), today.getUTCFullYear() - 1]) {
    for (const season of ['kharif', 'rabi'] as SeasonName[]) {
      const w = seasonWindow(season, y);
      const elapsed = (today.getTime() - utc(w.start).getTime()) / DAY_MS / w.lengthDays;
      if (elapsed >= minElapsedFraction) candidates.push({ season, year: y, start: utc(w.start).getTime() });
    }
  }
  candidates.sort((a, b) => b.start - a.start);
  return candidates[0] ?? { season: 'kharif', year: today.getUTCFullYear() - 1 };
}

// ---------------------------------------------------------------------------
// Time-series processing (preprocess/timeseries.py)
// ---------------------------------------------------------------------------

export function doubleLogistic(t: number, base: number, peak: number, sos: number, eos: number, kUp: number, kDown: number): number {
  const up = 1 / (1 + Math.exp(-kUp * (t - sos)));
  const down = 1 / (1 + Math.exp(-kDown * (t - eos)));
  return base + (peak - base) * (up - down);
}

/** numpy.interp semantics: linear between samples, held at the nearest value outside. */
export function gapFill(t: number[], y: number[], grid: number[]): number[] | null {
  const pts = t.map((ti, i) => [ti, y[i]] as const).filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
  if (pts.length < 2) return null; // one point is not a curve
  pts.sort((a, b) => a[0] - b[0]);
  return grid.map((g) => {
    if (g <= pts[0][0]) return pts[0][1];
    if (g >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
    let i = 1;
    while (pts[i][0] < g) i++;
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    return x1 === x0 ? y1 : y0 + ((y1 - y0) * (g - x0)) / (x1 - x0);
  });
}

/** Least-squares polynomial of `order` through (x, y), evaluated at `at`. */
function polyFitEval(x: number[], y: number[], order: number, at: number): number {
  const n = order + 1;
  const M = Array.from({ length: n }, () => new Array(n + 1).fill(0));
  for (let k = 0; k < x.length; k++) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) M[r][c] += x[k] ** (r + c);
      M[r][n] += y[k] * x[k] ** r;
    }
  }
  // Gaussian elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col || M[col][col] === 0) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const coef = M.map((row, i) => (row[i] === 0 ? 0 : row[n] / row[i]));
  return coef.reduce((s, c, i) => s + c * at ** i, 0);
}

/** Savitzky–Golay smoothing, scipy.signal.savgol_filter(mode='interp') semantics. */
export function savgol(y: number[], window = 7, order = 2): number[] {
  const n = y.length;
  let w = Math.min(window, n % 2 === 1 ? n : n - 1);
  if (w <= order) return [...y];
  if (w % 2 === 0) w -= 1;
  const half = (w - 1) / 2;
  const idx = (a: number) => Array.from({ length: w }, (_, i) => a + i);
  return y.map((_, i) => {
    if (i < half) {
      const xs = idx(0);
      return polyFitEval(xs, xs.map((k) => y[k]), order, i);
    }
    if (i >= n - half) {
      const xs = idx(n - w);
      return polyFitEval(xs, xs.map((k) => y[k]), order, i);
    }
    const xs = idx(i - half);
    return polyFitEval(xs, xs.map((k) => y[k]), order, i);
  });
}

export interface Phenology {
  sos: number;
  eos: number;
  peakDay: number;
  peakValue: number;
  baseValue: number;
  amplitude: number;
  length: number;
  integral: number;
  truncatedStart: boolean;
  truncatedEnd: boolean;
}

export function phenologyMetrics(grid: number[], y: number[], amplitudeFraction = 0.5, edgeFraction = 0.6, baseReference?: number): Phenology {
  let iPeak = 0;
  for (let i = 1; i < y.length; i++) if (y[i] > y[iPeak]) iPeak = i;
  const peak = y[iPeak];
  const base = Math.min(...y);
  const amp = peak - base;
  const thr = base + amplitudeFraction * amp;
  const above = y.map((v) => v >= thr);
  const cross = (x0: number, x1: number, y0: number, y1: number) => (y1 === y0 ? x0 : x0 + ((thr - y0) * (x1 - x0)) / (y1 - y0));
  let sos = grid[0];
  for (let i = iPeak; i > 0; i--) {
    if (above[i] && !above[i - 1]) {
      sos = cross(grid[i - 1], grid[i], y[i - 1], y[i]);
      break;
    }
  }
  let eos = grid[grid.length - 1];
  for (let i = iPeak; i < y.length - 1; i++) {
    if (above[i] && !above[i + 1]) {
      eos = cross(grid[i], grid[i + 1], y[i], y[i + 1]);
      break;
    }
  }
  let integral = 0;
  for (let i = 1; i < grid.length; i++) {
    if (grid[i - 1] >= sos && grid[i] <= eos) {
      integral += ((Math.max(0, y[i - 1] - base) + Math.max(0, y[i] - base)) / 2) * (grid[i] - grid[i - 1]);
    }
  }
  const ref = baseReference === undefined ? base : Math.min(baseReference, base);
  const edge = ref + edgeFraction * (peak - ref);
  return {
    sos,
    eos,
    peakDay: grid[iPeak],
    peakValue: peak,
    baseValue: base,
    amplitude: amp,
    length: eos - sos,
    integral,
    truncatedStart: peak > ref && y[0] >= edge,
    truncatedEnd: peak > ref && y[y.length - 1] >= edge,
  };
}

// ---------------------------------------------------------------------------
// Matching (point.py: match_crop / decide)
// ---------------------------------------------------------------------------

export interface CropScore {
  crop: string;
  fit: number;
  shiftDays: number;
}

export function matchCrop(grid: number[], curve: number[], crops: string[]): CropScore[] {
  const amp = Math.max(...curve) - Math.min(...curve);
  const out: CropScore[] = [];
  for (const crop of crops) {
    const p = CROP_PROFILES[crop];
    let best = { fit: -Infinity, shift: 0 };
    for (let shift = -MATCHER_SETTINGS.shiftSearchDays; shift <= MATCHER_SETTINGS.shiftSearchDays; shift += 5) {
      const tmpl = grid.map((t) => doubleLogistic(t, SOIL_BASE_NDVI, p.peak, p.sos + shift, p.sos + shift + p.length, p.kUp, p.kDown));
      // Ordinary least squares: curve ≈ a + b·tmpl
      const n = tmpl.length;
      const mx = tmpl.reduce((s, v) => s + v, 0) / n;
      const my = curve.reduce((s, v) => s + v, 0) / n;
      let sxx = 0;
      let sxy = 0;
      for (let i = 0; i < n; i++) {
        sxx += (tmpl[i] - mx) ** 2;
        sxy += (tmpl[i] - mx) * (curve[i] - my);
      }
      if (sxx === 0) continue;
      const b = sxy / sxx;
      if (b <= 0) continue;
      const a = my - b * mx;
      let sse = 0;
      for (let i = 0; i < n; i++) sse += (a + b * tmpl[i] - curve[i]) ** 2;
      const rmse = Math.sqrt(sse / n);
      const fit = amp > 0 ? 1 - rmse / amp : 0;
      if (fit > best.fit) best = { fit, shift };
    }
    out.push({ crop, fit: Number.isFinite(best.fit) ? Math.max(best.fit, 0) : 0, shiftDays: best.shift });
  }
  return out.sort((x, y) => y.fit - x.fit);
}

export type VerdictStatus = 'matched' | 'ambiguous' | 'no_match' | 'truncated_window' | 'insufficient_observations';

export interface Verdict {
  status: VerdictStatus;
  crop: string | null;
  margin?: number;
  /** For an ambiguous result: every crop fitting within the ambiguity margin of the best */
  candidates?: string[];
  message: string;
}

export function decide(
  scores: CropScore[],
  pheno: Phenology,
  nClear: number,
  edgesObserved: { start: boolean; end: boolean } = { start: true, end: true }
): Verdict {
  const S = MATCHER_SETTINGS;
  const label = (c: string) => CROP_LABELS[c] ?? c;
  if (nClear < S.minClearDates) {
    return {
      status: 'insufficient_observations',
      crop: null,
      message: `Only ${nClear} cloud-free dates (need ${S.minClearDates}); no growth curve is reported because it was never observed.`,
    };
  }
  // Departure from point.py: a low, flat curve is no crop season, not a truncated one.
  if (pheno.peakValue < S.bareMaxPeakNdvi && pheno.amplitude < S.bareMaxAmplitude) {
    return {
      status: 'no_match',
      crop: null,
      message: `No crop growth season observed: NDVI stayed low all season (peak ${pheno.peakValue.toFixed(2)}, rise ${pheno.amplitude.toFixed(2)}). Likely fallow, bare or non-crop land.`,
    };
  }
  // Departure from point.py: only judge truncation at an edge that was actually observed.
  if (pheno.truncatedStart && !edgesObserved.start) {
    return {
      status: 'insufficient_observations',
      crop: null,
      message: `The start of the season was not observed (no clear date within ${S.edgeObservedDays} days of the window start, typically monsoon cloud), and the field was already green at the first clear date. The sowing date and season length cannot be measured.`,
    };
  }
  if (pheno.truncatedEnd && !edgesObserved.end) {
    return {
      status: 'insufficient_observations',
      crop: null,
      message: `The end of the window was not observed (no clear date within ${S.edgeObservedDays} days of it) while the field was still green. Re-run when later clear passes are available.`,
    };
  }
  if (pheno.truncatedStart || pheno.truncatedEnd) {
    const edge = pheno.truncatedStart ? 'start' : 'end';
    return {
      status: 'truncated_window',
      crop: null,
      message: `Vegetation is still high at the window ${edge}: the season is longer than the window (or still in progress), so long crops would look short. Re-run after the season or choose the other season window.`,
    };
  }
  const best = scores[0];
  if (!best || best.fit < S.minFit) {
    return { status: 'no_match', crop: null, message: `No crop template fits (best ${best ? label(best.crop) : '—'} fit ${best?.fit.toFixed(2) ?? '—'}).` };
  }
  const margin = scores.length > 1 ? best.fit - scores[1].fit : best.fit;
  if (margin < S.ambiguousMargin) {
    const candidates = scores.filter((sc) => best.fit - sc.fit < S.ambiguousMargin).map((sc) => sc.crop);
    return {
      status: 'ambiguous',
      crop: best.crop,
      margin,
      candidates,
      message: `Ambiguous — the growth curve fits ${candidates.map(label).join(', ')} almost equally well (best ${best.fit.toFixed(2)}). Satellite NDVI alone cannot separate them; confirm in the field.`,
    };
  }
  return {
    status: 'matched',
    crop: best.crop,
    margin,
    message: `${label(best.crop)}: fit ${best.fit.toFixed(2)}, margin ${margin.toFixed(2)} over ${scores[1] ? label(scores[1].crop) : '—'}.`,
  };
}

export interface SeasonClassification {
  season: SeasonName;
  year: number;
  window: { start: string; end: string };
  /** Clear observations used: date (YYYY-MM-DD) and field NDVI */
  observations: { date: string; ndvi: number }[];
  grid: number[];
  curve: number[] | null;
  phenology: Phenology | null;
  scores: CropScore[];
  verdict: Verdict;
}

/** Classify one season from dated field NDVI values (cloud-free observations only). */
export function classifySeason(season: SeasonName, year: number, observations: { date: string; ndvi: number }[]): SeasonClassification {
  const window = seasonWindow(season, year);
  const startMs = utc(window.start).getTime();
  const inWindow = observations
    .filter((o) => o.date >= window.start && o.date <= window.end && Number.isFinite(o.ndvi))
    .sort((a, b) => a.date.localeCompare(b.date));
  const t = inWindow.map((o) => Math.round((utc(o.date).getTime() - startMs) / DAY_MS));
  const grid: number[] = [];
  for (let d = 0; d <= window.lengthDays; d += MATCHER_SETTINGS.gridStepDays) grid.push(d);

  const filled = gapFill(t, inWindow.map((o) => o.ndvi), grid);
  const base: Omit<SeasonClassification, 'curve' | 'phenology' | 'scores' | 'verdict'> = { season, year, window, observations: inWindow, grid };
  if (!filled) {
    return {
      ...base,
      curve: null,
      phenology: null,
      scores: [],
      verdict: { status: 'insufficient_observations', crop: null, message: `Only ${inWindow.length} usable dates; no curve.` },
    };
  }
  const curve = savgol(filled, MATCHER_SETTINGS.savgolWindow, MATCHER_SETTINGS.savgolOrder);
  const phenology = phenologyMetrics(grid, curve, MATCHER_SETTINGS.phenologyAmplitudeFraction, MATCHER_SETTINGS.truncationNdviFraction, SOIL_BASE_NDVI);
  const scores = matchCrop(grid, curve, SEASONS[season].crops);
  const edgesObserved = {
    start: t.length > 0 && t[0] <= MATCHER_SETTINGS.edgeObservedDays,
    end: t.length > 0 && window.lengthDays - t[t.length - 1] <= MATCHER_SETTINGS.edgeObservedDays,
  };
  return { ...base, curve, phenology, scores, verdict: decide(scores, phenology, inWindow.length, edgesObserved) };
}

