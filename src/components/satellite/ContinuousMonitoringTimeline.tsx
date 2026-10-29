/**
 * AgriSurvey AI — Continuous 15-Day Satellite Monitoring Timeline
 *
 * Displays 15-day periodic Sentinel-2 observations, 7 spectral vegetation/moisture indices,
 * honest cloud-gap tracking, growth stages, the seasonal crop-pattern indicator and the
 * actual imagery of the selected period. Pre-seeded sample records are labelled as such.
 */

import React, { useEffect, useState } from 'react';
import {
  Satellite,
  Calendar,
  Cloud,
  CloudOff,
  TrendingUp,
  TrendingDown,
  Minus,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  RefreshCw,
  Layers,
  Activity,
  Droplets,
  Eye,
  Info,
  CheckCircle,
  Clock,
  Compass,
  Sprout,
  MapPin,
} from 'lucide-react';
import {
  MonitoringArea,
  MonitoringPeriodObservation,
} from '@/types';
import { mockDb } from '@/services/mock-db';
import { loadAreaClip, SceneClip, SurveyArea } from '@/lib/sentinel-cog';
import { ClipImageMode, SceneClipImage } from './SceneClipImage';

const fmtIndex = (v: number | null | undefined, d = 3) =>
  typeof v === 'number' && Number.isFinite(v) ? v.toFixed(d) : '—';

const areaGeometry = (area: MonitoringArea): SurveyArea =>
  area.polygon_coordinates && area.polygon_coordinates.length >= 3
    ? { kind: 'polygon', coordinates: area.polygon_coordinates }
    : { kind: 'circle', center: { lat: area.latitude, lon: area.longitude }, radiusKm: area.radius_km };

interface ContinuousMonitoringTimelineProps {
  area: MonitoringArea;
  observations: MonitoringPeriodObservation[];
  onRefreshObservations?: () => Promise<void>;
}

type IndexKey =
  | 'ndvi_mean'
  | 'evi_mean'
  | 'savi_mean'
  | 'ndwi_mean'
  | 'ndmi_mean'
  | 'ndre_mean'
  | 'gcvi_mean';

interface IndexMeta {
  key: IndexKey;
  label: string;
  fullName: string;
  formula: string;
  description: string;
  color: string;
  min: number;
  max: number;
}

const INDICES_CONFIG: IndexMeta[] = [
  {
    key: 'ndvi_mean',
    label: 'NDVI',
    fullName: 'Normalized Difference Vegetation Index',
    formula: '(B08 - B04) / (B08 + B04)',
    description: 'Core vegetative vigor, canopy greenness, and photosynthetic biomass.',
    color: '#10b981', // emerald-500
    min: 0,
    max: 1,
  },
  {
    key: 'evi_mean',
    label: 'EVI',
    fullName: 'Enhanced Vegetation Index',
    formula: '2.5 * (B08 - B04) / (B08 + 6*B04 - 7.5*B02 + 1)',
    description: 'High-biomass sensitivity with atmospheric and soil background resistance.',
    color: '#06b6d4', // cyan-500
    min: 0,
    max: 1,
  },
  {
    key: 'savi_mean',
    label: 'SAVI',
    fullName: 'Soil-Adjusted Vegetation Index',
    formula: '((B08 - B04) / (B08 + B04 + 0.5)) * 1.5',
    description: 'Soil background attenuation for early sowing and sparse crop cover.',
    color: '#84cc16', // lime-500
    min: 0,
    max: 1,
  },
  {
    key: 'ndwi_mean',
    label: 'NDWI',
    fullName: 'Normalized Difference Water Index',
    formula: '(B03 - B08) / (B03 + B08)',
    description: 'Canopy surface moisture and flood/waterbody delineation.',
    color: '#3b82f6', // blue-500
    min: -0.5,
    max: 0.5,
  },
  {
    key: 'ndmi_mean',
    label: 'NDMI',
    fullName: 'Normalized Difference Moisture Index',
    formula: '(B08 - B11) / (B08 + B11)',
    description: 'Crop canopy internal water stress and moisture deficit tracking.',
    color: '#6366f1', // indigo-500
    min: -0.2,
    max: 0.8,
  },
  {
    key: 'ndre_mean',
    label: 'NDRE',
    fullName: 'Normalized Difference Red Edge',
    formula: '(B08 - B05) / (B08 + B05)',
    description: 'Chlorophyll content and mid-to-late season nitrogen vigor.',
    color: '#14b8a6', // teal-500
    min: 0,
    max: 0.8,
  },
  {
    key: 'gcvi_mean',
    label: 'GCVI',
    fullName: 'Green Chlorophyll Vegetation Index',
    formula: '(B08 / B03) - 1',
    description: 'High-latitude green leaf chlorophyll index for dense row crops.',
    color: '#eab308', // yellow-500
    min: 0,
    max: 3.5,
  },
];

