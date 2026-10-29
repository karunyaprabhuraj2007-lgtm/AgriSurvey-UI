/**
 * AgriSurvey AI — High-resolution field map
 *
 * Shows the sharpest real imagery available for a field, each with its true date:
 * - Sub-metre satellite captures from Esri World Imagery Wayback (date, provider, resolution
 *   read from Esri's metadata service for this exact location).
 * - Optional Sentinel-2 overlay (10 m, newest pass every ~5 days).
 * - Optional drone orthomosaic upload (cm-level, resolves individual plants).
 */

import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polygon, ImageOverlay, useMap } from 'react-leaflet';
import { Loader2, Maximize2, Minimize2, Plane, Satellite, Trash2, Upload } from 'lucide-react';
import { WaybackCapture, WaybackRelease, fetchWaybackReleases, findCaptures } from '@/lib/wayback';
import { Orthomosaic, loadOrthomosaic } from '@/lib/orthomosaic';
import { AoiBounds } from '@/lib/sentinel-cog';

const ESRI_LATEST = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const DAY_MS = 24 * 3600 * 1000;

const ageText = (iso: string) => {
  const days = Math.floor((Date.now() - new Date(`${iso}T00:00:00Z`).getTime()) / DAY_MS);
  if (days < 60) return `${days} days ago`;
  if (days < 730) return `${Math.round(days / 30.4)} months ago`;
  return `${(days / 365.25).toFixed(1)} years ago`;
};

const captureLabel = (c: WaybackCapture) =>
  [c.captureDate, c.provider || c.sensor, c.resolutionM ? `${c.resolutionM.toFixed(2)} m` : null].filter(Boolean).join(' · ');

const FitBounds: React.FC<{ outline?: [number, number][]; center: { lat: number; lon: number } }> = ({ outline, center }) => {
  const map = useMap();
  const key = outline?.length ? outline.map((p) => p.join(',')).join(';') : `${center.lat},${center.lon}`;
  useEffect(() => {
    if (outline && outline.length > 1) map.fitBounds(outline, { padding: [24, 24], maxZoom: 19 });
    else map.setView([center.lat, center.lon], 18);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
};

const InvalidateOnResize: React.FC<{ dep: unknown }> = ({ dep }) => {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 50);
    return () => clearTimeout(t);
  }, [dep, map]);
  return null;
};

export interface HighResFieldMapProps {
  center: { lat: number; lon: number };
  outline?: [number, number][];
  /** Tailwind height class for the map, e.g. "h-[420px]" */
  heightClass?: string;
  sentinelOverlay?: { url: string; bounds: AoiBounds; label: string };
  allowDroneUpload?: boolean;
  /** Extra react-leaflet layers / handlers (e.g. drawing) */
  children?: React.ReactNode;
}

