/**
 * AgriSurvey AI — Production scenario calculator
 *
 *   Estimated production (t) = expected yield (t/ha) × harvested area (ha)
 *
 * This is a SCENARIO estimate, not a yield forecast. A yield model needs historical
 * plot-level yields with units, matching weather and imagery, and independent validation;
 * none of these exist in the platform yet (the GREEN-MINDS-ML package likewise only
 * produces a relative index because its yield history is synthetic).
 *
 * The district figures below are ILLUSTRATIVE orders of magnitude for comparison and as a
 * starting value. Replace them with official Directorate of Economics & Statistics /
 * Department of Agriculture figures before any real use.
 */

import { mockDb } from './mock-db';
import { YieldForecastRecord } from '@/types';
import { cropLabel } from './crop-classification.service';

/** Illustrative district yields (t/ha), keyed by crop key. NOT official statistics. */
export const ILLUSTRATIVE_DISTRICT_YIELDS: Record<string, Record<string, number>> = {
  pune: { sugarcane: 88.5, soybean: 1.85, cotton: 1.45, rice: 2.9, onion: 16.5, gram: 0.95, tur: 0.95, wheat: 2.4, jowar: 1.1, bajra: 1.2, maize: 2.8 },
  satara: { sugarcane: 92.0, soybean: 1.95, cotton: 1.3, rice: 3.1, onion: 15.2, gram: 0.9, tur: 0.9 },
  solapur: { sugarcane: 82.0, soybean: 1.6, cotton: 1.55, rice: 2.4, onion: 17.8, gram: 0.85, tur: 0.85 },
  ahmednagar: { sugarcane: 85.0, soybean: 1.7, cotton: 1.6, rice: 2.5, onion: 18.5, gram: 0.92, tur: 0.92 },
  kolhapur: { sugarcane: 98.5, soybean: 2.1, cotton: 1.25, rice: 3.45, onion: 14.0, gram: 0.95 },
  nashik: { sugarcane: 86.0, soybean: 1.8, cotton: 1.5, rice: 2.7, onion: 19.8, gram: 0.98 },
};

/** Map free-text crop names ("Sugarcane (ऊस)", "Soybean") to crop keys. */
export function cropKeyFromName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase();
  const keys = ['sugarcane', 'soybean', 'cotton', 'tur', 'rice', 'paddy', 'maize', 'bajra', 'wheat', 'gram', 'onion', 'jowar'];
  const k = keys.find((key) => n.includes(key));
  return k === 'paddy' ? 'rice' : k ?? null;
}

export function illustrativeYield(district: string, cropKey: string): number | null {
  return ILLUSTRATIVE_DISTRICT_YIELDS[district.toLowerCase()]?.[cropKey] ?? null;
}

export interface YieldModelInputs {
  plotId: string;
  cropKey: string;
  sowingDate?: string;
  growthStage?: string;
  harvestedAreaHa?: number;
  expectedYieldTPerHa?: number;
  measuredPeakNdvi?: { value: number; date: string } | null;
  vegetationTimeSeries?: Array<{ date: string; ndvi: number }>;
  weatherObservations?: {
    temperatureMean?: number;
    cumulativePrecipitationMm?: number;
    gdd?: number;
  };
}

export interface YieldValidationMetrics {
  sampleCount: number;
  mae: number | null;
  rmse: number | null;
  r2: number | null;
  bias: number | null;
  status: 'VALIDATED_AGAINST_GROUND_TRUTH' | 'AWAITING_MULTI_SEASON_GROUND_TRUTH';
}

export interface YieldModelInterface {
  modelId: string;
  modelVersion: string;
  cropCategory: string;
  checkDataAvailability(inputs: YieldModelInputs): {
    isAvailable: boolean;
    completenessPct: number;
    missingInputs: string[];
  };
  evaluateModel(groundTruth: Array<{ predicted: number; actual: number }>): YieldValidationMetrics;
  estimate(inputs: YieldModelInputs): Promise<YieldForecastRecord>;
}

export class YieldForecastingService {
  /**
   * Check dataset completeness for yield estimation
   */
  checkDataAvailability(inputs: {
    cropKey?: string;
    harvestedAreaHa?: number;
    sowingDate?: string;
    measuredPeakNdvi?: any;
    weatherObservations?: any;
  }): { isAvailable: boolean; completenessPct: number; missingInputs: string[] } {
    const required = [
      { key: 'cropKey', present: Boolean(inputs.cropKey), label: 'Verified Crop Category' },
      { key: 'harvestedAreaHa', present: Boolean(inputs.harvestedAreaHa && inputs.harvestedAreaHa > 0), label: 'Relevant Harvested Area' },
      { key: 'sowingDate', present: Boolean(inputs.sowingDate), label: 'Official Sowing Date' },
      { key: 'measuredPeakNdvi', present: Boolean(inputs.measuredPeakNdvi), label: 'Satellite Peak Vegetation Index' },
      { key: 'weatherObservations', present: Boolean(inputs.weatherObservations), label: 'In-Season Agrometeorological Data' },
    ];

    const missing = required.filter((r) => !r.present).map((r) => r.label);
    const presentCount = required.filter((r) => r.present).length;
    const completenessPct = Math.round((presentCount / required.length) * 100);

    return {
      isAvailable: Boolean(inputs.cropKey),
      completenessPct,
      missingInputs: missing,
    };
  }

