/**
 * AgriSurvey AI — Coordinate-Based Satellite Monitoring Modal
 * 
 * Allows Farmers and Tahsildars to register an area for continuous 15-day satellite monitoring
 * using coordinates (with paste support e.g. "19.0760, 72.8777"), radius, or cadastral plot boundaries.
 */

import React, { useState } from 'react';
import {
  X,
  Compass,
  MapPin,
  Calendar,
  Layers,
  Sprout,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Info,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { FarmPlot, MonitoringArea } from '@/types';
import { satelliteMonitoringService } from '@/services/satellite-monitoring.service';
import { mockDb } from '@/services/mock-db';

interface CoordinateMonitoringModalProps {
  isOpen: boolean;
  onClose: () => void;
  availablePlots?: FarmPlot[];
  defaultPlot?: FarmPlot;
  onAreaCreated: (newArea: MonitoringArea) => void;
}

const MAHARASHTRA_PRESETS = [
  { name: 'Haveli, Pune (Sugarcane/Tur)', lat: 18.5793, lon: 73.9812, taluk: 'Haveli' },
  { name: 'Baramati, Pune (Soybean/Wheat)', lat: 18.1519, lon: 74.5772, taluk: 'Baramati' },
  { name: 'Shirur, Pune (Onion/Bajara)', lat: 18.8277, lon: 74.3792, taluk: 'Shirur' },
  { name: 'Junnar, Pune (Grapes/Gram)', lat: 19.2083, lon: 73.8769, taluk: 'Junnar' },
  { name: 'Indapur, Pune (Sugarcane)', lat: 18.1158, lon: 75.0342, taluk: 'Indapur' },
];

const CROPS = [
  'Sugarcane',
  'Soybean',
  'Cotton',
  'Tur (Pigeon Pea)',
  'Wheat',
  'Onion',
  'Jowar (Sorghum)',
  'Bajra (Pearl Millet)',
  'Gram (Chickpea)',
  'Grapes',
  'Fallow',
];

const CoordinateMonitoringModalContent: React.FC<CoordinateMonitoringModalProps> = ({
  isOpen,
  onClose,
  availablePlots = [],
  defaultPlot,
  onAreaCreated,
}) => {

  // Selected plot linkage
  const [selectedPlotId, setSelectedPlotId] = useState<string>(defaultPlot?.id || 'none');

  // Name & details
  const [areaName, setAreaName] = useState<string>(
    defaultPlot ? `${defaultPlot.plot_name} Continuous Monitoring` : 'Field Parcel Satellite Monitoring'
  );

  // Coordinate inputs
  const [rawCoordInput, setRawCoordInput] = useState<string>(
    defaultPlot
      ? `${defaultPlot.boundary_coordinates[0][0]}, ${defaultPlot.boundary_coordinates[0][1]}`
      : '18.5793, 73.9812'
  );
  const [latitude, setLatitude] = useState<string>(
    defaultPlot ? defaultPlot.boundary_coordinates[0][0].toString() : '18.5793'
  );
  const [longitude, setLongitude] = useState<string>(
    defaultPlot ? defaultPlot.boundary_coordinates[0][1].toString() : '73.9812'
  );

  // Radius & Season
  const [radiusKm, setRadiusKm] = useState<number>(0.5);
  const [preferredCrop, setPreferredCrop] = useState<string>(defaultPlot?.crop_type || 'Sugarcane');
  const [season, setSeason] = useState<'kharif' | 'rabi' | 'summer' | 'annual'>('kharif');
  const [startDate, setStartDate] = useState<string>('2026-06-01');
  const [endDate, setEndDate] = useState<string>('2026-10-31');

  // Execution states
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto parse when user enters coordinates in combined box
  const handleCoordInputChange = (val: string) => {
    setRawCoordInput(val);
    const parsed = satelliteMonitoringService.parseCoordinates(val);
    if (parsed) {
      setLatitude(parsed.lat.toString());
      setLongitude(parsed.lon.toString());
      setErrorMessage(null);
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

  const handlePlotSelect = (plotId: string) => {
    setSelectedPlotId(plotId);
    if (plotId !== 'none') {
      const match = availablePlots.find((p) => p.id === plotId);
      if (match && match.boundary_coordinates.length > 0) {
        const [lat, lon] = match.boundary_coordinates[0];
        setLatitude(lat.toString());
        setLongitude(lon.toString());
        setRawCoordInput(`${lat}, ${lon}`);
        setAreaName(`${match.plot_name} (Survey ${match.survey_number})`);
        if (match.crop_type) {
          setPreferredCrop(match.crop_type);
        }
      }
    }
  };

  const handlePresetSelect = (preset: typeof MAHARASHTRA_PRESETS[0]) => {
    setLatitude(preset.lat.toString());
    setLongitude(preset.lon.toString());
    setRawCoordInput(`${preset.lat}, ${preset.lon}`);
    setAreaName(`${preset.name} Monitoring`);
    setSelectedPlotId('none');
  };

  // Calculated area in hectares
  const calculatedHectares = Math.PI * Math.pow(radiusKm, 2) * 100; // rough circular area in ha
  const calculatedAcres = calculatedHectares * 2.47105;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    const latNum = parseFloat(latitude);
    const lonNum = parseFloat(longitude);

    if (isNaN(latNum) || isNaN(lonNum)) {
      setErrorMessage('Please enter valid numeric latitude and longitude coordinates.');
      return;
    }

    if (latNum < 15.0 || latNum > 22.5 || lonNum < 72.0 || lonNum > 81.0) {
      setErrorMessage(
        'Warning: Coordinates appear outside Maharashtra bounds (Lat: 15.0° - 22.5° N, Lon: 72.0° - 81.0° E). Please verify.'
      );
      return;
    }

    setIsSubmitting(true);
    setStatusMessage('Registering monitoring area in Maharashtra spatial registry...');

    try {
      const currentUser = mockDb.currentUser;
      const createdArea = await satelliteMonitoringService.registerMonitoringArea({
        user_id: currentUser.id,
        farmer_id: currentUser.id,
        plot_id: selectedPlotId !== 'none' ? selectedPlotId : undefined,
        name: areaName.trim() || 'Custom Farm Plot Monitoring',
        latitude: latNum,
        longitude: lonNum,
        radius_km: radiusKm,
        area_hectares: parseFloat(calculatedHectares.toFixed(2)),
        area_acres: parseFloat(calculatedAcres.toFixed(2)),
        start_date: startDate,
        end_date: endDate,
        interval_days: 15,
        preferred_crop: preferredCrop,
        preferred_season: season,
      });

      setStatusMessage('Querying Copernicus Sentinel-2 L2A STAC archive & processing 15-day intervals...');
      
      // Process observations for this area
      await satelliteMonitoringService.processAreaObservations(createdArea.id, {
        usePythonBackend: true,
      });

      setStatusMessage('Done! 15-Day continuous monitoring initialized.');
      onAreaCreated(createdArea);
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to initialize continuous monitoring');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full border border-slate-200 overflow-hidden my-6">
        {/* Modal Header */}
        <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white px-6 py-4 flex items-center justify-between border-b border-slate-700">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/20 text-emerald-400 rounded-xl border border-emerald-500/30">
              <Compass className="w-6 h-6 animate-spin-slow" />
            </div>
            <div>
              <h2 className="text-lg font-bold">Start 15-Day Satellite Farm Monitoring</h2>
              <p className="text-xs text-slate-300">
                Automatic updates every 15 days &bull; Crop growth, health and moisture tracking
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {errorMessage && (
            <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-2.5">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-500 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Monitoring Name */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
              Monitoring Area Name
            </label>
            <input
              type="text"
              value={areaName}
              onChange={(e) => setAreaName(e.target.value)}
              placeholder="e.g. Wagholi Sugarcane & Tur Parcel"
              required
              className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-medium text-slate-800"
            />
          </div>

          {/* Link to Existing Cadastral Plot */}
          {availablePlots.length > 0 && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                Link with Registered Cadastral Plot (Optional)
              </label>
              <select
                value={selectedPlotId}
                onChange={(e) => handlePlotSelect(e.target.value)}
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-slate-800 bg-white"
              >
                <option value="none">-- Direct Coordinate Input (No linked plot) --</option>
                {availablePlots.map((plot) => (
                  <option key={plot.id} value={plot.id}>
                    {plot.plot_name} (Survey: {plot.survey_number}, {plot.village}, {plot.area_acres} Acres)
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Coordinate Inputs with Comma-Separated Paste Support */}
          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-emerald-600" />
                Target Geographic Coordinates
              </span>
              <span className="text-[11px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                Paste supported: "lat, lon"
              </span>
            </div>

            {/* Quick Combined Paste Field */}
            <div>
              <label className="block text-[11px] text-slate-500 mb-1">
                Paste Coordinates (e.g. <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700 font-mono">19.0760, 72.8777</code> or <code className="bg-slate-200 px-1 py-0.5 rounded text-slate-700 font-mono">18.5793, 73.9812</code>):
              </label>
              <input
                type="text"
                value={rawCoordInput}
                onChange={(e) => handleCoordInputChange(e.target.value)}
                placeholder="18.5793, 73.9812"
                className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-slate-800"
              />
            </div>

            {/* Lat and Lon Fields */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Latitude (°N)</label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => handleLatChange(e.target.value)}
                  placeholder="18.5793"
                  required
                  className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-slate-800"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">Longitude (°E)</label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => handleLonChange(e.target.value)}
                  placeholder="73.9812"
                  required
                  className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-slate-800"
                />
              </div>
            </div>

            {/* Maharashtra Quick Presets */}
            <div>
              <span className="block text-[11px] font-semibold text-slate-500 mb-1.5">
                Quick Test Locations (Pune District):
              </span>
              <div className="flex flex-wrap gap-1.5">
                {MAHARASHTRA_PRESETS.map((preset) => (
                  <button
                    key={preset.name}
                    type="button"
                    onClick={() => handlePresetSelect(preset)}
                    className="text-[11px] px-2.5 py-1 rounded-md bg-white border border-slate-300 text-slate-700 hover:border-emerald-500 hover:text-emerald-700 hover:bg-emerald-50 transition-colors cursor-pointer"
                  >
                    {preset.name}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Radius, Crop & Season Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Radius */}
            <div>
              <div className="flex justify-between items-center mb-1">
                <label className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Monitoring Radius
                </label>
                <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                  {radiusKm} km (~{calculatedHectares.toFixed(1)} ha / {calculatedAcres.toFixed(1)} ac)
                </span>
              </div>
              <input
                type="range"
                min="0.2"
                max="3.0"
                step="0.1"
                value={radiusKm}
                onChange={(e) => setRadiusKm(parseFloat(e.target.value))}
                className="w-full accent-emerald-600 cursor-pointer mt-1"
              />
              <p className="text-[11px] text-slate-500 mt-1">
                Sentinel-2 10m/20m pixels within this radius are composited using cloud-free SCL masking.
              </p>
            </div>

            {/* Expected Crop */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Declared / Primary Crop
              </label>
              <select
                value={preferredCrop}
                onChange={(e) => setPreferredCrop(e.target.value)}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-slate-800 bg-white"
              >
                {CROPS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-slate-500 mt-1">
                ML Phenology classifier compares 15-day curve against this baseline.
              </p>
            </div>
          </div>

          {/* Date Range & Cadence */}
          <div className="grid grid-cols-2 gap-3 pt-1">
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Monitoring Start Date
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-slate-800"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1">
                Monitoring End Date
              </label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                required
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 text-slate-800"
              />
            </div>
          </div>

          {/* Cadence info box */}
          <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/60 flex items-start gap-2.5 text-xs text-emerald-900">
            <Info className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">Automated 15-Day Continuous Observation Protocol</p>
              <p className="text-emerald-800 mt-0.5">
                Every 15-day interval generates a max-NDVI composite from Sentinel-2 L2A BOA scenes. Heavy monsoon overcast periods are cataloged with transparent cloud badges rather than synthetic approximations.
              </p>
            </div>
          </div>

          {/* Action Footer */}
          <div className="flex items-center justify-between pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-semibold text-sm shadow-md hover:shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{statusMessage || 'Processing STAC imagery...'}</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>Start 15-Day Monitoring</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// Mount the content only while open so its hooks always run in the same order.
export const CoordinateMonitoringModal: React.FC<CoordinateMonitoringModalProps> = (props) =>
  props.isOpen ? <CoordinateMonitoringModalContent {...props} /> : null;