export const HighResFieldMap: React.FC<HighResFieldMapProps> = ({
  center,
  outline,
  heightClass = 'h-[420px]',
  sentinelOverlay,
  allowDroneUpload,
  children,
}) => {
  const [captureState, setCaptureState] = useState<{ key: string; list: WaybackCapture[]; error: string | null } | null>(null);
  const [latestRelease, setLatestRelease] = useState<WaybackRelease | null>(null);
  const [selectedRelease, setSelectedRelease] = useState<number | null>(null);
  const [sentinelOpacity, setSentinelOpacity] = useState(0);
  const [expanded, setExpanded] = useState(false);

  const [ortho, setOrtho] = useState<Orthomosaic | null>(null);
  const [orthoOpacity, setOrthoOpacity] = useState(1);
  const [orthoLoading, setOrthoLoading] = useState(false);
  const [orthoError, setOrthoError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Capture history for this location (rounded so small pans do not refetch)
  const lat = Number(center.lat.toFixed(4));
  const lon = Number(center.lon.toFixed(4));
  const locationKey = `${lat},${lon}`;
  useEffect(() => {
    const controller = new AbortController();
    fetchWaybackReleases()
      .then((releases) => !controller.signal.aborted && setLatestRelease(releases[0] ?? null))
      .catch(() => {});
    findCaptures(lat, lon, { signal: controller.signal })
      .then((list) => {
        if (controller.signal.aborted) return;
        setCaptureState({
          key: locationKey,
          list,
          error: list.length ? null : 'No dated capture metadata was returned for this location.',
        });
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setCaptureState({
          key: locationKey,
          list: [],
          error: `Capture dates could not be loaded (${err instanceof Error ? err.message : String(err)}).`,
        });
      });
    return () => controller.abort();
  }, [lat, lon, locationKey]);
  const captures = captureState?.key === locationKey ? captureState.list : null;
  const captureError = captureState?.key === locationKey ? captureState.error : null;

  const selected = captures?.find((c) => c.release.releaseNum === selectedRelease) ?? captures?.[0] ?? null;
  const tileUrl = selected?.release.tileUrl ?? latestRelease?.tileUrl ?? ESRI_LATEST;
  const attribution = `Imagery &copy; Esri, Maxar, Earthstar Geographics${selected ? ` · World Imagery Wayback ${selected.release.releaseDate}` : ''}`;

  const handleOrthoFile = async (file: File | undefined) => {
    if (!file) return;
    setOrthoLoading(true);
    setOrthoError(null);
    try {
      setOrtho(await loadOrthomosaic(file));
      setOrthoOpacity(1);
    } catch (err) {
      setOrthoError(err instanceof Error ? err.message : String(err));
    } finally {
      setOrthoLoading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const mapHeight = expanded ? 'h-[80vh]' : heightClass;

  return (
    <div className="space-y-2">
      {/* Imagery source & date */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700">
          <Satellite className="w-3.5 h-3.5 text-emerald-600" />
          High-resolution satellite
        </span>
        {captures === null ? (
          <span className="inline-flex items-center gap-1 text-slate-500">
            <Loader2 className="w-3 h-3 animate-spin" /> finding capture dates…
          </span>
        ) : captures.length ? (
          <select
            value={selected?.release.releaseNum ?? ''}
            onChange={(e) => setSelectedRelease(Number(e.target.value))}
            className="px-2 py-1 rounded-md border border-slate-300 bg-white text-slate-800 max-w-full"
            aria-label="High-resolution capture"
          >
            {captures.map((c) => (
              <option key={c.release.releaseNum} value={c.release.releaseNum}>
                Captured {captureLabel(c)}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-amber-700">{captureError} Showing the latest Esri World Imagery (capture date not verified).</span>
        )}
        {selected?.captureDate && (
          <span className="px-2 py-0.5 rounded-full bg-slate-100 border border-slate-200 text-slate-700">
            {ageText(selected.captureDate)}
            {selected.accuracyM ? ` · position ±${selected.accuracyM.toFixed(1)} m` : ''}
          </span>
        )}

        <span className="flex-1" />

        {sentinelOverlay && (
          <label className="inline-flex items-center gap-1.5 text-slate-600">
            Sentinel-2 overlay ({sentinelOverlay.label})
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={sentinelOpacity}
              onChange={(e) => setSentinelOpacity(parseFloat(e.target.value))}
              className="w-20 accent-emerald-600"
              aria-label="Sentinel-2 overlay opacity"
            />
          </label>
        )}
        {allowDroneUpload && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept=".tif,.tiff,image/tiff"
              className="hidden"
              onChange={(e) => handleOrthoFile(e.target.files?.[0])}
              aria-label="Drone orthomosaic GeoTIFF"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={orthoLoading}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 bg-white text-slate-700 font-semibold disabled:opacity-60"
            >
              {orthoLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />}
              Drone orthomosaic
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-slate-300 bg-white text-slate-700 font-semibold"
          aria-label={expanded ? 'Shrink map' : 'Enlarge map'}
        >
          {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          {expanded ? 'Smaller' : 'Larger'}
        </button>
      </div>

      {ortho && (
        <div className="flex flex-wrap items-center gap-2 text-[11px] bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1.5 text-emerald-900">
          <Plane className="w-3.5 h-3.5" />
          <span className="font-semibold">{ortho.fileName}</span>
          <span>
            {(ortho.sourceGsdM * 100).toFixed(1)} cm/pixel source{ortho.displayGsdM > ortho.sourceGsdM * 1.05 ? ` (shown at ${(ortho.displayGsdM * 100).toFixed(1)} cm)` : ''}
            {' · '}EPSG:{ortho.epsg}
            {ortho.capturedAt ? ` · file date ${ortho.capturedAt}` : ' · capture date not in file'}
          </span>
          <label className="inline-flex items-center gap-1">
            Opacity
            <input type="range" min={0} max={1} step={0.05} value={orthoOpacity} onChange={(e) => setOrthoOpacity(parseFloat(e.target.value))} className="w-20 accent-emerald-600" aria-label="Drone orthomosaic opacity" />
          </label>
          <button type="button" onClick={() => setOrtho(null)} className="inline-flex items-center gap-1 text-emerald-800 hover:text-red-700">
            <Trash2 className="w-3 h-3" /> Remove
          </button>
        </div>
      )}
      {orthoError && <p role="alert" className="text-[11px] text-red-700 bg-red-50 border border-red-200 rounded-lg px-2.5 py-1.5">{orthoError}</p>}

      <div className={`${mapHeight} rounded-xl overflow-hidden border border-slate-200 isolate transition-[height]`}>
        <MapContainer center={[center.lat, center.lon]} zoom={18} maxZoom={23} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
          {/* Keyed on the attribution too: Leaflet does not replace a changed attribution in place */}
          <TileLayer key={`${tileUrl}|${attribution}`} url={tileUrl} maxNativeZoom={19} maxZoom={23} attribution={attribution} />
          <FitBounds outline={outline} center={center} />
          <InvalidateOnResize dep={expanded} />
          {sentinelOverlay && sentinelOpacity > 0 && (
            <ImageOverlay
              url={sentinelOverlay.url}
              bounds={[[sentinelOverlay.bounds.minLat, sentinelOverlay.bounds.minLon], [sentinelOverlay.bounds.maxLat, sentinelOverlay.bounds.maxLon]]}
              opacity={sentinelOpacity}
            />
          )}
          {ortho && (
            <ImageOverlay
              url={ortho.url}
              bounds={[[ortho.bounds.minLat, ortho.bounds.minLon], [ortho.bounds.maxLat, ortho.bounds.maxLon]]}
              opacity={orthoOpacity}
            />
          )}
          {outline && outline.length > 2 && <Polygon positions={outline} pathOptions={{ color: '#facc15', weight: 2, fill: false }} />}
          {children}
        </MapContainer>
      </div>

      <p className="text-[10px] text-slate-500 leading-snug">
        All layers are real imagery with their capture dates. Sub-metre satellite captures (≈0.3–0.6 m) show field boundaries,
        rows, trees and large plants but are refreshed irregularly (often months apart) — no satellite provides a live video
        feed. For the newest view use the Sentinel-2 overlay (new pass every ~5 days, 10 m); to see individual plants, upload a
        drone orthomosaic (1–5 cm).
      </p>
    </div>
  );
};
