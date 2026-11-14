import React, { useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Tooltip as MapTooltip, useMap } from 'react-leaflet';
import { ComposedChart, Line, Scatter, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer, ReferenceArea } from 'recharts';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Loader2,
  MapPin,
  Play,
  RotateCcw,
  Satellite,
  Square,
  Upload,
  X,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CROP_LABELS, SEASONS, SeasonName, seasonWindow } from '@/lib/crop-phenology';
import { AssessmentWindow, PointResult, SurveyPoint, applyYields, defaultWindows } from '@/lib/coordinate-survey';
import {
  LoadedSheet,
  buildFilledWorkbook,
  downloadBlob,
  loadSurveySheet,
  resultsGeoJson,
  runCoordinateSurvey,
} from '@/services/coordinate-survey.service';

const CROP_COLORS: Record<string, string> = {
  soybean: '#16a34a',
  cotton: '#f8fafc',
  tur: '#a16207',
  jowar: '#d97706',
  bajra: '#ca8a04',
  maize: '#eab308',
  rice: '#0ea5e9',
  sugarcane: '#7c3aed',
};

/** Main kharif crops of Akola district; preselected when the sheet is for Akola (editable). */
const AKOLA_KHARIF_CROPS = ['soybean', 'cotton', 'tur', 'jowar'];

type PointState = 'queued' | 'running' | 'done' | 'error';

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

