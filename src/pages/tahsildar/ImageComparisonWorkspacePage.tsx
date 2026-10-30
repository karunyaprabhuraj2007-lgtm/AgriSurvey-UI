import React, { useState, useEffect } from 'react';
import {
  Eye,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  CheckSquare,
  AlertTriangle,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  FileText,
  Sliders,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { cropVerificationService } from '@/services/crop-verification.service';
import { droneService } from '@/services/drone.service';
import { mockDb } from '@/services/mock-db';
import { EvidenceImage } from '@/components/media/EvidenceImage';
import { hasEvidenceFile } from '@/lib/evidence';
import { CircleMarker, Tooltip } from 'react-leaflet';
import { HighResFieldMap } from '@/components/satellite/HighResFieldMap';
import { LatestSentinelPanel } from '@/components/satellite/LatestSentinelPanel';
import { SurveyArea, surveyAreaCenter } from '@/lib/sentinel-cog';
import { fieldOutline } from '@/services/field-surveillance.service';
import { ComparisonResultType, FarmerLandImage, DroneImagery, RegistrationApplication } from '@/types';
import { useLanguage } from '@/context/LanguageContext';
import { getTahsildarLabel } from '@/lib/dashboard-localizer';

const DAY_MS = 24 * 3600 * 1000;

/** Great-circle distance in metres between two photo geotags. */
function distanceM(a: { latitude: number | null; longitude: number | null }, b: { latitude: number | null; longitude: number | null }): number | null {
  if (a.latitude === null || a.longitude === null || b.latitude === null || b.longitude === null) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

const photoTime = (t: string | null) => (t ? `${t.replace('T', ' ').slice(0, 16)} (camera clock)` : 'Capture time not in file');
const photoGps = (r: { latitude: number | null; longitude: number | null; rtk_status?: string | null; media_id?: string; image_url?: string }) =>
  !hasEvidenceFile(r)
    ? 'Sample record — coordinates not from a photograph'
    : r.latitude !== null && r.longitude !== null
    ? `${r.rtk_status === 'FIXED' ? 'RTK' : 'GPS'}: ${r.latitude.toFixed(6)}°, ${r.longitude.toFixed(6)}°`
    : 'No GPS in file';

export const ImageComparisonWorkspacePage: React.FC = () => {
  const { language } = useLanguage();
  const tl = (key: string) => getTahsildarLabel(key, language);

  // Applications with evidence to compare
  const applications = mockDb.applications
    .filter((a) => mockDb.landImages.some((i) => i.application_id === a.id) || mockDb.droneImagery.some((d) => d.application_id === a.id))
    .map((a) => ({ ...a, property: a.property ?? mockDb.properties.find((p) => p.id === a.property_id), farmer: a.farmer ?? mockDb.profiles.find((p) => p.id === a.farmer_id) }));
  const [selectedAppId, setSelectedAppId] = useState<string>(applications[0]?.id ?? '');
  const selectedApp = applications.find((a) => a.id === selectedAppId) ?? null;
  const [farmerImages, setFarmerImages] = useState<FarmerLandImage[]>([]);
  const [droneImages, setDroneImages] = useState<DroneImagery[]>([]);

  const [selectedFarmerIndex, setSelectedFarmerIndex] = useState(0);
  const [selectedDroneIndex, setSelectedDroneIndex] = useState(0);
  const [zoomLevel, setZoomLevel] = useState(1);

  // Verification Checklist State
  // Unticked until the reviewer has actually checked each item
  const [checkLandmarks, setCheckLandmarks] = useState(false);
  const [checkBoundaries, setCheckBoundaries] = useState(false);
  const [checkSeasonality, setCheckSeasonality] = useState(false);
  const [checkIrrigation, setCheckIrrigation] = useState(false);
  const [checkQuality, setCheckQuality] = useState(false);

  // Decision State
  const [comparisonOutcome, setComparisonOutcome] = useState<ComparisonResultType | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (!selectedApp) return;
    let cancelled = false;
    Promise.all([
      droneService.getFarmerImages(selectedApp.property_id, selectedApp.id),
      droneService.getDroneImages(selectedApp.property_id, selectedApp.id),
    ]).then(([f, d]) => {
      if (cancelled) return;
      // Actual photographs first (newest capture first), sample records last
      const order = <T extends { media_id?: string; image_url?: string; capture_timestamp: string | null }>(list: T[]) =>
        [...list].sort(
          (a, b) =>
            Number(hasEvidenceFile(b)) - Number(hasEvidenceFile(a)) || (b.capture_timestamp ?? '').localeCompare(a.capture_timestamp ?? '')
        );
      setFarmerImages(order(f));
      setDroneImages(order(d));
      setSelectedFarmerIndex(0);
      setSelectedDroneIndex(0);
      const saved = mockDb.comparisons.find((c) => c.application_id === selectedApp.id);
      setComparisonOutcome(saved?.comparison_result ?? null);
      setReviewNotes(saved?.review_notes ?? '');
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAppId]);

  // Satellite reference for the selected property: registered plot boundary, else 100 m around its coordinates
  const plot = selectedApp ? mockDb.farmPlots.find((p) => p.property_id === selectedApp.property_id) : undefined;
  const satelliteArea: SurveyArea | null =
    plot && plot.boundary_coordinates.length >= 3
      ? { kind: 'polygon', coordinates: plot.boundary_coordinates }
      : selectedApp?.property?.latitude != null && selectedApp.property.longitude != null
      ? { kind: 'circle', center: { lat: selectedApp.property.latitude, lon: selectedApp.property.longitude }, radiusKm: 0.1 }
      : null;
  const geotaggedPhotos = [
    ...farmerImages.filter((i) => hasEvidenceFile(i) && i.latitude !== null).map((i) => ({ r: i, kind: 'Farmer photo' as const })),
    ...droneImages.filter((i) => hasEvidenceFile(i) && i.latitude !== null).map((i) => ({ r: i, kind: 'Drone photo' as const })),
  ];

  const activeFarmerImg = farmerImages[selectedFarmerIndex] ?? null;
  const activeDroneImg = droneImages[selectedDroneIndex] ?? null;
  // Only compare geotags read from actual photograph files
  const pairIsReal = !!activeFarmerImg && !!activeDroneImg && hasEvidenceFile(activeFarmerImg) && hasEvidenceFile(activeDroneImg);
  const pairDistance = pairIsReal ? distanceM(activeFarmerImg!, activeDroneImg!) : null;
  const sampleOnly =
    [...farmerImages, ...droneImages].length > 0 && [...farmerImages, ...droneImages].every((r) => !r.media_id && !r.image_url);

  const handleSaveComparison = async () => {
    if (!selectedApp || !comparisonOutcome) return;
    if (!reviewNotes.trim()) {
      setSaveError('Please record what you compared and observed before saving the finding.');
      return;
    }
    setSaveError(null);
    setIsSaving(true);
    try {
      await cropVerificationService.saveImageComparison({
        applicationId: selectedApp.id,
        propertyId: selectedApp.property_id,
        comparisonResult: comparisonOutcome,
        reviewNotes: reviewNotes.trim(),
      });

      setIsSaving(false);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (err: any) {
      setIsSaving(false);
      setSaveError(err.message || 'Error recording comparison');
    }
  };

  return (
    <DashboardLayout
      title={tl('imageComparisonTitle')}
      subtitle={tl('imageComparisonSubtitle')}
    >
      <div className="space-y-6">
        {/* Workspace Controls Header */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-teal-50 text-teal-800 flex items-center justify-center font-bold">
              <Eye className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                {applications.length ? (
                  <select
                    value={selectedAppId}
                    onChange={(e) => setSelectedAppId(e.target.value)}
                    className="text-xs font-bold text-slate-900 border border-slate-300 rounded-md px-2 py-1 bg-white"
                    aria-label="Application"
                  >
                    {applications.map((a) => (
                      <option key={a.id} value={a.id}>
                        {language === 'mr' ? 'गट क्र.' : 'Survey Gat'} {a.property?.survey_number ?? '—'} • {a.property?.village ?? '—'} • {a.application_reference}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-xs font-bold text-slate-900">No applications with uploaded evidence</span>
                )}
                {selectedApp && <Badge status={selectedApp.status} size="sm" />}
              </div>
              {selectedApp && (
                <p className="text-[11px] text-slate-500 font-mono">
                  {selectedApp.farmer?.full_name ?? 'Farmer'} • {selectedApp.property?.land_area ?? '—'} {language === 'mr' ? 'एकर' : language === 'hi' ? 'एकड़' : 'Acres'} •{' '}
                  {farmerImages.filter(hasEvidenceFile).length} ground photo(s) • {droneImages.filter(hasEvidenceFile).length} drone photo(s)
                  {[...farmerImages, ...droneImages].some((r) => !hasEvidenceFile(r))
                    ? ` • ${[...farmerImages, ...droneImages].filter((r) => !hasEvidenceFile(r)).length} sample record(s) without files`
                    : ''}
                </p>
              )}
            </div>
          </div>

          {/* Synchronized Zoom Controls */}
          <div className="flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-200">
            <span className="text-xs font-semibold text-slate-500 mr-1">{tl('zoomLabel')}</span>
            <button
              onClick={() => setZoomLevel(Math.max(0.8, zoomLevel - 0.2))}
              className="p-1 rounded bg-white hover:bg-slate-100 border border-slate-200 text-slate-700"
              title="Zoom out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-mono w-10 text-center font-bold text-slate-800">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              onClick={() => setZoomLevel(Math.min(2.5, zoomLevel + 0.2))}
              className="p-1 rounded bg-white hover:bg-slate-100 border border-slate-200 text-slate-700"
              title="Zoom in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              className="p-1 rounded bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 ml-1"
              title="Reset zoom"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Real satellite imagery of the property (independent of uploaded photos) */}
        {selectedApp && (
          <Card className="p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 border-b border-slate-100 pb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-indigo-600" />
                Satellite imagery of this property
              </h3>
              <span className="text-[11px] text-slate-500">
                {plot ? `Plot ${plot.plot_reference} boundary` : 'Registered property coordinates (100 m radius)'} · every image is dated
              </span>
            </div>
            {satelliteArea ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <div className="lg:col-span-5">
                  <LatestSentinelPanel area={satelliteArea} />
                </div>
                <div className="lg:col-span-7">
                  <HighResFieldMap
                    center={surveyAreaCenter(satelliteArea)}
                    outline={fieldOutline(satelliteArea)}
                    heightClass="h-[440px]"
                    allowDroneUpload
                  >
                    {geotaggedPhotos.map(({ r, kind }) => (
                      <CircleMarker
                        key={r.id}
                        center={[r.latitude!, r.longitude!]}
                        radius={6}
                        pathOptions={{ color: kind === 'Farmer photo' ? '#10b981' : '#06b6d4', weight: 2, fillOpacity: 0.9 }}
                      >
                        <Tooltip>
                          {kind}: {r.original_filename}
                          {r.capture_timestamp ? ` · ${r.capture_timestamp.replace('T', ' ').slice(0, 16)}` : ''}
                        </Tooltip>
                      </CircleMarker>
                    ))}
                  </HighResFieldMap>
                  {geotaggedPhotos.length > 0 && (
                    <p className="text-[10px] text-slate-500 mt-1">
                      Dots mark where each uploaded photo was taken (green = farmer, blue = drone), from the photo's own GPS tag.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-500">This property has no registered coordinates or plot boundary, so no satellite view can be shown.</p>
            )}
          </Card>
        )}

        {/* Dual-Pane Side-by-Side Viewing Workspace (Section 14 Requirement) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* LEFT PANEL: Farmer-Submitted Ground Photos */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  {tl('leftPanelTitle')}
                </h3>
              </div>
              <span className="text-[11px] font-mono text-emerald-800 font-semibold bg-emerald-50 px-2 py-0.5 rounded">
                {farmerImages.length ? `${tl('photoPrefix')} ${selectedFarmerIndex + 1} ${tl('ofConnector')} ${farmerImages.length}` : '0'}
              </span>
            </div>

            {/* Main Interactive Viewer */}
            <div className="relative rounded-xl overflow-hidden bg-slate-950 h-72 sm:h-96 flex items-center justify-center border border-slate-200 group">
              {activeFarmerImg ? (
                <>
                  <div style={{ transform: `scale(${zoomLevel})` }} className="w-full h-full transition-transform duration-200">
                    <EvidenceImage record={activeFarmerImg} className="w-full h-full object-contain" />
                  </div>
                  <div className="absolute top-2 left-2 bg-slate-900/80 backdrop-blur-xs px-2.5 py-1 rounded text-[10px] text-white font-mono space-y-0.5">
                    <div>{activeFarmerImg.original_filename}</div>
                    <div className="text-emerald-400">{photoTime(activeFarmerImg.capture_timestamp)}</div>
                    <div className="text-slate-300">{photoGps(activeFarmerImg)}</div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 p-6 text-center">The farmer has not uploaded ground photographs for this application.</p>
              )}
            </div>

            {/* Thumbnail Selector Strip */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {farmerImages.map((img, idx) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedFarmerIndex(idx)}
                  className={`w-20 h-14 rounded-lg overflow-hidden border-2 shrink-0 transition-all ${
                    selectedFarmerIndex === idx
                      ? 'border-emerald-600 ring-2 ring-emerald-500/20'
                      : 'border-slate-200 opacity-60 hover:opacity-100'
                  }`}
                >
                  <EvidenceImage record={img} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </Card>

          {/* RIGHT PANEL: Drone Inspection Aerial Imagery */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  {tl('rightPanelTitle')}
                </h3>
              </div>
              <span className="text-[11px] font-mono text-cyan-800 font-semibold bg-cyan-50 px-2 py-0.5 rounded">
                {droneImages.length ? `${tl('orthoPrefix')} ${selectedDroneIndex + 1} ${tl('ofConnector')} ${droneImages.length}` : '0'}
              </span>
            </div>

            {/* Main Interactive Viewer */}
            <div className="relative rounded-xl overflow-hidden bg-slate-950 h-72 sm:h-96 flex items-center justify-center border border-slate-200 group">
              {activeDroneImg ? (
                <>
                  <div style={{ transform: `scale(${zoomLevel})` }} className="w-full h-full transition-transform duration-200">
                    <EvidenceImage record={activeDroneImg} className="w-full h-full object-contain" />
                  </div>
                  <div className="absolute top-2 left-2 bg-slate-900/80 backdrop-blur-xs px-2.5 py-1 rounded text-[10px] text-white font-mono space-y-0.5">
                    <div>{activeDroneImg.original_filename}</div>
                    <div className="text-cyan-400">
                      {activeDroneImg.mission_reference ? `${activeDroneImg.mission_reference} • ` : ''}
                      {photoTime(activeDroneImg.capture_timestamp)}
                    </div>
                    <div className="text-slate-300">{photoGps(activeDroneImg)}</div>
                  </div>
                </>
              ) : (
                <p className="text-xs text-slate-400 p-6 text-center">No drone photographs have been uploaded for this application.</p>
              )}
            </div>

            {/* Thumbnail Selector Strip */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              {droneImages.map((img, idx) => (
                <button
                  key={img.id}
                  onClick={() => setSelectedDroneIndex(idx)}
                  className={`w-20 h-14 rounded-lg overflow-hidden border-2 shrink-0 transition-all ${
                    selectedDroneIndex === idx
                      ? 'border-cyan-600 ring-2 ring-cyan-500/20'
                      : 'border-slate-200 opacity-60 hover:opacity-100'
                  }`}
                >
                  <EvidenceImage record={img} className="w-full h-full object-cover" />
                </button>
              ))}
            </div>
          </Card>
        </div>

        {/* Measured facts about the selected pair (no automated image matching is performed) */}
        {(activeFarmerImg || activeDroneImg) && (
          <div className="bg-white rounded-xl border border-slate-200 p-3 text-xs text-slate-700 flex flex-wrap gap-x-6 gap-y-1">
            <span>
              <strong>Distance between photo geotags:</strong>{' '}
              {pairDistance !== null
                ? `${pairDistance < 1000 ? pairDistance.toFixed(0) + ' m' : (pairDistance / 1000).toFixed(2) + ' km'}`
                : pairIsReal
                ? 'Unavailable (a photo has no GPS)'
                : 'Unavailable (sample record without a photograph)'}
            </span>
            <span>
              <strong>Capture dates apart:</strong>{' '}
              {pairIsReal && activeFarmerImg?.capture_timestamp && activeDroneImg?.capture_timestamp
                ? `${Math.round(Math.abs(new Date(activeFarmerImg.capture_timestamp).getTime() - new Date(activeDroneImg.capture_timestamp).getTime()) / DAY_MS)} day(s)`
                : 'Unavailable'}
            </span>
            <span className="text-slate-500">Visual comparison is the reviewer's judgement; no automated similarity score is calculated.</span>
          </div>
        )}
        {sampleOnly && (
          <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl p-3">
            This application only has seeded sample records without photograph files. They are not evidence; ask the farmer and
            field team to upload original photographs.
          </p>
        )}

        {/* Verification Checklist & Official Findings Module */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Checklist (6 Cols) */}
          <Card className="lg:col-span-6 p-6 space-y-4">
            <div className="border-b border-slate-100 pb-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                {tl('officialChecklistTitle')}
              </h4>
              <p className="text-[11px] text-slate-500">
                {tl('officialChecklistDesc')}
              </p>
            </div>

            <div className="space-y-3 text-xs">
              <label className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkLandmarks}
                  onChange={(e) => setCheckLandmarks(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <span className="font-semibold text-slate-800">{tl('chkLandmarksTitle')}</span>
                  <p className="text-[11px] text-slate-500">
                    {tl('chkLandmarksDesc')}
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkBoundaries}
                  onChange={(e) => setCheckBoundaries(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <span className="font-semibold text-slate-800">{tl('chkBoundariesTitle')}</span>
                  <p className="text-[11px] text-slate-500">
                    {tl('chkBoundariesDesc')}
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkSeasonality}
                  onChange={(e) => setCheckSeasonality(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <span className="font-semibold text-slate-800">{tl('chkSeasonalityTitle')}</span>
                  <p className="text-[11px] text-slate-500">
                    {tl('chkSeasonalityDesc')}
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkIrrigation}
                  onChange={(e) => setCheckIrrigation(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <span className="font-semibold text-slate-800">{tl('chkIrrigationTitle')}</span>
                  <p className="text-[11px] text-slate-500">
                    {tl('chkIrrigationDesc')}
                  </p>
                </div>
              </label>

              <label className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-slate-50 cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkQuality}
                  onChange={(e) => setCheckQuality(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500"
                />
                <div>
                  <span className="font-semibold text-slate-800">{tl('chkQualityTitle')}</span>
                  <p className="text-[11px] text-slate-500">
                    {tl('chkQualityDesc')}
                  </p>
                </div>
              </label>
            </div>
          </Card>

          {/* Decision Outcome & Review Notes (6 Cols) */}
          <Card className="lg:col-span-6 p-6 space-y-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div className="border-b border-slate-100 pb-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  {tl('imageComparisonFindingTitle')}
                </h4>
                <p className="text-[11px] text-slate-500">
                  {tl('imageComparisonFindingDesc')}
                </p>
              </div>

              {/* Outcome Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-2">
                  {tl('officialComparisonFindingLabel')}
                </label>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setComparisonOutcome('CONSISTENT')}
                    className={`p-2.5 rounded-lg border text-left font-semibold transition-all ${
                      comparisonOutcome === 'CONSISTENT'
                        ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-emerald-50'
                    }`}
                  >
                    {tl('btnConsistentWithEvidence')}
                  </button>

                  <button
                    type="button"
                    onClick={() => setComparisonOutcome('INCONSISTENT')}
                    className={`p-2.5 rounded-lg border text-left font-semibold transition-all ${
                      comparisonOutcome === 'INCONSISTENT'
                        ? 'bg-rose-600 text-white border-rose-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-rose-50'
                    }`}
                  >
                    {tl('btnInconsistentWithEvidence')}
                  </button>

                  <button
                    type="button"
                    onClick={() => setComparisonOutcome('INSUFFICIENT_EVIDENCE')}
                    className={`p-2.5 rounded-lg border text-left font-semibold transition-all ${
                      comparisonOutcome === 'INSUFFICIENT_EVIDENCE'
                        ? 'bg-amber-600 text-white border-amber-600 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-amber-50'
                    }`}
                  >
                    {tl('btnInsufficientEvidence')}
                  </button>

                  <button
                    type="button"
                    onClick={() => setComparisonOutcome('REQUIRES_REINSPECTION')}
                    className={`p-2.5 rounded-lg border text-left font-semibold transition-all ${
                      comparisonOutcome === 'REQUIRES_REINSPECTION'
                        ? 'bg-cyan-700 text-white border-cyan-700 shadow-xs'
                        : 'bg-white text-slate-700 border-slate-200 hover:bg-cyan-50'
                    }`}
                  >
                    {tl('btnRequiresReinspection')}
                  </button>
                </div>
              </div>

              {/* Review Notes */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {tl('tahsildarReviewNotesLabel')}
                </label>
                <textarea
                  rows={4}
                  value={reviewNotes}
                  onChange={(e) => setReviewNotes(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-900"
                  placeholder={tl('tahsildarReviewNotesPlaceholder')}
                />
              </div>

              {/* AI Similarity Note (Section 14 requirement) */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-[11px] text-slate-600 flex items-start gap-2">
                <Info className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <div>
                  <span className="font-bold">{tl('algorithmicNoticeTitle')}</span> {tl('algorithmicNoticeDesc')}
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
              {savedSuccess ? (
                <span className="text-xs text-emerald-700 font-bold flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  {tl('comparisonSavedSuccessMsg')}
                </span>
              ) : (
                <span className="text-[11px] text-slate-400">
                  {saveError ? (
                    <span role="alert" className="text-red-700">{saveError}</span>
                  ) : (
                    <>
                      {tl('reviewerLabel')} {mockDb.currentUser.full_name} ({language === 'mr' ? 'तहसीलदार' : language === 'hi' ? 'तहसीलदार' : 'Tahsildar'})
                    </>
                  )}
                </span>
              )}

              <Button onClick={handleSaveComparison} isLoading={isSaving} disabled={!selectedApp || !comparisonOutcome}>
                {tl('saveComparisonFindingBtn')}
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </DashboardLayout>
  );
};
