/**
 * AgriSurvey AI — Latest clear Sentinel-2 view of an area
 *
 * Finds the newest Sentinel-2 L2A pass whose pixels over the area are actually clear
 * (checked with the SCL mask, not just the tile-level cloud figure) and shows it at
 * 10 m in natural colour, infrared or NDVI, with its acquisition date.
 */

import React, { useEffect, useState } from 'react';
import { Loader2, Satellite } from 'lucide-react';
import { SatelliteScene } from '@/types';
import { stacSatelliteService } from '@/services/stac.service';
import { ClipImageMode, SceneClip, SurveyArea, loadAreaClip, surveyAreaCenter } from '@/lib/sentinel-cog';
import { SceneClipImage } from './SceneClipImage';

const DAY_MS = 24 * 3600 * 1000;
const MIN_CLEAR_PCT = 70;
const iso = (d: Date) => d.toISOString().slice(0, 10);

type State =
  | { status: 'loading'; key: string }
  | { status: 'ready'; key: string; scene: SatelliteScene; clip: SceneClip; checked: number }
  | { status: 'none'; key: string; message: string };

export const LatestSentinelPanel: React.FC<{ area: SurveyArea; lookbackDays?: number }> = ({ area, lookbackDays = 120 }) => {
  const [state, setState] = useState<State | null>(null);
  const [mode, setMode] = useState<ClipImageMode>('visual');
  const key = JSON.stringify(area);

  // Keyed on the area's contents: callers often pass a new (but equal) object each render
  useEffect(() => {
    const controller = new AbortController();
    const area = JSON.parse(key) as SurveyArea;
    const c = surveyAreaCenter(area);
    (async () => {
      try {
        const result = await stacSatelliteService.searchScenes({
          latitude: c.lat,
          longitude: c.lon,
          radiusKm: 0.2,
          startDate: iso(new Date(Date.now() - lookbackDays * DAY_MS)),
          endDate: iso(new Date()),
          maxCloudCover: 60,
          limit: 10,
        });
        let checked = 0;
        let best: { scene: SatelliteScene; clip: SceneClip } | null = null;
        // Newest first; stop at the first pass that is clear over this area
        for (const scene of result.scenes.slice(0, 6)) {
          if (controller.signal.aborted) return;
          checked++;
          const clip = await loadAreaClip(scene, area, { marginM: 300, maxOutputDim: 720, signal: controller.signal }).catch(() => null);
          if (!clip) continue;
          if (!best || clip.stats.validCoveragePct > best.clip.stats.validCoveragePct) best = { scene, clip };
          if (clip.stats.validCoveragePct >= MIN_CLEAR_PCT) break;
        }
        if (controller.signal.aborted) return;
        if (best) setState({ status: 'ready', key, ...best, checked });
        else
          setState({
            status: 'none',
            key,
            message: result.scenes.length
              ? 'Sentinel-2 passes were found but their image files could not be read.'
              : `No Sentinel-2 pass with less than 60% tile cloud in the last ${lookbackDays} days.`,
          });
      } catch (err) {
        if (!controller.signal.aborted)
          setState({ status: 'none', key, message: `Satellite catalogue unavailable (${err instanceof Error ? err.message : String(err)}).` });
      }
    })();
    return () => controller.abort();
  }, [key, lookbackDays]);

  const current = state && state.key === key ? state : ({ status: 'loading', key } as State);

  return (
    <div className="bg-slate-900 text-white rounded-xl p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
          <Satellite className="w-4 h-4" /> Latest clear Sentinel-2 pass (10 m)
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
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`px-1.5 py-0.5 rounded font-semibold ${mode === m ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {current.status === 'loading' && (
        <div className="aspect-square rounded-lg border border-slate-700 flex flex-col items-center justify-center gap-2 text-[11px] text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin text-emerald-400" />
          Finding the newest clear satellite pass…
        </div>
      )}
      {current.status === 'none' && (
        <div className="aspect-square rounded-lg border border-slate-700 flex items-center justify-center text-[11px] text-slate-400 p-4 text-center">
          {current.message}
        </div>
      )}
      {current.status === 'ready' && (
        <>
          <SceneClipImage
            clip={current.clip}
            mode={mode}
            alt={`Sentinel-2 ${mode} acquired ${current.scene.acquisition_datetime.slice(0, 10)}`}
            className="aspect-square rounded-lg overflow-hidden"
          />
          <div className="text-[11px] text-slate-300 space-y-0.5">
            <div>
              Acquired <strong className="text-white">{current.scene.acquisition_datetime.slice(0, 16).replace('T', ' ')} UTC</strong> (
              {Math.floor((Date.now() - new Date(current.scene.acquisition_datetime).getTime()) / DAY_MS)} days ago) ·{' '}
              {current.clip.stats.validCoveragePct.toFixed(0)}% of the plot clear
              {current.clip.stats.ndviMean !== null ? ` · mean NDVI ${current.clip.stats.ndviMean.toFixed(2)}` : ''}
            </div>
            <div className="font-mono text-slate-400 truncate">{current.scene.scene_id}</div>
            {current.clip.stats.validCoveragePct < MIN_CLEAR_PCT && (
              <div className="text-amber-300">No fully clear pass recently; this is the clearest of {current.checked} checked.</div>
            )}
          </div>
        </>
      )}
      <p className="text-[10px] text-slate-500">
        Real Copernicus Sentinel-2 L2A imagery; a new pass every ~5 days. Yellow outline = plot. 10 m pixels show the field, not
        individual plants.
      </p>
    </div>
  );
};