const FitBounds: React.FC<{ points: SurveyPoint[] }> = ({ points }) => {
  const map = useMap();
  const key = points.map((p) => p.srNo).join(',');
  React.useEffect(() => {
    if (!points.length) return;
    const lats = points.map((p) => p.lat);
    const lons = points.map((p) => p.lon);
    map.fitBounds(
      [
        [Math.min(...lats), Math.min(...lons)],
        [Math.max(...lats), Math.max(...lons)],
      ],
      { padding: [24, 24], maxZoom: 15 }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
};

const confidenceBadge = (c?: string) =>
  c === 'moderate'
    ? 'bg-emerald-100 text-emerald-800'
    : c === 'low'
    ? 'bg-amber-100 text-amber-800'
    : 'bg-slate-100 text-slate-500';

export const CoordinateSurveyPanel: React.FC<{ onClose?: () => void }> = ({ onClose }) => {
  const [sheet, setSheet] = useState<LoadedSheet | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [year, setYear] = useState(2026);
  const season: SeasonName = 'kharif';
  const [windows, setWindows] = useState<AssessmentWindow[]>(defaultWindows(2026));
  const [radiusM, setRadiusM] = useState(20);
  const [crops, setCrops] = useState<string[]>(SEASONS.kharif.crops);
  const [running, setRunning] = useState(false);
  const [states, setStates] = useState<Record<number, PointState>>({});
  const [progress, setProgress] = useState<Record<number, { read: number; planned: number }>>({});
  const [results, setResults] = useState<Record<number, PointResult>>({});
  const [runError, setRunError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [timing, setTiming] = useState<{ start: number; last: number } | null>(null);

  const points = useMemo(() => sheet?.points ?? [], [sheet]);
  const ordered = useMemo(() => applyYields(points.map((p) => results[p.srNo]).filter(Boolean)), [points, results]);
  const byNo = useMemo(() => new Map(ordered.map((r) => [r.point.srNo, r])), [ordered]);
  const doneCount = Object.values(states).filter((s) => s === 'done' || s === 'error').length;
  const queuedCount = Object.values(states).filter((s) => s === 'queued' || s === 'running').length;
  const [doneSinceStart, setDoneSinceStart] = useState(0);
  const selectedResult = selected !== null ? byNo.get(selected) : undefined;

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setLoadError(null);
    setResults({});
    setStates({});
    setProgress({});
    setSelected(null);
    try {
      const loaded = await loadSurveySheet(file);
      if (!loaded.points.length) throw new Error(loaded.warnings.join(' ') || 'No coordinates found.');
      setSheet(loaded);
      if (/akola/i.test(`${loaded.layout.title ?? ''} ${loaded.fileName}`)) setCrops(AKOLA_KHARIF_CROPS);
      const yearInSheet = JSON.stringify(loaded.layout.headers).match(/20\d\d/)?.[0];
      if (yearInSheet) {
        setYear(Number(yearInSheet));
        setWindows(defaultWindows(Number(yearInSheet)));
      }
    } catch (e) {
      setSheet(null);
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  };

  const failedPoints = points.filter((p) => results[p.srNo]?.status === 'error');

  const run = async (onlyFailed = false) => {
    if (!sheet) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // Retry: the failed primaries plus their twins; everything else keeps its result.
    const failedNos = new Set(failedPoints.map((p) => p.sameAs ?? p.srNo));
    const target = onlyFailed ? sheet.points.filter((p) => failedNos.has(p.srNo) || (p.sameAs !== undefined && failedNos.has(p.sameAs))) : sheet.points;
    setRunning(true);
    setRunError(null);
    if (onlyFailed) {
      setResults((prev) => Object.fromEntries(Object.entries(prev).filter(([, r]) => r.status !== 'error')));
    } else {
      setResults({});
      setProgress({});
    }
    setStates((prev) => ({ ...(onlyFailed ? prev : {}), ...Object.fromEntries(target.map((p) => [p.srNo, 'queued' as PointState])) }));
    const t = Date.now();
    setTiming({ start: t, last: t });
    setDoneSinceStart(0);
    try {
      await runCoordinateSurvey(target, {
        season,
        year,
        windows,
        radiusM,
        crops,
        concurrency: 3,
        signal: ctrl.signal,
        onPointStart: (p) => setStates((s) => ({ ...s, [p.srNo]: 'running' })),
        onPointProgress: (sr, read, planned) => setProgress((pr) => ({ ...pr, [sr]: { read, planned } })),
        onPointDone: (r) => {
          setResults((prev) => ({ ...prev, [r.point.srNo]: r }));
          setTiming((tm) => (tm ? { ...tm, last: Date.now() } : tm));
          setDoneSinceStart((n) => n + 1);
          setStates((s) => ({ ...s, [r.point.srNo]: r.status === 'done' ? 'done' : 'error' }));
        },
      });
    } catch (e) {
      if (!ctrl.signal.aborted) setRunError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const exportExcel = async () => {
    if (!sheet || !ordered.length) return;
    setExporting(true);
    try {
      const blob = await buildFilledWorkbook({ sheet, results: ordered, windows, season, year, radiusM, crops });
      const base = sheet.fileName.replace(/\.(xlsx|csv)$/i, '');
      downloadBlob(blob, `${base}_AgriSurvey_filled.xlsx`);
    } catch (e) {
      setRunError(`Excel export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const etaMin = running && timing && doneSinceStart > 0 ? ((timing.last - timing.start) / 60000 / Math.max(1, doneSinceStart)) * queuedCount : null;
  const sw = seasonWindow(season, year);

  return (
    <Card className="p-4 bg-white border border-emerald-200 shadow-xs space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3">
        <div>
          <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
            Coordinate Crop Survey · Sentinel-2 L2A
          </span>
          <h3 className="text-sm font-extrabold text-slate-900 mt-1">
            Answer a district coordinate sheet: crop, crop situation per window, and estimated yield
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5 max-w-3xl">
            Upload the client's Excel or CSV of GPS points. Each point is read on every cloud-free Sentinel-2 pass of the {season} {year}{' '}
            season ({fmtDay(sw.start)} – {fmtDay(sw.end)}); the answers are written back into the same workbook with the raw data, index
            documentation, method notes and satellite image chips.
          </p>
        </div>
        {onClose && (
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100 text-slate-400" aria-label="Close coordinate survey">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Step 1: upload & settings */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 text-xs">
        <div className="lg:col-span-4 space-y-3">
          <label
            className="flex flex-col items-center justify-center gap-1.5 p-4 rounded-xl border-2 border-dashed border-emerald-300 bg-emerald-50/40 hover:bg-emerald-50 cursor-pointer text-center"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              onFile(e.dataTransfer.files?.[0]);
            }}
          >
            <Upload className="w-5 h-5 text-emerald-700" />
            <span className="font-bold text-emerald-900">{sheet ? sheet.fileName : 'Upload coordinate sheet (.xlsx / .csv)'}</span>
            <span className="text-[11px] text-slate-500">
              A "Coordinates" column with "lat,lon" per row, or separate Latitude / Longitude columns
            </span>
            <input
              type="file"
              accept=".xlsx,.csv"
              className="hidden"
              disabled={running}
              onChange={(e) => onFile(e.target.files?.[0] ?? undefined)}
            />
          </label>
          {loadError && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 flex gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> {loadError}
            </div>
          )}
          {sheet && (
            <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
              {sheet.layout.title && <div className="font-bold text-slate-800">{sheet.layout.title}</div>}
              <div className="text-slate-600">
                <strong>{sheet.points.length}</strong> points
                {sheet.points.some((p) => p.sameAs !== undefined) && (
                  <>
                    {' '}
                    · {sheet.points.filter((p) => p.sameAs !== undefined).length} repeat an earlier point within 10 m (
                    {sheet.points
                      .filter((p) => p.sameAs !== undefined)
                      .map((p) => `#${p.srNo}=#${p.sameAs}`)
                      .join(', ')}
                    ) and reuse its result
                  </>
                )}
              </div>
              {sheet.warnings.map((w) => (
                <div key={w} className="text-amber-800 flex gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {w}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="p-3 rounded-xl border border-slate-200 space-y-2">
            <div className="font-bold text-slate-700">Season & assessment windows</div>
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-24 whitespace-nowrap">Kharif year</span>
              <input
                type="number"
                min={2017}
                max={2030}
                value={year}
                disabled={running}
                onChange={(e) => {
                  const y = Number(e.target.value);
                  setYear(y);
                  setWindows(defaultWindows(y));
                }}
                className="px-2 py-1 rounded border border-slate-300 w-24"
              />
            </div>
            {windows.map((w, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-slate-500 w-24 whitespace-nowrap">Window {i + 1}</span>
                <input
                  type="date"
                  value={w.start}
                  disabled={running}
                  onChange={(e) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, start: e.target.value, label: `${fmtDay(e.target.value)} – ${fmtDay(x.end)} ${year}` } : x)))}
                  className="px-1.5 py-1 rounded border border-slate-300"
                />
                <span>to</span>
                <input
                  type="date"
                  value={w.end}
                  disabled={running}
                  onChange={(e) => setWindows((ws) => ws.map((x, j) => (j === i ? { ...x, end: e.target.value, label: `${fmtDay(x.start)} – ${fmtDay(e.target.value)} ${year}` } : x)))}
                  className="px-1.5 py-1 rounded border border-slate-300"
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <span className="text-slate-500 w-24 whitespace-nowrap">Sample area</span>
              <select value={radiusM} disabled={running} onChange={(e) => setRadiusM(Number(e.target.value))} className="px-2 py-1 rounded border border-slate-300 bg-white">
                <option value={10}>10 m radius (~3 pixels)</option>
                <option value={20}>20 m radius (~13 pixels)</option>
                <option value={30}>30 m radius (~28 pixels)</option>
              </select>
            </div>
          </div>

          <div className="p-3 rounded-xl border border-slate-200 space-y-2">
            <div className="font-bold text-slate-700">Crops grown in the district</div>
            <div className="flex flex-wrap gap-1.5">
              {SEASONS.kharif.crops.map((c) => {
                const on = crops.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    disabled={running}
                    onClick={() => setCrops((cs) => (on ? cs.filter((x) => x !== c) : [...cs, c]))}
                    className={`px-2 py-0.5 rounded-full border font-semibold ${on ? 'bg-emerald-700 text-white border-emerald-700' : 'bg-white text-slate-500 border-slate-300'}`}
                  >
                    {CROP_LABELS[c] ?? c}
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] text-slate-500">
              Untick crops that are not grown here. Soybean and maize have almost the same growth curve, so leaving maize in makes every
              soybean field come back as "probable". For Akola, soybean, cotton, tur and jowar cover most of the kharif area.
            </p>
          </div>
        </div>
      </div>


      {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              {!running ? (
                <Button size="sm" icon={<Play className="w-3.5 h-3.5" />} disabled={!sheet || crops.length === 0} onClick={() => run(false)}>
                  Run survey on {sheet?.points.length ?? 0} points
                </Button>
              ) : (
                <Button size="sm" variant="danger" icon={<Square className="w-3.5 h-3.5" />} onClick={() => abortRef.current?.abort()}>
                  Stop
                </Button>
              )}
              {!running && failedPoints.length > 0 && (
                <Button size="sm" variant="secondary" icon={<RotateCcw className="w-3.5 h-3.5" />} onClick={() => run(true)}>
                  Retry {failedPoints.length} failed point{failedPoints.length > 1 ? 's' : ''}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                icon={<FileSpreadsheet className="w-3.5 h-3.5 text-emerald-700" />}
                disabled={!ordered.length || running || exporting}
                isLoading={exporting}
                onClick={exportExcel}
              >
                Download filled Excel
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Download className="w-3.5 h-3.5" />}
                disabled={!ordered.length}
                onClick={() =>
                  downloadBlob(new Blob([resultsGeoJson(ordered)], { type: 'application/geo+json' }), `${sheet?.fileName.replace(/\.\w+$/, '') ?? 'survey'}_results.geojson`)
                }
              >
                GeoJSON
              </Button>
              <span className="text-[11px] text-slate-500">
                Reads about 20–30 Sentinel-2 passes per point straight from the public archive; allow roughly 15–25 minutes for 45 points and keep this tab open.
              </span>
            </div>

      {(running || doneCount > 0) && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[11px] text-slate-600">
            <span className="flex items-center gap-1.5">
              {running ? <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-700" /> : <CheckCircle2 className="w-3.5 h-3.5 text-emerald-700" />}
              {doneCount} / {points.length} points analysed
              {etaMin !== null && ` · about ${Math.max(1, Math.round(etaMin))} min left`}
            </span>
            {!running && doneCount < points.length && doneCount > 0 && <span className="text-amber-700">Stopped early — the export contains the analysed points only.</span>}
          </div>
          <div className="h-1.5 rounded bg-slate-100 overflow-hidden">
            <div className="h-full bg-emerald-600 transition-all" style={{ width: `${(doneCount / Math.max(points.length, 1)) * 100}%` }} />
          </div>
        </div>
      )}
      {runError && (
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {runError}
        </div>
      )}

      {sheet && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Map */}
          <div className="lg:col-span-4 rounded-xl overflow-hidden border border-slate-200 h-[420px]">
            <MapContainer center={[points[0]?.lat ?? 20.7, points[0]?.lon ?? 77]} zoom={10} style={{ height: '100%', width: '100%' }}>
              <TileLayer
                attribution='&copy; <a href="https://www.esri.com/">Esri World Imagery</a>'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
              <FitBounds points={points} />
              {points.map((p) => {
                const r = byNo.get(p.srNo);
                const st = states[p.srNo];
                const color = r?.crop?.crop ? CROP_COLORS[r.crop.crop] ?? '#22c55e' : st === 'error' ? '#e11d48' : st === 'running' ? '#38bdf8' : '#94a3b8';
                return (
                  <CircleMarker
                    key={p.srNo}
                    center={[p.lat, p.lon]}
                    radius={selected === p.srNo ? 9 : 6}
                    pathOptions={{ color: selected === p.srNo ? '#fde047' : '#0f172a', weight: 2, fillColor: color, fillOpacity: 0.95 }}
                    eventHandlers={{ click: () => setSelected(p.srNo) }}
                  >
                    <MapTooltip>
                      #{p.srNo} {r?.crop?.cell ?? (st ? st : 'not analysed')}
                    </MapTooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>

          {/* Results table */}
          <div className="lg:col-span-8 overflow-auto max-h-[420px] border border-slate-200 rounded-xl">
            <table className="w-full text-[11px] text-left">
              <thead className="sticky top-0 bg-slate-50 text-slate-500 uppercase text-[10px]">
                <tr>
                  <th className="py-1.5 px-2">Sr</th>
                  <th className="py-1.5 px-2">Crop</th>
                  <th className="py-1.5 px-2">{windows[0]?.label}</th>
                  <th className="py-1.5 px-2">{windows[1]?.label}</th>
                  <th className="py-1.5 px-2">Yield kg/ha</th>
                  <th className="py-1.5 px-2">Clear</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {points.map((p) => {
                  const r = byNo.get(p.srNo);
                  const st = states[p.srNo];
                  const pr = progress[p.sameAs ?? p.srNo];
                  return (
                    <tr
                      key={p.srNo}
                      onClick={() => setSelected(p.srNo)}
                      className={`cursor-pointer align-top ${selected === p.srNo ? 'bg-emerald-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="py-1.5 px-2 font-mono font-bold text-slate-700">
                        {p.srNo}
                        {p.sameAs !== undefined && <div className="text-[9px] text-slate-400 font-sans">=#{p.sameAs}</div>}
                      </td>
                      {!r ? (
                        <td colSpan={5} className="py-1.5 px-2 text-slate-400">
                          {p.lat.toFixed(5)}, {p.lon.toFixed(5)} —{' '}
                          {st === 'running' ? (
                            <span className="text-sky-700">
                              reading imagery{pr ? ` (${pr.read}/${pr.planned})` : '…'}
                            </span>
                          ) : (
                            st ?? 'not analysed'
                          )}
                        </td>
                      ) : r.status === 'error' ? (
                        <td colSpan={5} className="py-1.5 px-2 text-rose-700">
                          {r.error}
                        </td>
                      ) : (
                        <>
                          <td className="py-1.5 px-2">
                            <div className="font-semibold text-slate-800">{r.crop?.cell}</div>
                            <span className={`inline-block mt-0.5 px-1.5 rounded text-[9px] font-bold ${confidenceBadge(r.crop?.confidence)}`}>
                              {r.crop?.confidence === 'none' ? 'not determined' : `${r.crop?.confidence} confidence`}
                            </span>
                          </td>
                          {[0, 1].map((i) => (
                            <td key={i} className={`py-1.5 px-2 ${r.windows[i]?.basis === 'none' ? 'text-slate-400' : r.windows[i]?.basis === 'interpolated' ? 'text-amber-800' : 'text-slate-700'}`}>
                              {r.windows[i]?.cell}
                            </td>
                          ))}
                          <td className="py-1.5 px-2">
                            {r.yield?.estimate != null ? (
                              <>
                                <strong className="text-slate-800">{r.yield.estimate.toLocaleString('en-IN')}</strong>
                                <div className="text-[9px] text-slate-400">
                                  {r.yield.low}–{r.yield.high}
                                </div>
                              </>
                            ) : (
                              <span className="text-slate-400">—</span>
                            )}
                          </td>
                          <td className="py-1.5 px-2 text-slate-500">{r.observations.length}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedResult && selectedResult.status === 'done' && <PointDetail r={selectedResult} windows={windows} onClose={() => setSelected(null)} />}

      <p className="text-[10px] text-slate-400 italic">
        Indicative, not field-calibrated: crop templates and NDVI thresholds have not been fitted on surveyed parcels in this district, and
        yields are regional reference values ranked by seasonal NDVI. Confirm with ground photographs and officer verification before use.
        Contains modified Copernicus Sentinel data.
      </p>
    </Card>
  );
};

const PointDetail: React.FC<{ r: PointResult; windows: AssessmentWindow[]; onClose: () => void }> = ({ r, windows, onClose }) => {
  const DAY = 86400000;
  const t0 = r.crop ? new Date(`${r.crop.windowStart}T00:00:00Z`).getTime() : 0;
  const curve =
    r.crop?.curve?.map((v, i) => ({ t: t0 + r.crop!.grid[i] * DAY, curve: Number(v.toFixed(3)) })).filter((d) => !r.crop || d.t <= new Date(`${r.crop.windowEnd}T00:00:00Z`).getTime()) ?? [];
  const obs = r.observations.map((o) => ({ t: new Date(`${o.date}T00:00:00Z`).getTime(), ndvi: o.ndvi }));
  const data = [...curve, ...obs].sort((a, b) => a.t - b.t);
  const tick = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: 'UTC' });

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-3 text-xs bg-slate-50/50">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5 font-extrabold text-slate-900 text-sm">
            <MapPin className="w-4 h-4 text-emerald-700" /> Point #{r.point.srNo}
            <span className="font-mono font-normal text-slate-500 text-xs">
              {r.point.lat.toFixed(6)}, {r.point.lon.toFixed(6)}
            </span>
            {r.point.sameAs !== undefined && <span className="text-[10px] text-slate-500">(same location as #{r.point.sameAs})</span>}
          </div>
          <div className="text-slate-700 mt-1">
            <strong>{r.crop?.cell}</strong> — {r.crop?.message}
          </div>
          {r.crop && r.crop.scores.length > 0 && (
            <div className="text-[11px] text-slate-500 mt-0.5">
              Template fits: {r.crop.scores.slice(0, 4).map((s) => `${CROP_LABELS[s.crop] ?? s.crop} ${s.fit.toFixed(2)}`).join(' · ')}
            </div>
          )}
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-slate-200 text-slate-400" aria-label="Close point detail">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-3">
        <div className="lg:col-span-7 h-56 bg-white rounded-lg border border-slate-200 p-1">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: -16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tickFormatter={tick} tick={{ fontSize: 10 }} />
              <YAxis domain={[0, 1]} tick={{ fontSize: 10 }} />
              <Tooltip labelFormatter={(t) => tick(Number(t))} formatter={(v) => Number(v).toFixed(3)} />
              {windows.map((w) => (
                <ReferenceArea
                  key={w.start}
                  x1={new Date(`${w.start}T00:00:00Z`).getTime()}
                  x2={new Date(`${w.end}T00:00:00Z`).getTime()}
                  fill="#fde68a"
                  fillOpacity={0.45}
                  label={{ value: w.label.split(' ').slice(0, 2).join(' '), fontSize: 9, position: 'insideTop' }}
                />
              ))}
              <Line dataKey="curve" name="Smoothed NDVI" stroke="#15803d" dot={false} strokeWidth={2} connectNulls isAnimationActive={false} />
              <Scatter dataKey="ndvi" name="Clear pass NDVI" fill="#0f172a" isAnimationActive={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="lg:col-span-5 space-y-2">
          {r.windows.map((w) => (
            <div key={w.window.start} className="p-2 rounded-lg bg-white border border-slate-200">
              <div className="font-bold text-slate-700">{w.window.label}</div>
              <div className="text-slate-800">{w.situation}</div>
              <div className="text-[11px] text-slate-500">{w.detail}</div>
            </div>
          ))}
          <div className="p-2 rounded-lg bg-white border border-slate-200">
            <div className="font-bold text-slate-700">Estimated yield</div>
            {r.yield?.estimate != null ? (
              <div className="text-slate-800">
                <strong>{r.yield.estimate.toLocaleString('en-IN')} kg/ha</strong> (range {r.yield.low}–{r.yield.high}, {r.yield.confidence} confidence)
              </div>
            ) : null}
            <div className="text-[11px] text-slate-500">{r.yield?.basis}</div>
          </div>
        </div>
      </div>

      {r.images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {r.images.map((im) => (
            <div key={im.window} className="space-y-1">
              <div className="text-[10px] font-bold text-slate-500 flex items-center gap-1">
                <Satellite className="w-3 h-3" /> {im.window} · pass {fmtDay(im.date)}
              </div>
              <div className="flex gap-1.5">
                <img src={im.trueColor} alt={`True colour around point ${r.point.srNo}, ${im.date}`} className="w-32 h-32 rounded border border-slate-300 [image-rendering:pixelated]" />
                <img src={im.ndvi} alt={`NDVI around point ${r.point.srNo}, ${im.date}`} className="w-32 h-32 rounded border border-slate-300 [image-rendering:pixelated]" />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
