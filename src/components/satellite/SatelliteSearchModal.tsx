/**
 * AgriSurvey AI — Satellite Scene Search & NDVI Trigger Modal
 * 
 * Powered by Earth Search STAC API (https://earth-search.aws.element84.com/v1)
 */

import React, { useState } from 'react';
import {
  X,
  Search,
  Sparkles,
  Cloud,
  Calendar,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  ExternalLink,
  ChevronRight,
  Eye,
} from 'lucide-react';
import { FarmPlot, SatelliteScene, VegetationIndexObservation } from '@/types';
import { stacSatelliteService, StacSearchResult } from '@/services/stac.service';
import { ndviProcessorService } from '@/services/ndvi.service';

interface SatelliteSearchModalProps {
  plot: FarmPlot;
  isOpen: boolean;
  onClose: () => void;
  onNdviCalculated?: (obs: VegetationIndexObservation) => void;
}

const SatelliteSearchModalContent: React.FC<SatelliteSearchModalProps> = ({
  plot,
  isOpen,
  onClose,
  onNdviCalculated,
}) => {

  const [startDate, setStartDate] = useState<string>('2026-05-01');
  const [endDate, setEndDate] = useState<string>('2026-10-26');
  const [maxCloudCover, setMaxCloudCover] = useState<number>(25);

  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchResults, setSearchResults] = useState<StacSearchResult | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [processingSceneId, setProcessingSceneId] = useState<string | null>(null);
  const [successObs, setSuccessObs] = useState<VegetationIndexObservation | null>(null);

  const handleSearch = async () => {
    setIsSearching(true);
    setSearchError(null);
    setSuccessObs(null);

    try {
      const res = await stacSatelliteService.searchScenes({
        plotId: plot.id,
        startDate,
        endDate,
        maxCloudCover,
        limit: 10,
      });
      setSearchResults(res);
    } catch (err: any) {
      setSearchError(err.message || 'Failed to search Earth Search STAC API');
    } finally {
      setIsSearching(false);
    }
  };

  const handleProcessNdvi = async (scene: SatelliteScene) => {
    setProcessingSceneId(scene.scene_id);
    try {
      const result = await ndviProcessorService.processNdvi({
        plotId: plot.id,
        sceneId: scene.scene_id,
        cloudMaskingEnabled: true,
      });
      setSuccessObs(result.observation);
      if (onNdviCalculated) {
        onNdviCalculated(result.observation);
      }
    } catch (err: any) {
      alert(`NDVI Processing Error: ${err.message}`);
    } finally {
      setProcessingSceneId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">Sentinel-2 Satellite Imagery Search</h3>
              <p className="text-xs text-slate-400">
                Plot: {plot.plot_name} • Survey {plot.survey_number} ({plot.area_acres} Acres, {plot.village})
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Parameters Form */}
        <div className="p-6 border-b border-slate-100 bg-slate-50/50">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" /> Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-emerald-500 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-slate-500" /> End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:border-emerald-500 font-mono"
              />
            </div>

            <div>
              <div className="flex justify-between items-center mb-1 font-semibold text-slate-700">
                <span className="flex items-center gap-1">
                  <Cloud className="w-3.5 h-3.5 text-slate-500" /> Max Cloud Cover
                </span>
                <span className="text-emerald-700 font-mono font-bold">{maxCloudCover}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="50"
                step="5"
                value={maxCloudCover}
                onChange={(e) => setMaxCloudCover(parseInt(e.target.value))}
                className="w-full h-2 bg-slate-200 rounded-lg cursor-pointer mt-2"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">
              STAC Endpoint: <code className="text-slate-700">earth-search.aws.element84.com/v1</code> (Sentinel-2 L2A BOA Reflectance)
            </span>
            <button
              onClick={handleSearch}
              disabled={isSearching}
              className="px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold flex items-center gap-2 shadow-xs transition-all"
            >
              {isSearching ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Querying STAC...
                </>
              ) : (
                <>
                  <Search className="w-4 h-4" /> Search Scenes
                </>
              )}
            </button>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 max-h-96 overflow-y-auto">
          {searchError && (
            <div className="p-3 mb-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{searchError}</span>
            </div>
          )}

          {successObs && (
            <div className="p-4 mb-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-950 text-xs flex items-start justify-between gap-3 shadow-xs">
              <div className="space-y-1">
                <div className="font-bold flex items-center gap-1.5 text-emerald-900">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  Real NDVI Spectral Processing Completed Successfully!
                </div>
                <div className="text-slate-600">
                  Formula: <code className="bg-white px-1.5 py-0.5 rounded font-mono text-emerald-800">(B08_NIR - B04_RED) / (B08_NIR + B04_RED)</code>
                </div>
                <div className="flex flex-wrap gap-3 pt-1 font-semibold">
                  <span>Mean NDVI: <strong className="text-emerald-700">{successObs.ndvi_mean}</strong></span>
                  <span>Range: <strong className="text-slate-800">{successObs.ndvi_min} to {successObs.ndvi_max}</strong></span>
                  <span>Classification: <strong className="text-emerald-700">{successObs.vegetation_classification}</strong></span>
                  <span>Valid Coverage: <strong className="text-slate-800">{successObs.valid_pixel_coverage_pct}%</strong></span>
                </div>
              </div>
              <span className="px-2.5 py-1 bg-emerald-600 text-white font-bold rounded-lg text-[10px] shrink-0">
                Raster Overlaid on Map
              </span>
            </div>
          )}

          {!searchResults && !isSearching && (
            <div className="text-center py-10 text-slate-400 text-xs">
              <Sparkles className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              Click "Search Scenes" to query live Sentinel-2 Level-2A imagery intersecting this parcel.
            </div>
          )}

          {searchResults && searchResults.scenes.length === 0 && (
            <div className="text-center py-8 text-slate-500 text-xs">
              <Cloud className="w-8 h-8 text-slate-300 mx-auto mb-2" />
              No scenes found within cloud threshold ({maxCloudCover}%). Try increasing cloud tolerance or broadening the date window.
            </div>
          )}

          {searchResults && searchResults.scenes.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                <span>Discovered {searchResults.totalFound} Sentinel-2 L2A Scenes ({searchResults.dataSource})</span>
                <span>Select observation to calculate NDVI raster:</span>
              </div>

              {searchResults.scenes.map((scene) => {
                const isProcessing = processingSceneId === scene.scene_id;
                const isProcessed = successObs?.scene_id === scene.scene_id;

                return (
                  <div
                    key={scene.id}
                    className={`p-3.5 rounded-xl border transition-all flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 ${
                      isProcessed
                        ? 'border-emerald-300 bg-emerald-50/40 shadow-xs'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {scene.thumbnail_url ? (
                        <img
                          src={scene.thumbnail_url}
                          alt="Thumbnail"
                          className="w-16 h-16 rounded-lg object-cover border border-slate-200 shrink-0 bg-slate-100"
                        />
                      ) : (
                        <div className="w-16 h-16 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                          <Layers className="w-6 h-6" />
                        </div>
                      )}

                      <div className="space-y-1 text-xs">
                        <div className="font-bold text-slate-900 flex items-center gap-2">
                          <span>{scene.scene_id}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600">
                            Cloud: {scene.cloud_cover_percentage}%
                          </span>
                        </div>
                        <div className="text-slate-500 text-[11px]">
                          Acquisition: <span className="font-semibold text-slate-800">{new Date(scene.acquisition_datetime).toLocaleString()}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 flex flex-wrap gap-2">
                          <span className="text-emerald-700 font-semibold">B04 (Red 10m)</span>
                          <span className="text-emerald-700 font-semibold">B08 (NIR 10m)</span>
                          <span className="text-sky-700">SCL (Mask 20m)</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
                      <button
                        onClick={() => handleProcessNdvi(scene)}
                        disabled={isProcessing}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs ${
                          isProcessed
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                            : 'bg-emerald-700 hover:bg-emerald-600 text-white'
                        }`}
                      >
                        {isProcessing ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Calculating Raster...
                          </>
                        ) : isProcessed ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            Recalculate NDVI
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3.5 h-3.5" />
                            Calculate NDVI Raster
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-200 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold hover:bg-slate-100"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// Mount the content only while open so its hooks always run in the same order.
export const SatelliteSearchModal: React.FC<SatelliteSearchModalProps> = (props) =>
  props.isOpen ? <SatelliteSearchModalContent {...props} /> : null;
