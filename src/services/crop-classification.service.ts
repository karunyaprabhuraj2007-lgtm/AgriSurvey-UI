/**
 * AgriSurvey AI — Crop identification service
 *
 * Runs the GREEN-MINDS-ML phenology template matcher (src/lib/crop-phenology.ts) on a
 * plot's real Sentinel-2 NDVI series for one season window:
 *   1. every Sentinel-2 L2A pass over the plot boundary is listed (Earth Search STAC);
 *   2. for each 10-day period the clearest pass is read at 10 m with SCL masking, and the
 *      plot's median NDVI is kept when at least half of the plot is clear;
 *   3. the dated series is matched against the season's crop templates; the matcher
 *      abstains (ambiguous / insufficient / truncated / no match) instead of guessing.
 *
 * Officer verifications are stored as labelled samples. They are the data needed to
 * measure real accuracy and, later, to re-fit the indicative templates.
 */

import { mockDb } from './mock-db';
import { CropPredictionRecord } from '@/types';
import { PeriodResult, RunProgress, runSurveillance } from './field-surveillance.service';
import {
  CROP_LABELS,
  CROP_PROFILES,
  MATCHER_SETTINGS,
  METHOD_NAME,
  SeasonName,
  classifySeason,
  defaultSeason,
  seasonWindow,
} from '@/lib/crop-phenology';

export const MODEL_VERSION = 'cropsurvey-point-matcher (GREEN-MINDS-ML templates, TS port 1.0)';
const DATA_SOURCE = 'Copernicus Sentinel-2 L2A via Earth Search STAC (AWS Open Data), 10 m, SCL-masked';
const PERIOD_DAYS = 10;
const MIN_PLOT_CLEAR_PCT = 50;

/** Crops an officer can record, plus non-crop outcomes. */
export const VERIFIABLE_CROPS = [...Object.keys(CROP_PROFILES), 'other_crop', 'fallow', 'non_crop'];
export const cropLabel = (key: string | null | undefined) =>
  !key
    ? '—'
    : CROP_LABELS[key] ?? { other_crop: 'Other crop', fallow: 'Fallow / bare', non_crop: 'Non-crop' }[key] ?? key;

export interface TrainingSample {
  id: string;
  plot_id: string;
  prediction_id: string;
  season: SeasonName;
  season_year: number;
  verified_crop: string;
  observations: { date: string; ndvi: number }[];
  verified_by: string;
  verified_at: string;
}

const SAMPLES_KEY = 'agrisurvey_crop_training_samples';
/** Used when localStorage is unavailable (private mode, Node) so samples are not lost in-session. */
let memorySamples: TrainingSample[] | null = null;

function readSamples(): TrainingSample[] {
  if (memorySamples) return memorySamples;
  try {
    return JSON.parse(localStorage.getItem(SAMPLES_KEY) || '[]') as TrainingSample[];
  } catch {
    return [];
  }
}

function writeSamples(samples: TrainingSample[]) {
  try {
    localStorage.setItem(SAMPLES_KEY, JSON.stringify(samples));
    memorySamples = null;
  } catch {
    memorySamples = samples;
  }
}

export interface ClassificationEvaluation {
  verified: number;
  /** Verified predictions where the matcher committed to a crop */
  answered: number;
  correct: number;
  /** Share of verified predictions the matcher answered */
  coverage: number | null;
  /** Share of answered predictions that were correct */
  accuracy: number | null;
  abstentionsByReason: Record<string, number>;
  confusion: { predicted: string; verified: string; count: number }[];
  samplesPerCrop: Record<string, number>;
}

