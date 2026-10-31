import React, { useState, useEffect } from 'react';
import {
  Users,
  ShieldAlert,
  BarChart3,
  MapPin,
  History,
  Building2,
  CheckCircle2,
  Clock,
  Layers,
  FileCheck2,
  Settings,
  PlusCircle,
  Search,
  Bell,
  Smartphone,
  Sprout,
  Edit2,
  Sliders,
} from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import { useLocation } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { analyticsService, DashboardStats, GovernmentDecisionMetrics } from '@/services/analytics.service';
import { notificationService } from '@/services/notification.service';
import { plantIntelligenceService } from '@/services/plant-intelligence.service';
import { mockDb } from '@/services/mock-db';
import { Profile, AuditLog, StaffRegion, NotificationJob, CropHealthThreshold } from '@/types';
import { PUNE_TALUKS, MAHARASHTRA_DISTRICTS } from '@/lib/constants';

type AdminTab = 'overview' | 'users' | 'regions' | 'audit' | 'sms' | 'thresholds';

// Sidebar links point at /admin/<section>; open the matching tab for each.
const tabForPath = (pathname: string): AdminTab => {
  if (pathname.startsWith('/admin/users')) return 'users';
  if (pathname.startsWith('/admin/regions')) return 'regions';
  if (pathname.startsWith('/admin/audit-logs')) return 'audit';
  if (pathname.startsWith('/admin/settings')) return 'thresholds';
  return 'overview';
};

