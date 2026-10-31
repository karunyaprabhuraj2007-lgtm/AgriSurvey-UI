/**
 * AgriSurvey AI — Preliminary disaster screening (Sentinel-2 NDVI change detection)
 *
 * For a plot and an event date:
 *  1. the clearest Sentinel-2 pass over the plot in the `windowDays` before the event and
 *     the clearest pass in the `windowDays` after it are selected (pixel-level SCL check);
 *  2. both are read at 10 m on the same grid over the plot boundary;
 *  3. pixels clear on both dates are compared; a pixel counts as changed when its NDVI fell
 *     by at least `changeThreshold`.
 *
 * Output is a SCREENING result: it locates possible damage for field verification. It is not
 * damage certification and does not establish the cause (harvest also lowers NDVI).
 */

import { mockDb } from './mock-db';
import { DisasterAssessmentRecord, SatelliteScene } from '@/types';
import { stacSatelliteService } from './stac.service';
import { SceneClip, SurveyArea, loadAreaClip, surveyAreaCenter } from '@/lib/sentinel-cog';
import { calculateGeodesicAreaSquareMeters } from '@/lib/geospatial';

export interface AssessDisasterParams {
  plotId: string;
  eventName: string;
  eventType: DisasterAssessmentRecord['event_type'];
  /** Event date (YYYY-MM-DD) */
  eventDate: string;
  /** Days searched before / after the event for a clear pass (default 30) */
  windowDays?: number;
  /** NDVI decrease counted as change (default 0.15) */
  changeThreshold?: number;
  onStatus?: (message: string) => void;
  signal?: AbortSignal;
}

const DAY_MS = 24 * 3600 * 1000;
const MIN_CLEAR_PCT = 70;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const DISASTER_METHOD = 'Sentinel-2 L2A pre/post NDVI change detection on the plot boundary (10 m, SCL-masked)';

async function clearestPass(
  area: SurveyArea,
  from: string,
  to: string,
  prefer: 'latest' | 'earliest',
  signal?: AbortSignal
): Promise<{ scene: SatelliteScene; clip: SceneClip } | null> {
  const c = surveyAreaCenter(area);
  const res = await stacSatelliteService.searchScenes({ latitude: c.lat, longitude: c.lon, radiusKm: 0.2, startDate: from, endDate: to, maxCloudCover: 80, limit: 12 });
  const scenes = [...res.scenes].sort((a, b) =>
    prefer === 'latest' ? b.acquisition_datetime.localeCompare(a.acquisition_datetime) : a.acquisition_datetime.localeCompare(b.acquisition_datetime)
  );
  let best: { scene: SatelliteScene; clip: SceneClip } | null = null;
  for (const scene of scenes.slice(0, 8)) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const clip = await loadAreaClip(scene, area, { marginM: 150, maxOutputDim: 400, includePixels: true, signal }).catch(() => null);
    if (!clip) continue;
    if (!best || clip.stats.validCoveragePct > best.clip.stats.validCoveragePct) best = { scene, clip };
    if (clip.stats.validCoveragePct >= MIN_CLEAR_PCT) break; // nearest-to-event clear pass
  }
  return best;
}

export interface NdviChangeSummary {
  plotPixels: number;
  compared: number;
  changed: number;
  comparedPct: number;
  affectedPct: number;
  preMean: number;
  postMean: number;
  medianDelta: number;
}

type PixelSet = { ndvi: Float32Array | number[]; valid: Uint8Array | number[]; inArea: Uint8Array | number[] };

