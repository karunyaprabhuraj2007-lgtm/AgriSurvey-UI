/**
 * AgriSurvey AI — Crop identification, production scenario and disaster screening for a plot
 *
 * 1. Crop identification: GREEN-MINDS-ML phenology template matcher on the plot's real
 *    Sentinel-2 NDVI series for a season; abstains when the evidence is insufficient;
 *    officer verification records the ground truth (and a labelled sample).
 * 2. Production scenario: expected yield × harvested area (not a forecast).
 * 3. Disaster screening: per-pixel NDVI change between clear passes before and after an event.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Activity, CheckCircle2, AlertTriangle, TrendingUp, FileText, Download, CloudLightning, Info, Loader2, Satellite } from 'lucide-react';
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, Legend } from 'recharts';
import { FarmPlot, CropPredictionRecord, YieldForecastRecord, DisasterAssessmentRecord } from '@/types';
import { VERIFIABLE_CROPS, cropClassificationService, cropLabel } from '@/services/crop-classification.service';
import { cropKeyFromName, illustrativeYield, yieldForecastingService } from '@/services/yield-forecasting.service';
import { disasterAssessmentService } from '@/services/disaster-assessment.service';
import { reportService } from '@/services/report.service';
import { RunProgress } from '@/services/field-surveillance.service';
import { CROP_PROFILES, MATCHER_SETTINGS, SEASONS, SeasonName, defaultSeason } from '@/lib/crop-phenology';

interface CropIntelligenceModalProps {
  plot: FarmPlot;
  isOpen: boolean;
  onClose: () => void;
  currentUserRole?: string;
}

const DAY_MS = 24 * 3600 * 1000;

const VERDICT_STYLE: Record<CropPredictionRecord['verdict_status'], { label: string; cls: string }> = {
  matched: { label: 'Matched', cls: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
  ambiguous: { label: 'Ambiguous — several crops fit', cls: 'bg-amber-100 text-amber-900 border-amber-300' },
  no_match: { label: 'No crop template fits', cls: 'bg-slate-100 text-slate-800 border-slate-300' },
  truncated_window: { label: 'Season longer than window', cls: 'bg-sky-100 text-sky-900 border-sky-300' },
  insufficient_observations: { label: 'Insufficient clear observations', cls: 'bg-slate-100 text-slate-800 border-slate-300' },
};

const CropIntelligenceModalContent: React.FC<CropIntelligenceModalProps> = ({ plot, onClose, currentUserRole = 'farmer' }) => {
  const [activeTab, setActiveTab] = useState<'classification' | 'yield' | 'disaster'>('classification');
  const canVerify = currentUserRole === 'tahsildar' || currentUserRole === 'admin';
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  // ---------------- Crop identification ----------------
  const def = defaultSeason();
  const [season, setSeason] = useState<SeasonName>(def.season);
  const [year, setYear] = useState<number>(def.year);
  const [predictions, setPredictions] = useState<CropPredictionRecord[]>([]);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [classifyError, setClassifyError] = useState<string | null>(null);
  const [verifiedCrop, setVerifiedCrop] = useState('');
  const [reviewerNotes, setReviewerNotes] = useState('');
  const [verifyMessage, setVerifyMessage] = useState<string | null>(null);

  const prediction = predictions.find((p) => p.season === season && p.season_year === year) ?? null;
  // Fits and season metrics only mean something when a growth season was actually observed.
  const seasonObserved =
    !!prediction?.phenology &&
    prediction.verdict_status !== 'insufficient_observations' &&
    !(prediction.phenology.peak_ndvi < MATCHER_SETTINGS.bareMaxPeakNdvi && prediction.phenology.amplitude < MATCHER_SETTINGS.bareMaxAmplitude);

  useEffect(() => {
    cropClassificationService.getPlotPredictions(plot.id).then(setPredictions);
  }, [plot.id]);

  const runClassification = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setClassifyError(null);
    setVerifyMessage(null);
    setProgress({ stage: 'searching', completedPeriods: 0, totalPeriods: 0 });
    try {
      await cropClassificationService.classifyPlotCrop(plot.id, { season, year, onProgress: setProgress, signal: controller.signal });
      setPredictions(await cropClassificationService.getPlotPredictions(plot.id));
    } catch (err) {
      if (!controller.signal.aborted) setClassifyError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setProgress(null);
    }
  };

  const handleVerify = async () => {
    if (!prediction) return;
    try {
      const updated = await cropClassificationService.verifyCropPrediction({ predictionId: prediction.id, verifiedCrop, reviewerNotes });
      setPredictions((prev) => prev.map((p) => (p.id === updated.id ? { ...updated } : p)));
      setVerifyMessage(`Recorded: ${updated.verification_status === 'CONFIRMED' ? 'matches the satellite result' : 'differs from the satellite result'}.`);
    } catch (err) {
      setVerifyMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const chartData = useMemo(() => {
    if (!prediction) return [];
    const start = new Date(`${prediction.window_start}T00:00:00Z`).getTime();
    const pts = new Map<number, { day: number; curve?: number; observed?: number }>();
    prediction.smoothed_curve?.forEach((v, i) => pts.set(i * prediction.grid_step_days, { day: i * prediction.grid_step_days, curve: v }));
    for (const o of prediction.observations) {
      const day = Math.round((new Date(`${o.date}T00:00:00Z`).getTime() - start) / DAY_MS);
      pts.set(day + 0.001, { day, observed: o.ndvi });
    }
    return [...pts.values()].sort((a, b) => a.day - b.day);
  }, [prediction]);

  // ---------------- Production scenario ----------------
  const [yieldRecord, setYieldRecord] = useState<YieldForecastRecord | null>(null);
  const suggestedCrop = prediction?.predicted_crop ?? cropKeyFromName(plot.crop_type) ?? '';
  const [scenarioCrop, setScenarioCrop] = useState(suggestedCrop);
  const [expectedYield, setExpectedYield] = useState('');
  const [harvestedArea, setHarvestedArea] = useState(String(plot.area_hectares));
  const [yieldError, setYieldError] = useState<string | null>(null);
  const reference = scenarioCrop ? illustrativeYield(plot.district, scenarioCrop) : null;

  useEffect(() => {
    yieldForecastingService.getLatestForecast(plot.id).then(setYieldRecord);
  }, [plot.id]);

  const runScenario = async () => {
    setYieldError(null);
    try {
      const rec = await yieldForecastingService.forecastPlotYield(plot.id, {
        cropKey: scenarioCrop,
        expectedYieldTPerHa: expectedYield.trim() ? parseFloat(expectedYield) : undefined,
        harvestedAreaHa: parseFloat(harvestedArea),
        measuredPeakNdvi:
          prediction?.phenology && prediction.observations.length
            ? { value: prediction.phenology.peak_ndvi, date: `${prediction.season} ${prediction.season_year}` }
            : null,
      });
      setYieldRecord(rec);
    } catch (err) {
      setYieldError(err instanceof Error ? err.message : String(err));
    }
  };

  // ---------------- Disaster screening ----------------
  const [disasters, setDisasters] = useState<DisasterAssessmentRecord[]>([]);
  const [eventName, setEventName] = useState('');
  const [eventType, setEventType] = useState<DisasterAssessmentRecord['event_type']>('HEAVY_RAINFALL_FLOOD');
  const [eventDate, setEventDate] = useState('');
  const [windowDays, setWindowDays] = useState(30);
  const [threshold, setThreshold] = useState(0.15);
  const [disasterStatus, setDisasterStatus] = useState<string | null>(null);
  const [disasterError, setDisasterError] = useState<string | null>(null);

  useEffect(() => {
    disasterAssessmentService.getPlotAssessments(plot.id).then(setDisasters);
  }, [plot.id]);

  const runDisaster = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setDisasterError(null);
    setDisasterStatus('Starting…');
    try {
      await disasterAssessmentService.assessPlotDisaster({
        plotId: plot.id,
        eventName: eventName.trim() || `${eventType.replace(/_/g, ' ').toLowerCase()} on ${eventDate}`,
        eventType,
        eventDate,
        windowDays,
        changeThreshold: threshold,
        onStatus: setDisasterStatus,
        signal: controller.signal,
      });
      setDisasters(await disasterAssessmentService.getPlotAssessments(plot.id));
    } catch (err) {
      if (!controller.signal.aborted) setDisasterError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!controller.signal.aborted) setDisasterStatus(null);
    }
  };

  const busy = !!progress || !!disasterStatus;
  const yearOptions = [new Date().getUTCFullYear(), new Date().getUTCFullYear() - 1, new Date().getUTCFullYear() - 2];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">Crop Identification, Production & Disaster Screening</h3>
              <p className="text-xs text-slate-400">
                {plot.plot_name} • Survey {plot.survey_number} ({plot.area_acres} Acres / {plot.area_hectares} Ha)
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-200 bg-slate-50 px-6 text-xs font-semibold" role="tablist">
          {(
            [
              ['classification', 'Crop identification', Satellite],
              ['yield', 'Production scenario', TrendingUp],
              ['disaster', 'Disaster screening', CloudLightning],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              role="tab"
              aria-selected={activeTab === id}
              onClick={() => setActiveTab(id)}
              className={`py-3 px-4 border-b-2 flex items-center gap-1.5 ${activeTab === id ? 'border-emerald-600 text-emerald-800' : 'border-transparent text-slate-500 hover:text-slate-800'}`}
            >
              <Icon className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>

        <div className="p-6 max-h-[68vh] overflow-y-auto space-y-4">
          {/* ---------------------------------------------------------------- */}
          {activeTab === 'classification' && (
            <>
              <div className="flex flex-wrap items-end gap-3 text-xs">
                <label className="block">
                  <span className="font-semibold text-slate-600">Season</span>
                  <select value={season} onChange={(e) => setSeason(e.target.value as SeasonName)} className="mt-1 block px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white">
                    <option value="kharif">Kharif (10 Jun – 27 Nov)</option>
                    <option value="rabi">Rabi (15 Oct – 15 Apr)</option>
                  </select>
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-600">Year</span>
                  <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="mt-1 block px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white">
                    {yearOptions.map((y) => (
                      <option key={y} value={y}>
                        {season === 'rabi' ? `${y}–${String(y + 1).slice(2)}` : y}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  onClick={runClassification}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-60"
                >
                  {progress ? <Loader2 className="w-4 h-4 animate-spin" /> : <Satellite className="w-4 h-4" />}
                  {prediction ? 'Re-run satellite analysis' : 'Run satellite analysis'}
                </button>
                <span className="text-[11px] text-slate-500">Candidate crops: {SEASONS[season].crops.map(cropLabel).join(', ')}</span>
              </div>

              {progress && (
                <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1.5" aria-live="polite">
                  <div>
                    {progress.stage === 'searching'
                      ? 'Finding every Sentinel-2 pass over the plot for the season…'
                      : `Reading 10 m imagery: ${progress.completedPeriods} of ${progress.totalPeriods} ten-day periods (${progress.passesFound ?? 0} passes)`}
                  </div>
                  <div className="h-1.5 bg-slate-200 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${(progress.completedPeriods / Math.max(1, progress.totalPeriods)) * 100}%` }} />
                  </div>
                </div>
              )}
              {classifyError && (
                <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">
                  {classifyError}
                </p>
              )}

              {!prediction && !progress && (
                <p className="text-xs text-slate-500 bg-slate-50 border border-dashed border-slate-300 rounded-lg p-6 text-center">
                  No analysis for {season} {year} yet. Running it reads every clear Sentinel-2 pass over this plot for the season (about 20–40 seconds).
                </p>
              )}

              {prediction && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <span className={`inline-block px-2.5 py-1 rounded-lg border text-xs font-bold ${VERDICT_STYLE[prediction.verdict_status].cls}`}>
                        {VERDICT_STYLE[prediction.verdict_status].label}
                      </span>
                      <div className="text-lg font-bold text-slate-900">
                        {prediction.predicted_crop
                          ? cropLabel(prediction.predicted_crop)
                          : prediction.candidate_crops.length
                          ? prediction.candidate_crops.map(cropLabel).join(' / ')
                          : 'No crop identified'}
                      </div>
                      <p className="text-xs text-slate-600 max-w-xl">{prediction.verdict_message}</p>
                    </div>
                    <div className="text-[11px] text-slate-500 text-right">
                      <div>{prediction.observations.length} clear Sentinel-2 dates</div>
                      <div>
                        Window {prediction.window_start} → {prediction.window_end}
                      </div>
                      <div>Run {prediction.created_at.slice(0, 16).replace('T', ' ')}</div>
                    </div>
                  </div>

                  {chartData.length > 0 && (
                    <div className="h-56 border border-slate-200 rounded-lg p-2">
                      <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={chartData} margin={{ top: 5, right: 12, left: -12, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                          <XAxis dataKey="day" type="number" domain={[0, 'dataMax']} tick={{ fontSize: 10 }} label={{ value: 'days from window start', fontSize: 10, position: 'insideBottom', offset: -2 }} />
                          <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(v: unknown) => (typeof v === 'number' ? v.toFixed(3) : String(v))} />
                          <Legend wrapperStyle={{ fontSize: 11 }} />
                          <Line dataKey="curve" name="Smoothed curve" stroke="#047857" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
                          <Scatter dataKey="observed" name="Observed plot NDVI (clear date)" fill="#0369a1" isAnimationActive={false} />
                        </ComposedChart>
                      </ResponsiveContainer>
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <h4 className="font-bold text-xs text-slate-800 mb-1.5">Template fit by crop</h4>
                      <p className="text-[10px] text-slate-500 mb-2">1 − RMSE / curve amplitude. A fit is not a probability.</p>
                      <div className="space-y-1.5">
                        {seasonObserved && prediction.template_fits.slice(0, 6).map((f) => (
                          <div key={f.crop} className="text-xs">
                            <div className="flex justify-between">
                              <span className="text-slate-700">{cropLabel(f.crop)}</span>
                              <span className="font-mono text-slate-600">
                                {f.fit.toFixed(2)} {f.shift_days ? `(sowing ${f.shift_days > 0 ? '+' : ''}${f.shift_days} d)` : ''}
                              </span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-emerald-500" style={{ width: `${Math.max(0, f.fit) * 100}%` }} />
                            </div>
                          </div>
                        ))}
                        {!seasonObserved && <p className="text-xs text-slate-500">Not shown: no crop growth season was observed to compare with the templates.</p>}
                      </div>
                    </div>
                    <div className="space-y-2 text-xs">
                      <h4 className="font-bold text-slate-800">Measured season</h4>
                      {seasonObserved && prediction.phenology ? (
                        <dl className="grid grid-cols-2 gap-1.5 text-slate-600">
                          <dt>Peak NDVI</dt>
                          <dd className="font-mono text-slate-900">{prediction.phenology.peak_ndvi}</dd>
                          <dt>Peak day</dt>
                          <dd className="font-mono text-slate-900">{prediction.phenology.peak_day}</dd>
                          <dt>Green-up (day)</dt>
                          <dd className="font-mono text-slate-900">{prediction.phenology.sos_day}</dd>
                          <dt>Season length</dt>
                          <dd className="font-mono text-slate-900">{prediction.phenology.season_length_days} d</dd>
                        </dl>
                      ) : (
                        <p className="text-slate-500">
                          {prediction.phenology ? `No growth season: peak NDVI ${prediction.phenology.peak_ndvi}, rise ${prediction.phenology.amplitude}.` : 'Unavailable — insufficient observations.'}
                        </p>
                      )}
                      <p className="text-[10px] text-slate-500 leading-snug flex gap-1">
                        <Info className="w-3.5 h-3.5 shrink-0" />
                        {prediction.method}. Templates are indicative shapes, not calibrated on surveyed Maharashtra fields; no accuracy has
                        been measured on real fields yet. Confirm on the ground.
                      </p>
                    </div>
                  </div>

                  {/* Verification */}
                  <div className="border-t border-slate-200 pt-3 space-y-2 text-xs">
                    <h4 className="font-bold text-slate-800 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Ground verification
                    </h4>
                    {prediction.verified_crop ? (
                      <p className="text-slate-700">
                        Ground crop: <strong>{cropLabel(prediction.verified_crop)}</strong> —{' '}
                        {prediction.verification_status === 'CONFIRMED' ? 'matches the satellite result' : 'differs from the satellite result'}. Recorded by{' '}
                        {prediction.reviewer_name} on {prediction.reviewed_at?.slice(0, 10)}. “{prediction.reviewer_notes}”
                      </p>
                    ) : canVerify ? (
                      <div className="flex flex-wrap items-end gap-2">
                        <label className="block">
                          <span className="font-semibold text-slate-600">Crop found on the ground</span>
                          <select value={verifiedCrop} onChange={(e) => setVerifiedCrop(e.target.value)} className="mt-1 block px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white">
                            <option value="">— select —</option>
                            {VERIFIABLE_CROPS.map((c) => (
                              <option key={c} value={c}>
                                {cropLabel(c)}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="block flex-1 min-w-[200px]">
                          <span className="font-semibold text-slate-600">How it was verified</span>
                          <input
                            value={reviewerNotes}
                            onChange={(e) => setReviewerNotes(e.target.value)}
                            placeholder="e.g. field visit on 28 Oct, geotagged photos"
                            className="mt-1 block w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={handleVerify}
                          disabled={!verifiedCrop || !reviewerNotes.trim()}
                          className="px-3 py-1.5 rounded-lg bg-slate-900 text-white font-semibold disabled:opacity-50"
                        >
                          Record verification
                        </button>
                      </div>
                    ) : (
                      <p className="text-slate-500">Awaiting verification by the Tahsildar / agricultural officer.</p>
                    )}
                    {verifyMessage && <p className="text-slate-600">{verifyMessage}</p>}
                    <p className="text-[10px] text-slate-500">
                      Each verification is stored with the plot's NDVI series as a labelled sample — the data needed to measure real accuracy and re-fit the templates.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ---------------------------------------------------------------- */}
          {activeTab === 'yield' && (
            <>
              <p className="text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg p-3 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                Scenario estimate, not a forecast: production = expected yield × harvested area. No validated yield model exists yet (it needs
                historical plot yields). District figures are illustrative, not official statistics.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs items-end">
                <label className="block">
                  <span className="font-semibold text-slate-600">Crop</span>
                  <select value={scenarioCrop} onChange={(e) => setScenarioCrop(e.target.value)} className="mt-1 block w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white">
                    <option value="">— select —</option>
                    {Object.keys(CROP_PROFILES).map((c) => (
                      <option key={c} value={c}>
                        {cropLabel(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-600">Expected yield (t/ha)</span>
                  <input
                    type="number"
                    step="any"
                    min="0"
                    value={expectedYield}
                    onChange={(e) => setExpectedYield(e.target.value)}
                    placeholder={reference !== null ? `${reference} (illustrative)` : 'required'}
                    className="mt-1 block w-full px-2.5 py-1.5 rounded-lg border border-slate-300"
                  />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-600">Harvested area (ha)</span>
                  <input type="number" step="any" min="0" max={plot.area_hectares} value={harvestedArea} onChange={(e) => setHarvestedArea(e.target.value)} className="mt-1 block w-full px-2.5 py-1.5 rounded-lg border border-slate-300" />
                </label>
                <button type="button" onClick={runScenario} className="px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                  Calculate scenario
                </button>
              </div>
              {yieldError && <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{yieldError}</p>}
              {yieldRecord && (
                <div className="border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                  <div className="text-2xl font-bold text-slate-900">
                    {yieldRecord.estimated_total_tonnes} t <span className="text-sm font-normal text-slate-500">of {cropLabel(yieldRecord.crop_type)} (scenario)</span>
                  </div>
                  <div className="text-slate-600">
                    {yieldRecord.expected_yield_tonnes_per_ha} t/ha × {yieldRecord.harvested_area_hectares} ha
                    {yieldRecord.measured_peak_ndvi ? ` · measured season peak NDVI ${yieldRecord.measured_peak_ndvi.value} (${yieldRecord.measured_peak_ndvi.date}, context only)` : ''}
                  </div>
                  <ul className="list-disc pl-5 text-slate-600">
                    {yieldRecord.assumptions.map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}

          {/* ---------------------------------------------------------------- */}
          {activeTab === 'disaster' && (
            <>
              <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 flex gap-2">
                <Info className="w-4 h-4 shrink-0" />
                Compares the clearest Sentinel-2 pass before the event with the clearest pass after it, pixel by pixel over the plot. A pixel counts as
                changed when its NDVI fell by at least the threshold. Screening only: harvest and ploughing also lower NDVI; not damage certification.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <label className="block">
                  <span className="font-semibold text-slate-600">Event type</span>
                  <select value={eventType} onChange={(e) => setEventType(e.target.value as DisasterAssessmentRecord['event_type'])} className="mt-1 block w-full px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white">
                    <option value="HEAVY_RAINFALL_FLOOD">Heavy rainfall / flood</option>
                    <option value="DROUGHT_STRESS">Drought stress</option>
                    <option value="HAILSTORM_DAMAGE">Hailstorm</option>
                    <option value="PEST_DETERIORATION">Pest outbreak</option>
                  </select>
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-600">Event date</span>
                  <input type="date" value={eventDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setEventDate(e.target.value)} className="mt-1 block w-full px-2.5 py-1.5 rounded-lg border border-slate-300" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-600">Event name (optional)</span>
                  <input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. 14 Oct cloudburst" className="mt-1 block w-full px-2.5 py-1.5 rounded-lg border border-slate-300" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-600">Search window: {windowDays} days each side</span>
                  <input type="range" min={10} max={60} step={5} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} className="mt-2 block w-full accent-emerald-600" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-600">Change threshold: NDVI drop ≥ {threshold.toFixed(2)}</span>
                  <input type="range" min={0.05} max={0.4} step={0.01} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} className="mt-2 block w-full accent-emerald-600" />
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={runDisaster}
                    disabled={!eventDate || busy}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold disabled:opacity-60"
                  >
                    {disasterStatus ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudLightning className="w-4 h-4" />}
                    Run change detection
                  </button>
                </div>
              </div>
              {disasterStatus && <p className="text-xs text-slate-600" aria-live="polite">{disasterStatus}</p>}
              {disasterError && <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5">{disasterError}</p>}

              {disasters.length === 0 ? (
                <p className="text-center py-6 text-slate-500 text-xs">No screening has been run for this plot.</p>
              ) : (
                disasters.map((dis) => (
                  <div key={dis.id} className="border border-slate-200 rounded-xl p-4 space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-bold text-slate-900">{dis.event_name}</span>
                      <span className="px-2 py-0.5 rounded-full border text-[10px] font-bold bg-slate-50">
                        {dis.inspection_priority} priority · preliminary screening
                      </span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] text-slate-400">Before ({dis.pre_event_date})</div>
                        <div className="font-bold font-mono">NDVI {dis.pre_event_ndvi}</div>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] text-slate-400">After ({dis.post_event_date})</div>
                        <div className="font-bold font-mono">NDVI {dis.post_event_ndvi}</div>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] text-slate-400">Pixels with NDVI drop ≥ {dis.change_threshold}</div>
                        <div className="font-bold">{dis.affected_percentage}% · {dis.affected_area_hectares} ha</div>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] text-slate-400">Plot compared (clear both dates)</div>
                        <div className="font-bold">{dis.compared_pct_of_plot}%</div>
                      </div>
                    </div>
                    <p className="text-slate-600">{dis.surveyor_notes}</p>
                    <p className="text-[10px] text-slate-400 font-mono">
                      {dis.pre_scene_id} → {dis.post_scene_id}
                    </p>
                  </div>
                ))
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => reportService.generateComprehensivePlotPdf(plot.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold"
            >
              <FileText className="w-3.5 h-3.5" /> Plot PDF dossier
            </button>
            <button
              onClick={() => reportService.exportPlotDataCsv(plot.id)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold"
            >
              <Download className="w-3.5 h-3.5" /> CSV
            </button>
          </div>
          <button onClick={onClose} className="px-4 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100">
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// Mount the content only while open so its hooks always run in the same order.
export const CropIntelligenceModal: React.FC<CropIntelligenceModalProps> = (props) =>
  props.isOpen ? <CropIntelligenceModalContent {...props} /> : null;