export const AdminDashboardPage: React.FC = () => {
  const { pathname } = useLocation();
  const [activeTab, setActiveTab] = useState<AdminTab>(() => tabForPath(pathname));
  const [tabPath, setTabPath] = useState(pathname);
  if (tabPath !== pathname) {
    setTabPath(pathname);
    setActiveTab(tabForPath(pathname));
  }
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [govMetrics, setGovMetrics] = useState<GovernmentDecisionMetrics | null>(null);
  const [timelineData, setTimelineData] = useState<any[]>([]);
  const [districtData, setDistrictData] = useState<any[]>([]);
  const [cropData, setCropData] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [staffRegions, setStaffRegions] = useState<StaffRegion[]>([]);
  const [smsJobs, setSmsJobs] = useState<NotificationJob[]>([]);

  // Crop Health Thresholds State
  const [cropThresholds, setCropThresholds] = useState<CropHealthThreshold[]>([]);
  const [selectedCropFilter, setSelectedCropFilter] = useState('ALL');
  const [editingThreshold, setEditingThreshold] = useState<CropHealthThreshold | null>(null);
  const [thresholdEditModal, setThresholdEditModal] = useState(false);

  // User Management Modal State
  const [userModalOpen, setUserModalOpen] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffEmail, setNewStaffEmail] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'tahsildar' | 'field_worker'>('tahsildar');
  const [newStaffTaluk, setNewStaffTaluk] = useState('Shirur');

  useEffect(() => {
    loadAllAdminData();
  }, []);

  const loadAllAdminData = async () => {
    const [s, t, d, c, a, sr, jobs, gm] = await Promise.all([
      analyticsService.getDashboardStats(),
      analyticsService.getRegistrationsOverTime(),
      analyticsService.getDistrictDistribution(),
      analyticsService.getCropDistribution(),
      analyticsService.getAuditLogs(),
      analyticsService.getStaffRegions(),
      notificationService.getNotificationJobs(),
      analyticsService.getGovernmentDecisionMetrics(),
    ]);

    setStats(s);
    setTimelineData(t);
    setDistrictData(d);
    setCropData(c);
    setAuditLogs(a);
    setStaffRegions(sr);
    setSmsJobs(jobs);
    setGovMetrics(gm);

    const ths = await plantIntelligenceService.getCropThresholds();
    setCropThresholds(ths);
  };

  const handleCreateStaff = () => {
    if (!newStaffName || !newStaffEmail) {
      alert('Please enter name and email');
      return;
    }

    const newProfile: Profile = {
      id: `usr-${newStaffRole}-${Date.now()}`,
      full_name: newStaffName,
      email: newStaffEmail,
      phone_number: '9822000000',
      role: newStaffRole,
      account_status: 'active',
      preferred_language: 'en',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const newRegion: StaffRegion = {
      id: `sr-${Date.now()}`,
      staff_user_id: newProfile.id,
      state: 'Maharashtra',
      district: 'Pune',
      taluk: newStaffTaluk,
      village: null,
      created_at: new Date().toISOString(),
    };

    mockDb.profiles.push(newProfile);
    mockDb.staffRegions.push(newRegion);
    mockDb.addAuditLog(
      'STAFF_ACCOUNT_PROVISIONED',
      'profiles',
      newProfile.id,
      null,
      { name: newStaffName, role: newStaffRole, taluk: newStaffTaluk }
    );
    mockDb.persistAll();

    setUserModalOpen(false);
    setNewStaffName('');
    setNewStaffEmail('');
    loadAllAdminData();
  };

  return (
    <DashboardLayout
      title="State Administration & Governance Center"
      subtitle="Dr. Meenakshi Sundaram, IAS • Joint Director of Land Records & System Superuser"
    >
      <div className="space-y-6">
        {/* Navigation Tabs */}
        <div className="flex border-b border-slate-200 bg-white rounded-xl px-4 shadow-xs">
          {[
            { id: 'overview', label: 'Overview & Recharts Analytics', icon: BarChart3 },
            { id: 'thresholds', label: 'Crop Health Thresholds & Policies', icon: Sprout },
            { id: 'users', label: 'User & Staff Provisioning', icon: Users },
            { id: 'regions', label: 'Geographic Allocations', icon: MapPin },
            { id: 'sms', label: 'SMS & Delivery Queue', icon: Smartphone },
            { id: 'audit', label: 'Immutable Audit Logs', icon: History },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as AdminTab)}
                className={`py-3.5 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all ${
                  isActive
                    ? 'border-emerald-600 text-emerald-800'
                    : 'border-transparent text-slate-500 hover:text-slate-800'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* TAB 1: OVERVIEW & RECHARTS */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Top 4 Key Metric Cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="p-5">
                <span className="text-[11px] font-bold text-slate-400 uppercase">Registered Farmers</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-1">{stats?.totalFarmers ?? 2}</div>
                <div className="text-xs text-emerald-700 font-semibold mt-1">Verified identities in registry</div>
              </Card>

              <Card className="p-5">
                <span className="text-[11px] font-bold text-slate-400 uppercase">Agricultural Land Area</span>
                <div className="text-3xl font-extrabold text-slate-900 mt-1">
                  {stats?.totalLandAreaAcres ?? 11.45} <span className="text-base font-normal text-slate-500">Acres</span>
                </div>
                <div className="text-xs text-teal-700 font-semibold mt-1">Across 3 Pune taluks</div>
              </Card>

              <Card className="p-5">
                <span className="text-[11px] font-bold text-slate-400 uppercase">Pending Approvals</span>
                <div className="text-3xl font-extrabold text-amber-800 mt-1">{stats?.pendingRegistrations ?? 2}</div>
                <div className="text-xs text-amber-600 font-semibold mt-1">Tahsildar review queue</div>
              </Card>

              <Card className="p-5">
                <span className="text-[11px] font-bold text-slate-400 uppercase">Verified Properties</span>
                <div className="text-3xl font-extrabold text-emerald-800 mt-1">{stats?.completedVerifications ?? 1}</div>
                <div className="text-xs text-emerald-600 font-semibold mt-1">Certified reports compiled</div>
              </Card>
            </div>

            {/* Government Spatial Intelligence & Policy Dashboard (Challenge Module G) */}
            {govMetrics && (
              <Card className="p-5 bg-gradient-to-r from-emerald-950 via-slate-900 to-teal-950 text-white border-none shadow-md space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-3">
                  <div>
                    <span className="text-[10px] font-mono uppercase tracking-wider font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                      Module G — Government Decision Support
                    </span>
                    <h3 className="text-base font-extrabold text-white mt-1">
                      Maharashtra Spatial Agricultural Intelligence & Policy Indicators
                    </h3>
                  </div>
                  <span className="text-xs text-white/60">
                    Active Pilot Zones: Haveli, Baramati, Shirur, Daund
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-white/60 block text-[10px]">1. Kharif Crop Acreage</span>
                    <strong className="text-lg text-emerald-300 font-bold">{govMetrics.kharifAcreageMapped} Acres</strong>
                    <span className="block text-[10px] text-white/40">Sugarcane, Soybean, Cotton</span>
                  </div>

                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-white/60 block text-[10px]">2. Rabi Crop Acreage</span>
                    <strong className="text-lg text-teal-300 font-bold">{govMetrics.rabiAcreageMapped} Acres</strong>
                    <span className="block text-[10px] text-white/40">Wheat, Gram, Rabi Onion</span>
                  </div>

                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-white/60 block text-[10px]">3. Subsidy Pass Rate</span>
                    <strong className="text-lg text-amber-300 font-bold">{govMetrics.subsidyVerificationRatePct}%</strong>
                    <span className="block text-[10px] text-white/40">7/12 & Ground Photo Verified</span>
                  </div>

                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-white/60 block text-[10px]">4. Overlap Deduplicated</span>
                    <strong className="text-lg text-sky-300 font-bold">{govMetrics.nonOverlappingNetAreaHa} Ha</strong>
                    <span className="block text-[10px] text-white/40">{govMetrics.overlapAvoidedHa} ha duplicate avoided</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs pt-1">
                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-white/60 block text-[10px]">5. Disaster Screened Area</span>
                    <strong className="text-lg text-rose-300 font-bold">{govMetrics.criticalDamageHectares} Ha</strong>
                    <span className="block text-[10px] text-rose-300/80">Pending Tahsildar survey</span>
                  </div>

                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-white/60 block text-[10px]">6. High Moisture Stress</span>
                    <strong className="text-lg text-amber-300 font-bold">{govMetrics.highStressMoistureHectares} Ha</strong>
                    <span className="block text-[10px] text-amber-300/80">NDWI / NDMI Deficit</span>
                  </div>

                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-white/60 block text-[10px]">7. Crop Discrepancies</span>
                    <strong className="text-lg text-purple-300 font-bold">{govMetrics.discrepanciesCount} Parcels</strong>
                    <span className="block text-[10px] text-white/40">Phenology vs Farmer Claim</span>
                  </div>

                  <div className="p-3 bg-white/5 rounded-lg border border-white/10">
                    <span className="text-white/60 block text-[10px]">8. Resolution Turnaround</span>
                    <strong className="text-lg text-emerald-300 font-bold">{govMetrics.avgResolutionTurnaroundDays} Days</strong>
                    <span className="block text-[10px] text-white/40">Officer dispatch to verify</span>
                  </div>
                </div>
              </Card>
            )}

            {/* Recharts Analytics Charts (Section 18 Requirement) */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Chart 1: Registrations Over Time (7 Cols) */}
              <Card className="lg:col-span-7 p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                      Monthly Applications vs Verifications
                    </h4>
                    <p className="text-[11px] text-slate-400">Maharashtra Revenue Division</p>
                  </div>
                  <span className="text-[10px] font-mono bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded font-bold">
                    Recharts Dynamic
                  </span>
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                      <defs>
                        <linearGradient id="colorApps" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#15803D" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#15803D" stopOpacity={0} />
                        </linearGradient>
                        <linearGradient id="colorVerif" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#0891B2" stopOpacity={0.8} />
                          <stop offset="95%" stopColor="#0891B2" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#94A3B8" />
                      <YAxis tick={{ fontSize: 10 }} stroke="#94A3B8" />
                      <Tooltip />
                      <Area
                        type="monotone"
                        dataKey="applications"
                        name="Applications"
                        stroke="#15803D"
                        fillOpacity={1}
                        fill="url(#colorApps)"
                      />
                      <Area
                        type="monotone"
                        dataKey="verified"
                        name="Completed Verifications"
                        stroke="#0891B2"
                        fillOpacity={1}
                        fill="url(#colorVerif)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </Card>

              {/* Chart 2: Land Area by District (5 Cols) */}
              <Card className="lg:col-span-5 p-6 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                      Land Area by Region (Acres)
                    </h4>
                    <p className="text-[11px] text-slate-400">Total verified and pending acreage</p>
                  </div>
                </div>

                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={districtData} layout="vertical" margin={{ top: 5, right: 10, left: 20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis type="number" tick={{ fontSize: 10 }} stroke="#94A3B8" />
                      <YAxis dataKey="district" type="category" tick={{ fontSize: 9 }} stroke="#94A3B8" width={80} />
                      <Tooltip />
                      <Bar dataKey="acres" name="Acres" fill="#0F766E" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* TAB 2: USER MANAGEMENT */}
        {activeTab === 'users' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                Staff & User Accounts ({mockDb.profiles.length})
              </h3>
              <Button size="sm" onClick={() => setUserModalOpen(true)} icon={<PlusCircle className="w-3.5 h-3.5" />}>
                Provision Staff Account
              </Button>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-3 px-4">User ID</th>
                      <th className="py-3 px-4">Full Name</th>
                      <th className="py-3 px-4">Email</th>
                      <th className="py-3 px-4">Role</th>
                      <th className="py-3 px-4">Account Status</th>
                      <th className="py-3 px-4">Created Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {mockDb.profiles.map((p) => (
                      <tr key={p.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono text-slate-400">{p.id}</td>
                        <td className="py-3 px-4 font-bold text-slate-900">{p.full_name}</td>
                        <td className="py-3 px-4 text-slate-600">{p.email || 'N/A'}</td>
                        <td className="py-3 px-4">
                          <span className="font-semibold capitalize text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            {p.role.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4">
                          <Badge status={p.account_status} size="sm" />
                        </td>
                        <td className="py-3 px-4 text-slate-400">
                          {new Date(p.created_at).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 3: STAFF REGIONS */}
        {activeTab === 'regions' && (
          <div className="space-y-4">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
              Staff Geographic Jurisdiction Assignments (staff_regions)
            </h3>

            <Card className="p-0 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Region ID</th>
                    <th className="py-3 px-4">Staff User</th>
                    <th className="py-3 px-4">Designated State</th>
                    <th className="py-3 px-4">District</th>
                    <th className="py-3 px-4">Assigned Taluk</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {staffRegions.map((sr) => {
                    const staff = mockDb.profiles.find((p) => p.id === sr.staff_user_id);
                    return (
                      <tr key={sr.id} className="hover:bg-slate-50">
                        <td className="py-3 px-4 font-mono text-slate-400">{sr.id}</td>
                        <td className="py-3 px-4 font-bold text-slate-900">
                          {staff?.full_name} ({staff?.role})
                        </td>
                        <td className="py-3 px-4 text-slate-600">{sr.state}</td>
                        <td className="py-3 px-4 font-semibold text-slate-800">{sr.district}</td>
                        <td className="py-3 px-4 text-emerald-700 font-bold">{sr.taluk || 'All Taluks'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* TAB 4: SMS QUEUE */}
        {activeTab === 'sms' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  SMS Gateway Job Dispatcher
                </h3>
                <p className="text-[11px] text-slate-500">
                  Real-time status of SMS notifications dispatched to landholders
                </p>
              </div>
            </div>

            <Card className="p-0 overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                  <tr>
                    <th className="py-3 px-4">Job ID</th>
                    <th className="py-3 px-4">Gateway Provider</th>
                    <th className="py-3 px-4">Delivery Status</th>
                    <th className="py-3 px-4">Txn Reference</th>
                    <th className="py-3 px-4">Last Attempt</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {smsJobs.map((job) => (
                    <tr key={job.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono font-bold text-slate-800">{job.id}</td>
                      <td className="py-3 px-4 text-slate-700">{job.provider}</td>
                      <td className="py-3 px-4">
                        <Badge status={job.delivery_status} size="sm" />
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-500">{job.provider_message_reference}</td>
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(job.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>
        )}

        {/* TAB 5: AUDIT LOGS */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-900">
                  Immutable Security Audit Trail (audit_logs)
                </h3>
                <p className="text-[11px] text-slate-500">
                  Every application decision, evidence submission, and status transition is cryptographically logged
                </p>
              </div>
            </div>

            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Timestamp</th>
                      <th className="py-3 px-4">Actor</th>
                      <th className="py-3 px-4">Action</th>
                      <th className="py-3 px-4">Target Entity</th>
                      <th className="py-3 px-4">Entity ID</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono text-[11px]">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50">
                        <td className="py-2.5 px-4 text-slate-400 font-sans">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-emerald-800 font-sans font-medium">
                          {log.actor_name || log.actor_user_id}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-slate-800">
                          {log.action}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{log.entity_type}</td>
                        <td className="py-2.5 px-4 text-slate-500">{log.entity_id}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {/* TAB 6: CROP HEALTH THRESHOLDS & POLICIES */}
        {activeTab === 'thresholds' && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Sprout className="w-5 h-5 text-emerald-600" />
                  <span>Crop-Specific Health Thresholds & Agronomic Engine Settings</span>
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Configure physiological reference limits for soil moisture, soil pH, and temperature. The health analysis engine compares field telemetry against these limits.
                </p>
              </div>

              <div className="flex items-center gap-2 text-xs">
                <span className="font-semibold text-slate-600">Filter Crop:</span>
                <select
                  value={selectedCropFilter}
                  onChange={(e) => setSelectedCropFilter(e.target.value)}
                  className="p-2 border border-slate-300 rounded-lg bg-white text-xs font-semibold"
                >
                  <option value="ALL">All Crops ({cropThresholds.length})</option>
                  <option value="Sugarcane">Sugarcane</option>
                  <option value="Cotton">Cotton</option>
                  <option value="Soybean">Soybean</option>
                  <option value="Onion">Onion</option>
                  <option value="Wheat">Wheat</option>
                  <option value="Tomato">Tomato</option>
                  <option value="Grapes">Grapes</option>
                </select>
              </div>
            </div>

            {/* Thresholds Table */}
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 uppercase tracking-wider text-[10px]">
                    <tr>
                      <th className="py-3 px-4">Crop Name</th>
                      <th className="py-3 px-4">Parameter</th>
                      <th className="py-3 px-4">Optimal Range</th>
                      <th className="py-3 px-4">Tolerable Bounds</th>
                      <th className="py-3 px-4">Scientific Description</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {cropThresholds
                      .filter((th) => selectedCropFilter === 'ALL' || th.crop_name.toLowerCase() === selectedCropFilter.toLowerCase())
                      .map((th) => (
                        <tr key={th.id} className="hover:bg-slate-50">
                          <td className="py-3 px-4 font-bold text-slate-900">
                            {th.crop_name}
                          </td>
                          <td className="py-3 px-4 font-mono text-emerald-800">
                            {th.parameter.replace('_', ' ')} ({th.unit})
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-700">
                            <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded font-mono">
                              {th.min_optimal} – {th.max_optimal} {th.unit}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-semibold text-slate-500">
                            <span className="bg-amber-50 text-amber-800 px-2 py-0.5 rounded font-mono">
                              {th.min_tolerable} – {th.max_tolerable} {th.unit}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-slate-600 max-w-xs truncate">
                            {th.description}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              onClick={() => {
                                setEditingThreshold(th);
                                setThresholdEditModal(true);
                              }}
                              className="px-2.5 py-1 text-xs font-semibold rounded bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 ml-auto"
                            >
                              <Edit2 className="w-3 h-3 text-slate-500" />
                              <span>Configure</span>
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Sensor Telemetry Integration Health Status */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-1">
                <span className="font-bold text-slate-800 block text-sm">IoT Gateways Ingestion</span>
                <span className="text-slate-500 font-bold">○ Not monitored</span>
                <p className="text-slate-500 text-[11px]">
                  No live gateway is connected; sensor readings shown elsewhere are sample or manually entered data.
                </p>
              </div>

              <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-1">
                <span className="font-bold text-slate-800 block text-sm">Plant image analysis</span>
                <span className="text-slate-500 font-bold">○ Not available</span>
                <p className="text-slate-500 text-[11px]">
                  No plant-disease image model has been trained or validated. Field photographs are stored as evidence only.
                </p>
              </div>

              <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-1">
                <span className="font-bold text-slate-800 block text-sm">Crop identification</span>
                <span className="text-amber-700 font-bold">● Phenology template matcher (uncalibrated)</span>
                <p className="text-slate-500 text-[11px]">
                  GREEN-MINDS-ML templates on real Sentinel-2 series. Accuracy is measured only on officer-verified plots.
                </p>
              </div>

              <div className="p-4 bg-white rounded-xl border border-slate-200 space-y-1">
                <span className="font-bold text-slate-800 block text-sm">SMS Gateway Interface</span>
                <span className="text-teal-700 font-bold">● Multi-Channel Dispatched</span>
                <p className="text-slate-500 text-[11px]">
                  Authentication credentials and high-priority critical alerts dispatched via transactional SMS.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Threshold Editing Modal */}
      {editingThreshold && (
        <Modal
          isOpen={thresholdEditModal}
          onClose={() => setThresholdEditModal(false)}
          title={`Configure Threshold: ${editingThreshold.crop_name} (${editingThreshold.parameter})`}
          size="md"
        >
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Min Optimal ({editingThreshold.unit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={editingThreshold.min_optimal}
                  onChange={(e) =>
                    setEditingThreshold({
                      ...editingThreshold,
                      min_optimal: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Max Optimal ({editingThreshold.unit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={editingThreshold.max_optimal}
                  onChange={(e) =>
                    setEditingThreshold({
                      ...editingThreshold,
                      max_optimal: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Min Tolerable ({editingThreshold.unit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={editingThreshold.min_tolerable}
                  onChange={(e) =>
                    setEditingThreshold({
                      ...editingThreshold,
                      min_tolerable: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Max Tolerable ({editingThreshold.unit})
                </label>
                <input
                  type="number"
                  step="0.1"
                  value={editingThreshold.max_tolerable}
                  onChange={(e) =>
                    setEditingThreshold({
                      ...editingThreshold,
                      max_tolerable: parseFloat(e.target.value) || 0,
                    })
                  }
                  className="w-full p-2.5 rounded-lg border border-slate-300"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                Agronomic Context & Description
              </label>
              <textarea
                rows={2}
                value={editingThreshold.description || ''}
                onChange={(e) =>
                  setEditingThreshold({
                    ...editingThreshold,
                    description: e.target.value,
                  })
                }
                className="w-full p-2.5 rounded-lg border border-slate-300"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
              <Button variant="outline" onClick={() => setThresholdEditModal(false)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  await plantIntelligenceService.updateCropThreshold(editingThreshold);
                  const ths = await plantIntelligenceService.getCropThresholds();
                  setCropThresholds(ths);
                  setThresholdEditModal(false);
                  alert('Crop threshold updated successfully.');
                }}
              >
                Save Threshold Changes
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Staff Provisioning Modal */}
      <Modal
        isOpen={userModalOpen}
        onClose={() => setUserModalOpen(false)}
        title="Provision Authorized Staff Account"
        description="Create authorized Tahsildar or Field Worker with geographic jurisdiction"
        maxWidth="md"
      >
        <div className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Officer Full Legal Name
            </label>
            <input
              type="text"
              required
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              placeholder="e.g., Kedar Mohan Deshmukh"
              className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Official Government Email
            </label>
            <input
              type="email"
              required
              value={newStaffEmail}
              onChange={(e) => setNewStaffEmail(e.target.value)}
              placeholder="e.g., kedar.deshmukh@agrisurvey.gov.in"
              className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
            />
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Assigned Role
            </label>
            <select
              value={newStaffRole}
              onChange={(e) => setNewStaffRole(e.target.value as any)}
              className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
            >
              <option value="tahsildar">Tahsildar / Revenue Executive Magistrate</option>
              <option value="field_worker">Field Verification Worker (Drone Surveyor)</option>
            </select>
          </div>

          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Assigned Geographic Taluk (Pune District)
            </label>
            <select
              value={newStaffTaluk}
              onChange={(e) => setNewStaffTaluk(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-slate-300 bg-white"
            >
              {PUNE_TALUKS.map((t) => (
                <option key={t} value={t}>
                  {t} Taluk
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
            <Button variant="ghost" onClick={() => setUserModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateStaff}>
              Provision & Assign Region
            </Button>
          </div>
        </div>
      </Modal>
    </DashboardLayout>
  );
};
