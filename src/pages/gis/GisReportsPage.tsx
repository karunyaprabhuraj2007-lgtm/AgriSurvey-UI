import React, { useState } from 'react';
import {
  FileText,
  Download,
  Filter,
  CheckCircle2,
  Calendar,
  Layers,
  MapPin,
  Building2,
  Activity,
  Sparkles,
  Camera,
  ShieldCheck,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cropLabel } from '@/services/crop-classification.service';
import { reportService } from '@/services/report.service';
import { mockDb } from '@/services/mock-db';
import { MAHARASHTRA_DISTRICTS } from '@/lib/geospatial';
import { useLanguage } from '@/context/LanguageContext';
import { getReportsHubLabel, localizeReportTitle } from '@/lib/dashboard-localizer';

export type ReportType =
  | 'plot_survey'
  | 'village_crop_survey'
  | 'taluka_crop_area'
  | 'district_crop_area'
  | 'field_survey_completion'
  | 'satellite_observation'
  | 'crop_health'
  | 'crop_classification'
  | 'yield_estimation'
  | 'disaster_damage';

const REPORT_DEFINITIONS: Array<{
  id: ReportType;
  title: string;
  category: string;
  description: string;
  primaryMetric: string;
}> = [
  {
    id: 'plot_survey',
    title: '1. Individual Plot Survey Report',
    category: 'Cadastral & Ground',
    description: 'Comprehensive dossier for a single agricultural parcel including boundary coordinates, remote sensing, and crop history.',
    primaryMetric: 'Single Parcel Deep-Dive',
  },
  {
    id: 'village_crop_survey',
    title: '2. Village Crop Survey Report',
    category: 'Village Administration',
    description: 'Village-level aggregation of all registered survey plots, cultivated crops, and verification statuses.',
    primaryMetric: 'Village-Wide Registry',
  },
  {
    id: 'taluka_crop_area',
    title: '3. Taluka Crop-Area Report',
    category: 'Taluka Revenue',
    description: 'Statistical breakdown of total registered acreage, surveyed area, and verified cadastral bounds for a taluka.',
    primaryMetric: 'Taluka Agricultural Area',
  },
  {
    id: 'district_crop_area',
    title: '4. District Crop-Area Report',
    category: 'District Oversight',
    description: 'District summary of agricultural acreage across all talukas, crop distributions, and verified Khatedar land records.',
    primaryMetric: 'District Crop Coverage',
  },
  {
    id: 'field_survey_completion',
    title: '5. Field-Survey Completion Report',
    category: 'Field Operations',
    description: 'Mobile ground surveyor progress, GPS accuracy indicators, offline drafts, and cloud synchronization statistics.',
    primaryMetric: 'Surveyor Field Telemetry',
  },
  {
    id: 'satellite_observation',
    title: '6. Satellite-Observation Report',
    category: 'Remote Sensing',
    description: 'Inventory of Sentinel-2 L2A optical scenes from AWS Earth Search STAC catalog, cloud coverage percentages, and band assets.',
    primaryMetric: 'STAC Scene Catalog',
  },
  {
    id: 'crop_health',
    title: '7. Crop-Health Monitoring Report',
    category: 'Agronomic Health',
    description: 'Calculated (B08-B04)/(B08+B04) NDVI vegetation indices, canopy density classifications, and active sensor anomaly alerts.',
    primaryMetric: 'NDVI Spectral Vigor',
  },
  {
    id: 'crop_classification',
    title: '8. Crop-Classification Evaluation Report',
    category: 'Model Verification',
    description: 'Phenology-matcher results measured against officer ground verification: accuracy on answered plots, coverage and abstentions (only verified plots count).',
    primaryMetric: 'Model Accuracy & Provenance',
  },
  {
    id: 'yield_estimation',
    title: '9. Yield-Estimation Report',
    category: 'Production Economics',
    description: 'Transparent crop yield forecasting based on district historical baselines, NDVI canopy vigor, and uncertainty bands.',
    primaryMetric: 'Tonnage Production Forecast',
  },
  {
    id: 'disaster_damage',
    title: '10. Potential Crop-Damage Assessment Report',
    category: 'Disaster Relief',
    description: 'Multi-temporal satellite NDVI delta change detection highlighting flood, drought, or hail inundated agricultural acreage.',
    primaryMetric: 'Disaster Delta Assessment',
  },
];