export const ContinuousMonitoringTimeline: React.FC<ContinuousMonitoringTimelineProps> = ({
  area,
  observations,
  onRefreshObservations,
}) => {
  const [selectedIndex, setSelectedIndex] = useState<IndexKey>('ndvi_mean');
  const [selectedObsId, setSelectedObsId] = useState<string | null>(
    observations.length > 0 ? observations[observations.length - 1].id : null
  );
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Imagery of the selected period, re-read from the scene that was measured
  const [imageMode, setImageMode] = useState<ClipImageMode>('visual');
  const [clip, setClip] = useState<{ key: string; clip?: SceneClip; error?: string } | null>(null);

  const isSample = observations.some((o) => o.data_origin !== 'SENTINEL2_MEASURED');

  const activeIndexMeta = INDICES_CONFIG.find((i) => i.key === selectedIndex) || INDICES_CONFIG[0];
  const selectedObs =
    observations.find((o) => o.id === selectedObsId) ||
    (observations.length > 0 ? observations[observations.length - 1] : null);

  const handleRefresh = async () => {
    if (!onRefreshObservations) return;
    setIsRefreshing(true);
    setRefreshError(null);
    try {
      await onRefreshObservations();
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRefreshing(false);
    }
  };

  const clipSceneId = selectedObs?.has_data && !isSample ? selectedObs.scene_ids[0] : undefined;
  const clipKey = clipSceneId ? `${area.id}|${clipSceneId}` : '';
  const clipScene = clipSceneId ? mockDb.satelliteScenes.find((sc) => sc.scene_id === clipSceneId) : undefined;
  useEffect(() => {
    if (!clipScene) return;
    const scene = clipScene;
    const controller = new AbortController();
    loadAreaClip(scene, areaGeometry(area), { marginM: 250, maxOutputDim: 640, signal: controller.signal })
      .then((c) => !controller.signal.aborted && setClip({ key: clipKey, clip: c }))
      .catch((err) => !controller.signal.aborted && setClip({ key: clipKey, error: err instanceof Error ? err.message : String(err) }));
    return () => controller.abort();
  }, [clipKey, clipScene, area]);
  const activeClip =
    clipSceneId && !clipScene
      ? { key: clipKey, error: 'Scene details are not cached on this device; press "Check Latest Scan" to reload imagery.' }
      : clip && clip.key === clipKey
      ? clip
      : null;

  // Usable observations count
  const usableCount = observations.filter((o) => o.has_data).length;
  const cloudOutagesCount = observations.filter((o) => !o.has_data).length;

  // Chart coordinate calculations
  const chartHeight = 160;
  const chartWidth = 720;
  const paddingX = 40;
  const paddingY = 25;

  const validPoints = observations
    .map((obs, idx) => {
      const val = obs.indices[selectedIndex];
      if (!obs.has_data || typeof val !== 'number' || !Number.isFinite(val)) return null;
      const x =
        observations.length > 1
          ? paddingX + (idx / (observations.length - 1)) * (chartWidth - paddingX * 2)
          : chartWidth / 2;
      const normalizedY =
        (val - activeIndexMeta.min) / (activeIndexMeta.max - activeIndexMeta.min);
      const clampedNormY = Math.max(0, Math.min(1, normalizedY));
      const y = chartHeight - paddingY - clampedNormY * (chartHeight - paddingY * 2);
      return { x, y, val, obs, idx };
    })
    .filter(Boolean) as Array<{
    x: number;
    y: number;
    val: number;
    obs: MonitoringPeriodObservation;
    idx: number;
  }>;

  const pathD =
    validPoints.length > 1
      ? validPoints.reduce((acc, pt, i) => `${acc} ${i === 0 ? 'M' : 'L'} ${pt.x} ${pt.y}`, '')
      : '';

  return (
    <div className="space-y-6">
      {/* Area Overview Banner - Simplified & Feature-Explaining */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white rounded-2xl p-5 sm:p-6 shadow-xl border border-slate-700/60">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2.5 max-w-3xl">
            {/* Top Badges */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 shadow-xs">
                <Satellite className="w-3.5 h-3.5 text-emerald-400" />
                Sentinel-2 Crop Monitor
              </span>
              {isSample && (
                <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-400 text-amber-950">
                  SAMPLE DATA — not a satellite measurement
                </span>
              )}
              <span className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/10 text-slate-300 border border-white/10 flex items-center gap-1.5">
                <Clock className="w-3 h-3 text-cyan-400" />
                Scans Farm Every {area.interval_days || 15} Days
              </span>
            </div>

            {/* Farm Title & Explainer */}
            <div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                {area.name}
              </h2>
              <p className="text-xs text-slate-300/90 leading-relaxed mt-1">
                Monitors crop greenness, growth stages, and water moisture directly from space to verify healthy cultivation without physical paperwork.
              </p>
            </div>

            {/* Farm Key Details Pills */}
            <div className="flex flex-wrap items-center gap-2 text-xs pt-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">
                <Sprout className="w-3.5 h-3.5 text-emerald-400" />
                <span>Declared crop: <strong className="text-white">{area.preferred_crop || 'Not declared'}</strong>{area.preferred_season ? ` (${area.preferred_season})` : ''}</span>
              </span>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200">
                <Layers className="w-3.5 h-3.5 text-teal-400" />
                <span>Farm Area: <strong className="text-white">{area.area_acres} Acres</strong></span>
              </span>

              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-slate-200 font-mono">
                <Compass className="w-3.5 h-3.5 text-cyan-400" />
                <span>{area.latitude.toFixed(4)}° N, {area.longitude.toFixed(4)}° E</span>
              </span>
            </div>
          </div>

          {/* Right Metrics & Scan Action Button */}
          <div className="flex sm:items-center justify-between lg:justify-end gap-4 pt-3 lg:pt-0 border-t lg:border-t-0 border-white/10">
            <div className="text-left sm:text-right">
              <div className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
                Successful Scans
              </div>
              <div className="text-lg sm:text-xl font-bold text-emerald-400 font-mono flex items-baseline gap-1 sm:justify-end">
                <span>{usableCount} of {observations.length}</span>
                <span className="text-xs font-normal text-emerald-300/80">clear</span>
              </div>
              <div className="text-[11px] text-amber-300/90 flex items-center gap-1 sm:justify-end">
                <Cloud className="w-3 h-3 text-amber-400" />
                <span>{cloudOutagesCount} cloudy (skipped)</span>
              </div>
            </div>

            {onRefreshObservations && (
              <button
                onClick={handleRefresh}
                disabled={isRefreshing}
                className="inline-flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-semibold rounded-xl shadow-md shadow-emerald-950/40 transition-all cursor-pointer disabled:opacity-60 shrink-0"
                title="Fetch the newest Sentinel-2 satellite scan for this farm"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>{isRefreshing ? 'Scanning...' : 'Check Latest Scan'}</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {isSample && (
        <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            These observations are pre-loaded demonstration records, not measurements of this farm.
            {onRefreshObservations
              ? ' Press "Check Latest Scan" to replace them with real Sentinel-2 measurements.'
              : ' Run a satellite scan to replace them with real Sentinel-2 measurements.'}
          </span>
        </div>
      )}
      {(refreshError || area.last_run_error) && (
        <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-start gap-2">
          <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{refreshError || area.last_run_error}</span>
        </div>
      )}

      {!isSample && (area.growth_summary || area.crop_pattern) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs space-y-2">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <Sprout className="w-4 h-4 text-emerald-600" /> Current growth report
            </h3>
            {area.growth_summary && <p className="text-sm text-slate-700">{area.growth_summary}</p>}
            {area.crop_pattern && (
              <div className="pt-2 border-t border-slate-100 text-xs space-y-0.5">
                <p className="font-semibold text-slate-900">
                  Crop type indicator: {area.crop_pattern.pattern}{' '}
                  <span className="font-normal text-slate-600">({area.crop_pattern.typical_crops})</span>
                </p>
                <p className="text-slate-600">{area.crop_pattern.explanation}</p>
                {area.crop_pattern.declared_crop_agreement === 'consistent' && (
                  <p className="text-emerald-800 font-semibold">✓ Consistent with the declared crop</p>
                )}
                {area.crop_pattern.declared_crop_agreement === 'differs' && (
                  <p className="text-amber-800 font-semibold">⚠ Differs from the declared crop — field verification needed</p>
                )}
                <p className="text-[10px] text-slate-500">Rule-based seasonal indicator, not a validated crop classifier.</p>
              </div>
            )}
          </div>
          <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs space-y-2">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-600" /> Alerts ({area.alerts?.length ?? 0})
            </h3>
            {!area.alerts?.length && (
              <p className="text-xs text-slate-600 flex items-center gap-1.5">
                <CheckCircle className="w-4 h-4 text-emerald-600" /> No alerts for the observed periods.
              </p>
            )}
            <ul className="space-y-1.5 max-h-40 overflow-y-auto">
              {area.alerts?.map((a, i) => (
                <li
                  key={i}
                  className={`text-[11px] rounded-lg border p-2 ${
                    a.severity === 'critical'
                      ? 'bg-red-50 border-red-200 text-red-900'
                      : a.severity === 'warning'
                      ? 'bg-amber-50 border-amber-200 text-amber-900'
                      : 'bg-slate-50 border-slate-200 text-slate-700'
                  }`}
                >
                  <strong>{a.title}.</strong> {a.detail}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Spectral Indices Picker */}
      <div className="bg-white rounded-xl p-4 border border-slate-200 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-emerald-600" />
            <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Crop Health & Moisture Measurements (Select Measurement)
            </span>
          </div>
          <span className="text-xs text-slate-500 font-medium">
            {activeIndexMeta.fullName}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          {INDICES_CONFIG.map((idx) => {
            const isSelected = idx.key === selectedIndex;
            return (
              <button
                key={idx.key}
                onClick={() => setSelectedIndex(idx.key)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 border ${
                  isSelected
                    ? 'bg-slate-900 text-white border-slate-900 shadow-xs'
                    : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100 hover:border-slate-300'
                }`}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full inline-block"
                  style={{ backgroundColor: idx.color }}
                />
                <span>{idx.label}</span>
              </button>
            );
          })}
        </div>
        <p className="text-xs text-slate-600 mt-2.5 bg-slate-50 p-2 rounded-lg border border-slate-100">
          <strong className="text-slate-800">{activeIndexMeta.label}:</strong> {activeIndexMeta.description}
        </p>
      </div>

      {/* SVG Time-Series Chart */}
      <div className="bg-white rounded-xl p-5 border border-slate-200 shadow-xs">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              15-Day Growth Timeline — {activeIndexMeta.label} ({activeIndexMeta.fullName})
            </h3>
            <p className="text-xs text-slate-500">
              Copernicus Sentinel-2 Bottom-of-Atmosphere (BOA) Reflectance with SCL Cloud Masking
            </p>
          </div>
          <div className="text-xs text-slate-500 flex items-center gap-3">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-emerald-500 inline-block" /> Usable Acquisition
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Cloud Outage
            </span>
          </div>
        </div>

        {/* SVG Curve Container */}
        <div className="w-full overflow-x-auto">
          <div className="min-w-[680px]">
            <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-44 overflow-visible">
              {/* Grid Lines */}
              <line
                x1={paddingX}
                y1={paddingY}
                x2={chartWidth - paddingX}
                y2={paddingY}
                stroke="#e2e8f0"
                strokeDasharray="3 3"
              />
              <line
                x1={paddingX}
                y1={chartHeight / 2}
                x2={chartWidth - paddingX}
                y2={chartHeight / 2}
                stroke="#e2e8f0"
                strokeDasharray="3 3"
              />
              <line
                x1={paddingX}
                y1={chartHeight - paddingY}
                x2={chartWidth - paddingX}
                y2={chartHeight - paddingY}
                stroke="#cbd5e1"
              />

              {/* Min and Max Labels */}
              <text x={paddingX - 6} y={paddingY + 4} textAnchor="end" className="text-[10px] fill-slate-400 font-mono">
                {activeIndexMeta.max}
              </text>
              <text x={paddingX - 6} y={chartHeight - paddingY + 4} textAnchor="end" className="text-[10px] fill-slate-400 font-mono">
                {activeIndexMeta.min}
              </text>

              {/* Data Path */}
              {pathD && (
                <path
                  d={pathD}
                  fill="none"
                  stroke={activeIndexMeta.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Nodes for each period */}
              {observations.map((obs, idx) => {
                const x =
                  observations.length > 1
                    ? paddingX + (idx / (observations.length - 1)) * (chartWidth - paddingX * 2)
                    : chartWidth / 2;

                if (!obs.has_data) {
                  // Cloud Outage Mark
                  return (
                    <g key={obs.id} className="cursor-pointer" onClick={() => setSelectedObsId(obs.id)}>
                      <circle
                        cx={x}
                        cy={chartHeight - paddingY}
                        r="5"
                        fill="#fbbf24"
                        stroke="#ffffff"
                        strokeWidth="2"
                      />
                      <text
                        x={x}
                        y={chartHeight - 6}
                        textAnchor="middle"
                        className="text-[9px] fill-amber-700 font-bold"
                      >
                        P{obs.period_index}
                      </text>
                    </g>
                  );
                }

                const pt = validPoints.find((p) => p.obs.id === obs.id);
                if (!pt) return null;
                const isSelected = obs.id === selectedObsId;

                return (
                  <g key={obs.id} className="cursor-pointer" onClick={() => setSelectedObsId(obs.id)}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isSelected ? 7 : 4.5}
                      fill={isSelected ? '#0f172a' : activeIndexMeta.color}
                      stroke="#ffffff"
                      strokeWidth="2"
                      className="transition-all hover:scale-125"
                    />
                    <text
                      x={pt.x}
                      y={pt.y - 10}
                      textAnchor="middle"
                      className="text-[10px] fill-slate-700 font-mono font-bold"
                    >
                      {pt.val.toFixed(2)}
                    </text>
                    <text
                      x={pt.x}
                      y={chartHeight - 6}
                      textAnchor="middle"
                      className="text-[9px] fill-slate-500 font-medium"
                    >
                      P{obs.period_index}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>

      {/* 15-Day Observation Gallery (Chronological) */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-emerald-600" />
            15-Day Periodic Observation Record
          </h3>
          <span className="text-xs text-slate-500">
            Click any period card below to inspect scene metadata and phenology features
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {observations.map((obs) => {
            const isSelected = obs.id === selectedObsId;
            const delta = obs.delta_ndvi_previous;

            return (
              <div
                key={obs.id}
                onClick={() => setSelectedObsId(obs.id)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer relative overflow-hidden ${
                  isSelected
                    ? 'border-emerald-600 bg-emerald-50/40 ring-2 ring-emerald-600/20 shadow-md'
                    : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-xs'
                }`}
              >
                {/* Period Index & Health Badge */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded">
                    Period {obs.period_index}
                  </span>
                  {obs.has_data ? (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                      {obs.growth_stage}
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 flex items-center gap-1">
                      <CloudOff className="w-3 h-3" />
                      {obs.scenes_found === 0 && obs.data_origin === 'SENTINEL2_MEASURED' ? 'No pass' : 'Cloud Outage'}
                    </span>
                  )}
                </div>

                {/* Scheduled Period Dates */}
                <div className="text-[11px] text-slate-500 mb-1">
                  Scheduled: <span className="font-medium text-slate-700">{obs.period_start.slice(5)} to {obs.period_end.slice(5)}</span>
                </div>

                {/* Actual Acquisition Date vs None */}
                <div className="text-[11px] mb-2.5">
                  <span className="text-slate-500">Acquired: </span>
                  {obs.actual_acquisition_dates.length > 0 ? (
                    <span className="font-semibold text-emerald-700 font-mono">
                      {obs.actual_acquisition_dates.join(', ')}
                    </span>
                  ) : (
                    <span className="font-medium text-amber-600 italic">None (overcast)</span>
                  )}
                </div>

                {/* Metric Display */}
                {obs.has_data ? (
                  <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500 font-semibold">{activeIndexMeta.label}:</span>
                      <span className="font-bold font-mono text-slate-900">
                        {fmtIndex(obs.indices[selectedIndex])}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-500">NDVI Delta:</span>
                      {delta !== null ? (
                        <span
                          className={`font-bold font-mono flex items-center gap-0.5 ${
                            delta > 0
                              ? 'text-emerald-600'
                              : delta < -0.05
                              ? 'text-red-600'
                              : 'text-slate-600'
                          }`}
                        >
                          {delta > 0 ? (
                            <TrendingUp className="w-3 h-3" />
                          ) : delta < 0 ? (
                            <TrendingDown className="w-3 h-3" />
                          ) : (
                            <Minus className="w-3 h-3" />
                          )}
                          {delta > 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)}
                        </span>
                      ) : (
                        <span className="text-slate-400 font-mono text-[11px]">Baseline</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded border border-amber-200 mt-2">
                    {obs.missing_reason || 'No clear observation in this period'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Selected Observation Deep-Dive & ML Phenology Card */}
      {selectedObs && (
        <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-1 bg-slate-900 text-white text-xs font-bold rounded-md">
                  {selectedObs.period_label}
                </span>
                <span className="text-xs text-slate-500 font-mono">
                  {selectedObs.has_data
                    ? `Acquisition Date: ${selectedObs.actual_acquisition_dates.join(', ')}`
                    : 'No clear satellite scene available'}
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-1.5">{selectedObs.change_summary}</p>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Provider:</span>
              <span className="text-xs font-semibold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md">
                {selectedObs.satellite_provider}
              </span>
            </div>
          </div>

          {selectedObs.has_data ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* 7 Indices Grid */}
              <div className="md:col-span-2 space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4 text-emerald-600" />
                  Calculated Indices for this 15-Day Composite
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {INDICES_CONFIG.map((idx) => {
                    const val = selectedObs.indices[idx.key];
                    return (
                      <div key={idx.key} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="text-[11px] font-semibold text-slate-500">{idx.label}</div>
                        <div className="text-sm font-bold font-mono text-slate-900 mt-0.5">
                          {fmtIndex(val)}
                        </div>
                      </div>
                    );
                  })}
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[11px] font-semibold text-slate-500">Valid Pixels</div>
                    <div className="text-sm font-bold font-mono text-emerald-700 mt-0.5">
                      {(selectedObs.valid_pixel_fraction * 100).toFixed(1)}%
                    </div>
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4 gap-y-1 pt-1">
                  <span>Scene IDs: <code className="text-slate-700">{selectedObs.scene_ids.join(', ') || 'N/A'}</code></span>
                  <span>BOA Offset: <code className="text-slate-700">{selectedObs.boa_offset_applied}</code></span>
                  <span>Scale: <code className="text-slate-700">{selectedObs.scale_factor}</code></span>
                </div>
              </div>

              {isSample ? (
                <div className="p-4 rounded-xl bg-gradient-to-br from-slate-900 to-slate-800 text-white border border-slate-700 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4" />
                      Sample model output
                    </span>
                    <span className="text-[10px] bg-amber-400 text-amber-950 px-2 py-0.5 rounded font-bold">
                      Demo only
                    </span>
                  </div>

                  {selectedObs.crop_prediction ? (
                    <div>
                      <div className="text-xs text-slate-400">Classified Crop Identity</div>
                      <div className="text-lg font-bold text-white mt-0.5 flex items-center justify-between">
                        <span>{selectedObs.crop_prediction.crop_name}</span>
                        <span className="text-emerald-400 font-mono text-sm">
                          {selectedObs.crop_prediction.confidence.toFixed(1)}%
                        </span>
                      </div>

                      {/* Threshold warning if confidence < 90% */}
                      {selectedObs.crop_prediction.needs_field_check && (
                        <div className="mt-2.5 p-2 rounded-lg bg-amber-500/20 border border-amber-500/40 text-amber-200 text-[11px] flex items-start gap-1.5">
                          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                          <span>Selective Prediction: Below 90% confidence threshold. Flagged for Tahsildar ground verification.</span>
                        </div>
                      )}

                      {/* Model Ranking */}
                      <div className="mt-3 space-y-1.5">
                        <div className="text-[11px] text-slate-400 font-semibold">Classification Probabilities:</div>
                        {selectedObs.crop_prediction.ranking.map((r) => (
                          <div key={r.crop} className="flex justify-between items-center text-xs">
                            <span className="text-slate-300">{r.crop}</span>
                            <span className="font-mono text-slate-400">{r.fit.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 italic">
                      Crop classification requires usable Sentinel-2 phenology features.
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-3 rounded-xl bg-slate-900 text-white border border-slate-700 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                      <Eye className="w-4 h-4" /> Satellite view
                    </span>
                    <div className="flex gap-0.5 bg-white/10 p-0.5 rounded text-[10px]" role="group" aria-label="Band combination">
                      {(
                        [
                          ['visual', 'Natural'],
                          ['false_color', 'Infrared'],
                          ['ndvi', 'NDVI'],
                        ] as [ClipImageMode, string][]
                      ).map(([m, label]) => (
                        <button
                          key={m}
                          type="button"
                          aria-pressed={imageMode === m}
                          onClick={() => setImageMode(m)}
                          className={`px-1.5 py-0.5 rounded font-semibold ${imageMode === m ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:text-white'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {activeClip?.clip ? (
                    <SceneClipImage
                      clip={activeClip.clip}
                      mode={imageMode}
                      alt={`Sentinel-2 ${imageMode} on ${selectedObs.actual_acquisition_dates[0]}`}
                      className="aspect-square rounded-lg overflow-hidden"
                    />
                  ) : (
                    <div className="aspect-square rounded-lg border border-slate-700 flex items-center justify-center text-[11px] text-slate-400 p-4 text-center">
                      {activeClip?.error ?? 'Loading 10 m imagery…'}
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400">
                    Acquired {selectedObs.actual_acquisition_dates[0]} · yellow outline = monitored area · 10 m pixels, display-stretched.
                  </p>
                </div>
              )}
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-3">
              <CloudOff className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-amber-800">No clear observation in this period</p>
                <p className="text-amber-700 mt-1">
                  {selectedObs.missing_reason || 'No usable satellite view.'} The period is left empty rather than filled with estimated values.
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
