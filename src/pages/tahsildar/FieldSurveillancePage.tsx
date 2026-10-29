/**
 * AgriSurvey AI — Field Surveillance
 *
 * One page per field: define the field (registered plot, point + radius, or a boundary
 * drawn on the map), then follow its growth through every 15-day period of the season
 * using real Sentinel-2 10 m imagery: per-period images, NDVI / EVI / NDMI series,
 * growth stage, alerts, a seasonal crop-pattern indicator and a downloadable report.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Satellite,
  MapPin,
  PenLine,
  Sprout,
  Play,
  Trash2,
  Loader2,
  AlertTriangle,
  Info,
  FileDown,
  FileSpreadsheet,
  Calendar,
  TrendingUp,
  TrendingDown,
  Minus,
  Undo2,
  CheckCircle2,
  CloudOff,
} from 'lucide-react';
import { MapContainer, TileLayer, Polygon, ImageOverlay, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, ResponsiveContainer, ReferenceLine } from 'recharts';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { mockDb } from '@/services/mock-db';
import {
  SurveillanceField,
  PeriodResult,
  RunProgress,
  GrowthAnalysis,
  analyseGrowth,
  buildPeriods,
  deleteField,
  describeArea,
  effectiveEndDate,
  exportCsv,
  fieldOutline,
  fieldAreaHectares,
  generatePdfReport,
  listSavedFields,
  periodStatusLabel,
  runSurveillance,
  saveField,
} from '@/services/field-surveillance.service';
import { ClipImageMode, NDVI_CLASSES, NDVI_MASKED_COLOR, SurveyArea, clipUrl } from '@/lib/sentinel-cog';
import { SceneClipImage } from '@/components/satellite/SceneClipImage';

type AreaMode = 'plot' | 'point' | 'draw';
type ImageMode = ClipImageMode;

const DAY_MS = 24 * 3600 * 1000;
const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const rgb = (c: [number, number, number]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
const fmt = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '—' : v.toFixed(d));
const shortDate = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString(undefined, { day: '2-digit', month: 'short', timeZone: 'UTC' });

const FitToArea: React.FC<{ outline: [number, number][] | null }> = ({ outline }) => {
  const map = useMap();
  const key = outline ? outline.map((p) => p.join(',')).join(';') : '';
  useEffect(() => {
    if (outline && outline.length > 1) map.fitBounds(outline, { padding: [30, 30], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
};

const DrawClicks: React.FC<{ enabled: boolean; onAdd: (p: [number, number]) => void }> = ({ enabled, onAdd }) => {
  useMapEvents({
    click(e) {
      if (enabled) onAdd([Number(e.latlng.lat.toFixed(6)), Number(e.latlng.lng.toFixed(6))]);
    },
  });
  return null;
};

const STAGE_STYLE: Record<string, string> = {
  'Bare soil / pre-sowing': 'bg-amber-100 text-amber-900 border-amber-300',
  'Sparse / mixed cover': 'bg-stone-100 text-stone-800 border-stone-300',
  'Emergence / establishment': 'bg-lime-100 text-lime-900 border-lime-300',
  'Vegetative growth': 'bg-green-100 text-green-900 border-green-300',
  'Peak canopy (flowering / reproductive)': 'bg-emerald-200 text-emerald-950 border-emerald-400',
  'Stable canopy': 'bg-emerald-100 text-emerald-900 border-emerald-300',
  'Maturity / senescence': 'bg-yellow-100 text-yellow-900 border-yellow-300',
  'Harvested / bare': 'bg-orange-100 text-orange-900 border-orange-300',
  'Insufficient data': 'bg-slate-100 text-slate-600 border-slate-300',
};

export const FieldSurveillancePage: React.FC = () => {
  const [searchParams] = useSearchParams();
  const plots = mockDb.farmPlots;

  // ---------------- Field setup ----------------
  const qLat = searchParams.get('lat');
  const qLon = searchParams.get('lon');
  const [mode, setMode] = useState<AreaMode>(qLat && qLon ? 'point' : plots.length ? 'plot' : 'point');
  const [name, setName] = useState('');
  const [plotId, setPlotId] = useState(plots[0]?.id ?? '');
  const [lat, setLat] = useState(qLat ?? '18.4633');
  const [lon, setLon] = useState(qLon ?? '74.5804');
  const [radiusM, setRadiusM] = useState(() => {
    const r = parseFloat(searchParams.get('r') ?? '');
    return Number.isFinite(r) && r > 0 ? Math.min(1000, Math.round(r * 1000)) : 100;
  });
  const [drawPoints, setDrawPoints] = useState<[number, number][]>([]);
  const [startDate, setStartDate] = useState(() => isoDate(new Date(Date.now() - 180 * DAY_MS)));
  const [endDate, setEndDate] = useState('');
  const [declaredCrop, setDeclaredCrop] = useState(() => (qLat && qLon ? '' : plots[0]?.crop_type ?? ''));
  const [formError, setFormError] = useState<string | null>(null);

  const selectedPlot = plots.find((p) => p.id === plotId);

  const draftArea: SurveyArea | null = useMemo(() => {
    if (mode === 'plot') {
      return selectedPlot && selectedPlot.boundary_coordinates.length >= 3
        ? { kind: 'polygon', coordinates: selectedPlot.boundary_coordinates }
        : null;
    }
    if (mode === 'draw') return drawPoints.length >= 3 ? { kind: 'polygon', coordinates: drawPoints } : null;
    const la = parseFloat(lat);
    const lo = parseFloat(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return null;
    return { kind: 'circle', center: { lat: la, lon: lo }, radiusKm: radiusM / 1000 };
  }, [mode, selectedPlot, drawPoints, lat, lon, radiusM]);

  // ---------------- Saved fields & active run ----------------
  const [savedFields, setSavedFields] = useState<SurveillanceField[]>(() => listSavedFields());
  const [activeField, setActiveField] = useState<SurveillanceField | null>(null);
  const [results, setResults] = useState<(PeriodResult | undefined)[]>([]);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [imageMode, setImageMode] = useState<ImageMode>('visual');
  const [overlayOpacity, setOverlayOpacity] = useState(0.8);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const startRun = async (field: SurveillanceField) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const periods = buildPeriods(field.startDate, effectiveEndDate(field), field.intervalDays);
    setActiveField(field);
    setResults(new Array(periods.length).fill(undefined));
    setSelectedIndex(null);
    setRunError(null);
    setProgress({ stage: 'searching', completedPeriods: 0, totalPeriods: periods.length });
    try {
      await runSurveillance(
        field,
        {
          onProgress: (p) => !controller.signal.aborted && setProgress(p),
          onPeriod: (r) => {
            if (controller.signal.aborted) return;
            setResults((prev) => {
              const next = [...prev];
              next[r.period.index] = r;
              return next;
            });
          },
        },
        controller.signal
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      const message = err instanceof Error ? err.message : String(err);
      setRunError(
        /fetch|network/i.test(message)
          ? 'The Sentinel-2 catalogue or image files could not be reached. Check the internet connection and try again.'
          : message
      );
      setProgress(null);
    }
  };

  const handleRun = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!draftArea) {
      setFormError(
        mode === 'draw'
          ? 'Click at least three corners of the field on the map.'
          : mode === 'plot'
          ? 'Select a registered plot with a boundary.'
          : 'Enter a valid latitude and longitude.'
      );
      return;
    }
    if (endDate && endDate < startDate) {
      setFormError('The end date must be after the start date.');
      return;
    }
    if (buildPeriods(startDate, endDate || isoDate(new Date()), 15).length > 30) {
      setFormError('Please choose a season of at most about 15 months (30 periods).');
      return;
    }
    const field: SurveillanceField = {
      id: `fld-${Date.now()}`,
      name:
        name.trim() ||
        (mode === 'plot' && selectedPlot ? `${selectedPlot.plot_name} (${selectedPlot.plot_reference})` : `Field at ${describeArea(draftArea)}`),
      area: draftArea,
      startDate,
      endDate,
      intervalDays: 15,
      declaredCrop: declaredCrop.trim() || undefined,
      plotId: mode === 'plot' ? selectedPlot?.id : undefined,
      village: mode === 'plot' && selectedPlot ? `${selectedPlot.village}, ${selectedPlot.taluk}` : undefined,
      createdAt: new Date().toISOString(),
    };
    saveField(field);
    setSavedFields(listSavedFields());
    startRun(field);
  };

  const handleDeleteSaved = (id: string) => {
    deleteField(id);
    setSavedFields(listSavedFields());
    if (activeField?.id === id) {
      abortRef.current?.abort();
      setActiveField(null);
      setResults([]);
      setProgress(null);
    }
  };

  // ---------------- Derived analysis ----------------
  const loadedResults = results.filter(Boolean) as PeriodResult[];
  const analysis: GrowthAnalysis | null = useMemo(
    () => (activeField && results.length ? analyseGrowth(results as PeriodResult[], activeField) : null),
    [results, activeField]
  );
  const isRunning = !!progress && progress.stage !== 'done';

  const effectiveSelected =
    selectedIndex ?? analysis?.latest?.periodIndex ?? (loadedResults.find((r) => r.clip)?.period.index ?? null);
  const selected = effectiveSelected !== null ? results[effectiveSelected] : undefined;
  const previousClear = useMemo(() => {
    if (effectiveSelected === null || !analysis) return undefined;
    for (let i = effectiveSelected - 1; i >= 0; i--) {
      if (analysis.perPeriod[i]?.ndvi !== null && analysis.perPeriod[i] && results[i]?.clip) return results[i];
    }
    return undefined;
  }, [effectiveSelected, analysis, results]);

  const chartData = useMemo(
    () =>
      results.map((r, i) => {
        const g = analysis?.perPeriod[i];
        return {
          label: r ? shortDate(r.period.start) : `P${i + 1}`,
          NDVI: g?.ndvi ?? null,
          EVI: g?.evi ?? null,
          NDMI: g?.ndmi ?? null,
        };
      }),
    [results, analysis]
  );

  const mapOutline = activeField ? fieldOutline(activeField.area) : draftArea ? fieldOutline(draftArea) : null;
  const overlayClip = selected?.clip;

  const downloadPdf = () => {
    if (!activeField || !analysis) return;
    generatePdfReport(activeField, results as PeriodResult[], analysis).save(
      `field-surveillance_${activeField.name.replace(/[^a-z0-9]+/gi, '_').slice(0, 40)}_${isoDate(new Date())}.pdf`
    );
  };
  const downloadCsv = () => {
    if (!activeField || !analysis) return;
    const blob = new Blob([exportCsv(activeField, results as PeriodResult[], analysis)], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `field-surveillance_${isoDate(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const TrendIcon = analysis?.trend === 'rising' ? TrendingUp : analysis?.trend === 'falling' ? TrendingDown : Minus;

  return (
    <DashboardLayout
      title="Field Surveillance"
      subtitle="15-day Sentinel-2 growth monitoring for a single field · real satellite observations with acquisition dates"
    >
      <div className="space-y-6">
        {/* ------------------------------------------------------------------ */}
        {/* Setup + map                                                         */}
        {/* ------------------------------------------------------------------ */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <form onSubmit={handleRun} className="xl:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
            <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Satellite className="w-4 h-4 text-emerald-600" />
              Field to monitor
            </h2>

            <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg text-xs" role="tablist" aria-label="How to define the field">
              {(
                [
                  ['plot', 'Registered plot', Sprout],
                  ['point', 'Point + radius', MapPin],
                  ['draw', 'Draw boundary', PenLine],
                ] as [AreaMode, string, typeof Sprout][]
              ).map(([m, label, Icon]) => (
                <button
                  key={m}
                  type="button"
                  role="tab"
                  aria-selected={mode === m}
                  onClick={() => setMode(m)}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-md font-semibold transition-colors ${
                    mode === m ? 'bg-white text-emerald-800 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                </button>
              ))}
            </div>

            {mode === 'plot' && (
              <label className="block text-xs">
                <span className="font-semibold text-slate-600">Plot</span>
                <select
                  value={plotId}
                  onChange={(e) => {
                    setPlotId(e.target.value);
                    setDeclaredCrop(plots.find((p) => p.id === e.target.value)?.crop_type ?? '');
                  }}
                  className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-800"
                >
                  {plots.length === 0 && <option value="">No registered plots</option>}
                  {plots.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.plot_name} · {p.plot_reference} · {p.village} ({p.area_hectares.toFixed(2)} ha)
                    </option>
                  ))}
                </select>
              </label>
            )}

            {mode === 'point' && (
              <div className="grid grid-cols-3 gap-3 text-xs">
                <label className="block">
                  <span className="font-semibold text-slate-600">Latitude</span>
                  <input type="number" step="any" value={lat} onChange={(e) => setLat(e.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-600">Longitude</span>
                  <input type="number" step="any" value={lon} onChange={(e) => setLon(e.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300 font-mono" />
                </label>
                <label className="block">
                  <span className="font-semibold text-slate-600">Radius: {radiusM} m</span>
                  <input type="range" min={20} max={1000} step={10} value={radiusM} onChange={(e) => setRadiusM(parseInt(e.target.value, 10))} className="mt-2.5 w-full accent-emerald-600" />
                </label>
              </div>
            )}

            {mode === 'draw' && (
              <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
                <span>
                  Click the field corners on the map ({drawPoints.length} point{drawPoints.length === 1 ? '' : 's'}
                  {drawPoints.length >= 3 ? `, ${fieldAreaHectares({ kind: 'polygon', coordinates: drawPoints }).toFixed(2)} ha` : ''}).
                </span>
                <span className="flex gap-1.5 shrink-0">
                  <button type="button" onClick={() => setDrawPoints((p) => p.slice(0, -1))} disabled={!drawPoints.length} className="px-2 py-1 rounded border border-slate-300 bg-white disabled:opacity-50 inline-flex items-center gap-1">
                    <Undo2 className="w-3 h-3" /> Undo
                  </button>
                  <button type="button" onClick={() => setDrawPoints([])} disabled={!drawPoints.length} className="px-2 py-1 rounded border border-slate-300 bg-white disabled:opacity-50">
                    Clear
                  </button>
                </span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3 text-xs">
              <label className="block col-span-2">
                <span className="font-semibold text-slate-600">Field name (optional)</span>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Survey 112/3, Patas" className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300" />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-600">Season start</span>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300" />
              </label>
              <label className="block">
                <span className="font-semibold text-slate-600">Season end (blank = today)</span>
                <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300" />
              </label>
              <label className="block col-span-2">
                <span className="font-semibold text-slate-600">Declared crop (optional, compared with the observed pattern)</span>
                <input list="crop-options" value={declaredCrop} onChange={(e) => setDeclaredCrop(e.target.value)} placeholder="e.g. Soybean" className="mt-1 w-full px-2.5 py-1.5 rounded-lg border border-slate-300" />
                <datalist id="crop-options">
                  {['Sugarcane', 'Soybean', 'Cotton', 'Paddy', 'Maize', 'Tur', 'Wheat', 'Gram', 'Jowar', 'Onion', 'Grapes', 'Banana'].map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
            </div>

            {formError && (
              <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 flex gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" /> {formError}
              </p>
            )}

            <div className="flex items-center justify-between gap-3 pt-1">
              <span className="text-[11px] text-slate-500">
                {draftArea
                  ? `${fieldAreaHectares(draftArea).toFixed(2)} ha · ${buildPeriods(startDate, endDate || isoDate(new Date()), 15).length} periods of 15 days`
                  : 'Define the field to continue'}
              </span>
              <button type="submit" disabled={isRunning} className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-md disabled:opacity-60">
                {isRunning ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Save &amp; analyse field
              </button>
            </div>

            {savedFields.length > 0 && (
              <div className="pt-3 border-t border-slate-100">
                <h3 className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">Saved fields</h3>
                <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                  {savedFields.map((f) => (
                    <li key={f.id} className={`flex items-center gap-2 text-xs rounded-lg border px-2.5 py-1.5 ${activeField?.id === f.id ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200'}`}>
                      <button type="button" onClick={() => startRun(f)} className="flex-1 text-left truncate hover:text-emerald-700" title="Open and refresh">
                        <span className="font-semibold">{f.name}</span>
                        <span className="text-slate-500"> · from {f.startDate}{f.declaredCrop ? ` · ${f.declaredCrop}` : ''}</span>
                      </button>
                      <button type="button" onClick={() => handleDeleteSaved(f.id)} className="p-1 text-slate-400 hover:text-red-600" aria-label={`Delete ${f.name}`}>
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </form>

          <div className="xl:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-xs p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs font-bold text-slate-800">
                {mode === 'draw' && !activeField ? 'Click on the map to outline the field' : 'Field location'}
              </span>
              {overlayClip && (
                <label className="flex items-center gap-1.5 text-[11px] text-slate-500">
                  Sentinel-2 overlay ({selected?.scene?.acquisition_datetime.slice(0, 10)})
                  <input type="range" min={0} max={1} step={0.05} value={overlayOpacity} onChange={(e) => setOverlayOpacity(parseFloat(e.target.value))} className="w-24 accent-emerald-600" aria-label="Overlay opacity" />
                </label>
              )}
            </div>
            <div className="h-[420px] rounded-xl overflow-hidden border border-slate-200 isolate">
              <MapContainer center={[18.4633, 74.5804]} zoom={14} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
                <TileLayer
                  attribution='Basemap &copy; <a href="https://www.esri.com/">Esri World Imagery</a> (undated reference)'
                  url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                  maxZoom={19}
                />
                <FitToArea outline={mapOutline} />
                <DrawClicks enabled={mode === 'draw'} onAdd={(p) => setDrawPoints((prev) => [...prev, p])} />
                {overlayClip && (
                  <ImageOverlay
                    url={clipUrl(overlayClip, imageMode)}
                    bounds={[[overlayClip.bounds.minLat, overlayClip.bounds.minLon], [overlayClip.bounds.maxLat, overlayClip.bounds.maxLon]]}
                    opacity={overlayOpacity}
                  />
                )}
                {mapOutline && <Polygon positions={mapOutline} pathOptions={{ color: '#facc15', weight: 2, fill: false }} />}
                {mode === 'draw' && !activeField &&
                  drawPoints.map((p, i) => <CircleMarker key={i} center={p} radius={4} pathOptions={{ color: '#facc15', fillOpacity: 1 }} />)}
              </MapContainer>
            </div>
            <p className="text-[10px] text-slate-500 px-1">
              The sharp basemap is an undated visual reference for locating the field. All analysis uses dated Sentinel-2 passes (10 m), shown as the overlay.
            </p>
          </div>
        </div>

        {/* What satellite imagery can and cannot show */}
        <div className="text-xs text-sky-900 bg-sky-50 border border-sky-200 rounded-xl p-3 flex gap-2">
          <Info className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            Free satellite imagery (Sentinel-2) shows 10 m × 10 m per pixel: it measures crop canopy greenness, growth and moisture every few
            days, but it cannot show individual plants or let you recognise a crop species by eye. The crop type below is inferred from the
            season's growth pattern and must be confirmed with a field survey or drone imagery.
          </span>
        </div>

        {runError && (
          <div role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-xl p-3 flex gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" /> {runError}
          </div>
        )}

        {!activeField && !runError && (
          <div className="text-center text-sm text-slate-500 bg-white rounded-2xl border border-dashed border-slate-300 p-10">
            Define a field and press <strong>Save &amp; analyse field</strong> to build its 15-day growth record.
          </div>
        )}

        {activeField && analysis && (
          <>
            {/* -------------------------------------------------------------- */}
            {/* Progress                                                        */}
            {/* -------------------------------------------------------------- */}
            {isRunning && progress && (
              <div className="bg-white rounded-xl border border-slate-200 p-3 text-xs text-slate-600 space-y-2" aria-live="polite">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-600" />
                  {progress.stage === 'searching'
                    ? 'Finding every Sentinel-2 pass over this field…'
                    : `Reading 10 m imagery: ${progress.completedPeriods} of ${progress.totalPeriods} periods (${progress.passesFound} passes found)`}
                </div>
                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 transition-all" style={{ width: `${(progress.completedPeriods / Math.max(1, progress.totalPeriods)) * 100}%` }} />
                </div>
              </div>
            )}

            {/* -------------------------------------------------------------- */}
            {/* Current growth report                                           */}
            {/* -------------------------------------------------------------- */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-4">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900">{activeField.name}</h2>
                  <p className="text-xs text-slate-500">
                    {describeArea(activeField.area)} · {fieldAreaHectares(activeField.area).toFixed(2)} ha
                    {activeField.village ? ` · ${activeField.village}` : ''} · {activeField.startDate} to {effectiveEndDate(activeField)}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button type="button" onClick={downloadPdf} disabled={isRunning} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold disabled:opacity-50">
                    <FileDown className="w-3.5 h-3.5" /> PDF report
                  </button>
                  <button type="button" onClick={downloadCsv} disabled={isRunning} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold disabled:opacity-50">
                    <FileSpreadsheet className="w-3.5 h-3.5" /> CSV
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
                <div className="p-3 rounded-xl border border-slate-200 col-span-2">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Current growth stage</span>
                  <div className={`mt-1 inline-block px-2.5 py-1 rounded-lg border text-sm font-bold ${STAGE_STYLE[analysis.currentStage]}`}>{analysis.currentStage}</div>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {analysis.latest
                      ? `Latest clear view ${analysis.latest.acquired.slice(0, 10)} (${analysis.latest.daysSinceObservation} days ago)`
                      : isRunning
                      ? 'Waiting for imagery…'
                      : 'Unavailable — no clear observation'}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Crop greenness (NDVI)</span>
                  <div className="text-2xl font-bold font-mono text-emerald-900">{fmt(analysis.latest?.ndvi)}</div>
                  <span className="text-[11px] text-slate-500 inline-flex items-center gap-1">
                    <TrendIcon className="w-3.5 h-3.5" />
                    {analysis.latest?.deltaNdvi != null ? `${analysis.latest.deltaNdvi >= 0 ? '+' : ''}${analysis.latest.deltaNdvi.toFixed(2)} vs previous (${analysis.trend})` : 'No previous clear view'}
                  </span>
                </div>
                <div className="p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Canopy moisture (NDMI)</span>
                  <div className="text-2xl font-bold font-mono text-sky-900">{fmt(analysis.latest?.ndmi)}</div>
                  <span className="text-[11px] text-slate-500">Higher = more leaf water</span>
                </div>
                <div className="p-3 rounded-xl border border-slate-200">
                  <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Season peak</span>
                  <div className="text-2xl font-bold font-mono text-slate-900">{fmt(analysis.peak?.ndvi)}</div>
                  <span className="text-[11px] text-slate-500">
                    {analysis.peak ? `on ${analysis.peak.acquired}` : '—'} · {analysis.validObservations}/{results.length} clear periods
                  </span>
                </div>
              </div>

              <p className="text-sm text-slate-700">{analysis.summary}</p>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl bg-emerald-50/60 border border-emerald-200 space-y-1.5">
                  <h3 className="text-xs font-bold text-emerald-900 flex items-center gap-1.5">
                    <Sprout className="w-4 h-4" /> Crop type indicator (from the growth pattern)
                  </h3>
                  <p className="text-sm font-semibold text-slate-900">{analysis.cropPattern.pattern}</p>
                  <p className="text-xs text-slate-700">{analysis.cropPattern.typicalCrops}</p>
                  <p className="text-[11px] text-slate-600">{analysis.cropPattern.explanation}</p>
                  {analysis.cropPattern.declaredCropAgreement !== 'not_declared' && (
                    <p className="text-[11px] font-semibold">
                      Declared crop "{activeField.declaredCrop}":{' '}
                      {analysis.cropPattern.declaredCropAgreement === 'consistent' && <span className="text-emerald-800">✓ consistent with the observed pattern</span>}
                      {analysis.cropPattern.declaredCropAgreement === 'differs' && <span className="text-amber-800">⚠ differs — field verification needed</span>}
                      {analysis.cropPattern.declaredCropAgreement === 'undetermined' && <span className="text-slate-600">cannot be compared yet</span>}
                    </p>
                  )}
                  <p className="text-[10px] text-slate-500">Rule-based seasonal indicator, not a validated crop classifier.</p>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                  <h3 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600" /> Surveillance alerts ({analysis.alerts.length})
                  </h3>
                  {analysis.alerts.length === 0 && (
                    <p className="text-xs text-slate-600 flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" /> {isRunning ? 'Checking…' : 'No alerts for the observed periods.'}
                    </p>
                  )}
                  <ul className="space-y-1.5 max-h-48 overflow-y-auto">
                    {analysis.alerts.map((a, i) => (
                      <li key={i} className={`text-[11px] rounded-lg border p-2 ${a.severity === 'critical' ? 'bg-red-50 border-red-200 text-red-900' : a.severity === 'warning' ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-white border-slate-200 text-slate-700'}`}>
                        <strong className="uppercase text-[9px] tracking-wider mr-1">{a.severity}</strong>
                        <strong>{a.title}.</strong> {a.detail}
                        {a.periodIndex !== undefined && (
                          <button type="button" onClick={() => setSelectedIndex(a.periodIndex!)} className="ml-1 underline">View period</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* Growth chart                                                    */}
            {/* -------------------------------------------------------------- */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-1">Growth every 15 days</h3>
              <p className="text-[11px] text-slate-500 mb-3">Mean over clear pixels inside the field. Gaps are periods without a clear view (no values are filled in).</p>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData} margin={{ top: 5, right: 16, left: -10, bottom: 0 }} onClick={(e: any) => e?.activeTooltipIndex != null && setSelectedIndex(Number(e.activeTooltipIndex))}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                    <YAxis domain={[-0.2, 1]} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: any) => (typeof v === 'number' ? v.toFixed(3) : v)} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceLine y={0.25} stroke="#a16207" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="NDVI" stroke="#047857" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="EVI" stroke="#65a30d" strokeWidth={1.5} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                    <Line type="monotone" dataKey="NDMI" stroke="#0369a1" strokeWidth={1.5} strokeDasharray="5 3" dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-[10px] text-slate-500 mt-1">Dashed brown line: NDVI 0.25, below which the field is treated as bare soil.</p>
            </div>

            {/* -------------------------------------------------------------- */}
            {/* Selected period vs previous clear period                        */}
            {/* -------------------------------------------------------------- */}
            {selected && (
              <div className="bg-slate-900 text-white rounded-2xl p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold">
                    Period {selected.period.index + 1}: {selected.period.start} – {selected.period.end}
                  </h3>
                  <div className="flex items-center gap-1 bg-white/10 p-1 rounded-lg text-[11px]" role="group" aria-label="Band combination">
                    {(
                      [
                        ['visual', 'Natural colour'],
                        ['false_color', 'Infrared (vigour)'],
                        ['ndvi', 'NDVI greenness'],
                      ] as [ImageMode, string][]
                    ).map(([m, label]) => (
                      <button key={m} type="button" aria-pressed={imageMode === m} onClick={() => setImageMode(m)} className={`px-2 py-0.5 rounded font-semibold ${imageMode === m ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:text-white'}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {[
                    { title: 'Previous clear period', r: previousClear },
                    { title: 'Selected period', r: selected },
                  ].map(({ title, r }) => (
                    <div key={title} className="space-y-1.5">
                      <div className="text-[11px] text-slate-300 flex justify-between">
                        <span className="font-semibold">{title}</span>
                        {r?.scene && <span className="font-mono">Acquired {r.scene.acquisition_datetime.slice(0, 16).replace('T', ' ')} UTC</span>}
                      </div>
                      {r?.clip ? (
                        <SceneClipImage clip={r.clip} mode={imageMode} alt={`${title} ${imageMode}`} className="aspect-square rounded-xl overflow-hidden" />
                      ) : (
                        <div className="aspect-square rounded-xl border border-slate-700 flex items-center justify-center text-xs text-slate-400 p-6 text-center">
                          {r ? (r.status === 'no_pass' ? 'No satellite pass in this period.' : r.error || 'No usable image.') : 'No earlier clear period.'}
                        </div>
                      )}
                      {r?.clip && (
                        <div className="text-[11px] text-slate-300 grid grid-cols-4 gap-1 font-mono">
                          <span>NDVI {fmt(r.clip.stats.ndviMean)}</span>
                          <span>EVI {fmt(r.clip.stats.eviMean)}</span>
                          <span>NDMI {fmt(r.clip.stats.ndmiMean)}</span>
                          <span>Clear {r.clip.stats.validCoveragePct.toFixed(0)}%</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {imageMode === 'ndvi' && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-slate-300">
                    {NDVI_CLASSES.map((c) => (
                      <span key={c.label} className="flex items-center gap-1.5">
                        <span className="w-3 h-3 rounded-sm border border-white/20" style={{ background: rgb(c.color) }} />
                        {c.label}
                      </span>
                    ))}
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-sm border border-white/20" style={{ background: rgb(NDVI_MASKED_COLOR) }} />
                      Masked (cloud / shadow / no data)
                    </span>
                  </div>
                )}
                <p className="text-[10px] text-slate-400">
                  Yellow outline = field boundary; images include 250 m of surroundings. Sentinel-2 10 m bands, contrast-stretched for display.
                  {selected.status === 'partly_cloudy' && ' This period is partly cloudy over the field — read values with caution.'}
                </p>
              </div>
            )}

            {/* -------------------------------------------------------------- */}
            {/* 15-day timeline gallery                                         */}
            {/* -------------------------------------------------------------- */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5">
              <h3 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-emerald-600" /> 15-day image timeline
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-3">
                {results.map((r, i) => {
                  const g = analysis.perPeriod[i];
                  const isSel = effectiveSelected === i;
                  return (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setSelectedIndex(i)}
                      aria-pressed={isSel}
                      className={`text-left p-2 rounded-xl border transition-all ${isSel ? 'border-emerald-600 ring-2 ring-emerald-600/20 bg-emerald-50/50' : 'border-slate-200 hover:border-slate-300'}`}
                    >
                      {r?.clip ? (
                        <SceneClipImage clip={r.clip} mode={imageMode} alt={`Period ${i + 1}`} className="aspect-square rounded-lg overflow-hidden" />
                      ) : (
                        <div className="aspect-square rounded-lg bg-slate-100 flex flex-col items-center justify-center gap-1 text-[10px] text-slate-500 text-center p-2">
                          {!r ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudOff className="w-4 h-4" />}
                          {!r ? 'Loading…' : periodStatusLabel(r.status)}
                        </div>
                      )}
                      <div className="mt-1.5 text-[10px] font-bold text-slate-900">
                        P{i + 1} · {r ? `${shortDate(r.period.start)} – ${shortDate(r.period.end)}` : ''}
                      </div>
                      {r?.scene && <div className="text-[9px] text-slate-500 font-mono">Acq. {r.scene.acquisition_datetime.slice(0, 10)}</div>}
                      {r && (
                        <div className="text-[10px] text-slate-700 flex justify-between gap-1">
                          <span>{periodStatusLabel(r.status)}{r.clip ? ` · ${r.clip.stats.validCoveragePct.toFixed(0)}%` : ''}</span>
                          <span className="font-mono font-bold">{g?.ndvi !== null && g ? g.ndvi.toFixed(2) : '—'}</span>
                        </div>
                      )}
                      {g && g.ndvi !== null && <div className={`mt-1 text-[9px] px-1.5 py-0.5 rounded border inline-block ${STAGE_STYLE[g.stage]}`}>{g.stage}</div>}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-[10px] text-slate-500">
              Source: Copernicus Sentinel-2 L2A (Earth Search STAC, AWS Open Data). For each 15-day period the least-cloudy pass over the field is used
              (SCL cloud, shadow, cirrus and no-data masked). Growth stages and alerts use fixed, configurable thresholds and are not crop-specific calibrated
              models. A low index alone does not establish disease, nutrient deficiency or the cause of stress — verify in the field. Not an official
              damage certification.
            </p>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};