export class CropClassificationService {
  /**
   * Classify a plot's crop for one season from real Sentinel-2 observations.
   * Defaults to the most recent season window that is at least 60% complete.
   */
  async classifyPlotCrop(
    plotId: string,
    options: { season?: SeasonName; year?: number; onProgress?: (p: RunProgress) => void; signal?: AbortSignal } = {}
  ): Promise<CropPredictionRecord> {
    const plot = mockDb.farmPlots.find((p) => p.id === plotId);
    if (!plot) throw new Error(`Farm plot not found: ${plotId}`);
    if (!plot.boundary_coordinates || plot.boundary_coordinates.length < 3) {
      throw new Error('This plot has no boundary; a boundary is needed to read its satellite pixels.');
    }

    const def = defaultSeason();
    const season = options.season ?? def.season;
    const year = options.year ?? def.year;
    const window = seasonWindow(season, year);
    const today = new Date().toISOString().slice(0, 10);
    if (window.start > today) throw new Error(`The ${season} ${year} season has not started yet.`);

    const results: PeriodResult[] = await runSurveillance(
      {
        id: `cls-${plot.id}`,
        name: plot.plot_name,
        area: { kind: 'polygon', coordinates: plot.boundary_coordinates },
        startDate: window.start,
        endDate: window.end < today ? window.end : today,
        intervalDays: PERIOD_DAYS,
        createdAt: new Date().toISOString(),
      },
      { onProgress: options.onProgress },
      options.signal
    );

    const observations = results
      .filter((r) => r?.clip && r.scene && r.clip.stats.ndviMedian !== null && r.clip.stats.validCoveragePct >= MIN_PLOT_CLEAR_PCT)
      .map((r) => ({
        date: r.scene!.acquisition_datetime.slice(0, 10),
        ndvi: Number(r.clip!.stats.ndviMedian!.toFixed(4)),
        scene_id: r.scene!.scene_id,
        clear_pct: Number(r.clip!.stats.validCoveragePct.toFixed(1)),
      }));

    return this.classifyFromObservations(plot.id, season, year, observations);
  }

  /**
   * Run the matcher on an already-measured series of clear plot NDVI values and save the
   * result. `classifyPlotCrop` feeds it real Sentinel-2 observations; it is separate so the
   * decision step can be tested without the network.
   */
  async classifyFromObservations(
    plotId: string,
    season: SeasonName,
    year: number,
    observations: CropPredictionRecord['observations'],
    dataSource = DATA_SOURCE
  ): Promise<CropPredictionRecord> {
    const plot = mockDb.farmPlots.find((p) => p.id === plotId);
    if (!plot) throw new Error(`Farm plot not found: ${plotId}`);
    const c = classifySeason(season, year, observations);
    const v = c.verdict;
    const used = new Set(c.observations.map((o) => o.date));
    const record: CropPredictionRecord = {
      id: `pred-${Date.now()}`,
      plot_id: plot.id,
      season,
      season_year: year,
      window_start: c.window.start,
      window_end: c.window.end,
      verdict_status: v.status,
      predicted_crop: v.status === 'matched' ? v.crop : null,
      candidate_crops: v.status === 'matched' && v.crop ? [v.crop] : v.candidates ?? [],
      verdict_message: v.message,
      template_fits: c.scores.map((sc) => ({ crop: sc.crop, fit: Number(sc.fit.toFixed(4)), shift_days: sc.shiftDays })),
      observations: observations.filter((o) => used.has(o.date)).sort((a, b) => a.date.localeCompare(b.date)),
      smoothed_curve: c.curve ? c.curve.map((x) => Number(x.toFixed(4))) : null,
      grid_step_days: MATCHER_SETTINGS.gridStepDays,
      phenology: c.phenology
        ? {
            sos_day: Number(c.phenology.sos.toFixed(1)),
            eos_day: Number(c.phenology.eos.toFixed(1)),
            peak_day: c.phenology.peakDay,
            peak_ndvi: Number(c.phenology.peakValue.toFixed(3)),
            amplitude: Number(c.phenology.amplitude.toFixed(3)),
            season_length_days: Number(c.phenology.length.toFixed(1)),
          }
        : null,
      method: METHOD_NAME,
      model_version: MODEL_VERSION,
      data_source: dataSource,
      verification_status: 'AI_PREDICTION',
      created_at: new Date().toISOString(),
    };

    mockDb.cropPredictions.unshift(record);
    mockDb.addAuditLog('CROP_CLASSIFICATION_PERFORMED', 'crop_predictions', record.id, null, {
      plot_reference: plot.plot_reference,
      season: `${season} ${year}`,
      verdict: record.verdict_status,
      predicted_crop: record.predicted_crop,
      clear_observations: record.observations.length,
      model_version: record.model_version,
    });
    mockDb.persistAll();
    return record;
  }

