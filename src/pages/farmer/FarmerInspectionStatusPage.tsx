import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Layers,
  MapPin,
  Clock,
  CheckCircle2,
  Calendar,
  Compass,
  ArrowRight,
  User,
  ShieldCheck,
  Eye,
  RefreshCw,
  Sparkles,
  Camera,
  Activity,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { inspectionService } from '@/services/inspection.service';
import { droneService } from '@/services/drone.service';
import { mockDb } from '@/services/mock-db';
import { FieldInspection, DroneImagery, InspectionStatus } from '@/types';
import { EvidenceImage } from '@/components/media/EvidenceImage';
import { useLanguage } from '@/context/LanguageContext';
import { localizePlotOrCropName } from '@/lib/dashboard-localizer';

export const FarmerInspectionStatusPage: React.FC = () => {
  const { t, language } = useLanguage();
  const farmer = mockDb.currentUser;
  const [inspections, setInspections] = useState<FieldInspection[]>([]);
  const [droneImages, setDroneImages] = useState<DroneImagery[]>([]);
  const [selectedInspection, setSelectedInspection] = useState<FieldInspection | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [previewImageModal, setPreviewImageModal] = useState<DroneImagery | null>(null);

  const loadData = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const list = await inspectionService.getInspectionsForFarmer(farmer.id);
      setInspections(list);

      const allImages = await droneService.getDroneImages();
      setDroneImages(allImages);

      if (list.length > 0 && !selectedInspection) {
        setSelectedInspection(list[0]);
      }
    } finally {
      setIsRefreshing(false);
    }
  }, [farmer.id, selectedInspection]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredInspections = inspections.filter((insp) => {
    if (filterStatus === 'ALL') return true;
    return insp.inspection_status === filterStatus;
  });

  const totalMissions = inspections.length;
  const completedMissions = inspections.filter(
    (i) => i.inspection_status === 'COMPLETED' || i.inspection_status === 'EVIDENCE_UPLOADED'
  ).length;
  const inProgressMissions = inspections.filter((i) => i.inspection_status === 'IN_PROGRESS').length;
  const scheduledMissions = inspections.filter(
    (i) => i.inspection_status === 'SCHEDULED' || i.inspection_status === 'ASSIGNED'
  ).length;

  const getStatusBadge = (status: InspectionStatus) => {
    return <Badge status={status} />;
  };

  const getStepStatus = (insp: FieldInspection, stepIndex: number) => {
    const statusOrder: InspectionStatus[] = [
      'ASSIGNED',
      'SCHEDULED',
      'IN_PROGRESS',
      'EVIDENCE_UPLOADED',
      'COMPLETED',
    ];
    const currentIndex = statusOrder.indexOf(insp.inspection_status);
    if (currentIndex >= stepIndex) return 'complete';
    if (currentIndex === stepIndex - 1) return 'current';
    return 'upcoming';
  };

  return (
    <DashboardLayout
      title={t('dashboard.droneStatusTitle', 'Drone Inspection Status')}
      subtitle={t('dashboard.droneStatusSubtitle', 'Track official UAV aerial photogrammetry missions, flight parameters, and boundary survey evidence.')}
    >
      <div className="space-y-6">
        {/* Header Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="p-4 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Total Drone Missions</span>
              <Layers className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{totalMissions}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Across registered parcels</div>
          </Card>

          <Card className="p-4 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Completed & Verified</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-emerald-600 mt-1">{completedMissions}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Orthomosaics generated</div>
          </Card>

          <Card className="p-4 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>In Progress</span>
              <Activity className="w-4 h-4 text-amber-500" />
            </div>
            <div className="text-2xl font-extrabold text-amber-600 mt-1">{inProgressMissions}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Active field pilots</div>
          </Card>

          <Card className="p-4 bg-white border border-slate-200">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>Upcoming / Scheduled</span>
              <Clock className="w-4 h-4 text-blue-500" />
            </div>
            <div className="text-2xl font-extrabold text-blue-600 mt-1">{scheduledMissions}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">Awaiting weather window</div>
          </Card>
        </div>

        {/* Action & Filter Bar */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
            {['ALL', 'EVIDENCE_UPLOADED', 'COMPLETED', 'IN_PROGRESS', 'SCHEDULED'].map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  filterStatus === st
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {st === 'ALL'
                  ? 'All Missions'
                  : st === 'EVIDENCE_UPLOADED'
                  ? 'Evidence Ready'
                  : st === 'COMPLETED'
                  ? 'Completed'
                  : st === 'IN_PROGRESS'
                  ? 'In Flight'
                  : 'Scheduled'}
              </button>
            ))}
          </div>

          <Button
            variant="outline"
            size="sm"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />}
            onClick={loadData}
          >
            Refresh Flights
          </Button>
        </div>

        {/* Main Content: Inspection Cards */}
        {filteredInspections.length === 0 ? (
          <Card className="p-12 text-center bg-white border-dashed border-2 border-slate-200">
            <Layers className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-bold text-slate-800">No Drone Inspections Found</h3>
            <p className="text-sm text-slate-500 max-w-md mx-auto mt-1">
              There are no drone flights matching the selected filter. Once the Tahsildar assigns an
              aerial inspection to your land parcel, flight logs and orthomosaics will appear here.
            </p>
          </Card>
        ) : (
          <div className="space-y-6">
            {filteredInspections.map((insp) => {
              const inspImages = droneImages.filter((img) => img.inspection_id === insp.id);
              const worker = insp.assigned_worker || mockDb.profiles.find((p) => p.id === insp.assigned_worker_id);

              return (
                <Card key={insp.id} className="overflow-hidden border border-slate-200 bg-white">
                  {/* Card Header */}
                  <div className="p-5 sm:p-6 border-b border-slate-100 bg-slate-50/50 flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded text-[11px] font-mono font-bold bg-slate-200 text-slate-800">
                          {insp.id.toUpperCase()}
                        </span>
                        {getStatusBadge(insp.inspection_status)}
                        <span className="text-xs text-slate-400">
                          • Scheduled: {new Date(insp.scheduled_at || insp.created_at).toLocaleDateString()}
                        </span>
                      </div>
                      <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2">
                        <span>{insp.property?.property_name ? localizePlotOrCropName(insp.property.property_name, language) : 'Primary Farmland'}</span>
                        <span className="text-slate-400 font-normal text-sm">
                          (Survey No: {insp.property?.survey_number || '142/2A'})
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 flex items-center gap-1.5">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        <span>
                          {insp.property?.village || 'Wagholi'}, Taluk {insp.property?.taluk || 'Haveli'}, Pune
                        </span>
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="text-right hidden sm:block">
                        <div className="text-xs font-semibold text-slate-500">Field Inspector</div>
                        <div className="text-sm font-bold text-slate-800">{worker?.full_name || 'Prakash M. Jadhav'}</div>
                        <div className="text-[11px] text-slate-400">{worker?.phone_number || '+91 98229 87654'}</div>
                      </div>
                      <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 font-bold flex items-center justify-center shrink-0">
                        {worker?.full_name?.slice(0, 2).toUpperCase() || 'FW'}
                      </div>
                    </div>
                  </div>

                  {/* 5-Step Mission Progress Tracker */}
                  <div className="p-5 border-b border-slate-100 bg-white">
                    <div className="text-xs font-bold text-slate-500 mb-3 uppercase tracking-wider">
                      UAV Mission Lifecycle
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      {[
                        { title: '1. Mission Assigned', desc: 'Officer authorized', time: insp.created_at },
                        { title: '2. Pre-Flight Check', desc: 'Airspace cleared', time: insp.scheduled_at },
                        { title: '3. Flight Survey', desc: '45m AGL RTK Pass', time: insp.started_at },
                        { title: '4. Orthomosaic Created', desc: 'Photogrammetry stitch', time: insp.completed_at },
                        { title: '5. Revenue Verified', desc: 'Tahsildar approved', time: insp.completed_at },
                      ].map((step, idx) => {
                        const status = getStepStatus(insp, idx);
                        const isDone = status === 'complete';
                        const isCurrent = status === 'current';

                        return (
                          <div
                            key={step.title}
                            className={`p-3 rounded-lg border transition-all ${
                              isDone
                                ? 'bg-emerald-50/60 border-emerald-200'
                                : isCurrent
                                ? 'bg-amber-50/60 border-amber-300 ring-2 ring-amber-100'
                                : 'bg-slate-50 border-slate-200 opacity-60'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-1">
                              {isDone ? (
                                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              ) : isCurrent ? (
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" />
                              ) : (
                                <span className="w-2 h-2 rounded-full bg-slate-300 shrink-0" />
                              )}
                              <span
                                className={`text-xs font-bold ${
                                  isDone
                                    ? 'text-emerald-900'
                                    : isCurrent
                                    ? 'text-amber-900'
                                    : 'text-slate-600'
                                }`}
                              >
                                {step.title}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500">{step.desc}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Flight Parameters & Mission Notes */}
                  <div className="p-5 sm:p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* Column 1: Telemetry Specifications */}
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        UAV Flight Technical Data
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 space-y-2 text-xs">
                        <div className="flex justify-between py-1 border-b border-slate-200">
                          <span className="text-slate-500">Drone Hardware</span>
                          <span className="font-semibold text-slate-800">DJI Matrice 300 RTK</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-200">
                          <span className="text-slate-500">Flight Altitude</span>
                          <span className="font-semibold text-slate-800">45 meters AGL</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-200">
                          <span className="text-slate-500">Sensor Payload</span>
                          <span className="font-semibold text-slate-800">Zenmuse P1 45MP Full-Frame</span>
                        </div>
                        <div className="flex justify-between py-1 border-b border-slate-200">
                          <span className="text-slate-500">Ground Sample Dist (GSD)</span>
                          <span className="font-semibold text-emerald-700">1.2 cm / pixel</span>
                        </div>
                        <div className="flex justify-between py-1">
                          <span className="text-slate-500">Geopositioning Mode</span>
                          <span className="font-semibold text-emerald-700">RTK Fixed (Centimeter-Level)</span>
                        </div>
                      </div>
                    </div>

                    {/* Column 2: Field Worker Inspector Notes */}
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                        Field Inspector Remarks
                      </div>
                      <div className="bg-slate-50 rounded-xl p-4 border border-slate-200 text-xs text-slate-700 leading-relaxed space-y-3">
                        <p>{insp.field_notes || 'Standard automated aerial grid completed without anomalies.'}</p>
                        <div className="p-2.5 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 flex items-start gap-2">
                          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                          <span>
                            Boundary survey markers match 7/12 land records within allowable margin of error (0.02 acres).
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Column 3: Orthomosaic & Aerial Evidence Preview */}
                    <div className="space-y-3">
                      <div className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                        <span>Aerial Evidence ({inspImages.length} captured)</span>
                        <span className="text-[10px] text-emerald-600 font-semibold">RTK Geotagged</span>
                      </div>

                      {inspImages.length === 0 ? (
                        <div className="h-32 rounded-xl border border-dashed border-slate-200 bg-slate-50 flex flex-col items-center justify-center text-slate-400 text-xs">
                          <Camera className="w-6 h-6 mb-1 opacity-50" />
                          <span>Awaiting aerial imagery upload</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {inspImages.map((img) => (
                            <div
                              key={img.id}
                              onClick={() => setPreviewImageModal(img)}
                              className="group relative rounded-lg overflow-hidden border border-slate-200 bg-slate-900 aspect-video cursor-pointer"
                            >
                              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10" />
                              <EvidenceImage
                                record={img}
                                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                              />
                              <div className="absolute bottom-1.5 left-2 right-2 z-20 flex items-center justify-between text-[10px] text-white">
                                <span className="font-mono truncate max-w-[90px]">{img.original_filename}</span>
                                <Eye className="w-3 h-3 group-hover:text-emerald-400" />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="pt-2">
                        <Link to="/farmer/reports">
                          <Button variant="outline" size="sm" className="w-full" icon={<ArrowRight className="w-3.5 h-3.5" />}>
                            View Tahsildar Report
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {/* Modal: Aerial Imagery Full Preview */}
        {previewImageModal && (
          <Modal
            isOpen={Boolean(previewImageModal)}
            onClose={() => setPreviewImageModal(null)}
            title={`Drone photograph: ${previewImageModal.original_filename}`}
            maxWidth="2xl"
          >
            <div className="space-y-4">
              <div className="rounded-xl overflow-hidden bg-slate-950 aspect-video relative">
                <EvidenceImage record={previewImageModal} className="w-full h-full object-contain" />
                <div className="absolute top-3 left-3 bg-black/70 backdrop-blur-md px-2.5 py-1 rounded text-white text-xs font-mono">
                  {previewImageModal.latitude != null && previewImageModal.longitude != null
                    ? `${previewImageModal.rtk_status === 'FIXED' ? 'RTK fixed' : 'Camera GPS'}: ${previewImageModal.latitude.toFixed(6)}°, ${previewImageModal.longitude.toFixed(6)}°`
                    : 'No GPS in file'}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div>
                  <span className="text-slate-400 block text-[10px]">MISSION REF</span>
                  <span className="font-semibold text-slate-800">{previewImageModal.mission_reference || '—'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">CAPTURE TIME</span>
                  <span className="font-semibold text-slate-800">
                    {previewImageModal.capture_timestamp
                      ? `${previewImageModal.capture_timestamp.replace('T', ' ').slice(0, 16)} (camera clock)`
                      : 'Not in file'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px]">PROCESSING STATUS</span>
                  <span className="font-bold text-emerald-700">{previewImageModal.processing_status}</span>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
};
