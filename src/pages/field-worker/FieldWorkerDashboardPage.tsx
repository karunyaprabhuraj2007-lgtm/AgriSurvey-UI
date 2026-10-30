import React, { useState, useEffect } from 'react';
import {
  Camera,
  Calendar,
  Layers,
  CheckCircle2,
  Clock,
  Play,
  UploadCloud,
  FileText,
  MapPin,
  Compass,
  AlertCircle,
  Sprout,
  RefreshCw,
} from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { inspectionService } from '@/services/inspection.service';
import { droneService } from '@/services/drone.service';
import { plantIntelligenceService } from '@/services/plant-intelligence.service';
import { mobileSurveyService } from '@/services/mobile-survey.service';
import { mockDb } from '@/services/mock-db';
import { FieldInspection, DroneImagery, InspectionStatus, MonitoringUnit, FarmPlot } from '@/types';
import { PlantObservationModal } from '@/components/plant-intelligence/PlantObservationModal';
import { MobileFieldSurveyModal } from '@/components/field-survey/MobileFieldSurveyModal';
import { EvidenceImage } from '@/components/media/EvidenceImage';
import { hasEvidenceFile } from '@/lib/evidence';
import { PhotoMetadata, locationSourceLabel, readPhotoMetadata } from '@/lib/photo-metadata';

import { useLanguage } from '@/context/LanguageContext';

