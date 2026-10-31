import React, { useState, useEffect, useCallback } from 'react';
import {
  Layers,
  MapPin,
  Filter,
  Plus,
  Search,
  Sparkles,
  CloudSun,
  Activity,
  Download,
  FileText,
  Compass,
  CheckCircle2,
  Clock,
  ShieldCheck,
  Plane,
  Camera,
  RefreshCw,
  X,
  Sprout,
  BarChart3,
  Sliders,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { AgriculturalGISMap } from '@/components/maps/AgriculturalGISMap';
import { SatelliteSearchModal } from '@/components/satellite/SatelliteSearchModal';
import { PlotWeatherDrawer } from '@/components/weather/PlotWeatherDrawer';
import { CropIntelligenceModal } from '@/components/intelligence/CropIntelligenceModal';
import { MobileFieldSurveyModal } from '@/components/field-survey/MobileFieldSurveyModal';
import { plotService } from '@/services/plot.service';
import { reportService } from '@/services/report.service';
import { mockDb } from '@/services/mock-db';
import {
  FarmPlot,
  VegetationIndexObservation,
  WeatherObservation,
  DroneMissionRecord,
  MobileFieldSurveyRecord,
  SatelliteScene,
  AcreageAggregation,
} from '@/types';
import {
  MAHARASHTRA_DISTRICTS,
  computeGeodesicMeasurements,
} from '@/lib/geospatial';
import { ACTIVE_PILOT_TALUKS } from '@/lib/constants';
import { useLanguage } from '@/context/LanguageContext';
import { localizePlotOrCropName, getGisLabel } from '@/lib/dashboard-localizer';

export const GisCropSurveyPage: React.FC = () => {
  const { t, language } = useLanguage();
  const currentUser = mockDb.currentUser;

  // Plots State
  const [plots, setPlots] = useState<FarmPlot[]>([]);
  const [selectedPlot, setSelectedPlot] = useState<FarmPlot | null>(null);
  const [filteredPlots, setFilteredPlots] = useState<FarmPlot[]>([]);

  // Filter Bar State
  const [districtFilter, setDistrictFilter] = useState('Pune');
  const [talukFilter, setTalukFilter] = useState('ALL');
  const [cropFilter, setCropFilter] = useState('ALL');
  const [seasonFilter, setSeasonFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [searchTerm, setSearchTerm] = useState('');

  // Modals & Drawers
  const [satelliteModalOpen, setSatelliteModalOpen] = useState(false);
  const [weatherDrawerOpen, setWeatherDrawerOpen] = useState(false);
  const [intelligenceModalOpen, setIntelligenceModalOpen] = useState(false);
  const [fieldSurveyModalOpen, setFieldSurveyModalOpen] = useState(false);
  const [registerPlotModalOpen, setRegisterPlotModalOpen] = useState(false);

  // Active Map Overlay Context
  const [activeNdviObs, setActiveNdviObs] = useState<VegetationIndexObservation | null>(null);
  const [activeWeather, setActiveWeather] = useState<WeatherObservation | null>(null);
  const [activeDroneMission, setActiveDroneMission] = useState<DroneMissionRecord | null>(null);
  const [activeSceneFootprint, setActiveSceneFootprint] = useState<SatelliteScene | null>(null);
  const [fieldSurveys, setFieldSurveys] = useState<MobileFieldSurveyRecord[]>([]);

  // Crop Area Estimation Aggregation State (Challenge Module A)
  const [acreageSummary, setAcreageSummary] = useState<AcreageAggregation | null>(null);
  const [showAcreagePanel, setShowAcreagePanel] = useState(false);

  // Register New Plot Form State
  const [formPlotName, setFormPlotName] = useState('');
  const [formSurveyNumber, setFormSurveyNumber] = useState('');
  const [formSubdivision, setFormSubdivision] = useState('1');
  const [formVillage, setFormVillage] = useState('Wagholi');
  const [formTaluk, setFormTaluk] = useState('Haveli');
  const [formDistrict, setFormDistrict] = useState('Pune');
  const [formCropSeason, setFormCropSeason] = useState('Kharif');
  const [formDeclaredCrop, setFormDeclaredCrop] = useState('Sugarcane');
  const [formLandDocRef, setFormLandDocRef] = useState('');
  const [formIrrigationType, setFormIrrigationType] = useState('Drip');
  const [isSubmittingPlot, setIsSubmittingPlot] = useState(false);
  const [polygonCoords, setPolygonCoords] = useState<[number, number][]>([
    [18.5780, 73.9810],
    [18.5815, 73.9815],
    [18.5810, 73.9845],
    [18.5775, 73.9840],
    [18.5780, 73.9810],
  ]);

  const loadData = useCallback(async () => {
    const list = await plotService.getPlots();
    setPlots(list);
    setFieldSurveys(mockDb.mobileSurveys);
    if (list.length > 0 && !selectedPlot) {
      setSelectedPlot(list[0]);
    }
  }, [selectedPlot]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Apply Multi-Attribute Filter
  useEffect(() => {
    let result = [...plots];

    if (districtFilter !== 'ALL') {
      result = result.filter((p) => p.district.toLowerCase() === districtFilter.toLowerCase());
    }

    if (talukFilter !== 'ALL') {
      result = result.filter((p) => p.taluk.toLowerCase() === talukFilter.toLowerCase());
    }

    if (cropFilter !== 'ALL') {
      result = result.filter((p) => (p.crop_type || '').toLowerCase() === cropFilter.toLowerCase());
    }

    if (statusFilter !== 'ALL') {
      if (statusFilter === 'VERIFIED') {
        result = result.filter((p) => p.is_cadastral_verified);
      } else if (statusFilter === 'PENDING') {
        result = result.filter((p) => !p.is_cadastral_verified);
      }
    }

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      result = result.filter(
        (p) =>
          p.plot_reference.toLowerCase().includes(q) ||
          p.plot_name.toLowerCase().includes(q) ||
          p.survey_number.toLowerCase().includes(q) ||
          p.village.toLowerCase().includes(q)
      );
    }

    setFilteredPlots(result);
  }, [plots, districtFilter, talukFilter, cropFilter, seasonFilter, statusFilter, searchTerm]);

  // Load Acreage Aggregation & Deduplication metrics (Challenge Module A)
  useEffect(() => {
    plotService
      .getAcreageAggregation({
        level: talukFilter !== 'ALL' ? 'taluk' : 'district',
        regionName: talukFilter !== 'ALL' ? talukFilter : districtFilter !== 'ALL' ? districtFilter : 'Pune',
        cropFilter: cropFilter !== 'ALL' ? cropFilter : undefined,
      })
      .then(setAcreageSummary)
      .catch(console.error);
  }, [districtFilter, talukFilter, cropFilter, plots]);

  const isPilotZone =
    districtFilter === 'Pune' &&
    (talukFilter === 'ALL' || (ACTIVE_PILOT_TALUKS as readonly string[]).includes(talukFilter));

  // Real-time Geodesic Measurements of the current registration polygon
  const currentMeasurements = computeGeodesicMeasurements(polygonCoords);

  // Available talukas for selected district
  const selectedDistrictData = MAHARASHTRA_DISTRICTS.find((d) => d.name === districtFilter);
  const availableTaluks = selectedDistrictData ? selectedDistrictData.talukas.map((t) => t.name) : [];

  // Summary KPIs calculated from real database records
  const totalRegisteredArea = filteredPlots.reduce((acc, p) => acc + p.area_acres, 0);
  const totalHectares = filteredPlots.reduce((acc, p) => acc + p.area_hectares, 0);
  const verifiedCount = filteredPlots.filter((p) => p.is_cadastral_verified).length;
  const verifiedArea = filteredPlots
    .filter((p) => p.is_cadastral_verified)
    .reduce((acc, p) => acc + p.area_acres, 0);

  const handleRegisterPlotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmittingPlot(true);
    try {
      const newPlot = await plotService.createPlot({
        plotName: formPlotName || `Plot - ${formSurveyNumber}`,
        surveyNumber: formSurveyNumber || '142/NEW',
        subdivisionNumber: formSubdivision,
        village: formVillage,
        taluk: formTaluk,
        district: formDistrict,
        farmerId: currentUser.id,
        cropType: formDeclaredCrop,
        coordinates: polygonCoords,
      });

      setRegisterPlotModalOpen(false);
      await loadData();
      setSelectedPlot(newPlot);
      alert(`Plot registered successfully with Reference: ${newPlot.plot_reference}`);
    } catch (err: any) {
      alert(`Error registering plot: ${err.message}`);
    } finally {
      setIsSubmittingPlot(false);
    }
  };

  return (
    <DashboardLayout
      title={t('dashboard.gisCropSurvey', 'GIS Crop Survey & Land Registry')}
      subtitle={getGisLabel('cropSurveySubtitle', language)}
    >
      <div className="space-y-4">
        {/* Top Spatial Control & KPI Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="p-3.5 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>{getGisLabel('totalRegisteredAcreage', language)}</span>
              <Compass className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-xl font-extrabold text-slate-900 mt-1">
              {totalRegisteredArea.toFixed(2)} <span className="text-xs font-medium text-slate-400">{getGisLabel('acres', language)}</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {totalHectares.toFixed(2)} {getGisLabel('haAcrossParcels', language)} {filteredPlots.length} {getGisLabel('parcels', language)}
            </div>
          </Card>

          <Card className="p-3.5 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>{getGisLabel('cadastralVerified', language)}</span>
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-xl font-extrabold text-emerald-700 mt-1">
              {verifiedArea.toFixed(2)} <span className="text-xs font-medium text-slate-400">{getGisLabel('acres', language)}</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">
              {verifiedCount} {getGisLabel('verifiedByTahsildar', language)}
            </div>
          </Card>

          <Card className="p-3.5 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>{getGisLabel('fieldSurveysSynced', language)}</span>
              <Camera className="w-4 h-4 text-sky-600" />
            </div>
            <div className="text-xl font-extrabold text-sky-700 mt-1">{fieldSurveys.length}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{getGisLabel('mobileObservations', language)}</div>
          </Card>

          <Card className="p-3.5 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>{getGisLabel('satelliteNdviStatus', language)}</span>
              <Sparkles className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-xl font-extrabold text-amber-600 mt-1">{getGisLabel('active', language)}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{getGisLabel('sentinel2Discovery', language)}</div>
          </Card>
        </div>

        {/* Spatial Filter Bar & Quick Actions */}
        <Card className="p-3 bg-white border border-slate-200">
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 text-slate-600 font-bold">
                <Filter className="w-3.5 h-3.5 text-slate-500" />
                <span>{getGisLabel('filters', language)}</span>
              </div>

              {/* District */}
              <select
                value={districtFilter}
                onChange={(e) => {
                  setDistrictFilter(e.target.value);
                  setTalukFilter('ALL');
                }}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-700"
              >
                <option value="ALL">{getGisLabel('allDistricts', language)}</option>
                {MAHARASHTRA_DISTRICTS.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>

              {/* Taluka */}
              <select
                value={talukFilter}
                onChange={(e) => setTalukFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-700"
              >
                <option value="ALL">{getGisLabel('allTalukas', language)}</option>
                {availableTaluks.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>

              {/* Crop */}
              <select
                value={cropFilter}
                onChange={(e) => setCropFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-700"
              >
                <option value="ALL">{getGisLabel('allCrops', language)}</option>
                <option value="Sugarcane">{localizePlotOrCropName('Sugarcane', language)}</option>
                <option value="Soybean">{localizePlotOrCropName('Soybean', language)}</option>
                <option value="Cotton">{localizePlotOrCropName('Cotton', language)}</option>
                <option value="Wheat">{localizePlotOrCropName('Wheat', language)}</option>
                <option value="Onion">{localizePlotOrCropName('Onion', language)}</option>
              </select>

              {/* Cadastral Status */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-slate-300 bg-white font-medium text-slate-700"
              >
                <option value="ALL">{getGisLabel('allStatuses', language)}</option>
                <option value="VERIFIED">{getGisLabel('cadastralVerified', language)}</option>
                <option value="PENDING">{getGisLabel('surveyPending', language)}</option>
              </select>

              {/* Search */}
              <div className="relative">
                <input
                  type="text"
                  placeholder={getGisLabel('searchPlaceholder', language)}
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-7 pr-3 py-1.5 rounded-lg border border-slate-300 text-xs w-44"
                />
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2 top-2" />
              </div>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={showAcreagePanel ? 'primary' : 'outline'}
                icon={<BarChart3 className="w-3.5 h-3.5" />}
                onClick={() => setShowAcreagePanel(!showAcreagePanel)}
              >
                Crop Area Estimation
              </Button>

              <Button
                size="sm"
                variant="outline"
                icon={<Download className="w-3.5 h-3.5 text-slate-600" />}
                onClick={() => {
                  if (acreageSummary) {
                    const csv = plotService.exportAcreageCsv(acreageSummary);
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Crop_Acreage_Estimation_${districtFilter}_${talukFilter}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  } else {
                    reportService.exportRegionalAnalyticsCsv(districtFilter === 'ALL' ? undefined : districtFilter);
                  }
                }}
              >
                {getGisLabel('exportCsv', language)}
              </Button>

              <Button
                size="sm"
                variant="outline"
                icon={<Download className="w-3.5 h-3.5 text-slate-600" />}
                onClick={() => {
                  const geo = plotService.exportPlotsGeoJson(filteredPlots);
                  const blob = new Blob([geo], { type: 'application/geo+json' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = `AgriSurvey_${districtFilter}_${talukFilter}_Parcels.geojson`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
              >
                Export GeoJSON
              </Button>

              <Button
                size="sm"
                icon={<Plus className="w-3.5 h-3.5" />}
                onClick={() => setRegisterPlotModalOpen(true)}
              >
                {getGisLabel('registerPlot', language)}
              </Button>
            </div>
          </div>

          {/* Active Pilot Geography Quick Selector */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-100 mt-2 text-[11px]">
            <span className="font-semibold text-slate-500">Active Maharashtra Pilot Talukas:</span>
            {ACTIVE_PILOT_TALUKS.map((t) => (
              <button
                key={t}
                onClick={() => {
                  setDistrictFilter('Pune');
                  setTalukFilter(t);
                }}
                className={`px-2 py-0.5 rounded font-bold transition-colors ${
                  districtFilter === 'Pune' && talukFilter === t
                    ? 'bg-emerald-700 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-700 hover:bg-emerald-50 hover:text-emerald-800'
                }`}
              >
                {t}
              </button>
            ))}
            <button
              onClick={() => {
                setDistrictFilter('Pune');
                setTalukFilter('ALL');
              }}
              className="text-xs text-slate-400 hover:text-slate-600 ml-auto"
            >
              Reset to All Pilot Zones
            </button>
          </div>
        </Card>

        {/* Non-Pilot Region Notice (Challenge Module E Requirement) */}
        {!isPilotZone && (
          <div className="p-4 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 flex items-start gap-3 shadow-xs">
            <MapPin className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <strong className="block text-sm font-bold text-amber-950">
                DATA NOT AVAILABLE FOR THIS REGION
              </strong>
              <p>
                AgriSurvey AI is currently deployed in Phase 1 pilot across Maharashtra designated talukas:
                <strong> Haveli, Baramati, Shirur, and Daund</strong> (Pune District). Land verification, drone
                photogrammetry, and Sentinel-2 phenology matching for{' '}
                <strong>
                  {districtFilter} {talukFilter !== 'ALL' ? `(${talukFilter})` : ''}
                </strong>{' '}
                will be enabled in Phase 2 statewide rollout.
              </p>
              <div className="flex items-center gap-2 pt-1">
                <span className="font-semibold text-amber-800 text-[11px]">Switch to Active Pilot Geography:</span>
                {ACTIVE_PILOT_TALUKS.map((t) => (
                  <button
                    key={t}
                    onClick={() => {
                      setDistrictFilter('Pune');
                      setTalukFilter(t);
                    }}
                    className="px-2 py-0.5 rounded bg-white text-emerald-800 border border-emerald-300 font-bold hover:bg-emerald-50 text-[11px]"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Crop Area Estimation & Deduplication Dashboard (Challenge Module A Requirement) */}
        {showAcreagePanel && acreageSummary && (
          <Card className="p-4 bg-white border border-emerald-200 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <div>
                <span className="text-[10px] uppercase font-bold tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                  Geodesic WGS84 Area Intelligence (Module A)
                </span>
                <h3 className="text-sm font-extrabold text-slate-900 mt-1">
                  Crop Area Estimation & 4-Way Cadastral Accounting: {acreageSummary.region_name}
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-700 font-medium">
                  Quality: <strong>{acreageSummary.data_quality_status}</strong> ({acreageSummary.data_coverage_pct}% verified)
                </span>
              </div>
            </div>

            {/* 4-Way Separation Stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-500 block text-[10px] font-semibold">1. Farmer Declared</span>
                <div className="text-base font-extrabold text-slate-800 mt-0.5">
                  {acreageSummary.farmer_declared_area_ha.toFixed(2)} ha
                </div>
                <span className="text-[10px] text-slate-400">
                  {(acreageSummary.farmer_declared_area_ha * 2.471).toFixed(1)} acres
                </span>
              </div>

              <div className="p-2.5 bg-blue-50/60 rounded-lg border border-blue-200">
                <span className="text-blue-700 block text-[10px] font-semibold">2. ML Predicted</span>
                <div className="text-base font-extrabold text-blue-900 mt-0.5">
                  {acreageSummary.ml_predicted_area_ha.toFixed(2)} ha
                </div>
                <span className="text-[10px] text-blue-600">
                  {(acreageSummary.ml_predicted_area_ha * 2.471).toFixed(1)} acres (Phenology)
                </span>
              </div>

              <div className="p-2.5 bg-sky-50/60 rounded-lg border border-sky-200">
                <span className="text-sky-700 block text-[10px] font-semibold">3. Surveyor Observed</span>
                <div className="text-base font-extrabold text-sky-900 mt-0.5">
                  {acreageSummary.field_observed_area_ha.toFixed(2)} ha
                </div>
                <span className="text-[10px] text-sky-600">
                  {(acreageSummary.field_observed_area_ha * 2.471).toFixed(1)} acres (Mobile GPS)
                </span>
              </div>

              <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200">
                <span className="text-emerald-700 block text-[10px] font-semibold">4. Tahsildar Verified</span>
                <div className="text-base font-extrabold text-emerald-900 mt-0.5">
                  {acreageSummary.tahsildar_verified_area_ha.toFixed(2)} ha
                </div>
                <span className="text-[10px] text-emerald-600">
                  {(acreageSummary.tahsildar_verified_area_ha * 2.471).toFixed(1)} acres (Official 7/12)
                </span>
              </div>
            </div>

            {/* Overlap Deduplication & Net Mapped Area */}
            <div className="p-3 bg-amber-50/50 rounded-lg border border-amber-200 text-xs flex flex-wrap items-center justify-between gap-3">
              <div>
                <span className="font-bold text-amber-900">Spatial Overlap Deduplication:</span>
                <span className="text-slate-600 ml-1.5">
                  Raw polygon sum: <strong>{acreageSummary.raw_polygon_sum_ha.toFixed(2)} ha</strong> | Net non-overlapping mapped ground:{' '}
                  <strong className="text-emerald-700">{acreageSummary.net_mapped_deduplicated_ha.toFixed(2)} ha</strong>
                </span>
              </div>
              <div className="text-[11px] text-amber-800 font-medium">
                {acreageSummary.overlapping_polygons_count > 0 ? (
                  <span>
                    ⚠️ {acreageSummary.overlapping_polygons_count} overlapping parcel boundaries detected ({acreageSummary.overlapping_area_ha.toFixed(2)} ha duplicate avoided)
                  </span>
                ) : (
                  <span>✅ 0 spatial overlap conflicts across surveyed boundaries</span>
                )}
              </div>
            </div>

            {/* Crop-wise Acreage Table */}
            <div className="overflow-x-auto text-xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-[11px] text-slate-500 uppercase">
                    <th className="py-1.5 px-2">Crop / Cover</th>
                    <th className="py-1.5 px-2">Declared (Ha)</th>
                    <th className="py-1.5 px-2">Observed (Ha)</th>
                    <th className="py-1.5 px-2">Verified (Ha)</th>
                    <th className="py-1.5 px-2">Plots Count</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(acreageSummary.crop_acreage).map(([crop, data]) => (
                    <tr key={crop} className="hover:bg-slate-50">
                      <td className="py-1.5 px-2 font-semibold text-slate-800">{crop}</td>
                      <td className="py-1.5 px-2">{data.declared_ha.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-sky-700 font-medium">{data.observed_ha.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-emerald-700 font-bold">{data.verified_ha.toFixed(2)}</td>
                      <td className="py-1.5 px-2 text-slate-500">{data.plots_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="text-[10px] text-slate-400 italic">
              Methodology: {acreageSummary.methodology}
            </div>
          </Card>
        )}

        {/* Main Geospatial Workspace (Grid: 8 cols Map, 4 cols Intelligence Panel) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Interactive GIS Map Container (8 cols) */}
          <div className="lg:col-span-8 rounded-xl overflow-hidden border border-slate-200 shadow-xs bg-white">
            <AgriculturalGISMap
              plots={filteredPlots}
              selectedPlotId={selectedPlot?.id}
              onSelectPlot={(p) => setSelectedPlot(p)}
              activeNdviObservation={activeNdviObs}
              activeWeather={activeWeather}
              activeDroneMission={activeDroneMission}
              activeSceneFootprint={activeSceneFootprint}
              fieldSurveys={fieldSurveys}
              height="660px"
              onOpenSatelliteSearch={(p) => {
                setSelectedPlot(p);
                setSatelliteModalOpen(true);
              }}
              onOpenWeatherDrawer={(p) => {
                setSelectedPlot(p);
                setWeatherDrawerOpen(true);
              }}
              onOpenIntelligenceModal={(p) => {
                setSelectedPlot(p);
                setIntelligenceModalOpen(true);
              }}
              onOpenFieldSurveyModal={(p) => {
                setSelectedPlot(p);
                setFieldSurveyModalOpen(true);
              }}
              onExportReport={(p) => reportService.generatePlotSurveyPdf(p.id)}
            />
          </div>

          {/* Selected Plot Intelligence & Remote Sensing Inspector (4 cols) */}
          <div className="lg:col-span-4 space-y-4">
            {selectedPlot ? (
              <Card className="p-4 space-y-4 bg-white border border-slate-200">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                      {selectedPlot.plot_reference}
                    </span>
                    <h3 className="text-base font-extrabold text-slate-900 mt-1">
                      {localizePlotOrCropName(selectedPlot.plot_name, language)}
                    </h3>
                  </div>
                  <Badge
                    status={selectedPlot.is_cadastral_verified ? 'APPROVED' : 'PENDING_VERIFICATION'}
                    size="sm"
                  />
                </div>

                {/* Plot Cadastral Attributes Grid */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">{getGisLabel('surveyGatNo', language)}</span>
                    <strong className="text-slate-800">{selectedPlot.survey_number}</strong>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">{getGisLabel('cropStand', language)}</span>
                    <strong className="text-emerald-800">
                      {localizePlotOrCropName(selectedPlot.crop_type || 'Sugarcane', language)}
                    </strong>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">{getGisLabel('geodesicArea', language)}</span>
                    <strong className="text-slate-800">
                      {selectedPlot.area_acres} {getGisLabel('acres', language)} <span className="font-normal text-slate-400">({selectedPlot.area_hectares} Ha)</span>
                    </strong>
                  </div>

                  <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                    <span className="text-slate-400 block text-[10px]">{getGisLabel('perimeter', language)}</span>
                    <strong className="text-slate-800">{selectedPlot.perimeter_meters} m</strong>
                  </div>
                </div>

                <div className="text-xs text-slate-600 flex items-center gap-1.5 p-2.5 bg-slate-50 rounded-lg border border-slate-100">
                  <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span>
                    {selectedPlot.village}, Taluka {selectedPlot.taluk}, {selectedPlot.district}
                  </span>
                </div>

                {/* Direct Action Intelligence Triggers */}
                <div className="space-y-2 pt-1 text-xs">
                  <span className="font-bold text-slate-500 uppercase tracking-wider text-[10px] block">
                    {getGisLabel('remoteSensingActions', language)}
                  </span>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => setSatelliteModalOpen(true)}
                      className="p-2.5 rounded-xl border border-sky-200 bg-sky-50/70 hover:bg-sky-100 text-sky-800 font-bold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-sky-600" />
                      <span>{getGisLabel('sentinel2Stac', language)}</span>
                    </button>

                    <button
                      onClick={() => setWeatherDrawerOpen(true)}
                      className="p-2.5 rounded-xl border border-amber-200 bg-amber-50/70 hover:bg-amber-100 text-amber-800 font-bold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <CloudSun className="w-3.5 h-3.5 text-amber-600" />
                      <span>{getGisLabel('openMeteoWeather', language)}</span>
                    </button>

                    <button
                      onClick={() => setIntelligenceModalOpen(true)}
                      className="p-2.5 rounded-xl border border-emerald-200 bg-emerald-50/70 hover:bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Activity className="w-3.5 h-3.5 text-emerald-600" />
                      <span>{getGisLabel('aiYieldDisaster', language)}</span>
                    </button>

                    <button
                      onClick={() => setFieldSurveyModalOpen(true)}
                      className="p-2.5 rounded-xl border border-indigo-200 bg-indigo-50/70 hover:bg-indigo-100 text-indigo-800 font-bold flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Camera className="w-3.5 h-3.5 text-indigo-600" />
                      <span>{getGisLabel('fieldMobileSurvey', language)}</span>
                    </button>
                  </div>

                  <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      icon={<Download className="w-3.5 h-3.5 text-emerald-700" />}
                      onClick={() => reportService.generatePlotSurveyPdf(selectedPlot.id)}
                    >
                      {getGisLabel('plotPdfDossier', language)}
                    </Button>

                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs font-semibold"
                      icon={<FileText className="w-3.5 h-3.5 text-slate-700" />}
                      onClick={() => reportService.exportPlotSurveyCsv(selectedPlot.id)}
                    >
                      {getGisLabel('plotCsvData', language)}
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <Card className="p-8 text-center bg-white border border-slate-200">
                <Compass className="w-10 h-10 text-slate-300 mx-auto mb-2" />
                <h4 className="font-bold text-slate-700 text-sm">{getGisLabel('selectPlotOnMap', language)}</h4>
                <p className="text-xs text-slate-400 mt-1">
                  {getGisLabel('selectPlotHint', language)}
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>

      {/* Register Farm Plot Modal */}
      <Modal
        isOpen={registerPlotModalOpen}
        onClose={() => setRegisterPlotModalOpen(false)}
        title="Register Agricultural Plot — Maharashtra Cadastral GIS"
        maxWidth="2xl"
      >
        <form onSubmit={handleRegisterPlotSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Plot Name / Khatedar Alias</label>
              <input
                type="text"
                required
                placeholder="e.g. Shree Krishna Farmland - Block 2"
                value={formPlotName}
                onChange={(e) => setFormPlotName(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Survey / Gat Number</label>
              <input
                type="text"
                required
                placeholder="e.g. 142/2A"
                value={formSurveyNumber}
                onChange={(e) => setFormSurveyNumber(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">District</label>
              <select
                value={formDistrict}
                onChange={(e) => {
                  setFormDistrict(e.target.value);
                  const d = MAHARASHTRA_DISTRICTS.find((item) => item.name === e.target.value);
                  if (d && d.talukas.length > 0) setFormTaluk(d.talukas[0].name);
                }}
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white"
              >
                {MAHARASHTRA_DISTRICTS.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Taluka</label>
              <select
                value={formTaluk}
                onChange={(e) => setFormTaluk(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white"
              >
                {(MAHARASHTRA_DISTRICTS.find((d) => d.name === formDistrict)?.talukas || []).map((t) => (
                  <option key={t.id} value={t.name}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Village</label>
              <input
                type="text"
                required
                value={formVillage}
                onChange={(e) => setFormVillage(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Crop Season</label>
              <select
                value={formCropSeason}
                onChange={(e) => setFormCropSeason(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white"
              >
                <option value="Kharif">Kharif (खरीप)</option>
                <option value="Rabi">Rabi (रब्बी)</option>
                <option value="Zaid">Zaid / Summer (उन्हाळी)</option>
                <option value="Perennial">Annual / Perennial (बारमाही)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Declared Crop</label>
              <select
                value={formDeclaredCrop}
                onChange={(e) => setFormDeclaredCrop(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white"
              >
                <option value="Sugarcane">Sugarcane (ऊस)</option>
                <option value="Soybean">Soybean (सोयाबीन)</option>
                <option value="Cotton">Cotton (कापूस)</option>
                <option value="Wheat">Wheat (गहू)</option>
                <option value="Onion">Onion (कांदा)</option>
                <option value="Rice">Rice (भात)</option>
                <option value="Pulses">Pulses (डाळी)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Irrigation System</label>
              <select
                value={formIrrigationType}
                onChange={(e) => setFormIrrigationType(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white"
              >
                <option value="Drip">Drip Irrigation (ठिबक)</option>
                <option value="Sprinkler">Sprinkler (तुषार)</option>
                <option value="Canal">Canal Irrigation (कालवा)</option>
                <option value="Borewell">Borewell / Open Well (विहीर/बोअरवेल)</option>
                <option value="Rainfed">Rainfed / Jigani (जिरायती)</option>
              </select>
            </div>
          </div>

          {/* Real-time Geodesic Area Calculation Banner */}
          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
            <div className="space-y-0.5">
              <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider block">
                Calculated Geodesic Boundary Math (WGS84)
              </span>
              <p className="text-xs text-emerald-950 font-bold">
                {currentMeasurements.areaAcres} Acres • {currentMeasurements.areaHectares} Ha • {currentMeasurements.areaSquareMeters.toLocaleString()} m²
              </p>
            </div>
            <span className="text-[10px] text-emerald-700 bg-white px-2 py-1 rounded font-mono font-bold border border-emerald-300">
              Perimeter: {currentMeasurements.perimeterMeters}m
            </span>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Button variant="outline" type="button" onClick={() => setRegisterPlotModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={isSubmittingPlot}>
              Save & Register Plot
            </Button>
          </div>
        </form>
      </Modal>

      {/* Satellite Imagery STAC Modal */}
      {selectedPlot && (
        <SatelliteSearchModal
          plot={selectedPlot}
          isOpen={satelliteModalOpen}
          onClose={() => setSatelliteModalOpen(false)}
          onNdviCalculated={(obs) => {
            setActiveNdviObs(obs);
            loadData();
          }}
        />
      )}

      {/* Plot Live Agrometeorology Drawer */}
      {selectedPlot && (
        <PlotWeatherDrawer
          plot={selectedPlot}
          isOpen={weatherDrawerOpen}
          onClose={() => setWeatherDrawerOpen(false)}
        />
      )}

      {/* Crop Classification, Yield Forecasting & Disaster Assessment Modal */}
      {selectedPlot && (
        <CropIntelligenceModal
          plot={selectedPlot}
          isOpen={intelligenceModalOpen}
          onClose={() => setIntelligenceModalOpen(false)}
          currentUserRole={currentUser.role}
        />
      )}

      {/* Mobile Field Survey Modal */}
      {selectedPlot && (
        <MobileFieldSurveyModal
          plot={selectedPlot}
          isOpen={fieldSurveyModalOpen}
          onClose={() => setFieldSurveyModalOpen(false)}
          onSurveySubmitted={() => {
            loadData();
          }}
        />
      )}
    </DashboardLayout>
  );
};