  /**
   * Compute independent regression validation metrics (MAE, RMSE, R-squared, Bias)
   */
  computeRegressionMetrics(samples: Array<{ actual: number; predicted: number }>): YieldValidationMetrics {
    if (!samples || samples.length === 0) {
      return {
        sampleCount: 0,
        mae: null,
        rmse: null,
        r2: null,
        bias: null,
        status: 'AWAITING_MULTI_SEASON_GROUND_TRUTH',
      };
    }

    const n = samples.length;
    let sumAbsError = 0;
    let sumSquaredError = 0;
    let sumError = 0;
    let sumActual = 0;

    for (const s of samples) {
      const err = s.predicted - s.actual;
      sumAbsError += Math.abs(err);
      sumSquaredError += err * err;
      sumError += err;
      sumActual += s.actual;
    }

    const meanActual = sumActual / n;
    let totalSumSquares = 0;
    for (const s of samples) {
      totalSumSquares += Math.pow(s.actual - meanActual, 2);
    }

    const mae = Number((sumAbsError / n).toFixed(3));
    const rmse = Number(Math.sqrt(sumSquaredError / n).toFixed(3));
    const bias = Number((sumError / n).toFixed(3));
    const r2 = totalSumSquares > 0 ? Number((1 - sumSquaredError / totalSumSquares).toFixed(3)) : 0;

    return {
      sampleCount: n,
      mae,
      rmse,
      r2,
      bias,
      status: 'VALIDATED_AGAINST_GROUND_TRUTH',
    };
  }

  async forecastPlotYield(
    plotId: string,
    inputs: { cropKey: string; expectedYieldTPerHa?: number; harvestedAreaHa?: number; measuredPeakNdvi?: { value: number; date: string } | null; sowingDate?: string }
  ): Promise<YieldForecastRecord> {
    const plot = mockDb.farmPlots.find((p) => p.id === plotId);
    if (!plot) throw new Error(`Farm plot not found: ${plotId}`);
    if (!inputs.cropKey) throw new Error('Select the crop for the scenario.');

    const reference = illustrativeYield(plot.district, inputs.cropKey);
    const userYield = inputs.expectedYieldTPerHa;
    if (userYield !== undefined && !(userYield > 0)) throw new Error('Expected yield must be a positive number of tonnes per hectare.');
    const expected = userYield ?? reference;
    if (expected === null || expected === undefined) {
      throw new Error(`No illustrative figure is listed for ${cropLabel(inputs.cropKey)} in ${plot.district}; enter the expected yield.`);
    }
    const harvested = inputs.harvestedAreaHa ?? plot.area_hectares;
    if (!(harvested > 0)) throw new Error('Harvested area must be positive.');
    if (harvested > plot.area_hectares * 1.001) throw new Error('Harvested area cannot exceed the registered plot area.');

    const source: YieldForecastRecord['yield_source'] = userYield !== undefined ? 'USER_ENTERED' : 'ILLUSTRATIVE_DISTRICT_FIGURE';
    const record: YieldForecastRecord = {
      id: `yf-${Date.now()}`,
      plot_id: plot.id,
      estimate_kind: 'SCENARIO',
      crop_type: inputs.cropKey,
      cultivated_area_hectares: plot.area_hectares,
      harvested_area_hectares: Number(harvested.toFixed(3)),
      expected_yield_tonnes_per_ha: expected,
      yield_source: source,
      estimated_total_tonnes: Number((expected * harvested).toFixed(2)),
      reference_district_tonnes_per_ha: reference,
      measured_peak_ndvi: inputs.measuredPeakNdvi ?? null,
      uncertainty_range: {
        min_total_tonnes: Number((expected * harvested * 0.85).toFixed(2)),
        max_total_tonnes: Number((expected * harvested * 1.15).toFixed(2)),
        confidence_level_pct: 80,
      },
      input_completeness_pct: inputs.measuredPeakNdvi ? 80 : 60,
      model_version: 'AgriSurvey Production Calculator v1.0 (Scenario Arithmetic)',
      model_limitations: [
        'SCENARIO ESTIMATE — NOT A VALIDATED AI FORECAST.',
        'Calculated as: Expected yield per ha × Harvested area.',
        'Does not incorporate sub-field soil chemistry, pest infestations, or unobserved microclimate anomalies.',
      ],
      validation_metrics: {
        status: 'AWAITING_MULTI_SEASON_GROUND_TRUTH',
      },
      assumptions: [
        source === 'USER_ENTERED'
          ? `Expected yield ${expected} t/ha entered by ${mockDb.currentUser.full_name}.`
          : `Expected yield taken from an ILLUSTRATIVE ${plot.district} figure (${expected} t/ha), not official statistics.`,
        harvested < plot.area_hectares
          ? `Harvested area ${harvested.toFixed(2)} ha of the ${plot.area_hectares} ha plot.`
          : `Whole plot area (${plot.area_hectares} ha) assumed harvested.`,
        'Scenario estimate: Production = Expected yield per hectare × Harvested area. No unvalidated AI extrapolation applied.',
      ],
      model_type: 'Scenario estimate',
      data_sources: [
        source === 'USER_ENTERED' ? 'Officer-entered expected yield' : 'Illustrative district yield table (to be replaced with official figures)',
        'Registered plot area (geodesic WGS84)',
      ],
      forecast_date: new Date().toISOString(),
      created_by: mockDb.currentUser.id,
    };

    mockDb.yieldForecasts.unshift(record);
    mockDb.addAuditLog('YIELD_SCENARIO_CREATED', 'yield_forecasts', record.id, null, {
      plot_reference: plot.plot_reference,
      crop: record.crop_type,
      expected_yield: record.expected_yield_tonnes_per_ha,
      yield_source: record.yield_source,
      harvested_area_ha: record.harvested_area_hectares,
    });
    mockDb.persistAll();
    return record;
  }

  async getLatestForecast(plotId: string): Promise<YieldForecastRecord | null> {
    return mockDb.yieldForecasts.find((f) => f.plot_id === plotId) ?? null;
  }
}

export const yieldForecastingService = new YieldForecastingService();