/** Pixel-by-pixel NDVI change inside the plot, using only pixels clear on both dates. */
export function summariseNdviChange(pre: PixelSet, post: PixelSet, threshold: number): NdviChangeSummary | null {
  let plotPixels = 0;
  let compared = 0;
  let changed = 0;
  let preSum = 0;
  let postSum = 0;
  const deltas: number[] = [];
  for (let i = 0; i < pre.inArea.length; i++) {
    if (!pre.inArea[i]) continue;
    plotPixels++;
    if (!pre.valid[i] || !post.valid[i] || !Number.isFinite(pre.ndvi[i]) || !Number.isFinite(post.ndvi[i])) continue;
    compared++;
    preSum += pre.ndvi[i];
    postSum += post.ndvi[i];
    const d = post.ndvi[i] - pre.ndvi[i];
    deltas.push(d);
    if (d <= -threshold) changed++;
  }
  if (compared === 0) return null;
  deltas.sort((x, y) => x - y);
  return {
    plotPixels,
    compared,
    changed,
    comparedPct: (compared / plotPixels) * 100,
    affectedPct: (changed / compared) * 100,
    preMean: preSum / compared,
    postMean: postSum / compared,
    medianDelta: deltas[Math.floor(deltas.length / 2)],
  };
}

export class DisasterAssessmentService {
  async assessPlotDisaster(params: AssessDisasterParams): Promise<DisasterAssessmentRecord> {
    const plot = mockDb.farmPlots.find((p) => p.id === params.plotId);
    if (!plot) throw new Error(`Farm plot not found: ${params.plotId}`);
    if (!plot.boundary_coordinates || plot.boundary_coordinates.length < 3) throw new Error('This plot has no boundary to screen.');
    const windowDays = params.windowDays ?? 30;
    const threshold = params.changeThreshold ?? 0.15;
    const eventMs = new Date(`${params.eventDate}T00:00:00Z`).getTime();
    if (!Number.isFinite(eventMs)) throw new Error('Enter a valid event date.');
    const todayMs = Date.now();
    if (eventMs > todayMs) throw new Error('The event date is in the future.');

    const area: SurveyArea = { kind: 'polygon', coordinates: plot.boundary_coordinates };
    params.onStatus?.('Finding the clearest pass before the event…');
    const pre = await clearestPass(area, iso(eventMs - windowDays * DAY_MS), iso(eventMs - DAY_MS), 'latest', params.signal);
    params.onStatus?.('Finding the clearest pass after the event…');
    const post = await clearestPass(area, params.eventDate, iso(Math.min(todayMs, eventMs + windowDays * DAY_MS)), 'earliest', params.signal);
    if (!pre) throw new Error(`No readable Sentinel-2 pass over the plot in the ${windowDays} days before the event.`);
    if (!post) throw new Error(`No readable Sentinel-2 pass over the plot in the ${windowDays} days after the event yet.`);

    const sum = summariseNdviChange(pre.clip.pixels!, post.clip.pixels!, threshold);
    if (!sum) throw new Error('No part of the plot was clear on both selected dates; try a wider search window.');
    const { compared, comparedPct, affectedPct, medianDelta } = sum;

    const plotAreaSqm = calculateGeodesicAreaSquareMeters(plot.boundary_coordinates);
    const affectedAreaSqm = Math.round(plotAreaSqm * (affectedPct / 100));
    const affectedAreaHa = Math.round((affectedAreaSqm / 10000) * 1000) / 1000;

    // Screening priority from the measured share of changed pixels
    const severity: DisasterAssessmentRecord['damage_severity'] =
      affectedPct >= 50 ? 'CRITICAL' : affectedPct >= 25 ? 'SEVERE' : affectedPct >= 10 ? 'MODERATE' : 'NEGLIGIBLE';
    const priority: DisasterAssessmentRecord['inspection_priority'] =
      severity === 'CRITICAL' ? 'CRITICAL' : severity === 'SEVERE' ? 'HIGH' : severity === 'MODERATE' ? 'MEDIUM' : 'ROUTINE';

    const preDate = pre.scene.acquisition_datetime.slice(0, 10);
    const postDate = post.scene.acquisition_datetime.slice(0, 10);
    const lowCoverage = comparedPct < 60 ? ` Only ${comparedPct.toFixed(0)}% of the plot was clear on both dates.` : '';
    const assessment: DisasterAssessmentRecord = {
      id: `dis-${Date.now()}`,
      event_reference: `DIS-${plot.district.slice(0, 3).toUpperCase()}-${params.eventDate.replace(/-/g, '')}-${plot.id}`,
      event_name: params.eventName,
      event_type: params.eventType,
      plot_id: plot.id,
      pre_event_date: preDate,
      post_event_date: postDate,
      pre_event_ndvi: Number(sum.preMean.toFixed(3)),
      post_event_ndvi: Number(sum.postMean.toFixed(3)),
      ndvi_change_delta: Number((sum.postMean - sum.preMean).toFixed(3)),
      affected_area_sqm: affectedAreaSqm,
      affected_area_hectares: affectedAreaHa,
      affected_area_acres: Math.round(affectedAreaHa * 2.4710538 * 1000) / 1000,
      affected_percentage: Number(affectedPct.toFixed(1)),
      damage_severity: severity,
      inspection_priority: priority,
      verification_status: 'PRELIMINARY_AI_OBSERVATION',
      surveyor_notes:
        `${affectedPct.toFixed(1)}% of compared plot pixels lost ≥${threshold} NDVI between ${preDate} and ${postDate} ` +
        `(median change ${medianDelta.toFixed(2)}).${lowCoverage} Screening only: NDVI loss can also be harvest or ploughing; field verification required.`,
      assessed_at: new Date().toISOString(),
      method: DISASTER_METHOD,
      pre_scene_id: pre.scene.scene_id,
      post_scene_id: post.scene.scene_id,
      pre_clear_pct: Number(pre.clip.stats.validCoveragePct.toFixed(1)),
      post_clear_pct: Number(post.clip.stats.validCoveragePct.toFixed(1)),
      compared_pixels: compared,
      compared_pct_of_plot: Number(comparedPct.toFixed(1)),
      change_threshold: threshold,
      median_ndvi_change: Number(medianDelta.toFixed(3)),
    };

    mockDb.disasterAssessments.unshift(assessment);

    // Module F: Route Critical/Severe Disaster Screening to Inspection Queue
    if (severity === 'CRITICAL' || severity === 'SEVERE') {
      const existingInspection = mockDb.inspections.find(
        (i) => i.property_id === plot.property_id && i.inspection_status === 'ASSIGNED'
      );
      if (!existingInspection) {
        mockDb.inspections.unshift({
          id: `insp-disaster-${Date.now()}`,
          application_id: `app-dis-${plot.id}`,
          property_id: plot.property_id,
          assigned_worker_id: 'usr-field-01',
          assigned_tahsildar_id: 'usr-tahsildar-01',
          inspection_status: 'ASSIGNED',
          scheduled_at: null,
          started_at: null,
          completed_at: null,
          field_notes: `Disaster Screening Alert (${params.eventType}): ${assessment.affected_percentage}% of plot damaged (${assessment.affected_area_hectares} ha). Rapid ground verification required for compensation processing.`,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    mockDb.addAuditLog('DISASTER_SCREENING_COMPLETED', 'disaster_assessments', assessment.id, null, {
      event_reference: assessment.event_reference,
      plot_reference: plot.plot_reference,
      pre_scene: assessment.pre_scene_id,
      post_scene: assessment.post_scene_id,
      affected_pct: assessment.affected_percentage,
      inspection_priority: assessment.inspection_priority,
    });
    mockDb.persistAll();
    return assessment;
  }

  /** Field verification by a surveyor or Tahsildar */
  async verifyAssessment(
    assessmentId: string,
    decision: 'FIELD_VERIFIED' | 'COMPENSATION_APPROVED',
    notes: string
  ): Promise<DisasterAssessmentRecord> {
    const item = mockDb.disasterAssessments.find((d) => d.id === assessmentId);
    if (!item) throw new Error('Assessment not found');
    item.verification_status = decision;
    item.surveyor_notes = notes;
    mockDb.persistAll();
    return item;
  }

  async getPlotAssessments(plotId: string): Promise<DisasterAssessmentRecord[]> {
    return mockDb.disasterAssessments.filter((d) => d.plot_id === plotId);
  }
}

export const disasterAssessmentService = new DisasterAssessmentService();
