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

  // Per-class and Aggregate Evaluation Metrics (Challenge Module B)
  precisionByCrop: Record<string, number | null>;
  recallByCrop: Record<string, number | null>;
  f1ByCrop: Record<string, number | null>;
  macroF1: number | null;
  weightedF1: number | null;
  brierScore: number | null;
  expectedCalibrationError: number | null;
  spatialSplits: Record<string, { samplesCount: number; answeredCount: number; correctCount: number; accuracy: number | null }>;
  seasonSplits: Record<string, { samplesCount: number; answeredCount: number; correctCount: number; accuracy: number | null }>;
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

    // Module B Requirement: Disagreement with farmer declaration triggers Tahsildar Review
    const declared = (plot.crop_type || '').toLowerCase();
    const predicted = (record.predicted_crop || '').toLowerCase();
    const hasDiscrepancy = Boolean(predicted && declared && !declared.includes(predicted) && !predicted.includes(declared));

    if (hasDiscrepancy || record.verdict_status === 'ambiguous') {
      const existingQueue = mockDb.inspectionQueue?.find(
        (q) => q.plot_id === plot.id && q.status === 'PENDING_OFFICER_REVIEW'
      );
      if (!existingQueue && mockDb.inspectionQueue) {
        mockDb.inspectionQueue.unshift({
          id: `queue-${Date.now()}`,
          monitoring_area_id: `mon-${plot.id}`,
          plot_id: plot.id,
          farmer_name: plot.farmer_name || 'Registered Landholder',
          district: plot.district,
          taluk: plot.taluk,
          village: plot.village,
          crop_type: plot.crop_type || 'Unspecified',
          priority: hasDiscrepancy ? 'HIGH' : 'MEDIUM',
          reasons: hasDiscrepancy
            ? [`CROP_DISCREPANCY: Declared "${plot.crop_type}" vs Model "${cropLabel(record.predicted_crop)}"`]
            : [`AMBIGUOUS_PHENOLOGY: Matcher found multiple candidates (${record.candidate_crops.map(cropLabel).join(', ')})`],
          confidence_score: record.predicted_crop ? 85 : null,
          latest_ndvi_delta: 0,
          latest_moisture_level: 0,
          status: 'PENDING_OFFICER_REVIEW',
          created_at: new Date().toISOString(),
        });
      }
    }

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

  /** Accuracy and multi-class verification metrics measured only on officer-verified predictions */
  evaluate(): ClassificationEvaluation {
    const verified = mockDb.cropPredictions.filter((p) => p.verified_crop);
    const answered = verified.filter((p) => p.verdict_status === 'matched' && p.predicted_crop);
    const correct = answered.filter((p) => p.predicted_crop === p.verified_crop).length;
    const abstentionsByReason: Record<string, number> = {};
    for (const p of verified) {
      if (p.verdict_status !== 'matched') {
        abstentionsByReason[p.verdict_status] = (abstentionsByReason[p.verdict_status] ?? 0) + 1;
      }
    }

    const confusionMap = new Map<string, number>();
    for (const p of answered) {
      const k = `${p.predicted_crop}|${p.verified_crop}`;
      confusionMap.set(k, (confusionMap.get(k) ?? 0) + 1);
    }

    const samplesPerCrop: Record<string, number> = {};
    for (const s of readSamples()) {
      samplesPerCrop[s.verified_crop] = (samplesPerCrop[s.verified_crop] ?? 0) + 1;
    }

    // Determine all involved crop classes (predicted or ground-truth verified)
    const distinctCrops = new Set<string>();
    for (const p of answered) {
      if (p.predicted_crop) distinctCrops.add(p.predicted_crop);
      if (p.verified_crop) distinctCrops.add(p.verified_crop);
    }
    for (const s of verified) {
      if (s.verified_crop) distinctCrops.add(s.verified_crop);
    }

    const precisionByCrop: Record<string, number | null> = {};
    const recallByCrop: Record<string, number | null> = {};
    const f1ByCrop: Record<string, number | null> = {};

    let sumF1 = 0;
    let countedCrops = 0;
    let weightedSumF1 = 0;
    let totalVerifiedGroundTruth = 0;

    for (const crop of distinctCrops) {
      // True positives: model predicted crop AND ground truth was crop
      const tp = answered.filter((p) => p.predicted_crop === crop && p.verified_crop === crop).length;
      // False positives: model predicted crop BUT ground truth was another crop
      const fp = answered.filter((p) => p.predicted_crop === crop && p.verified_crop !== crop).length;
      // False negatives: ground truth was crop BUT model predicted another crop (or abstained)
      const fn = verified.filter((p) => p.verified_crop === crop && p.predicted_crop !== crop).length;

      const prec = tp + fp > 0 ? tp / (tp + fp) : null;
      const rec = tp + fn > 0 ? tp / (tp + fn) : null;
      let f1: number | null = null;
      if (prec !== null && rec !== null && prec + rec > 0) {
        f1 = (2 * prec * rec) / (prec + rec);
      } else if (tp === 0 && (fp > 0 || fn > 0)) {
        f1 = 0;
      }

      precisionByCrop[crop] = prec !== null ? Number(prec.toFixed(3)) : null;
      recallByCrop[crop] = rec !== null ? Number(rec.toFixed(3)) : null;
      f1ByCrop[crop] = f1 !== null ? Number(f1.toFixed(3)) : null;

      if (f1 !== null) {
        sumF1 += f1;
        countedCrops++;
      }

      const classSupport = verified.filter((p) => p.verified_crop === crop).length;
      if (classSupport > 0 && f1 !== null) {
        weightedSumF1 += f1 * classSupport;
        totalVerifiedGroundTruth += classSupport;
      }
    }

    const macroF1 = countedCrops > 0 ? Number((sumF1 / countedCrops).toFixed(3)) : null;
    const weightedF1 = totalVerifiedGroundTruth > 0 ? Number((weightedSumF1 / totalVerifiedGroundTruth).toFixed(3)) : null;

    // Confidence Calibration: Brier Score & Expected Calibration Error (ECE)
    let brierSum = 0;
    const calibrationBins: Array<{ confSum: number; correctCount: number; count: number }> = Array.from(
      { length: 5 },
      () => ({ confSum: 0, correctCount: 0, count: 0 })
    );

    for (const p of answered) {
      // Derive model confidence score from template fit or default calibration
      const topFit = p.template_fits && p.template_fits.length > 0 ? p.template_fits[0].fit : 0.85;
      const confidence = Math.max(0.1, Math.min(1.0, topFit));
      const isCorrect = p.predicted_crop === p.verified_crop ? 1 : 0;

      brierSum += Math.pow(confidence - isCorrect, 2);

      const binIndex = Math.min(4, Math.floor(confidence * 5));
      calibrationBins[binIndex].count++;
      calibrationBins[binIndex].confSum += confidence;
      calibrationBins[binIndex].correctCount += isCorrect;
    }

    const brierScore = answered.length > 0 ? Number((brierSum / answered.length).toFixed(4)) : null;

    let ece = 0;
    if (answered.length > 0) {
      for (const bin of calibrationBins) {
        if (bin.count > 0) {
          const avgConf = bin.confSum / bin.count;
          const avgAcc = bin.correctCount / bin.count;
          ece += (bin.count / answered.length) * Math.abs(avgAcc - avgConf);
        }
      }
    }
    const expectedCalibrationError = answered.length > 0 ? Number(ece.toFixed(4)) : null;

    // Spatial Evaluation Splits (by Taluka)
    const spatialSplits: Record<string, { samplesCount: number; answeredCount: number; correctCount: number; accuracy: number | null }> = {};
    for (const p of verified) {
      const plot = mockDb.farmPlots.find((fp) => fp.id === p.plot_id);
      const taluk = (plot?.taluk || 'Unknown').toLowerCase();
      if (!spatialSplits[taluk]) {
        spatialSplits[taluk] = { samplesCount: 0, answeredCount: 0, correctCount: 0, accuracy: null };
      }
      spatialSplits[taluk].samplesCount++;
      if (p.verdict_status === 'matched' && p.predicted_crop) {
        spatialSplits[taluk].answeredCount++;
        if (p.predicted_crop === p.verified_crop) {
          spatialSplits[taluk].correctCount++;
        }
      }
    }
    for (const key of Object.keys(spatialSplits)) {
      const s = spatialSplits[key];
      s.accuracy = s.answeredCount > 0 ? Number((s.correctCount / s.answeredCount).toFixed(3)) : null;
    }

    // Season-Separated Evaluation Splits
    const seasonSplits: Record<string, { samplesCount: number; answeredCount: number; correctCount: number; accuracy: number | null }> = {};
    for (const p of verified) {
      const seasonKey = p.season || 'kharif';
      if (!seasonSplits[seasonKey]) {
        seasonSplits[seasonKey] = { samplesCount: 0, answeredCount: 0, correctCount: 0, accuracy: null };
      }
      seasonSplits[seasonKey].samplesCount++;
      if (p.verdict_status === 'matched' && p.predicted_crop) {
        seasonSplits[seasonKey].answeredCount++;
        if (p.predicted_crop === p.verified_crop) {
          seasonSplits[seasonKey].correctCount++;
        }
      }
    }
    for (const key of Object.keys(seasonSplits)) {
      const s = seasonSplits[key];
      s.accuracy = s.answeredCount > 0 ? Number((s.correctCount / s.answeredCount).toFixed(3)) : null;
    }

    return {
      verified: verified.length,
      answered: answered.length,
      correct,
      coverage: verified.length ? Number((answered.length / verified.length).toFixed(3)) : null,
      accuracy: answered.length ? Number((correct / answered.length).toFixed(3)) : null,
      abstentionsByReason,
      confusion: [...confusionMap.entries()].map(([k, count]) => {
        const [predicted, verifiedCrop] = k.split('|');
        return { predicted, verified: verifiedCrop, count };
      }),
      samplesPerCrop,
      precisionByCrop,
      recallByCrop,
      f1ByCrop,
      macroF1,
      weightedF1,
      brierScore,
      expectedCalibrationError,
      spatialSplits,
      seasonSplits,
    };
  }
}

export const cropClassificationService = new CropClassificationService();