  /**
   * Officer verification. `verifiedCrop` is what was actually found on the ground; it is
   * required, and it is stored with the plot's NDVI series as a labelled sample.
   */
  async verifyCropPrediction(params: {
    predictionId: string;
    verifiedCrop: string;
    reviewerNotes: string;
  }): Promise<CropPredictionRecord> {
    const prediction = mockDb.cropPredictions.find((p) => p.id === params.predictionId);
    if (!prediction) throw new Error('Prediction record not found');
    if (!params.verifiedCrop) throw new Error('Record the crop actually found on the ground.');
    if (!params.reviewerNotes.trim()) throw new Error('Record how the crop was verified (field visit, photographs, etc.).');

    const reviewer = mockDb.currentUser;
    if (reviewer.role !== 'tahsildar' && reviewer.role !== 'admin') {
      throw new Error('Only a Tahsildar or administrator can record ground verification.');
    }
    const prevState = { verification_status: prediction.verification_status, verified_crop: prediction.verified_crop };
    prediction.verified_crop = params.verifiedCrop;
    prediction.verification_status =
      prediction.predicted_crop && prediction.predicted_crop === params.verifiedCrop ? 'CONFIRMED' : 'DISCREPANCY_MARKED';
    prediction.reviewer_id = reviewer.id;
    prediction.reviewer_name = reviewer.full_name;
    prediction.reviewer_notes = params.reviewerNotes.trim();
    prediction.reviewed_at = new Date().toISOString();

    const plot = mockDb.farmPlots.find((p) => p.id === prediction.plot_id);
    if (plot && CROP_PROFILES[params.verifiedCrop]) {
      plot.crop_type = cropLabel(params.verifiedCrop);
      plot.updated_at = new Date().toISOString();
    }

    // Labelled sample for evaluation and future template calibration
    if (prediction.observations.length > 0) {
      const samples = readSamples().filter((s) => s.prediction_id !== prediction.id);
      samples.push({
        id: `ts-${Date.now()}`,
        plot_id: prediction.plot_id,
        prediction_id: prediction.id,
        season: prediction.season,
        season_year: prediction.season_year,
        verified_crop: params.verifiedCrop,
        observations: prediction.observations.map(({ date, ndvi }) => ({ date, ndvi })),
        verified_by: reviewer.id,
        verified_at: prediction.reviewed_at,
      });
      writeSamples(samples);
    }

    mockDb.addAuditLog(`CROP_VERIFICATION_${prediction.verification_status}`, 'crop_predictions', prediction.id, prevState, {
      verified_crop: prediction.verified_crop,
      predicted_crop: prediction.predicted_crop,
      verdict: prediction.verdict_status,
      reviewer_name: prediction.reviewer_name,
      notes: prediction.reviewer_notes,
    });
    mockDb.persistAll();
    return prediction;
  }

  async getPlotPredictions(plotId: string): Promise<CropPredictionRecord[]> {
    return mockDb.cropPredictions.filter((p) => p.plot_id === plotId);
  }

  getTrainingSamples(): TrainingSample[] {
    return readSamples();
  }

  /** Accuracy measured only on officer-verified predictions; nothing is assumed. */
  evaluate(): ClassificationEvaluation {
    const verified = mockDb.cropPredictions.filter((p) => p.verified_crop);
    const answered = verified.filter((p) => p.verdict_status === 'matched' && p.predicted_crop);
    const correct = answered.filter((p) => p.predicted_crop === p.verified_crop).length;
    const abstentionsByReason: Record<string, number> = {};
    for (const p of verified) if (p.verdict_status !== 'matched') abstentionsByReason[p.verdict_status] = (abstentionsByReason[p.verdict_status] ?? 0) + 1;
    const confusionMap = new Map<string, number>();
    for (const p of answered) {
      const k = `${p.predicted_crop}|${p.verified_crop}`;
      confusionMap.set(k, (confusionMap.get(k) ?? 0) + 1);
    }
    const samplesPerCrop: Record<string, number> = {};
    for (const s of readSamples()) samplesPerCrop[s.verified_crop] = (samplesPerCrop[s.verified_crop] ?? 0) + 1;
    return {
      verified: verified.length,
      answered: answered.length,
      correct,
      coverage: verified.length ? answered.length / verified.length : null,
      accuracy: answered.length ? correct / answered.length : null,
      abstentionsByReason,
      confusion: [...confusionMap.entries()].map(([k, count]) => {
        const [predicted, verifiedCrop] = k.split('|');
        return { predicted, verified: verifiedCrop, count };
      }),
      samplesPerCrop,
    };
  }
}

export const cropClassificationService = new CropClassificationService();
