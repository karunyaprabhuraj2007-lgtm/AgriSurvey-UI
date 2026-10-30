import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  FileText,
  Search,
  CheckCircle2,
  Eye,
  MapPin,
  Calendar,
  Layers,
  ArrowRight,
  ShieldCheck,
  Building2,
  Clock,
  AlertCircle,
  Sprout,
  BarChart3,
  Wifi,
  WifiOff,
  Satellite,
  Compass,
  History,
  TrendingUp,
  Activity,
  Check,
} from 'lucide-react';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AgriculturalJurisdictionMap } from '@/components/maps/AgriculturalJurisdictionMap';
import { ContinuousMonitoringTimeline } from '@/components/satellite/ContinuousMonitoringTimeline';
import { TahsildarSatelliteCoordinateModal } from '@/components/satellite/TahsildarSatelliteCoordinateModal';
import { registrationService } from '@/services/registration.service';
import { plantIntelligenceService } from '@/services/plant-intelligence.service';
import { mockDb } from '@/services/mock-db';
import {
  RegistrationApplication,
  MonitoringUnit,
  Property,
  MonitoringArea,
  MonitoringPeriodObservation,
} from '@/types';
import { useLanguage } from '@/context/LanguageContext';
import { getTahsildarLabel, localizePlotOrCropName } from '@/lib/dashboard-localizer';

