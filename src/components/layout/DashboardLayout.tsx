import React, { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Compass,
  LayoutDashboard,
  FileText,
  UploadCloud,
  Layers,
  Sprout,
  Bell,
  LogOut,
  Menu,
  X,
  User,
  Users,
  History,
  BarChart3,
  CheckCircle2,
  Calendar,
  Eye,
  Satellite,
  Settings,
  HelpCircle,
  Camera,
  MapPin,
  ChevronRight,
} from 'lucide-react';
import { authService } from '@/services/auth.service';
import { notificationService } from '@/services/notification.service';
import { mockDb } from '@/services/mock-db';
import { Notification } from '@/types';
import { ROLE_LABELS } from '@/lib/permissions';
import { useLanguage } from '@/context/LanguageContext';
import { LanguageSwitcher } from '@/components/ui/LanguageSwitcher';

interface DashboardLayoutProps {
  children: React.ReactNode;
  title: string;
  subtitle?: string;
}

export const DashboardLayout: React.FC<DashboardLayoutProps> = ({ children, title, subtitle }) => {
  const { t } = useLanguage();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [currentUser, setCurrentUser] = useState(mockDb.currentUser);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setCurrentUser(mockDb.currentUser);
    loadNotifications();
  }, [location.pathname]);

  const loadNotifications = async () => {
    const list = await notificationService.getMyNotifications(mockDb.currentUser.id);
    setNotifications(list);
  };

  const handleMarkAsRead = async (notifId: string) => {
    await notificationService.markAsRead(notifId);
    loadNotifications();
  };

  const handleLogout = async () => {
    await authService.signOut();
    navigate('/');
  };

  // Build role-specific sidebar navigation
  const getNavItems = () => {
    switch (currentUser.role) {
      case 'farmer':
        return [
          { name: t('dashboard.overview', 'Overview'), href: '/farmer/dashboard', icon: LayoutDashboard },
          { name: t('dashboard.gisCropSurvey', 'GIS Crop Survey'), href: '/gis/crop-survey', icon: Compass },
          { name: t('dashboard.myProperties', 'My Properties'), href: '/farmer/properties', icon: MapPin },
          { name: t('dashboard.uploadImages', 'Upload Land Images'), href: '/farmer/upload-images', icon: UploadCloud },
          { name: t('dashboard.droneStatus', 'Drone Inspection Status'), href: '/farmer/inspection-status', icon: Layers },
          { name: t('dashboard.verificationReports', 'Verification Reports'), href: '/farmer/reports', icon: CheckCircle2 },
          { name: t('dashboard.statutoryReports', 'Statutory Reports Hub'), href: '/gis/reports', icon: FileText },
          { name: t('dashboard.notifications', 'Notifications'), href: '/farmer/notifications', icon: Bell },
        ];
      case 'tahsildar':
        return [
          { name: t('dashboard.overview', 'Overview'), href: '/tahsildar/dashboard', icon: LayoutDashboard },
          { name: t('dashboard.gisCropSurvey', 'GIS Spatial Intelligence'), href: '/gis/crop-survey', icon: Compass },
          { name: t('dashboard.registrationQueue', 'Registration Review Queue'), href: '/tahsildar/registrations', icon: FileText },
          { name: t('dashboard.assignInspections', 'Assign Inspections'), href: '/tahsildar/assign-inspections', icon: Calendar },
          { name: t('dashboard.fieldSurveillance', 'Field Surveillance (15-day)'), href: '/tahsildar/field-surveillance', icon: Satellite },
          { name: t('dashboard.imageComparison', 'Image Comparison Workspace'), href: '/tahsildar/image-comparison', icon: Eye },
          { name: t('dashboard.cropVerification', 'Crop Verification'), href: '/tahsildar/crop-verification', icon: Sprout },
          { name: t('dashboard.verificationReports', 'Verification Reports'), href: '/tahsildar/reports', icon: CheckCircle2 },
          { name: t('dashboard.statutoryReports', 'Statutory Reports Hub'), href: '/gis/reports', icon: FileText },
          { name: t('dashboard.auditLogs', 'Audit History'), href: '/tahsildar/audit-logs', icon: History },
        ];
      case 'field_worker':
        return [
          { name: t('dashboard.overview', 'Overview'), href: '/field-worker/dashboard', icon: LayoutDashboard },
          { name: t('dashboard.gisCropSurvey', 'GIS Plot & Drone Map'), href: '/gis/crop-survey', icon: Compass },
          { name: t('dashboard.assignedInspections', 'Assigned Inspections'), href: '/field-worker/inspections', icon: Calendar },
          { name: t('dashboard.uploadDrone', 'Upload Drone Imagery'), href: '/field-worker/drone-upload', icon: Camera },
          { name: t('dashboard.completedSurveys', 'Completed Surveys'), href: '/field-worker/completed', icon: CheckCircle2 },
          { name: t('dashboard.statutoryReports', 'Statutory Reports Hub'), href: '/gis/reports', icon: FileText },
        ];
      case 'admin':
        return [
          { name: t('dashboard.overview', 'System Overview'), href: '/admin/dashboard', icon: LayoutDashboard },
          { name: t('dashboard.gisCropSurvey', 'GIS Spatial Intelligence'), href: '/gis/crop-survey', icon: Compass },
          { name: t('dashboard.userManagement', 'User Management'), href: '/admin/users', icon: Users },
          { name: t('dashboard.geoRegions', 'Geographic Regions'), href: '/admin/regions', icon: MapPin },
          { name: t('dashboard.analyticsTrends', 'Analytics & Trends'), href: '/admin/analytics', icon: BarChart3 },
          { name: t('dashboard.statutoryReports', 'Statutory Reports Hub'), href: '/gis/reports', icon: FileText },
          { name: t('dashboard.auditLogs', 'Audit Logs'), href: '/admin/audit-logs', icon: History },
          { name: t('dashboard.systemSettings', 'System Settings'), href: '/admin/settings', icon: Settings },
        ];
      default:
        return [];
    }
  };

  const navItems = getNavItems();
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-xs lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Navigation - Fixed to Viewport on Desktop & Mobile */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Brand header */}
        <div className="h-16 sm:h-20 flex items-center justify-between px-6 border-b border-slate-100 shrink-0">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-agri-gradient flex items-center justify-center text-white shadow-xs">
              <Compass className="w-5 h-5" />
            </div>
            <div>
              <span className="text-lg font-bold tracking-tight text-slate-900">
                Agri<span className="text-emerald-700">Survey</span>
              </span>
              <span className="block text-[10px] uppercase font-semibold text-slate-400">
                {currentUser.role === 'farmer'
                  ? t('roles.farmerRoleBadge', 'Farmer / Landholder')
                  : currentUser.role === 'tahsildar'
                  ? t('roles.tahsildarRoleBadge', 'Tahsildar / Revenue Officer')
                  : currentUser.role === 'field_worker'
                  ? t('roles.fieldWorkerRoleBadge', 'Field Surveyor & Drone Pilot')
                  : t('roles.adminRoleBadge', 'System Administrator')}
              </span>
            </div>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Links - Scrollable if viewport height is small */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.name}
                to={item.href}
                onClick={() => setSidebarOpen(false)}
                className={`flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-emerald-50 text-emerald-800 font-semibold shadow-2xs border border-emerald-100'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon
                  className={`w-4 h-4 ${isActive ? 'text-emerald-700' : 'text-slate-400'}`}
                />
                <span>{item.name}</span>
              </Link>
            );
          })}
        </nav>

        {/* User Card & Logout Footer - Permanently Fixed at Bottom of Sidebar */}
        <div className="p-4 border-t border-slate-100 bg-slate-50/50 shrink-0 mt-auto">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold text-sm shrink-0 border border-emerald-200">
              {currentUser.full_name
                .split(' ')
                .map((n) => n[0])
                .slice(0, 2)
                .join('')}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-900 truncate">
                {currentUser.full_name}
              </p>
              <p className="text-[11px] text-slate-500 truncate">
                {currentUser.email || currentUser.phone_number}
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 text-xs font-medium text-slate-600 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors border border-slate-200 bg-white"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>{t('dashboard.signOut', 'Sign Out')}</span>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 lg:pl-72">
        {/* Top Header */}
        <header className="h-16 sm:h-20 bg-white border-b border-slate-200 px-3.5 sm:px-8 flex items-center justify-between sticky top-0 z-30 gap-2">
          <div className="flex items-center gap-2 sm:gap-3 min-w-0 flex-1">
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 text-slate-600 hover:bg-slate-100 rounded-lg shrink-0"
              aria-label="Open sidebar"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="min-w-0 flex-1">
              <h1 className="text-sm sm:text-lg md:text-xl font-bold text-slate-900 leading-tight truncate">
                {title}
              </h1>
              {subtitle && (
                <p className="text-[11px] sm:text-xs text-slate-500 truncate hidden sm:block">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {/* Right Header Controls */}
          <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
            {/* Firebase Live Badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200/80 text-amber-800 text-[11px] font-medium shrink-0 shadow-2xs" title="Google Firebase Project: agri-survey-4f115">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>
              <span className="font-semibold">Firebase</span>
              <span className="text-amber-600/80 text-[10px] hidden md:inline">agri-survey-4f115</span>
            </div>

            {/* Language Switcher */}
            <LanguageSwitcher variant="nav" size="sm" />

            {/* Live Notifications Bell */}
            <div className="relative">
              <button
                onClick={() => setNotificationsOpen(!notificationsOpen)}
                className="relative p-2 sm:p-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-xl transition-colors border border-slate-200"
                aria-label="View notifications"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow-xs">
                    {unreadCount}
                  </span>
                )}
              </button>

              {/* Notifications Dropdown Drawer */}
              {notificationsOpen && (
                <div className="absolute right-0 mt-2 w-[calc(100vw-2rem)] max-w-sm sm:w-96 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden animate-in fade-in zoom-in-95">
                  <div className="px-4 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      {t('dashboard.systemNotifications', 'System Notifications')}
                    </span>
                    <span className="text-[11px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full font-semibold">
                      {unreadCount} {t('dashboard.newBadge', 'New')}
                    </span>
                  </div>

                  <div className="max-h-80 overflow-y-auto divide-y divide-slate-100">
                    {notifications.length === 0 ? (
                      <div className="py-8 text-center text-xs text-slate-400">
                        {t('dashboard.noNotifications', 'No recent notifications.')}
                      </div>
                    ) : (
                      notifications.slice(0, 6).map((notif) => (
                        <div
                          key={notif.id}
                          className={`p-3.5 text-xs hover:bg-slate-50 transition-colors ${
                            !notif.read_at ? 'bg-emerald-50/40' : ''
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2 mb-1">
                            <span className="font-semibold text-slate-800">
                              {notif.title}
                            </span>
                            <span className="text-[10px] text-slate-400 shrink-0">
                              {new Date(notif.created_at).toLocaleDateString([], {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </span>
                          </div>
                          <p className="text-slate-600 text-[11px] leading-relaxed mb-2">
                            {notif.message}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase font-semibold text-slate-400">
                              {t('dashboard.channelLabel', 'Channel')}: {notif.channel}
                            </span>
                            {!notif.read_at && (
                              <button
                                onClick={() => handleMarkAsRead(notif.id)}
                                className="text-[11px] text-emerald-700 font-medium hover:underline"
                              >
                                {t('dashboard.markAsRead', 'Mark as read')}
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Back to Public Home */}
            <Link
              to="/"
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              <span>{t('dashboard.publicPortal', 'Public Portal')}</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </header>

        {/* Dynamic Page Content */}
        <main className="p-4 sm:p-8 flex-1">{children}</main>
      </div>
    </div>
  );
};
