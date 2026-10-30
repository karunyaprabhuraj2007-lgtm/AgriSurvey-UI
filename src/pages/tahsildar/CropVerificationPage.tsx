import React, { useState, useEffect } from 'react';
import {
  Sprout,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Info,
  Calendar,
  Layers,
  ShieldCheck,
  Building2,
  FileText,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  CROPS_CATALOG,
  CULTIVATION_SEASONS,
  IRRIGATION_METHODS,
} from '@/lib/constants';
import { cropVerificationService, AiCropAnalysisResult } from '@/services/crop-verification.service';
import { mockDb } from '@/services/mock-db';
import { CropVerificationResultType } from '@/types';
import { useLanguage } from '@/context/LanguageContext';
import { getTahsildarLabel, localizePlotOrCropName } from '@/lib/dashboard-localizer';

export const CropVerificationPage: React.FC = () => {
  const { language } = useLanguage();
  const tl = (key: string) => getTahsildarLabel(key, language);

  const [declaredCrop, setDeclaredCrop] = useState('Sugarcane (ऊस)');
  const [observedCrop, setObservedCrop] = useState('Sugarcane (ऊस)');
  const [cropCategory, setCropCategory] = useState('Cash Crop');
  const [season, setSeason] = useState('Perennial / Annual');
  const [cultivatedArea, setCultivatedArea] = useState(3.45);
  const [irrigation, setIrrigation] = useState('Drip Irrigation');
  const [verificationResult, setVerificationResult] =
    useState<CropVerificationResultType>('MATCHES');
  const [reviewerNotes, setReviewerNotes] = useState(
    'Confirmed on-site: 5-6 month old sugarcane crop stand with active lateral drip irrigation. Stand density matches declaration on 7/12 extract.'
  );

  // AI Analysis State
  const [aiRunning, setAiRunning] = useState(false);
  const [aiResult, setAiResult] = useState<AiCropAnalysisResult | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    // Check if crop verification exists
    cropVerificationService.getCropVerification('app-01').then((cv) => {
      if (cv) {
        setDeclaredCrop(cv.declared_crop_type);
        setObservedCrop(cv.observed_crop_type);
        setCropCategory(cv.crop_category);
        setSeason(cv.cultivation_season);
        if (cv.approximate_cultivated_area) setCultivatedArea(cv.approximate_cultivated_area);
        if (cv.irrigation_method) setIrrigation(cv.irrigation_method);
        setVerificationResult(cv.verification_result);
        if (cv.reviewer_notes) setReviewerNotes(cv.reviewer_notes);
      }
    });
  }, []);

  const handleRunAiAnalysis = async () => {
    setAiRunning(true);
    const res = await cropVerificationService.runAiCropAnalysis();
    setAiRunning(false);
    setAiResult(res);
  };

  const handleSaveCropVerification = async () => {
    setIsSaving(true);
    try {
      await cropVerificationService.saveCropVerification({
        applicationId: 'app-01',
        propertyId: 'prop-01',
        data: {
          declaredCropType: declaredCrop,
          observedCropType: observedCrop,
          cropCategory,
          cultivationSeason: season,
          approximateCultivatedArea: cultivatedArea,
          irrigationMethod: irrigation,
          verificationResult,
          reviewerNotes,
        },
        aiData: aiResult?.prediction
          ? {
              prediction: aiResult.prediction.cropName,
              confidence: aiResult.prediction.confidence,
            }
          : undefined,
      });

      setIsSaving(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setIsSaving(false);
      alert(err.message || 'Error recording crop verification');
    }
  };

  return (
    <DashboardLayout
      title={tl('cropVerificationTitle')}
      subtitle={tl('cropVerificationSubtitle')}
    >
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Land Parcel Summary Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold text-slate-500 uppercase">{tl('verificationTarget')}</span>
              <Badge status={verificationResult} size="sm" />
            </div>
            <h3 className="text-base font-bold text-slate-900">
              Survey Gat 142/2A • Wagholi, Haveli, Pune
            </h3>
            <p className="text-xs text-slate-500 font-mono">
              {tl('farmerPrefix')} Ramesh Patil • {tl('declaredPrefix')}{' '}
              {localizePlotOrCropName(declaredCrop, language)} • {tl('registeredAreaPrefix')} 3.50{' '}
              {language === 'mr' ? 'एकर' : language === 'hi' ? 'एकड़' : 'Acres'}
            </p>
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={handleRunAiAnalysis}
            isLoading={aiRunning}
            icon={<Sparkles className="w-3.5 h-3.5 text-emerald-600" />}
          >
            {tl('runAiCropIdentification')}
          </Button>
        </div>

        {/* AI Analysis Integration Status Banner (Section 15 Requirement) */}
        {aiResult && (
          <div
            className={`p-4 rounded-xl border text-xs leading-relaxed space-y-2 ${
              aiResult.isConfigured
                ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                : 'bg-slate-100 border-slate-300 text-slate-800'
            }`}
          >
            <div className="flex items-center justify-between font-bold">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <span>{tl('aiCropVisionStatus')}</span>
              </div>
              <span className="text-[10px] font-mono bg-white px-2 py-0.5 rounded border border-slate-200">
                {aiResult.isConfigured ? tl('apiConnected') : tl('fallbackStateActive')}
              </span>
            </div>

            <p>{aiResult.statusMessage}</p>

            {aiResult.prediction && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200 text-xs">
                <div>
                  <span className="text-emerald-800 block text-[10px] uppercase font-bold">{tl('predictedCrop')}</span>
                  <span className="font-bold">{localizePlotOrCropName(aiResult.prediction.cropName, language)}</span>
                </div>
                <div>
                  <span className="text-emerald-800 block text-[10px] uppercase font-bold">{tl('confidence')}</span>
                  <span className="font-bold font-mono">{aiResult.prediction.confidence}%</span>
                </div>
                <div>
                  <span className="text-emerald-800 block text-[10px] uppercase font-bold">{tl('vegetationNdvi')}</span>
                  <span className="font-bold font-mono">{aiResult.prediction.vegetationIndexNdvi ?? '—'}</span>
                </div>
                <div>
                  <span className="text-emerald-800 block text-[10px] uppercase font-bold">{tl('suggestedResult')}</span>
                  <span className="font-bold">{aiResult.prediction.suggestedVerification ?? '—'}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Crop Details Form */}
        <Card className="p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-100 pb-3">
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Sprout className="w-4 h-4 text-emerald-600" />
              <span>{tl('officialCropFieldsTitle')}</span>
            </h4>
            <p className="text-xs text-slate-500 mt-0.5">
              {tl('recordObservedCropsDesc')}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            {/* Declared Crop */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {tl('declaredCropTypeLabel')}
              </label>
              <select
                value={declaredCrop}
                onChange={(e) => setDeclaredCrop(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
              >
                {CROPS_CATALOG.map((c) => (
                  <option key={c.id} value={c.name}>
                    {localizePlotOrCropName(c.name, language)}
                  </option>
                ))}
              </select>
            </div>

            {/* Observed Crop */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {tl('observedCropTypeLabel')}
              </label>
              <select
                value={observedCrop}
                onChange={(e) => setObservedCrop(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
              >
                {CROPS_CATALOG.map((c) => (
                  <option key={c.id} value={c.name}>
                    {localizePlotOrCropName(c.name, language)}
                  </option>
                ))}
              </select>
            </div>

            {/* Crop Category */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {tl('cropClassificationCategoryLabel')}
              </label>
              <select
                value={cropCategory}
                onChange={(e) => setCropCategory(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
              >
                <option value="Cash Crop">{tl('catCashCrop')}</option>
                <option value="Cereal">{tl('catCerealGrain')}</option>
                <option value="Millet">{tl('catMillet')}</option>
                <option value="Oilseed">{tl('catOilseed')}</option>
                <option value="Horticulture">{tl('catHorticultureFruit')}</option>
                <option value="Vegetable">{tl('catVegetable')}</option>
                <option value="Fiber">{tl('catFiber')}</option>
              </select>
            </div>

            {/* Cultivation Season */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {tl('cultivationSeasonLabel')}
              </label>
              <select
                value={season}
                onChange={(e) => setSeason(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
              >
                {CULTIVATION_SEASONS.map((s) => {
                  let label = s;
                  if (s === 'Kharif (Monsoon)') label = tl('seasonKharif');
                  else if (s === 'Rabi (Winter)') label = tl('seasonRabi');
                  else if (s === 'Zaid (Summer)') label = tl('seasonZaid');
                  else if (s === 'Perennial / Annual') label = tl('seasonPerennial');
                  return (
                    <option key={s} value={s}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Approx Cultivated Area */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {tl('approxCultivatedAreaLabel')}
              </label>
              <input
                type="number"
                step="0.01"
                value={cultivatedArea}
                onChange={(e) => setCultivatedArea(parseFloat(e.target.value) || 0)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white font-mono"
              />
            </div>

            {/* Irrigation Method */}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {tl('observedIrrigationMethodLabel')}
              </label>
              <select
                value={irrigation}
                onChange={(e) => setIrrigation(e.target.value)}
                className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
              >
                {IRRIGATION_METHODS.map((im) => {
                  let label = im;
                  if (im === 'Drip Irrigation') label = tl('irrigDrip');
                  else if (im === 'Sprinkler Irrigation') label = tl('irrigSprinkler');
                  else if (im === 'Canal / Flow Irrigation') label = tl('irrigCanal');
                  else if (im === 'Borewell / Well Irrigation') label = tl('irrigWell');
                  else if (im === 'Rain-fed (No artificial irrigation)') label = tl('irrigRainfed');
                  return (
                    <option key={im} value={im}>
                      {label}
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Verification Result Selection (Section 15 Requirement) */}
          <div className="pt-2">
            <label className="block text-xs font-bold text-slate-900 mb-2">
              {tl('officialCropVerificationResultLabel')}
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <button
                type="button"
                onClick={() => setVerificationResult('MATCHES')}
                className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                  verificationResult === 'MATCHES'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50'
                }`}
              >
                {tl('btnMatchesDeclaration')}
              </button>

              <button
                type="button"
                onClick={() => setVerificationResult('PARTIALLY_MATCHES')}
                className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                  verificationResult === 'PARTIALLY_MATCHES'
                    ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                }`}
              >
                {tl('btnPartiallyMatches')}
              </button>

              <button
                type="button"
                onClick={() => setVerificationResult('DOES_NOT_MATCH')}
                className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                  verificationResult === 'DOES_NOT_MATCH'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-rose-50'
                }`}
              >
                {tl('btnDoesNotMatch')}
              </button>

              <button
                type="button"
                onClick={() => setVerificationResult('UNABLE_TO_DETERMINE')}
                className={`p-3 rounded-xl border text-center font-semibold transition-all ${
                  verificationResult === 'UNABLE_TO_DETERMINE'
                    ? 'bg-slate-700 text-white border-slate-700 shadow-xs'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
                }`}
              >
                {tl('btnUnableToDetermine')}
              </button>
            </div>
          </div>

          {/* Tahsildar Notes */}
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              {tl('fieldObservationsNotesLabel')}
            </label>
            <textarea
              rows={3}
              value={
                language === 'mr' && reviewerNotes.includes('Confirmed by Tahsildar Anand Kulkarni')
                  ? 'तहसीलदार आनंद कुलकर्णी यांनी प्रमाणित केले: ५-६ महिने वयाचे ऊस पीक प्रत्यक्ष घोषणा व ड्रोन रिफ्लेक्टन्सशी जुळते.'
                  : reviewerNotes
              }
              onChange={(e) => setReviewerNotes(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-900"
              placeholder={tl('fieldObservationsNotesPlaceholder')}
            />
          </div>

          {/* Submission Bar */}
          <div className="flex items-center justify-between pt-4 border-t border-slate-100">
            {saveSuccess ? (
              <span className="text-xs text-emerald-700 font-bold flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                {tl('cropVerificationSavedSuccessMsg')}
              </span>
            ) : (
              <span className="text-[11px] text-slate-400">
                {tl('reviewerLabel')} Anand S. Kulkarni ({language === 'mr' ? 'तहसीलदार' : language === 'hi' ? 'तहसीलदार' : 'Tahsildar'})
              </span>
            )}

            <Button onClick={handleSaveCropVerification} isLoading={isSaving}>
              {tl('saveCropVerificationBtn')}
            </Button>
          </div>
        </Card>
      </div>
    </DashboardLayout>
  );
};
