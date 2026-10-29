/**
 * AgriSurvey AI — Crop Intelligence, Yield Forecast, & Disaster Assessment Modal
 * 
 * Unifies:
 * 1. AI Spectral Crop Classification (MH-CROP-RF-v2.3) with human verification.
 * 2. Agricultural Yield Forecasting pipeline (Cultivated Ha × Yield t/ha = Total Tonnes).
 * 3. Preliminary Disaster Damage Assessment (Pre vs. Post NDVI drop, affected acres, inspection priority).
 * 4. PDF Dossier generation and CSV export.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Activity,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  FileText,
  Download,
  ShieldCheck,
  Sparkles,
  CloudLightning,
  ChevronRight,
  Info,
} from 'lucide-react';
import {
  FarmPlot,
  CropPredictionRecord,
  YieldForecastRecord,
  DisasterAssessmentRecord,
} from '@/types';
import { cropClassificationService } from '@/services/crop-classification.service';
import { yieldForecastingService } from '@/services/yield-forecasting.service';
import { disasterAssessmentService } from '@/services/disaster-assessment.service';
import { reportService } from '@/services/report.service';

interface CropIntelligenceModalProps {
  plot: FarmPlot;
  isOpen: boolean;
  onClose: () => void;
  currentUserRole?: string;
}

const CropIntelligenceModalContent: React.FC<CropIntelligenceModalProps> = ({
  plot,
  isOpen,
  onClose,
  currentUserRole = 'farmer',
}) => {

  const [activeTab, setActiveTab] = useState<'classification' | 'yield' | 'disaster'>('classification');

  const [prediction, setPrediction] = useState<CropPredictionRecord | null>(null);
  const [yieldForecast, setYieldForecast] = useState<YieldForecastRecord | null>(null);
  const [disasters, setDisasters] = useState<DisasterAssessmentRecord[]>([]);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [reviewerNotes, setReviewerNotes] = useState<string>('');

  const loadAllIntelligence = async () => {
    setIsLoading(true);
    try {
      // 1. Load / run crop prediction
      let pred = (await cropClassificationService.getPlotPredictions(plot.id))[0];
      if (!pred) {
        pred = await cropClassificationService.classifyPlotCrop(plot.id);
      }
      setPrediction(pred);

      // 2. Load / run yield forecast
      let yf = await yieldForecastingService.getLatestForecast(plot.id);
      if (!yf) {
        yf = await yieldForecastingService.forecastPlotYield(plot.id);
      }
      setYieldForecast(yf);

      // 3. Load disaster assessments
      let disList = await disasterAssessmentService.getPlotAssessments(plot.id);
      if (disList.length === 0) {
        // Run preliminary assessment
        const createdDis = await disasterAssessmentService.assessPlotDisaster({
          plotId: plot.id,
          eventName: 'Post-Monsoon Heavy Inundation Assessment',
          eventType: 'HEAVY_RAINFALL_FLOOD',
          preEventDate: '2026-10-05',
          postEventDate: '2026-10-20',
          preEventNdvi: 0.71,
          postEventNdvi: 0.68,
        });
        disList = [createdDis];
      }
      setDisasters(disList);
    } catch (err: any) {
      console.error('Error loading crop intelligence:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAllIntelligence();
  }, [plot.id]);

  const handleVerifyPrediction = async (decision: 'CONFIRMED' | 'DISCREPANCY_MARKED') => {
    if (!prediction) return;
    setIsVerifying(true);
    try {
      const updated = await cropClassificationService.verifyCropPrediction({
        predictionId: prediction.id,
        decision,
        verifiedCrop: prediction.predicted_crop,
        reviewerId: 'usr-tahsildar-01',
        reviewerName: 'Anand Shrikant Kulkarni (Tahsildar)',
        reviewerNotes: reviewerNotes || 'Confirmed matching ground survey and 7/12 land revenue extract.',
      });
      setPrediction(updated);
      alert(`Crop verification saved: ${decision}`);
    } catch (err: any) {
      alert(`Error verifying crop: ${err.message}`);
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full border border-slate-200 overflow-hidden my-8">
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-emerald-500/20 text-emerald-400 rounded-lg">
              <Activity className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-base">Agricultural Crop & Disaster Intelligence</h3>
              <p className="text-xs text-slate-400">
                {plot.plot_name} • Survey {plot.survey_number} ({plot.area_acres} Acres / {plot.area_hectares} Ha)
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

        {/* Tab Navigation */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <button
              onClick={() => setActiveTab('classification')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === 'classification'
                  ? 'border-emerald-600 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <Sparkles className="w-4 h-4 text-emerald-600" />
              Crop Classification AI
            </button>

            <button
              onClick={() => setActiveTab('yield')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === 'yield'
                  ? 'border-emerald-600 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              Yield Forecast & Production
            </button>

            <button
              onClick={() => setActiveTab('disaster')}
              className={`py-3 text-xs font-semibold border-b-2 transition-all flex items-center gap-1.5 ${
                activeTab === 'disaster'
                  ? 'border-emerald-600 text-emerald-800'
                  : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}
            >
              <CloudLightning className="w-4 h-4 text-amber-600" />
              Disaster Damage Risk
            </button>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => reportService.generateComprehensivePlotPdf(plot.id)}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-xs font-semibold text-slate-700 flex items-center gap-1 shadow-xs"
            >
              <FileText className="w-3.5 h-3.5 text-emerald-700" />
              PDF Dossier
            </button>
            <button
              onClick={() => reportService.exportPlotDataCsv(plot.id)}
              className="px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-xs font-semibold text-slate-700 flex items-center gap-1 shadow-xs"
            >
              <Download className="w-3.5 h-3.5 text-cyan-700" />
              Export CSV
            </button>
          </div>
        </div>

        {/* Tab Body */}
        <div className="p-6">
          {/* TAB 1: CROP CLASSIFICATION */}
          {activeTab === 'classification' && (
            <div className="space-y-5">
              {prediction ? (
                <>
                  <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
                    <div>
                      <div className="text-[11px] text-emerald-800 font-bold uppercase tracking-wider">
                        Primary Spectral Prediction
                      </div>
                      <div className="text-2xl font-black text-emerald-950 mt-0.5 flex items-center gap-2">
                        <span>{prediction.predicted_crop}</span>
                        <span className="text-sm font-semibold bg-emerald-600 text-white px-2.5 py-0.5 rounded-full">
                          {prediction.confidence_score}% Confidence
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 mt-1">
                        Model: <code className="font-mono text-emerald-800">{prediction.model_version}</code>
                      </div>
                    </div>

                    <div className="text-right">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-xs font-bold ${
                          prediction.verification_status === 'CONFIRMED'
                            ? 'bg-emerald-200 text-emerald-900 border border-emerald-300'
                            : 'bg-amber-100 text-amber-900 border border-amber-300'
                        }`}
                      >
                        {prediction.verification_status === 'CONFIRMED'
                          ? 'Officially Confirmed'
                          : 'AI Estimate (Unverified)'}
                      </span>
                      {prediction.reviewer_name && (
                        <div className="text-[11px] text-slate-500 mt-1">
                          Verified by: {prediction.reviewer_name}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Class Probabilities Bar */}
                  <div>
                    <h4 className="font-bold text-xs text-slate-800 mb-2">Class Probability Distribution</h4>
                    <div className="space-y-2">
                      {Object.entries(prediction.class_probabilities).map(([cropName, prob]) => (
                        <div key={cropName} className="text-xs">
                          <div className="flex justify-between font-medium text-slate-700 mb-0.5">
                            <span>{cropName}</span>
                            <span className="font-mono font-bold">{prob}%</span>
                          </div>
                          <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                            <div
                              className="bg-emerald-600 h-full rounded-full transition-all"
                              style={{ width: `${prob}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Spectral Features Analyzed */}
                  <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                    <div className="font-bold text-slate-800 mb-2">Sentinel-2 Features Analyzed:</div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px] text-slate-600">
                      <div>NDVI Mean: <strong className="text-slate-900">{prediction.features_analyzed.ndvi_mean}</strong></div>
                      <div>NDWI: <strong className="text-slate-900">{prediction.features_analyzed.ndwi}</strong></div>
                      <div>B04 Red: <strong className="text-slate-900">{prediction.features_analyzed.b04_red}</strong></div>
                      <div>B08 NIR: <strong className="text-slate-900">{prediction.features_analyzed.b08_nir}</strong></div>
                    </div>
                  </div>

                  {/* Human Verification Action (for Tahsildars / Admins) */}
                  {(currentUserRole === 'tahsildar' || currentUserRole === 'admin') && (
                    <div className="p-4 bg-slate-100/70 border border-slate-200 rounded-xl space-y-2">
                      <div className="font-bold text-xs text-slate-900 flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-emerald-700" />
                        Tahsildar Crop Verification Authorization
                      </div>
                      <input
                        type="text"
                        placeholder="Add official revenue observation notes..."
                        value={reviewerNotes}
                        onChange={(e) => setReviewerNotes(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white border border-slate-300 rounded-md text-xs focus:outline-hidden"
                      />
                      <div className="flex items-center gap-2 pt-1">
                        <button
                          onClick={() => handleVerifyPrediction('CONFIRMED')}
                          disabled={isVerifying}
                          className="px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-white rounded text-xs font-semibold shadow-xs"
                        >
                          Confirm Crop as Verified
                        </button>
                        <button
                          onClick={() => handleVerifyPrediction('DISCREPANCY_MARKED')}
                          disabled={isVerifying}
                          className="px-3 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-xs font-semibold"
                        >
                          Mark Discrepancy for Re-Inspection
                        </button>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center py-8 text-slate-500 text-xs">Loading crop intelligence...</div>
              )}
            </div>
          )}

          {/* TAB 2: YIELD FORECAST */}
          {activeTab === 'yield' && (
            <div className="space-y-5">
              {yieldForecast ? (
                <>
                  <div className="bg-gradient-to-r from-emerald-950 to-slate-900 text-white p-5 rounded-xl shadow-xs">
                    <div className="text-xs text-emerald-300 font-bold uppercase tracking-wider">
                      Estimated Production Output
                    </div>
                    <div className="text-3xl font-black mt-1">
                      {yieldForecast.estimated_total_tonnes} <span className="text-lg font-normal text-slate-300">tonnes</span>
                    </div>
                    <div className="text-xs text-emerald-200 mt-1">
                      Formula: {yieldForecast.cultivated_area_hectares} Ha × {yieldForecast.estimated_yield_tonnes_per_ha} tonnes/ha
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="text-slate-500 text-[11px]">Cultivated Area</div>
                      <div className="text-base font-bold text-slate-900 mt-0.5">
                        {yieldForecast.cultivated_area_hectares} Ha
                      </div>
                      <div className="text-[10px] text-slate-400">({plot.area_acres} Acres)</div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="text-slate-500 text-[11px]">District Average Baseline</div>
                      <div className="text-base font-bold text-slate-900 mt-0.5">
                        {yieldForecast.historical_baseline_tonnes_per_ha} t/ha
                      </div>
                      <div className="text-[10px] text-emerald-700 font-semibold">
                        +{yieldForecast.deviation_percentage}% above average
                      </div>
                    </div>

                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="text-slate-500 text-[11px]">Uncertainty Band</div>
                      <div className="text-base font-bold text-slate-900 mt-0.5">
                        {yieldForecast.uncertainty_range_tonnes.min} - {yieldForecast.uncertainty_range_tonnes.max} t
                      </div>
                      <div className="text-[10px] text-slate-400">±12% confidence band</div>
                    </div>
                  </div>

                  <div className="p-3.5 bg-amber-50 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
                    <div className="font-bold flex items-center gap-1 text-amber-800">
                      <Info className="w-3.5 h-3.5" /> Data Sources & Methodology:
                    </div>
                    <ul className="list-disc list-inside text-[11px] text-slate-700 space-y-0.5 pl-1">
                      {yieldForecast.data_sources.map((s, idx) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ul>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-slate-500 text-xs">Loading yield forecast...</div>
              )}
            </div>
          )}

          {/* TAB 3: DISASTER DAMAGE ASSESSMENT */}
          {activeTab === 'disaster' && (
            <div className="space-y-4">
              {disasters.length > 0 ? (
                disasters.map((dis) => (
                  <div key={dis.id} className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-2">
                      <div>
                        <div className="font-bold text-sm text-slate-900">{dis.event_name}</div>
                        <div className="text-[11px] text-slate-500">Ref: {dis.event_reference} • Type: {dis.event_type}</div>
                      </div>
                      <span
                        className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                          dis.inspection_priority === 'CRITICAL'
                            ? 'bg-red-100 text-red-800 border border-red-300'
                            : dis.inspection_priority === 'HIGH'
                            ? 'bg-amber-100 text-amber-800 border border-amber-300'
                            : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        }`}
                      >
                        Priority: {dis.inspection_priority}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] text-slate-400">Pre-Event NDVI</div>
                        <div className="font-bold text-slate-800">{dis.pre_event_ndvi}</div>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] text-slate-400">Post-Event NDVI</div>
                        <div className="font-bold text-slate-800">{dis.post_event_ndvi}</div>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] text-slate-400">NDVI Drop (Δ)</div>
                        <div className="font-bold text-red-600">{dis.ndvi_change_delta}</div>
                      </div>
                      <div className="p-2 bg-slate-50 rounded-lg">
                        <div className="text-[10px] text-slate-400">Affected Area</div>
                        <div className="font-bold text-slate-900">{dis.affected_area_acres} Acres ({dis.affected_percentage}%)</div>
                      </div>
                    </div>

                    <div className="p-2.5 bg-slate-50 rounded-lg text-xs text-slate-600">
                      <span className="font-semibold text-slate-800">Surveyor Note: </span>
                      {dis.surveyor_notes}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-center py-8 text-slate-500 text-xs">No disaster alerts recorded.</div>
              )}
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
export const CropIntelligenceModal: React.FC<CropIntelligenceModalProps> = (props) =>
  props.isOpen ? <CropIntelligenceModalContent {...props} /> : null;