export const GisReportsPage: React.FC = () => {
  const { t, language } = useLanguage();
  const [selectedReportId, setSelectedReportId] = useState<ReportType>('district_crop_area');
  const [selectedDistrict, setSelectedDistrict] = useState('Pune');
  const [selectedTaluk, setSelectedTaluk] = useState('Haveli');
  const [selectedVillage, setSelectedVillage] = useState('Wagholi');
  const [selectedPlotId, setSelectedPlotId] = useState(mockDb.farmPlots[0]?.id || '');

  const activeDef = REPORT_DEFINITIONS.find((r) => r.id === selectedReportId) || REPORT_DEFINITIONS[0];

  const handleDownloadPdf = () => {
    switch (selectedReportId) {
      case 'plot_survey':
        reportService.generatePlotSurveyPdf(selectedPlotId);
        break;
      case 'village_crop_survey':
        reportService.generateVillageCropSurveyReport(selectedVillage, selectedDistrict, 'pdf');
        break;
      case 'taluka_crop_area':
        reportService.generateTalukaCropAreaReport(selectedTaluk, selectedDistrict, 'pdf');
        break;
      case 'district_crop_area':
        reportService.generateDistrictCropAreaReport(selectedDistrict, 'pdf');
        break;
      case 'field_survey_completion':
        reportService.generateFieldSurveyCompletionReport('pdf');
        break;
      case 'satellite_observation':
        reportService.generateSatelliteObservationReport('pdf');
        break;
      case 'crop_health':
        reportService.generateCropHealthReport('pdf');
        break;
      case 'crop_classification':
        reportService.generateCropClassificationEvaluationReport('pdf');
        break;
      case 'yield_estimation':
        reportService.generateYieldEstimationReport(selectedDistrict, 'pdf');
        break;
      case 'disaster_damage':
        reportService.generateDisasterAssessmentReport('pdf');
        break;
    }
  };

  const handleDownloadCsv = () => {
    switch (selectedReportId) {
      case 'plot_survey':
        reportService.exportPlotSurveyCsv(selectedPlotId);
        break;
      case 'village_crop_survey':
        reportService.generateVillageCropSurveyReport(selectedVillage, selectedDistrict, 'csv');
        break;
      case 'taluka_crop_area':
        reportService.generateTalukaCropAreaReport(selectedTaluk, selectedDistrict, 'csv');
        break;
      case 'district_crop_area':
        reportService.generateDistrictCropAreaReport(selectedDistrict, 'csv');
        break;
      case 'field_survey_completion':
        reportService.generateFieldSurveyCompletionReport('csv');
        break;
      case 'satellite_observation':
        reportService.generateSatelliteObservationReport('csv');
        break;
      case 'crop_health':
        reportService.generateCropHealthReport('csv');
        break;
      case 'crop_classification':
        reportService.generateCropClassificationEvaluationReport('csv');
        break;
      case 'yield_estimation':
        reportService.generateYieldEstimationReport(selectedDistrict, 'csv');
        break;
      case 'disaster_damage':
        reportService.generateDisasterAssessmentReport('csv');
        break;
    }
  };

  // Render Live Preview Content Based on Selected Report
  const renderLivePreview = () => {
    switch (selectedReportId) {
      case 'plot_survey': {
        const plot = mockDb.farmPlots.find((p) => p.id === selectedPlotId) || mockDb.farmPlots[0];
        return (
          <div className="space-y-3">
            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <span className="text-slate-400 block text-[10px]">Plot Reference</span>
                <strong className="text-slate-800">{plot?.plot_reference}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Survey / Gat No</span>
                <strong className="text-slate-800">{plot?.survey_number}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Cultivated Area</span>
                <strong className="text-slate-800">{plot?.area_acres} Acres</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px]">Cadastre Status</span>
                <span className="text-emerald-700 font-bold">{plot?.is_cadastral_verified ? 'Verified ✓' : 'Pending'}</span>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Dossier includes geodesic polygon coordinates, Sentinel-2 STAC footprint match, NDVI vegetation indices, live Open-Meteo weather parameters, and legal notice disclaimer.
            </div>
          </div>
        );
      }

      case 'village_crop_survey': {
        const data = reportService.getVillageCropSurveyData(selectedVillage, selectedDistrict);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Village</span>
                <strong>{data.village}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Total Parcels</span>
                <strong>{data.totalPlots}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Village Acreage</span>
                <strong className="text-emerald-700">{data.totalAreaAcres} Acres</strong>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2 font-bold">Plot Ref</th>
                    <th className="p-2 font-bold">Survey No</th>
                    <th className="p-2 font-bold">Crop</th>
                    <th className="p-2 font-bold">Acreage</th>
                    <th className="p-2 font-bold">Cadastre Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.plots.map((p) => (
                    <tr key={p.id}>
                      <td className="p-2 font-mono">{p.plot_reference}</td>
                      <td className="p-2">{p.survey_number}</td>
                      <td className="p-2 font-semibold text-emerald-800">{p.crop_type || 'Sugarcane'}</td>
                      <td className="p-2">{p.area_acres} ac</td>
                      <td className="p-2">{p.is_cadastral_verified ? 'Verified ✓' : 'Pending'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'taluka_crop_area': {
        const data = reportService.getTalukaCropAreaData(selectedTaluk, selectedDistrict);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Taluk</span>
                <strong>{data.taluk}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Total Acreage</span>
                <strong>{data.totalAreaAcres} Acres</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Total Hectares</span>
                <strong>{data.totalAreaHa} Ha</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Verified Acreage</span>
                <strong className="text-emerald-700">{data.verifiedAreaAcres} Acres</strong>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              Aggregated across {data.totalPlots} surveyed landholdings in {selectedTaluk} jurisdiction.
            </div>
          </div>
        );
      }

      case 'district_crop_area': {
        const data = reportService.getDistrictCropAreaData(selectedDistrict);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">District</span>
                <strong>{data.district}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Total District Acreage</span>
                <strong className="text-emerald-700">{data.totalAreaAcres} Acres</strong>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2 font-bold">Taluka</th>
                    <th className="p-2 font-bold">Registered Parcels</th>
                    <th className="p-2 font-bold">Cultivated Area (Acres)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {Object.entries(data.talukMap).map(([taluk, info]) => (
                    <tr key={taluk}>
                      <td className="p-2 font-bold">{taluk}</td>
                      <td className="p-2">{info.plots}</td>
                      <td className="p-2 font-semibold text-emerald-800">{info.acres} ac</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'field_survey_completion': {
        const data = reportService.getFieldSurveyCompletionData();
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Total Ground Surveys</span>
                <strong>{data.totalSurveys}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Synchronized</span>
                <strong className="text-emerald-700">{data.syncedCount}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Pending Drafts</span>
                <strong className="text-amber-600">{data.pendingDraftsCount}</strong>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2 font-bold">Survey Ref</th>
                    <th className="p-2 font-bold">Surveyor</th>
                    <th className="p-2 font-bold">Crop</th>
                    <th className="p-2 font-bold">Stage</th>
                    <th className="p-2 font-bold">GPS Accuracy</th>
                    <th className="p-2 font-bold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.surveys.map((s) => (
                    <tr key={s.id}>
                      <td className="p-2 font-mono">{s.survey_reference}</td>
                      <td className="p-2">{s.surveyor_name}</td>
                      <td className="p-2 font-semibold">{s.crop_type}</td>
                      <td className="p-2">{s.growth_stage}</td>
                      <td className="p-2">±{s.gps_accuracy_meters}m</td>
                      <td className="p-2 font-bold text-emerald-700">{s.sync_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'satellite_observation': {
        const data = reportService.getSatelliteObservationData();
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Discovered Sentinel-2 Scenes</span>
                <strong className="text-sky-700">{data.totalScenes}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">NDVI Processed Observations</span>
                <strong className="text-emerald-700">{data.totalObservations}</strong>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2 font-bold">Scene ID</th>
                    <th className="p-2 font-bold">Acquisition Date</th>
                    <th className="p-2 font-bold">Cloud Cover</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.scenes.map((s) => (
                    <tr key={s.id}>
                      <td className="p-2 font-mono text-[10px]">{s.scene_id}</td>
                      <td className="p-2">{new Date(s.acquisition_datetime).toLocaleDateString()}</td>
                      <td className="p-2 font-semibold">{s.cloud_cover_percentage}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'crop_health': {
        const data = reportService.getCropHealthData();
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Processed NDVI Records</span>
                <strong className="text-emerald-700">{data.observationsCount}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Active Anomaly Flags</span>
                <strong className="text-amber-600">{data.activeAlertsCount}</strong>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2 font-bold">Plot UUID</th>
                    <th className="p-2 font-bold">Mean NDVI</th>
                    <th className="p-2 font-bold">Min-Max Range</th>
                    <th className="p-2 font-bold">Pixel Coverage</th>
                    <th className="p-2 font-bold">Canopy Classification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.vegObs.map((v) => (
                    <tr key={v.id}>
                      <td className="p-2 font-mono text-[10px]">{v.plot_id}</td>
                      <td className="p-2 font-bold text-emerald-800">{v.ndvi_mean}</td>
                      <td className="p-2 font-mono">{v.ndvi_min} - {v.ndvi_max}</td>
                      <td className="p-2">{v.valid_pixel_coverage_pct}%</td>
                      <td className="p-2 font-semibold">{v.vegetation_classification}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'crop_classification': {
        const data = reportService.getCropClassificationEvaluationData();
        const ev = data.evaluation;
        const pct = (v: number | null) => (v === null ? 'Not measurable yet' : `${(v * 100).toFixed(1)}%`);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Predictions run</span>
                <strong>{data.totalPredictions}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Officer-verified</span>
                <strong>{ev.verified}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Accuracy (answered, verified)</span>
                <strong className="text-emerald-700">{pct(ev.accuracy)}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Coverage (answered / verified)</span>
                <strong>{pct(ev.coverage)}</strong>
              </div>
            </div>
            <div className="text-xs text-slate-500">
              {data.method}. Accuracy is measured only on plots an officer has verified on the ground; no other accuracy
              figure exists for this model. Labelled samples collected so far:{' '}
              {Object.keys(ev.samplesPerCrop).length
                ? Object.entries(ev.samplesPerCrop).map(([c, n]) => `${c} ${n}`).join(', ')
                : 'none'}
              .
            </div>
          </div>
        );
      }

      case 'yield_estimation': {
        const data = reportService.getYieldEstimationData(selectedDistrict);
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Scenario records</span>
                <strong>{data.totalForecasts}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Sum of production scenarios</span>
                <strong className="text-amber-700">{data.totalProductionTonnes} Tonnes</strong>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2 font-bold">Crop</th>
                    <th className="p-2 font-bold">Expected yield</th>
                    <th className="p-2 font-bold">Yield source</th>
                    <th className="p-2 font-bold">Harvested area</th>
                    <th className="p-2 font-bold">Production (scenario)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.forecasts.map((f) => (
                    <tr key={f.id}>
                      <td className="p-2 font-semibold text-emerald-800">{cropLabel(f.crop_type)}</td>
                      <td className="p-2 font-bold">{f.expected_yield_tonnes_per_ha} t/ha</td>
                      <td className="p-2 text-slate-500">{f.yield_source === 'USER_ENTERED' ? 'Officer-entered' : 'Illustrative figure'}</td>
                      <td className="p-2">{f.harvested_area_hectares} ha</td>
                      <td className="p-2 font-mono text-[11px]">{f.estimated_total_tonnes} t</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }

      case 'disaster_damage': {
        const data = reportService.getDisasterAssessmentData();
        return (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Recorded Hazard Events</span>
                <strong>{data.totalAssessments}</strong>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-lg border border-slate-200">
                <span className="text-slate-400 block text-[10px]">Impacted Acreage</span>
                <strong className="text-rose-700">{data.totalAffectedAcres} Acres</strong>
              </div>
            </div>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 border-b border-slate-200 text-[11px]">
                  <tr>
                    <th className="p-2 font-bold">Hazard Event</th>
                    <th className="p-2 font-bold">NDVI Delta (Pre -&gt; Post)</th>
                    <th className="p-2 font-bold">Affected Area</th>
                    <th className="p-2 font-bold">Damage Severity</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.assessments.map((a) => (
                    <tr key={a.id}>
                      <td className="p-2 font-bold text-slate-800">{a.event_name}</td>
                      <td className="p-2 font-mono text-rose-700">{a.pre_event_ndvi} -&gt; {a.post_event_ndvi} ({a.ndvi_change_delta})</td>
                      <td className="p-2">{a.affected_area_acres} ac ({a.affected_percentage}%)</td>
                      <td className="p-2 font-bold text-rose-600">{a.damage_severity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      }
    }
  };

  return (
    <DashboardLayout
      title={getReportsHubLabel('title', language)}
      subtitle={getReportsHubLabel('subtitle', language)}
    >
      <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Report Category & Type Selector (4 cols) */}
          <div className="lg:col-span-4 space-y-3">
            <Card className="p-4 bg-white border border-slate-200">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                {getReportsHubLabel('selectCategory', language)}
              </h3>
              <div className="space-y-1.5">
                {REPORT_DEFINITIONS.map((rep) => {
                  const isSelected = rep.id === selectedReportId;
                  return (
                    <button
                      key={rep.id}
                      onClick={() => setSelectedReportId(rep.id)}
                      className={`w-full p-2.5 rounded-xl text-left transition-colors text-xs flex items-center justify-between border ${
                        isSelected
                          ? 'bg-emerald-50 border-emerald-300 text-emerald-950 font-bold shadow-xs'
                          : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="space-y-0.5">
                        <span className="block font-semibold">{localizeReportTitle(rep.id, language)}</span>
                        <span className="text-[10px] text-slate-400 block">{rep.category}</span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-white text-slate-600 border border-slate-200">
                        {rep.primaryMetric}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Report Configuration, Live Preview & Export Toolbar (8 cols) */}
          <div className="lg:col-span-8 space-y-4">
            <Card className="p-5 bg-white border border-slate-200 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                    {activeDef.category}
                  </span>
                  <h2 className="text-lg font-extrabold text-slate-900 mt-1">{localizeReportTitle(activeDef.id, language)}</h2>
                  <p className="text-xs text-slate-500 mt-0.5">{activeDef.description}</p>
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    icon={<FileText className="w-3.5 h-3.5" />}
                    onClick={handleDownloadCsv}
                  >
                    {getReportsHubLabel('exportCsv', language)}
                  </Button>

                  <Button
                    size="sm"
                    icon={<Download className="w-3.5 h-3.5" />}
                    onClick={handleDownloadPdf}
                  >
                    {getReportsHubLabel('downloadPdf', language)}
                  </Button>
                </div>
              </div>

              {/* Geographic Parameters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">{getReportsHubLabel('selectDistrict', language)}</label>
                  <select
                    value={selectedDistrict}
                    onChange={(e) => setSelectedDistrict(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300 bg-white"
                  >
                    {MAHARASHTRA_DISTRICTS.map((d) => (
                      <option key={d.name} value={d.name}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">{getReportsHubLabel('selectTaluka', language)}</label>
                  <select
                    value={selectedTaluk}
                    onChange={(e) => setSelectedTaluk(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="Haveli">Haveli</option>
                    <option value="Shirur">Shirur</option>
                    <option value="Baramati">Baramati</option>
                    <option value="Junnar">Junnar</option>
                    <option value="Khed">Khed</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">{getReportsHubLabel('selectVillage', language)}</label>
                  <input
                    type="text"
                    value={selectedVillage}
                    onChange={(e) => setSelectedVillage(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-600 mb-1">{getReportsHubLabel('selectPlot', language)}</label>
                  <select
                    value={selectedPlotId}
                    onChange={(e) => setSelectedPlotId(e.target.value)}
                    className="w-full p-2 rounded-lg border border-slate-300 bg-white"
                  >
                    {mockDb.farmPlots.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.survey_number} — {p.village}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Live Preview Container */}
              <div className="pt-2">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    Live Data Preview (Stored Database Records)
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">EPSG:4326 WGS84 Standard</span>
                </div>
                {renderLivePreview()}
              </div>

              {/* Legal Provenance Notice */}
              <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-[11px] text-amber-900 leading-relaxed">
                <span className="font-bold block mb-1">CRITICAL STATUTORY DISCLAIMER:</span>
                {getReportsHubLabel('statutoryDisclaimer', language)}
              </div>
            </Card>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};
