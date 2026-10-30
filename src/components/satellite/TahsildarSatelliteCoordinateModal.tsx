/**
 * AgriSurvey AI — Tahsildar Satellite Imagery Coordinate Search Modal
 *
 * Allows Tahsildars (Revenue Officers) to enter any geographic coordinates (lat, lon),
 * find Copernicus Sentinel-2 L2A passes over that exact point (Earth Search STAC, AWS
 * Open Data) and inspect the native 10 m bands clipped to the search radius:
 * true colour, false colour (NIR) and NDVI with SCL cloud/shadow masking.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Satellite,
  Compass,
  Calendar,
  Search,
  ExternalLink,
  Layers,
  AlertTriangle,
  Loader2,
  Activity,
  PlusCircle,
  Download,
  Maximize2,
  Info,
} from 'lucide-react';
import { CircleMarker } from 'react-leaflet';
import { HighResFieldMap } from './HighResFieldMap';
import { fieldOutline } from '@/services/field-surveillance.service';
import { SatelliteScene } from '@/types';
import { stacSatelliteService, StacSearchResult } from '@/services/stac.service';
import { satelliteMonitoringService } from '@/services/satellite-monitoring.service';
import { useLanguage } from '@/context/LanguageContext';
import { getTahsildarLabel } from '@/lib/dashboard-localizer';
import { loadSceneClip, SceneClip, NDVI_CLASSES, NDVI_MASKED_COLOR } from '@/lib/sentinel-cog';

interface TahsildarSatelliteCoordinateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRegisterMonitoringArea?: (newAreaId: string) => void;
}

const MAHARASHTRA_JURISDICTIONS = [
  { name: 'Haveli, Pune (Wagholi Sugarcane)', lat: 18.5793, lon: 73.9812, taluk: 'Haveli' },
  { name: 'Baramati, Pune (Supae Soybean)', lat: 18.1519, lon: 74.5772, taluk: 'Baramati' },
  { name: 'Shirur, Pune (Koregaon Bhima Onion)', lat: 18.8277, lon: 74.3792, taluk: 'Shirur' },
  { name: 'Junnar, Pune (Otur Grapes & Gram)', lat: 19.2083, lon: 73.8769, taluk: 'Junnar' },
  { name: 'Indapur, Pune (Bhigwan Sugarcane)', lat: 18.1158, lon: 75.0342, taluk: 'Indapur' },
  { name: 'Daund, Pune (Patas Kharif)', lat: 18.4633, lon: 74.5804, taluk: 'Daund' },
  { name: 'Khed, Pune (Chakan Green Belts)', lat: 18.8475, lon: 73.9042, taluk: 'Khed' },
];

type ImageryMode = 'visual' | 'ndvi' | 'false_color';

const isoDate = (d: Date) => d.toISOString().split('T')[0];

const formatCoord = (lat: number, lon: number) =>
  `${Math.abs(lat).toFixed(5)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(5)}° ${lon >= 0 ? 'E' : 'W'}`;

const rgb = (c: [number, number, number]) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

const classifyNdvi = (mean: number) =>
  mean > 0.6
    ? 'Very High Density'
    : mean > 0.35
    ? 'Moderate Density'
    : mean > 0.2
    ? 'Sparse / Stressed'
    : mean > 0
    ? 'Bare Soil / Tilled'
    : 'Non-Vegetated / Water';

const clipUrlForMode = (clip: SceneClip, mode: ImageryMode) =>
  mode === 'ndvi' ? clip.ndviUrl : mode === 'false_color' ? clip.falseColorUrl : clip.trueColorUrl;

const TahsildarSatelliteCoordinateModalContent: React.FC<TahsildarSatelliteCoordinateModalProps> = ({
  onClose,
  onRegisterMonitoringArea,
}) => {
  const navigate = useNavigate();
  const { language } = useLanguage();
  const tl = (key: string) => getTahsildarLabel(key, language);

  // Coordinate Inputs
  const [rawCoordInput, setRawCoordInput] = useState<string>('18.5793, 73.9812');
  const [latitude, setLatitude] = useState<string>('18.5793');
  const [longitude, setLongitude] = useState<string>('73.9812');
  const [radiusKm, setRadiusKm] = useState<number>(1.5);

  // Search Dates & Filters (default: last 120 days up to today)
  const [startDate, setStartDate] = useState<string>(() => isoDate(new Date(Date.now() - 120 * 24 * 3600 * 1000)));
  const [endDate, setEndDate] = useState<string>(() => isoDate(new Date()));
  const [maxCloudCover, setMaxCloudCover] = useState<number>(35);

  // State
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<StacSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchNotice, setSearchNotice] = useState<string | null>(null);
  // Location/radius the current results were searched for (inputs may change afterwards)
  const [searchedArea, setSearchedArea] = useState<{ lat: number; lon: number; radiusKm: number } | null>(null);

  // Active Scene Detail & Image View Mode
  const [selectedScene, setSelectedScene] = useState<SatelliteScene | null>(null);
  const [imageryMode, setImageryMode] = useState<ImageryMode>('visual');
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  // Clipped 10 m imagery for the selected scene
  const [clip, setClip] = useState<SceneClip | null>(null);
  const [clipSceneId, setClipSceneId] = useState<string | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const clipLoading = !!selectedScene && !!searchedArea && clipSceneId !== selectedScene.scene_id;

  useEffect(() => {
    if (!selectedScene || !searchedArea) return;
    const controller = new AbortController();
    loadSceneClip(selectedScene, { lat: searchedArea.lat, lon: searchedArea.lon }, searchedArea.radiusKm, controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setClip(result);
        setClipError(null);
        setClipSceneId(selectedScene.scene_id);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.warn('Sentinel-2 COG read failed:', err);
        const message = err instanceof Error ? err.message : String(err);
        setClip(null);
        setClipError(
          /fetch|network|cors/i.test(message)
            ? 'Could not download the 10 m band files from AWS Open Data (network or browser restriction). Showing the full-tile preview instead.'
            : message
        );
        setClipSceneId(selectedScene.scene_id);
      });
    return () => controller.abort();
  }, [selectedScene, searchedArea]);

  const handleCoordInputChange = (val: string) => {
    setRawCoordInput(val);
    const parsed = satelliteMonitoringService.parseCoordinates(val);
    if (parsed.isValid) {
      setLatitude(parsed.latitude.toString());
      setLongitude(parsed.longitude.toString());
      setSearchError(null);
    }
  };

  const handleLatChange = (latVal: string) => {
    setLatitude(latVal);
    setRawCoordInput(`${latVal}, ${longitude}`);
  };

  const handleLonChange = (lonVal: string) => {
    setLongitude(lonVal);
    setRawCoordInput(`${latitude}, ${lonVal}`);
  };

  const handlePresetSelect = (preset: typeof MAHARASHTRA_JURISDICTIONS[0]) => {
    setLatitude(preset.lat.toString());
    setLongitude(preset.lon.toString());
    setRawCoordInput(`${preset.lat}, ${preset.lon}`);
  };

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setSearchError(null);
    setSearchNotice(null);

    const latNum = parseFloat(latitude);
    const lonNum = parseFloat(longitude);

    if (isNaN(latNum) || isNaN(lonNum) || latNum < -90 || latNum > 90 || lonNum < -180 || lonNum > 180) {
      setSearchError('Please provide valid coordinates: latitude between -90 and 90, longitude between -180 and 180.');
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      setSearchError('The "from" date must be on or before the "to" date.');
      return;
    }

    if (latNum < 15.0 || latNum > 22.5 || lonNum < 72.0 || lonNum > 81.0) {
      setSearchNotice(
        'Notice: Target coordinates fall outside Maharashtra State boundaries (15.0° - 22.5° N, 72.0° - 81.0° E).'
      );
    }

    setIsSearching(true);
    try {
      const res = await stacSatelliteService.searchScenes({
        latitude: latNum,
        longitude: lonNum,
        radiusKm,
        startDate,
        endDate,
        maxCloudCover,
        limit: 12,
      });

      setSearchResults(res);
      setSearchedArea({ lat: latNum, lon: lonNum, radiusKm });
      setClip(null);
      setClipSceneId(null);
      setSelectedScene(res.scenes[0] ?? null);
    } catch (err: any) {
      setSearchError(err.message || 'Failed to query Sentinel-2 scenes from STAC API');
    } finally {
      setIsSearching(false);
    }
  };

  const handleRegisterMonitoring = async () => {
    const area = searchedArea ?? { lat: parseFloat(latitude), lon: parseFloat(longitude), radiusKm };
    try {
      const created = await satelliteMonitoringService.registerMonitoringArea({
        name: `Tahsildar Investigation Area (${area.lat.toFixed(4)}, ${area.lon.toFixed(4)})`,
        latitude: area.lat,
        longitude: area.lon,
        radius_km: area.radiusKm,
        start_date: startDate,
        end_date: endDate,
        interval_days: 15,
        preferred_crop: 'Sugarcane',
      });
      if (onRegisterMonitoringArea) {
        onRegisterMonitoringArea(created.id);
      }
      alert(`✅ Monitoring Area registered successfully! Area ID: ${created.id}. Now active in 15-day satellite queue.`);
      onClose();
    } catch (err: any) {
      alert(`Registration error: ${err.message}`);
    }
  };

  const activeClip = clip && selectedScene && clipSceneId === selectedScene.scene_id ? clip : null;
  const activeImageUrl = activeClip ? clipUrlForMode(activeClip, imageryMode) : null;
  const modeLabel =
    imageryMode === 'ndvi' ? 'NDVI' : imageryMode === 'false_color' ? 'False colour (B08-B04-B03)' : 'True colour (B04-B03-B02)';

  const handleDownloadClip = () => {
    if (!activeImageUrl || !selectedScene || !searchedArea) return;
    const a = document.createElement('a');
    a.href = activeImageUrl;
    a.download = `${selectedScene.scene_id}_${imageryMode}_${searchedArea.lat.toFixed(5)}_${searchedArea.lon.toFixed(5)}_${searchedArea.radiusKm}km.png`;
    a.click();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full border border-slate-200 overflow-hidden my-6 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white px-6 py-4 flex items-center justify-between border-b border-slate-700 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <Satellite className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-lg font-bold">{tl('modalInspectorTitle')}</h2>
              <p className="text-xs text-slate-300">
                {tl('modalInspectorSubtitle')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {/* Coordinate & Search Parameters Panel */}
          <form onSubmit={handleSearch} className="bg-slate-50 p-5 rounded-2xl border border-slate-200 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <span className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-emerald-600" />
                {tl('targetCoordinates')}
              </span>
              <span className="text-[11px] text-emerald-700 font-medium bg-emerald-100/70 px-2 py-0.5 rounded-full border border-emerald-200">
                {tl('directPasteHelp')}
              </span>
            </div>

            {/* Quick Paste Field */}
            <div>
              <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                {tl('enterOrPasteCoords')}
              </label>
              <input
                type="text"
                value={rawCoordInput}
                onChange={(e) => handleCoordInputChange(e.target.value)}
                placeholder="18.5793, 73.9812"
                className="w-full px-3.5 py-2 text-sm font-mono rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-slate-800"
              />
            </div>

            {/* Separated Numeric Lat & Lon */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">{tl('latitudeLabel')}</label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => handleLatChange(e.target.value)}
                  placeholder="18.5793"
                  required
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-slate-800"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">{tl('longitudeLabel')}</label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => handleLonChange(e.target.value)}
                  placeholder="73.9812"
                  required
                  className="w-full px-3 py-1.5 text-xs font-mono rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-slate-800"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-semibold text-slate-600">{tl('radiusLabel')}</label>
                  <span className="text-[11px] font-bold text-emerald-700">{radiusKm} km</span>
                </div>
                <input
                  type="range"
                  min="0.5"
                  max="5.0"
                  step="0.5"
                  value={radiusKm}
                  onChange={(e) => setRadiusKm(parseFloat(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer mt-1"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-[11px] font-semibold text-slate-600">{tl('maxCloudLabel')}</label>
                  <span className="text-[11px] font-bold text-slate-700">{maxCloudCover}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="80"
                  step="5"
                  value={maxCloudCover}
                  onChange={(e) => setMaxCloudCover(parseInt(e.target.value))}
                  className="w-full accent-emerald-600 cursor-pointer mt-1"
                />
              </div>
            </div>

            {/* Quick Location Presets in Pune Division */}
            <div>
              <span className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                {tl('quickLocationsLabel')}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {MAHARASHTRA_JURISDICTIONS.map((p) => (
                  <button
                    key={p.name}
                    type="button"
                    onClick={() => handlePresetSelect(p)}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-white border border-slate-200 text-slate-700 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Date Range & Fetch Button */}
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 pt-2 border-t border-slate-200">
              <div className="flex items-center gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">{tl('fromDateLabel')}</label>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">{tl('toDateLabel')}</label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 bg-white text-slate-800"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSearching}
                className="inline-flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs shadow-md transition-all cursor-pointer disabled:opacity-60"
              >
                {isSearching ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{tl('searchingArchiveBtn')}</span>
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    <span>{tl('fetchImagesBtn')}</span>
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Search Error Message */}
          {searchError && (
            <div role="alert" className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-500 mt-0.5" />
              <span>{searchError}</span>
            </div>
          )}
          {searchNotice && (
            <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2.5">
              <Info className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <span>{searchNotice}</span>
            </div>
          )}

          {/* Satellite Imagery Results Container */}
          {searchResults && searchedArea && (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Satellite className="w-4 h-4 text-emerald-600" />
                    {tl('scenesFoundTitle')} ({searchResults.scenes.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Passes covering {formatCoord(searchedArea.lat, searchedArea.lon)} &bull;{' '}
                    {searchResults.dataSource === 'LIVE_STAC_API'
                      ? 'Live Earth Search STAC catalogue'
                      : 'Offline: cached scenes covering this point'}
                  </p>
                </div>

                <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() =>
                    navigate(
                      `/tahsildar/field-surveillance?lat=${searchedArea.lat}&lon=${searchedArea.lon}&r=${Math.min(1, searchedArea.radiusKm)}`
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <Activity className="w-3.5 h-3.5" />
                  <span>Open 15-day field surveillance</span>
                </button>
                <button
                  type="button"
                  onClick={handleRegisterMonitoring}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
                  <span>{tl('start15dMonitoringBtn')}</span>
                </button>
                </div>
              </div>

              {searchResults.dataSource === 'LOCAL_INDEX' && (
                <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>
                    The live satellite catalogue could not be reached. Only previously retrieved scenes whose footprint
                    covers this point are listed; newer passes may exist.
                  </span>
                </div>
              )}

              {searchResults.scenes.length === 0 && (
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-slate-600 text-xs">
                  No Sentinel-2 passes with tile cloud cover below {maxCloudCover}% were found for this point between{' '}
                  {startDate} and {endDate}. Try widening the date range or raising the cloud limit (monsoon months are
                  often fully clouded).
                </div>
              )}

              {/* Main Imagery Viewer: Selected Scene & Gallery */}
              {selectedScene ? (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  {/* Image Display Card (7 cols) */}
                  <div className="lg:col-span-7 bg-slate-900 text-white rounded-2xl p-4 space-y-3 overflow-hidden shadow-lg border border-slate-800">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 text-[11px] font-bold rounded truncate max-w-[200px]">
                          {selectedScene.scene_id}
                        </span>
                        <span className="text-xs text-slate-300 font-mono shrink-0">
                          Acquired {selectedScene.acquisition_datetime.replace('T', ' ').slice(0, 16)} UTC
                        </span>
                      </div>

                      {/* Image Mode Switcher */}
                      <div className="flex items-center gap-1 bg-white/10 p-1 rounded-lg text-[10px]" role="group" aria-label="Imagery band combination">
                        {(
                          [
                            ['visual', tl('naturalPhoto')],
                            ['ndvi', tl('cropGreennessNdvi')],
                            ['false_color', tl('plantHealthInfrared')],
                          ] as [ImageryMode, string][]
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={imageryMode === mode}
                            onClick={() => setImageryMode(mode)}
                            className={`px-2 py-0.5 rounded font-semibold transition-all ${
                              imageryMode === mode ? 'bg-emerald-500 text-white' : 'text-slate-300 hover:text-white'
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Satellite Imagery Render Frame (north-up, clipped to the search area) */}
                    <div className="relative rounded-xl overflow-hidden aspect-square bg-black/80 flex items-center justify-center border border-slate-800">
                      {clipLoading && (
                        <div className="flex flex-col items-center gap-2 text-slate-300 text-xs p-6 text-center">
                          <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                          <span>Downloading 10 m Sentinel-2 bands for this location…</span>
                        </div>
                      )}

                      {!clipLoading && activeImageUrl && (
                        <>
                          <img
                            src={activeImageUrl}
                            alt={`Sentinel-2 ${modeLabel} around ${formatCoord(searchedArea.lat, searchedArea.lon)}`}
                            className="w-full h-full object-contain"
                          />
                          {/* Search radius & exact target point */}
                          <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <circle cx="50" cy="50" r="50" fill="none" stroke="white" strokeOpacity="0.7" strokeWidth="0.4" strokeDasharray="1.5 1" vectorEffect="non-scaling-stroke" />
                            <line x1="50" y1="46" x2="50" y2="48.8" stroke="#facc15" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            <line x1="50" y1="51.2" x2="50" y2="54" stroke="#facc15" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            <line x1="46" y1="50" x2="48.8" y2="50" stroke="#facc15" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                            <line x1="51.2" y1="50" x2="54" y2="50" stroke="#facc15" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                          </svg>
                          <button
                            type="button"
                            onClick={() => setIsExpanded(true)}
                            className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/60 hover:bg-black/90 text-white backdrop-blur-xs transition-colors cursor-pointer"
                            title="Expand satellite image"
                            aria-label="Expand satellite image"
                          >
                            <Maximize2 className="w-4 h-4" />
                          </button>
                          <div className="absolute bottom-2 left-2 px-2 py-1 rounded bg-black/70 text-[10px] font-mono text-slate-200">
                            {modeLabel} &bull; {(searchedArea.radiusKm * 2).toFixed(1)} km × {(searchedArea.radiusKm * 2).toFixed(1)} km &bull; North up
                          </div>
                        </>
                      )}

                      {!clipLoading && !activeImageUrl && (
                        <div className="relative w-full h-full">
                          {selectedScene.thumbnail_url && (
                            <img
                              src={selectedScene.thumbnail_url}
                              alt="Sentinel-2 full tile preview"
                              className="w-full h-full object-contain opacity-80"
                            />
                          )}
                          <div className="absolute inset-x-2 bottom-2 p-2 rounded bg-black/80 text-[11px] text-amber-300 flex items-start gap-1.5">
                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                            <span>
                              {clipError || 'Band files unavailable for this scene.'} The preview covers the whole ~110 km
                              tile at low resolution and is not centred on your coordinates.
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Watermark badge */}
                      <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/60 text-emerald-400 font-mono text-[9px] backdrop-blur-xs">
                        Copernicus Sentinel-2 L2A &bull; {activeClip ? '10 m bands' : 'tile preview'}
                      </div>
                    </div>

                    {/* NDVI legend (labels, not colour alone) */}
                    {imageryMode === 'ndvi' && activeClip && (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-1 text-[10px] text-slate-300">
                        {NDVI_CLASSES.map((cls) => (
                          <span key={cls.label} className="flex items-center gap-1.5">
                            <span className="w-3 h-3 rounded-sm shrink-0 border border-white/20" style={{ background: rgb(cls.color) }} />
                            {cls.label}
                          </span>
                        ))}
                        <span className="flex items-center gap-1.5">
                          <span className="w-3 h-3 rounded-sm shrink-0 border border-white/20" style={{ background: rgb(NDVI_MASKED_COLOR) }} />
                          Masked (cloud / shadow / no data)
                        </span>
                      </div>
                    )}

                    {/* Image Footer with Links */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 pt-1">
                      <span>
                        Tile cloud cover: <strong className="text-white">{selectedScene.cloud_cover_percentage}%</strong>
                      </span>
                      <div className="flex items-center gap-3">
                        {activeImageUrl && (
                          <button
                            type="button"
                            onClick={handleDownloadClip}
                            className="text-slate-300 hover:text-white inline-flex items-center gap-1 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Save this view (PNG)</span>
                          </button>
                        )}
                        {selectedScene.visual_url && (
                          <a
                            href={selectedScene.visual_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1 font-semibold"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Full tile TCI (.tif)</span>
                          </a>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-slate-500 leading-snug">
                      Display contrast is stretched and lightly sharpened for readability. Sentinel-2 resolves 10 m per
                      pixel, so individual small plots (&lt; 0.5 ha) may span only a few dozen pixels.
                    </p>
                  </div>

                  {/* Scene Inspection & NDVI Analysis (5 cols) */}
                  <div className="lg:col-span-5 space-y-4">
                    {/* Scene Metadata Specs */}
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 text-xs space-y-2.5">
                      <h4 className="font-bold text-slate-800 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                        <Layers className="w-3.5 h-3.5 text-emerald-600" />
                        Satellite Pass Information
                      </h4>
                      <dl className="space-y-1.5 text-slate-600">
                        <div className="flex justify-between gap-3">
                          <dt>Scene ID:</dt>
                          <dd className="font-mono font-bold text-slate-900 truncate max-w-[200px]" title={selectedScene.scene_id}>
                            {selectedScene.scene_id}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Collection / tile:</dt>
                          <dd className="font-mono text-slate-900">
                            {selectedScene.collection}
                            {selectedScene.mgrs_tile ? ` · ${selectedScene.mgrs_tile}` : ''}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Acquired:</dt>
                          <dd className="font-mono font-bold text-slate-900">
                            {new Date(selectedScene.acquisition_datetime).toLocaleString()}
                          </dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Tile cloud cover:</dt>
                          <dd className="font-mono font-bold text-slate-900">{selectedScene.cloud_cover_percentage}%</dd>
                        </div>
                        <div className="flex justify-between gap-3">
                          <dt>Clear pixels in radius:</dt>
                          <dd className="font-mono font-bold text-slate-900">
                            {activeClip
                              ? `${activeClip.stats.validCoveragePct.toFixed(1)}%`
                              : clipLoading
                              ? 'Calculating…'
                              : 'Unavailable'}
                          </dd>
                        </div>
                        {activeClip && (
                          <>
                            <div className="flex justify-between gap-3">
                              <dt>Cloud / shadow in radius:</dt>
                              <dd className="font-mono text-slate-900">{activeClip.stats.cloudOrShadowPct.toFixed(1)}%</dd>
                            </div>
                            <div className="flex justify-between gap-3">
                              <dt>Resolution:</dt>
                              <dd className="text-slate-900">10 m bands · EPSG:{activeClip.epsg} → WGS84</dd>
                            </div>
                          </>
                        )}
                      </dl>
                    </div>

                    {/* NDVI result computed from the clipped bands */}
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-3">
                      <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-emerald-600" />
                        Crop Greenness (NDVI) within {searchedArea.radiusKm} km
                      </span>

                      {clipLoading && <p className="text-[11px] text-slate-500">Calculating from B04 / B08 reflectance…</p>}

                      {!clipLoading && !activeClip && (
                        <p className="text-[11px] text-slate-500">Unavailable — the band files for this scene could not be read.</p>
                      )}

                      {activeClip && activeClip.stats.ndviMean === null && (
                        <p className="text-[11px] text-amber-700">
                          Insufficient data: no clear pixels inside the search radius on this date (cloud, shadow or no
                          data). Choose another pass.
                        </p>
                      )}

                      {activeClip && activeClip.stats.ndviMean !== null && (
                        <div className="space-y-2 pt-2 border-t border-slate-100">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div className="p-2 rounded bg-emerald-50 border border-emerald-200">
                              <span className="text-slate-500 block text-[10px]">Mean NDVI</span>
                              <span className="text-base font-bold text-emerald-900 font-mono">
                                {activeClip.stats.ndviMean.toFixed(3)}
                              </span>
                            </div>
                            <div className="p-2 rounded bg-slate-50 border border-slate-200">
                              <span className="text-slate-500 block text-[10px]">Vegetation density class</span>
                              <span className="text-xs font-bold text-slate-800">
                                {classifyNdvi(activeClip.stats.ndviMean)}
                              </span>
                            </div>
                          </div>
                          <dl className="grid grid-cols-3 gap-2 text-[11px] text-slate-600">
                            <div>
                              <dt className="text-[10px] text-slate-400">Median</dt>
                              <dd className="font-mono">{activeClip.stats.ndviMedian?.toFixed(3)}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] text-slate-400">Min</dt>
                              <dd className="font-mono">{activeClip.stats.ndviMin?.toFixed(3)}</dd>
                            </div>
                            <div>
                              <dt className="text-[10px] text-slate-400">Max</dt>
                              <dd className="font-mono">{activeClip.stats.ndviMax?.toFixed(3)}</dd>
                            </div>
                          </dl>
                          <p className="text-[10px] text-slate-500 leading-snug">
                            Calculated measurement: NDVI = (B08 − B04) / (B08 + B04) over{' '}
                            {activeClip.stats.validPixels.toLocaleString()} clear pixels (SCL cloud, shadow, cirrus, snow
                            and no-data masked; {activeClip.reflectance.source}). Covers all land in the radius, not a
                            single plot. A low value alone does not establish disease, nutrient deficiency or the cause
                            of stress — confirm in the field.
                          </p>
                          {activeClip.stats.validCoveragePct < 60 && (
                            <p className="text-[10px] text-amber-700">
                              Only {activeClip.stats.validCoveragePct.toFixed(0)}% of the radius is clear on this date;
                              treat the value with caution.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              ) : null}

              {/* Sharpest real imagery of the searched location */}
              {selectedScene && (
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs space-y-2">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                    <Satellite className="w-3.5 h-3.5 text-emerald-600" />
                    High-resolution satellite view (zoom in to field level)
                  </h4>
                  <HighResFieldMap
                    center={{ lat: searchedArea.lat, lon: searchedArea.lon }}
                    outline={fieldOutline({ kind: 'circle', center: { lat: searchedArea.lat, lon: searchedArea.lon }, radiusKm: searchedArea.radiusKm })}
                    heightClass="h-[460px]"
                    sentinelOverlay={
                      activeClip && activeImageUrl
                        ? { url: activeImageUrl, bounds: activeClip.bounds, label: selectedScene.acquisition_datetime.slice(0, 10) }
                        : undefined
                    }
                  >
                    <CircleMarker center={[searchedArea.lat, searchedArea.lon]} radius={5} pathOptions={{ color: '#facc15', weight: 2, fillOpacity: 0.9 }} />
                  </HighResFieldMap>
                </div>
              )}

              {/* Gallery of all scenes found in date range */}
              {searchResults.scenes.length > 0 && (
                <div>
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                    Satellite Passes for this Location (newest first)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-2.5">
                    {searchResults.scenes.map((scene) => {
                      const isSelected = scene.scene_id === selectedScene?.scene_id;
                      return (
                        <button
                          type="button"
                          key={scene.id}
                          onClick={() => setSelectedScene(scene)}
                          aria-pressed={isSelected}
                          className={`p-2 rounded-xl border text-left transition-all cursor-pointer ${
                            isSelected
                              ? 'border-emerald-600 bg-emerald-50/50 ring-2 ring-emerald-600/20'
                              : 'border-slate-200 bg-white hover:border-slate-300'
                          }`}
                        >
                          <div className="aspect-square rounded-lg overflow-hidden bg-slate-100 mb-1.5 relative">
                            {scene.thumbnail_url ? (
                              <img src={scene.thumbnail_url} alt={`Tile preview ${scene.scene_id}`} className="w-full h-full object-cover" loading="lazy" />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center text-[10px] text-slate-400">No preview</div>
                            )}
                            <span className="absolute bottom-1 right-1 text-[9px] bg-black/70 text-white font-mono px-1 rounded">
                              {scene.cloud_cover_percentage}% cloud
                            </span>
                          </div>
                          <div className="text-[10px] font-bold text-slate-900 truncate">
                            {scene.acquisition_datetime.slice(0, 10)}
                            {isSelected ? ' · selected' : ''}
                          </div>
                          <div className="text-[9px] text-slate-500 truncate">{scene.mgrs_tile || scene.scene_id}</div>
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">Thumbnails preview the whole ~110 km tile; select one to load your area at 10 m.</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>
            {searchedArea
              ? `Searched: ${formatCoord(searchedArea.lat, searchedArea.lon)} · radius ${searchedArea.radiusKm} km`
              : 'Enter coordinates and fetch imagery'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>

      {/* Expanded Satellite Image */}
      {isExpanded && activeImageUrl && (
        <div
          className="fixed inset-0 z-60 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setIsExpanded(false)}
        >
          <div className="relative max-w-[90vmin] w-full bg-black rounded-2xl overflow-hidden shadow-2xl p-2 border border-slate-700">
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="absolute top-4 right-4 z-10 p-2 bg-black/60 rounded-full text-white hover:bg-black"
              aria-label="Close expanded image"
            >
              <X className="w-5 h-5" />
            </button>
            <img src={activeImageUrl} alt={`Expanded Sentinel-2 ${modeLabel}`} className="w-full h-auto rounded-xl" />
            <p className="text-[11px] text-slate-300 px-2 py-1.5 font-mono">
              {selectedScene?.scene_id} · {modeLabel} · acquired {selectedScene?.acquisition_datetime.slice(0, 10)}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

// Mount the content only while open so its hooks always run in the same order.
export const TahsildarSatelliteCoordinateModal: React.FC<TahsildarSatelliteCoordinateModalProps> = (props) =>
  props.isOpen ? <TahsildarSatelliteCoordinateModalContent {...props} /> : null;