export const TahsildarOverviewPage: React.FC = () => {
  const { t, language } = useLanguage();
  const tl = (key: string) => getTahsildarLabel(key, language);
  const tahsildar = mockDb.currentUser;

  const [satCoordModalOpen, setSatCoordModalOpen] = useState(false);
  const [applications, setApplications] = useState<RegistrationApplication[]>([]);
  const [inspectedArea, setInspectedArea] = useState<MonitoringArea | null>(
    mockDb.getMonitoringAreaById('area-02') || mockDb.monitoringAreas[0] || null
  );
  const [inspectedAreaObs, setInspectedAreaObs] = useState<MonitoringPeriodObservation[]>(
    mockDb.getObservationsForArea('area-02')
  );

  const [monitoringSummary, setMonitoringSummary] = useState<{
    assignedJurisdiction: string;
    totalMonitoredFarms: number;
    totalMonitoredUnits: number;
    healthDistribution: Record<string, number>;
    criticalAlertCount: number;
    activeSensorsCount: number;
    disconnectedSensorsCount: number;
    staleDataUnitsCount: number;
    cropDistribution: Array<{ crop: string; unitCount: number; percentage: number }>;
    unitsWithCriticalAlerts: MonitoringUnit[];
    farmsWithStaleData: MonitoringUnit[];
  } | null>(null);

  const [jurisdictionProperties, setJurisdictionProperties] = useState<Property[]>([]);
  const [jurisdictionUnits, setJurisdictionUnits] = useState<MonitoringUnit[]>([]);

  const loadData = useCallback(async () => {
    const list = await registrationService.listApplicationsForTahsildar({
      status: 'ALL',
      taluk: 'ALL',
      search: '',
    });
    setApplications(list);

    const summary = await plantIntelligenceService.getTahsildarJurisdictionMonitoringSummary(
      tahsildar.id
    );
    setMonitoringSummary(summary);

    const props = mockDb.properties.filter((p) => p.district === 'Pune');
    setJurisdictionProperties(props);
    const units = await plantIntelligenceService.getMonitoringUnits();
    setJurisdictionUnits(units);
  }, [tahsildar.id]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Derived metrics
  const totalApps = applications.length;
  const pendingApps = applications.filter(
    (a) =>
      a.status === 'PENDING_TAHSILDAR_REVIEW' ||
      a.status === 'PENDING_VERIFICATION' ||
      a.status === 'SUBMITTED' ||
      a.status === 'UNDER_REVIEW'
  ).length;
  const activeInspectionsCount = mockDb.inspections.filter(
    (i) => i.inspection_status === 'SCHEDULED' || i.inspection_status === 'IN_PROGRESS' || i.inspection_status === 'ASSIGNED'
  ).length;
  const certifiedReportsCount = mockDb.reports ? mockDb.reports.length : 18;
  const approvedApps = applications.filter((a) => a.status === 'APPROVED').length;

  return (
    <DashboardLayout
      title={tl('tahsildarOverviewTitle')}
      subtitle={`${tl('tahsildarOverviewSubtitle')} • ${tahsildar.full_name}`}
    >
      <div className="space-y-6 pb-8">
        {/* Top Executive Division Ribbon */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-gradient-to-r from-emerald-900 via-slate-900 to-slate-950 p-5 rounded-2xl border border-emerald-800/40 text-white shadow-sm">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-300 shrink-0">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white">
                  {tl('assignedJurisdiction')}: {tl('haveliTaluk')}
                </h2>
                <Badge variant="success" className="bg-emerald-500/20 text-emerald-300 border-emerald-400/30 text-[10px]">
                  {tl('liveSatelliteView')}
                </Badge>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {tl('executiveDeskSubtitle')}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button
              size="sm"
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md flex items-center gap-1.5"
              onClick={() => setSatCoordModalOpen(true)}
            >
              <Satellite className="w-3.5 h-3.5" />
              <span>{tl('getSatelliteImages')}</span>
            </Button>
          </div>
        </div>

        {/* 6 Executive Jurisdiction Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 sm:gap-4">
          <Card className="p-4 bg-white border-slate-200 hover:border-emerald-300 transition-colors">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>{tl('monitoredLandTotal')}</span>
              <Sprout className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">
              2,410 <span className="text-xs font-medium text-slate-400">Ha</span>
            </div>
            <div className="text-[10px] text-emerald-700 font-medium mt-0.5">98.4% {tl('verifiedLandholders')}</div>
          </Card>

          <Card className="p-4 bg-white border-slate-200 hover:border-emerald-300 transition-colors">
            <div className="flex items-center justify-between text-xs font-semibold text-slate-500">
              <span>{tl('registeredFarmersCount')}</span>
              <Building2 className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="text-2xl font-extrabold text-slate-900 mt-1">{totalApps}</div>
            <div className="text-[10px] text-slate-400 mt-0.5">{approvedApps} {tl('approved')}</div>
          </Card>

          <Card className="p-4 bg-amber-50/60 border-amber-200 hover:border-amber-300 transition-colors">
            <div className="flex items-center justify-between text-xs font-semibold text-amber-800">
              <span>{tl('pendingReview')}</span>
              <Clock className="w-3.5 h-3.5 text-amber-600" />
            </div>
            <div className="text-2xl font-extrabold text-amber-950 mt-1">{pendingApps}</div>
            <div className="text-[10px] text-amber-700 font-medium mt-0.5">{tl('awaitingReview')}</div>
          </Card>

          <Card className="p-4 bg-blue-50/60 border-blue-200 hover:border-blue-300 transition-colors">
            <div className="flex items-center justify-between text-xs font-semibold text-blue-800">
              <span>{tl('activeInspections')}</span>
              <Calendar className="w-3.5 h-3.5 text-blue-600" />
            </div>
            <div className="text-2xl font-extrabold text-blue-950 mt-1">{activeInspectionsCount}</div>
            <div className="text-[10px] text-blue-700 font-medium mt-0.5">{tl('inProgressInspectionsCount')}</div>
          </Card>

          <Card className="p-4 bg-emerald-50/60 border-emerald-200 hover:border-emerald-300 transition-colors">
            <div className="flex items-center justify-between text-xs font-semibold text-emerald-800">
              <span>{tl('certifiedReportsCount')}</span>
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
            </div>
            <div className="text-2xl font-extrabold text-emerald-950 mt-1">{certifiedReportsCount}</div>
            <div className="text-[10px] text-emerald-700 font-medium mt-0.5">7/12 Digital Certified</div>
          </Card>

          <Card className="p-4 bg-red-50/60 border-red-200 hover:border-red-300 transition-colors">
            <div className="flex items-center justify-between text-xs font-semibold text-red-800">
              <span>{tl('criticalAlertsCount')}</span>
              <AlertCircle className="w-3.5 h-3.5 text-red-600" />
            </div>
            <div className="text-2xl font-extrabold text-red-950 mt-1">
              {monitoringSummary?.criticalAlertCount || 2}
            </div>
            <div className="text-[10px] text-red-700 font-medium mt-0.5">{tl('criticalMoistureStress')}</div>
          </Card>
        </div>

        {/* Operational Action Launchers (6 distinct cards linking to dedicated modules) */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <span>{tl('quickActionsTitle')}</span>
            </h3>
            <span className="text-[11px] text-slate-400 font-medium">Pune Division Operations Hub</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Launcher 1: Registrations Queue */}
            <Link
              to="/tahsildar/registrations"
              className="group block p-4 bg-white rounded-2xl border border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center">
                  <FileText className="w-5 h-5" />
                </div>
                <Badge variant="warning" className="text-[10px]">
                  {pendingApps} {tl('pendingReview')}
                </Badge>
              </div>
              <h4 className="font-bold text-slate-900 mt-3 group-hover:text-emerald-700 transition-colors flex items-center gap-1.5 text-sm">
                <span>{tl('btnReviewQueue')}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Verify new farmer applications, validate 7/12 land titles, issue approvals, and trigger SMS credentials.
              </p>
            </Link>

            {/* Launcher 2: Assign Inspections */}
            <Link
              to="/tahsildar/assign-inspections"
              className="group block p-4 bg-white rounded-2xl border border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-700 flex items-center justify-center">
                  <Calendar className="w-5 h-5" />
                </div>
                <Badge variant="info" className="text-[10px]">
                  {activeInspectionsCount} Active Missions
                </Badge>
              </div>
              <h4 className="font-bold text-slate-900 mt-3 group-hover:text-emerald-700 transition-colors flex items-center gap-1.5 text-sm">
                <span>{tl('btnAssignInspection')}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Deploy certified drone pilots and talathi field surveyors to capture 4K orthomosaics and boundary ground truths.
              </p>
            </Link>

            {/* Launcher 3: Image Comparison Workspace */}
            <Link
              to="/tahsildar/image-comparison"
              className="group block p-4 bg-white rounded-2xl border border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-700 flex items-center justify-center">
                  <Eye className="w-5 h-5" />
                </div>
                <Badge variant="neutral" className="text-[10px]">
                  Split-Screen GIS
                </Badge>
              </div>
              <h4 className="font-bold text-slate-900 mt-3 group-hover:text-emerald-700 transition-colors flex items-center gap-1.5 text-sm">
                <span>Image Comparison Workspace</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Side-by-side swipe comparison of Sentinel-2 satellite telemetry vs ultra-high-resolution aerial drone orthophotos.
              </p>
            </Link>

            {/* Launcher 4: Crop Verification */}
            <Link
              to="/tahsildar/crop-verification"
              className="group block p-4 bg-white rounded-2xl border border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
                  <Sprout className="w-5 h-5" />
                </div>
                <Badge variant="success" className="text-[10px]">
                  Officer verified
                </Badge>
              </div>
              <h4 className="font-bold text-slate-900 mt-3 group-hover:text-emerald-700 transition-colors flex items-center gap-1.5 text-sm">
                <span>Crop Verification Hub</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Automated ML crop classification, spectral signatures, and phenology matching against registered 7/12 claims.
              </p>
            </Link>

            {/* Launcher 5: Verification Reports */}
            <Link
              to="/tahsildar/reports"
              className="group block p-4 bg-white rounded-2xl border border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl bg-teal-50 text-teal-700 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <Badge variant="neutral" className="text-[10px]">
                  {certifiedReportsCount} Certified
                </Badge>
              </div>
              <h4 className="font-bold text-slate-900 mt-3 group-hover:text-emerald-700 transition-colors flex items-center gap-1.5 text-sm">
                <span>Verification Reports & Certificates</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Generate and digitally sign official statutory land and crop verification certificates with QR authentication.
              </p>
            </Link>

            {/* Launcher 6: Audit History */}
            <Link
              to="/tahsildar/audit-logs"
              className="group block p-4 bg-white rounded-2xl border border-slate-200 hover:border-emerald-400 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-700 flex items-center justify-center">
                  <History className="w-5 h-5" />
                </div>
                <Badge variant="neutral" className="text-[10px] bg-purple-50 text-purple-700 border-purple-200">
                  {tl('shaVerified')}
                </Badge>
              </div>
              <h4 className="font-bold text-slate-900 mt-3 group-hover:text-emerald-700 transition-colors flex items-center gap-1.5 text-sm">
                <span>{tl('auditHistoryTitle')}</span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-400 group-hover:translate-x-1 transition-transform" />
              </h4>
              <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                Chronological tamper-proof ledger of all revenue reviews, worker dispatches, state diffs, and farmer alerts.
              </p>
            </Link>
          </div>
        </div>

        {/* Agricultural Jurisdiction Spatial Intelligence Map & Crop Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Geospatial Map (7 cols) */}
          <div className="lg:col-span-7 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-2">
                <Compass className="w-4 h-4 text-emerald-600" />
                <span>{tl('geoCoverageTitle')}</span>
              </h3>
              <span className="text-[11px] text-slate-500 font-mono">
                {tl('haveliTaluk')} • Pune
              </span>
            </div>
            <AgriculturalJurisdictionMap
              properties={jurisdictionProperties}
              monitoringUnits={jurisdictionUnits}
              height="380px"
            />
          </div>

          {/* Crop Distribution in Jurisdiction (5 cols) */}
          <Card className="lg:col-span-5 p-5 space-y-4 bg-white border-slate-200">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900 flex items-center gap-1.5">
              <BarChart3 className="w-4 h-4 text-emerald-600" />
              <span>{tl('cropDistributionTitle')}</span>
            </h3>

            {monitoringSummary && (
              <div className="space-y-3">
                {monitoringSummary.cropDistribution.map((c) => (
                  <div key={c.crop} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-800">
                        {localizePlotOrCropName(c.crop, language)}
                      </span>
                      <span className="text-slate-500 font-mono">
                        {c.unitCount} ({c.percentage}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-emerald-600 h-2 rounded-full"
                        style={{ width: `${c.percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs text-slate-600">
              {tl('cropCoverageNote')}
            </div>

            {/* Sensor Network Status */}
            <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-100 text-xs">
              <div className="flex items-center gap-2">
                <Wifi className="w-4 h-4 text-emerald-600 shrink-0" />
                <div>
                  <div className="font-bold text-slate-900">
                    {monitoringSummary?.activeSensorsCount || 4} Active
                  </div>
                  <div className="text-[10px] text-slate-500">Telemetry Nodes</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <WifiOff className="w-4 h-4 text-slate-400 shrink-0" />
                <div>
                  <div className="font-bold text-slate-900">
                    {monitoringSummary?.staleDataUnitsCount || 1} Stale
                  </div>
                  <div className="text-[10px] text-slate-500">&gt;72h Telemetry</div>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* 15-Day Continuous Satellite Monitoring Highlights */}
        {inspectedArea && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2.5">
                <span className="p-2 bg-emerald-100 text-emerald-800 rounded-xl">
                  <Satellite className="w-5 h-5" />
                </span>
                <div>
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    {inspectedArea.name} — 15-Day Crop Growth & Health Timeline
                  </h3>
                  <p className="text-xs text-slate-500">
                    Copernicus Sentinel-2 composite passes every 15 days, vegetative canopy changes, and crop health indexes.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setSatCoordModalOpen(true)}
                className="text-xs flex items-center gap-1.5"
              >
                <Search className="w-3.5 h-3.5" />
                <span>{tl('queryByCoords')}</span>
              </Button>
            </div>

            <ContinuousMonitoringTimeline area={inspectedArea} observations={inspectedAreaObs} />
          </div>
        )}
      </div>

      {/* Coordinate Search Modal */}
      <TahsildarSatelliteCoordinateModal
        isOpen={satCoordModalOpen}
        onClose={() => setSatCoordModalOpen(false)}
      />
    </DashboardLayout>
  );
};
export default TahsildarOverviewPage;