export const FieldWorkerDashboardPage: React.FC = () => {
  const { t } = useLanguage();
  const { pathname } = useLocation();
  // Sidebar links: /inspections = still open, /completed = done, /drone-upload = opens upload dialog
  const listView = pathname.endsWith('/completed') ? 'completed' : pathname.endsWith('/inspections') ? 'active' : 'all';
  const worker = mockDb.currentUser;
  const [inspections, setInspections] = useState<FieldInspection[]>([]);
  const [selectedInspection, setSelectedInspection] = useState<FieldInspection | null>(null);
  const [droneUploadModal, setDroneUploadModal] = useState(false);
  const [missionRef, setMissionRef] = useState('MISSION-PUN-DRONE-HAV-082');
  const [flightNotes, setFlightNotes] = useState('Standard RTK grid flight executed at 45m AGL with 75% overlap.');
  const [isUploading, setIsUploading] = useState(false);
  const [droneImages, setDroneImages] = useState<DroneImagery[]>([]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<{ file: File; meta: PhotoMetadata }[]>([]);
  const [isReadingFiles, setIsReadingFiles] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [observationModalOpen, setObservationModalOpen] = useState(false);
  const [selectedUnit, setSelectedUnit] = useState<MonitoringUnit | null>(null);
  const [fieldSurveyModalOpen, setFieldSurveyModalOpen] = useState(false);
  const [isSyncingSurveys, setIsSyncingSurveys] = useState(false);

  const handleSyncOfflineSurveys = async () => {
    setIsSyncingSurveys(true);
    try {
      const result = await mobileSurveyService.syncPendingSurveys();
      alert(`Sync Complete: ${result.syncedCount} survey records synchronized to cloud.`);
    } catch (err: any) {
      alert(`Sync failed: ${err.message}`);
    } finally {
      setIsSyncingSurveys(false);
    }
  };

  useEffect(() => {
    loadInspections();
  }, [worker.id]);

  const loadInspections = async () => {
    const list = await inspectionService.getInspectionsForWorker(worker.id);
    setInspections(list);
    if (list.length > 0) {
      setSelectedInspection(list[0]);
      loadDroneImages(list[0].id);
    }
  };

  const loadDroneImages = async (inspId: string) => {
    const imgs = await droneService.getDroneImages(undefined, undefined, inspId);
    setDroneImages(imgs);
  };

  const handleSelectInsp = (insp: FieldInspection) => {
    setSelectedInspection(insp);
    loadDroneImages(insp.id);
  };

  const handleUpdateStatus = async (
    status: InspectionStatus
  ) => {
    if (!selectedInspection) return;
    try {
      const updated = await inspectionService.updateInspectionStatus(
        selectedInspection.id,
        status,
        flightNotes
      );
      setSelectedInspection(updated);
      loadInspections();
    } catch (err: any) {
      alert(err.message);
    }
  };

  const handleSelectDroneFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    setUploadError(null);
    setIsReadingFiles(true);
    const files = Array.from(list).filter((f) => /^image\/(jpeg|png|tiff)$/.test(f.type) || /\.(jpe?g|png|tiff?|dng)$/i.test(f.name));
    if (files.length < list.length) setUploadError('Only JPG, PNG or TIFF photographs can be uploaded; other files were skipped.');
    const withMeta = await Promise.all(files.map(async (file) => ({ file, meta: await readPhotoMetadata(file) })));
    setPendingFiles((prev) => [...prev, ...withMeta]);
    setIsReadingFiles(false);
  };

  const closeDroneUpload = () => {
    setDroneUploadModal(false);
    setPendingFiles([]);
    setUploadError(null);
  };

  const handleUploadDronePhotos = async () => {
    if (!selectedInspection || pendingFiles.length === 0) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      const uploaded = await droneService.uploadDroneImages({
        inspectionId: selectedInspection.id,
        propertyId: selectedInspection.property_id,
        applicationId: selectedInspection.application_id,
        missionReference: missionRef,
        files: pendingFiles.map((p) => p.file),
      });
      const unsaved = uploaded.filter((u) => !u.media_id && !u.image_url).length;
      if (unsaved) {
        setUploadError(`${unsaved} photograph(s) could not be stored on this device or in the cloud.`);
      } else {
        closeDroneUpload();
      }
      loadDroneImages(selectedInspection.id);
      loadInspections();
    } catch (err: any) {
      setUploadError(err.message || String(err));
    } finally {
      setIsUploading(false);
    }
  };

  // Telemetry summarised from the uploaded files themselves (sample records have no file)
  const realDroneImages = droneImages.filter(hasEvidenceFile);
  const cameraModels = [...new Set(realDroneImages.map((d) => [d.camera_make, d.camera_model].filter(Boolean).join(' ')).filter(Boolean))];
  const altitudes = realDroneImages.map((d) => d.relative_altitude_m).filter((v): v is number => typeof v === 'number');
  const geotagged = realDroneImages.filter((d) => d.latitude !== null).length;
  const rtkFixed = realDroneImages.filter((d) => d.rtk_status === 'FIXED').length;
  const sampleCount = droneImages.length - realDroneImages.length;

  const isInspectionDone = (i: FieldInspection) =>
    i.inspection_status === 'COMPLETED' || i.inspection_status === 'SUBMITTED_FOR_REVIEW';
  const visibleInspections =
    listView === 'completed'
      ? inspections.filter(isInspectionDone)
      : listView === 'active'
      ? inspections.filter((i) => !isInspectionDone(i))
      : inspections;

  const hasSelectedInspection = !!selectedInspection;
  useEffect(() => {
    if (pathname.endsWith('/drone-upload') && hasSelectedInspection) setDroneUploadModal(true);
  }, [pathname, hasSelectedInspection]);

  const totalAssigned = inspections.length;
  const inProgressCount = inspections.filter((i) => i.inspection_status === 'IN_PROGRESS').length;
  const completedCount = inspections.filter(
    (i) => i.inspection_status === 'COMPLETED' || i.inspection_status === 'SUBMITTED_FOR_REVIEW'
  ).length;

  return (
    <DashboardLayout
      title={t('dashboard.fieldWorkerTitle', 'Field Drone Operations Portal')}
      subtitle={`${t('dashboard.fieldWorkerSubtitle', 'Field Surveyor & Certified Pilot • RTK Mission Center')} • ${worker.full_name}`}
    >
      <div className="space-y-6">
        {/* Top Summary Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4">
            <div className="text-[11px] font-semibold text-slate-500 uppercase">Assigned Missions</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{totalAssigned}</div>
          </Card>
          <Card className="p-4 border-amber-200 bg-amber-50/20">
            <div className="text-[11px] font-semibold text-amber-700 uppercase">In Progress</div>
            <div className="text-2xl font-bold text-amber-800 mt-1">{inProgressCount}</div>
          </Card>
          <Card className="p-4 border-teal-200 bg-teal-50/20">
            <div className="text-[11px] font-semibold text-teal-700 uppercase">Evidence Uploaded</div>
            <div className="text-2xl font-bold text-teal-800 mt-1">
              {inspections.filter((i) => i.inspection_status === 'EVIDENCE_UPLOADED').length}
            </div>
          </Card>
          <Card className="p-4 border-emerald-200 bg-emerald-50/20">
            <div className="text-[11px] font-semibold text-emerald-700 uppercase">Submitted to Tahsildar</div>
            <div className="text-2xl font-bold text-emerald-800 mt-1">{completedCount}</div>
          </Card>
        </div>

        {/* Main Workspace Split */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Assigned Inspections List (5 Cols) */}
          <div className="lg:col-span-5 space-y-4">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
              {listView === 'completed'
                ? 'Completed Surveys'
                : listView === 'active'
                ? 'Open Field Inspections'
                : 'Assigned Field Inspections'}{' '}
              ({visibleInspections.length})
            </h3>

            {visibleInspections.length === 0 && (
              <div className="bg-white rounded-xl border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500">
                {listView === 'completed' ? 'No completed surveys yet.' : 'No inspections in this list.'}
              </div>
            )}

            {visibleInspections.map((insp) => {
              const isSelected = selectedInspection?.id === insp.id;
              const prop = insp.property;
              const app = insp.application;
              return (
                <div
                  key={insp.id}
                  onClick={() => handleSelectInsp(insp)}
                  className={`bg-white rounded-xl border p-4 transition-all cursor-pointer ${
                    isSelected
                      ? 'border-emerald-500 ring-2 ring-emerald-500/10 shadow-md'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900">
                        Survey No. {prop?.survey_number}
                      </h4>
                      <p className="text-[11px] text-slate-500 font-mono">
                        {insp.id} • {app?.application_reference}
                      </p>
                    </div>
                    <Badge status={insp.inspection_status} size="sm" />
                  </div>

                  <div className="text-xs text-slate-600 space-y-1 mb-3">
                    <div className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-slate-400" />
                      <span>{prop?.village}, {prop?.taluk} ({prop?.land_area} {prop?.land_area_unit})</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-500">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>Scheduled: {insp.scheduled_at ? new Date(insp.scheduled_at).toLocaleDateString() : 'Pending schedule'}</span>
                    </div>
                  </div>

                  <div className="text-[11px] text-slate-400 border-t border-slate-100 pt-2 truncate">
                    Notes: {insp.field_notes}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Inspection Mission Control & Drone Imagery Gallery (7 Cols) */}
          <div className="lg:col-span-7 space-y-5">
            {selectedInspection ? (
              <Card className="p-6 space-y-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-bold text-slate-900 uppercase">Active Mission</span>
                      <Badge status={selectedInspection.inspection_status} size="sm" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-900">
                      Survey Gat {selectedInspection.property?.survey_number} ({selectedInspection.property?.village})
                    </h3>
                  </div>

                  {/* Mission Status Transition Actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {selectedInspection.inspection_status === 'ASSIGNED' && (
                      <Button
                        size="sm"
                        onClick={() => handleUpdateStatus('IN_PROGRESS')}
                        icon={<Play className="w-3.5 h-3.5" />}
                      >
                        Start Flight Mission
                      </Button>
                    )}

                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setDroneUploadModal(true)}
                      icon={<Camera className="w-3.5 h-3.5" />}
                    >
                      Upload Drone Photos
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      className="border-sky-300 text-sky-800 hover:bg-sky-50"
                      onClick={() => setFieldSurveyModalOpen(true)}
                      icon={<MapPin className="w-3.5 h-3.5 text-sky-600" />}
                    >
                      Mobile Field Survey (GPS)
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      className="border-slate-300 text-slate-700 hover:bg-slate-50"
                      onClick={handleSyncOfflineSurveys}
                      isLoading={isSyncingSurveys}
                      icon={<RefreshCw className="w-3.5 h-3.5 text-slate-500" />}
                    >
                      Sync Offline Drafts
                    </Button>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const unit = mockDb.monitoringUnits.find((u) => u.property_id === selectedInspection.property_id) || mockDb.monitoringUnits[0];
                        setSelectedUnit(unit);
                        setObservationModalOpen(true);
                      }}
                      icon={<Sprout className="w-3.5 h-3.5 text-emerald-600" />}
                    >
                      Record In-Situ Plant Check
                    </Button>

                    {selectedInspection.inspection_status === 'EVIDENCE_UPLOADED' && (
                      <Button
                        size="sm"
                        onClick={() => handleUpdateStatus('SUBMITTED_FOR_REVIEW')}
                        icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                      >
                        Submit to Tahsildar
                      </Button>
                    )}
                  </div>
                </div>

                {/* Telemetry read from the uploaded files (EXIF / DJI XMP) */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Camera / drone</span>
                    <span className="font-semibold text-slate-800">{cameraModels.join(', ') || 'Not in files'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Flight altitude</span>
                    <span className="font-semibold text-slate-800">
                      {altitudes.length
                        ? `${Math.min(...altitudes).toFixed(0)}–${Math.max(...altitudes).toFixed(0)} m above take-off`
                        : 'Not in files'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">Geotagged photos</span>
                    <span className="font-semibold text-slate-800">
                      {realDroneImages.length ? `${geotagged} of ${realDroneImages.length}` : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-bold">RTK fixed</span>
                    <span className="font-semibold text-slate-800">
                      {realDroneImages.length ? (rtkFixed ? `${rtkFixed} photo(s)` : 'None reported') : '—'}
                    </span>
                  </div>
                </div>
                {sampleCount > 0 && (
                  <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                    {sampleCount} record(s) below are seeded sample entries without a photograph file; they are not survey evidence.
                  </p>
                )}

                {/* Drone Images Gallery */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                      Captured Aerial Imagery ({droneImages.length} Photographs)
                    </h4>
                    <span className="text-[11px] text-slate-400 font-mono">
                      Mission: {droneImages[0]?.mission_reference || '—'}
                    </span>
                  </div>

                  {droneImages.length === 0 ? (
                    <div className="p-8 border-2 border-dashed border-slate-200 rounded-xl text-center space-y-2">
                      <Camera className="w-8 h-8 text-slate-400 mx-auto" />
                      <p className="text-xs font-medium text-slate-600">
                        No drone imagery uploaded yet for this inspection parcel.
                      </p>
                      <Button size="sm" onClick={() => setDroneUploadModal(true)}>
                        Upload Drone Photos Now
                      </Button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3">
                      {droneImages.map((img, idx) => (
                        <div
                          key={img.id}
                          className="group relative rounded-xl overflow-hidden border border-slate-200 bg-slate-900"
                        >
                          <EvidenceImage
                            record={img}
                            onOpen={setPreviewUrl}
                            className="w-full h-36 object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute inset-0 pointer-events-none bg-gradient-to-t from-slate-950/80 via-transparent to-black/30 p-2.5 flex flex-col justify-between">
                            <div className="flex items-center justify-between">
                              <span className="bg-cyan-600/90 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                                Photo #{idx + 1}
                              </span>

                            </div>
                            <div>
                              <div className="text-white text-[11px] font-bold truncate">
                                {img.original_filename}
                              </div>
                              <div className="text-[10px] text-cyan-300 font-mono">
                                {img.latitude !== null && img.longitude !== null
                                  ? `${img.latitude.toFixed(6)}°, ${img.longitude.toFixed(6)}°`
                                  : 'No GPS in file'}
                                {img.capture_timestamp ? ` · ${img.capture_timestamp.replace('T', ' ').slice(0, 16)}` : ''}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Field Notes & Survey Diary */}
                <div className="space-y-2 pt-2 border-t border-slate-100">
                  <label className="block text-xs font-bold text-slate-700">
                    Field Survey Observations & Anomaly Log
                  </label>
                  <textarea
                    rows={3}
                    value={flightNotes}
                    onChange={(e) => setFlightNotes(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-slate-300 text-xs bg-white text-slate-900"
                    placeholder="Enter observations on physical landmarks, crop rows, hedges..."
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleUpdateStatus(selectedInspection.inspection_status)}
                    >
                      Save Survey Notes
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <div className="p-12 text-center text-xs text-slate-400">
                Select an inspection assignment to view mission controls.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Drone Upload Modal */}
      <Modal
        isOpen={droneUploadModal}
        onClose={closeDroneUpload}
        title="Upload Drone Mission Photographs"
        description="Original JPG / PNG / TIFF files; GPS, capture time and camera details are read from each file"
        maxWidth="lg"
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Drone Mission Identifier / Flight Log Ref
            </label>
            <input
              type="text"
              value={missionRef}
              onChange={(e) => setMissionRef(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-300 font-mono text-xs bg-white text-slate-900"
            />
          </div>

          <label className="block border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-slate-50 cursor-pointer hover:border-emerald-500">
            <UploadCloud className="w-8 h-8 text-slate-400 mx-auto mb-2" />
            <span className="block font-semibold text-slate-700">Choose drone photographs</span>
            <span className="block text-[10px] text-slate-400 mt-1">
              Upload the original camera files — edited or messaging-app copies usually lose their GPS tags.
            </span>
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/tiff,.dng"
              className="sr-only"
              aria-label="Drone photographs"
              onChange={(e) => {
                handleSelectDroneFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>

          {isReadingFiles && <p className="text-slate-500">Reading photo metadata…</p>}

          {pendingFiles.length > 0 && (
            <ul className="max-h-48 overflow-y-auto divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {pendingFiles.map(({ file, meta }, i) => (
                <li key={`${file.name}-${i}`} className="px-2.5 py-1.5 flex items-center justify-between gap-2">
                  <span className="truncate font-mono text-slate-800">{file.name}</span>
                  <span className={`shrink-0 text-[10px] ${meta.latitude === null ? 'text-amber-700' : 'text-emerald-700'}`}>
                    {locationSourceLabel(meta)}
                    {meta.capturedAt ? ` · ${meta.capturedAt.replace('T', ' ').slice(0, 16)}` : ' · no capture time'}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pendingFiles.some((p) => p.meta.latitude === null) && (
            <p className="text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-2">
              Some photographs have no GPS tag. They will be stored as unlocated evidence; no location is assumed for them.
            </p>
          )}
          {uploadError && (
            <p role="alert" className="text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">
              {uploadError}
            </p>
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="ghost" onClick={closeDroneUpload}>
              Cancel
            </Button>
            <Button
              onClick={handleUploadDronePhotos}
              isLoading={isUploading}
              disabled={pendingFiles.length === 0 || isReadingFiles}
              icon={<CheckCircle2 className="w-4 h-4" />}
            >
              Upload {pendingFiles.length || ''} photograph{pendingFiles.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Fullscreen Preview Modal */}
      <Modal isOpen={Boolean(previewUrl)} onClose={() => setPreviewUrl(null)} maxWidth="2xl">
        {previewUrl && (
          <div className="space-y-2">
            <img src={previewUrl} alt="Drone High Res" className="w-full h-auto rounded-lg max-h-[70vh] object-contain mx-auto" />
            <div className="text-center text-xs text-slate-500">Original uploaded photograph</div>
          </div>
        )}
      </Modal>
      {/* Plant Observation Modal for In-Situ Field Surveys */}
      <PlantObservationModal
        isOpen={observationModalOpen}
        onClose={() => setObservationModalOpen(false)}
        unit={selectedUnit}
        onSuccess={() => {
          alert('✅ Field observation and telemetry recorded for officer review.');
        }}
      />

      {/* Mobile Ground Field Survey Modal with GPS & Offline Sync */}
      {selectedInspection && (
        <MobileFieldSurveyModal
          plot={mockDb.farmPlots.find((p) => p.property_id === selectedInspection.property_id) || mockDb.farmPlots[0]}
          isOpen={fieldSurveyModalOpen}
          onClose={() => setFieldSurveyModalOpen(false)}
          onSurveySubmitted={() => {
            loadInspections();
          }}
        />
      )}
    </DashboardLayout>
  );
};
