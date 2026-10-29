import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { LanguageProvider } from '@/context/LanguageContext';
import { ProtectedRoute } from '@/components/auth/ProtectedRoute';
import { UserRole } from '@/types';
import { LandingPage } from '@/pages/LandingPage';
import { AuthPage } from '@/pages/AuthPage';
import { AccountActivationPage } from '@/pages/auth/AccountActivationPage';
import { FarmerApplicationStatusPage } from '@/pages/farmer/FarmerApplicationStatusPage';
import { FarmerDashboardPage } from '@/pages/farmer/FarmerDashboardPage';
import { FarmerRegistrationPage } from '@/pages/farmer/FarmerRegistrationPage';
import { FarmerPropertiesPage } from '@/pages/farmer/FarmerPropertiesPage';
import { LandImageUploadPage } from '@/pages/farmer/LandImageUploadPage';
import { FarmerInspectionStatusPage } from '@/pages/farmer/FarmerInspectionStatusPage';
import { FarmerReportsPage } from '@/pages/farmer/FarmerReportsPage';
import { FarmerNotificationsPage } from '@/pages/farmer/FarmerNotificationsPage';
import { TahsildarDashboardPage } from '@/pages/tahsildar/TahsildarDashboardPage';
import { TahsildarOverviewPage } from '@/pages/tahsildar/TahsildarOverviewPage';
import { TahsildarRegistrationsPage } from '@/pages/tahsildar/TahsildarRegistrationsPage';
import { TahsildarAssignInspectionsPage } from '@/pages/tahsildar/TahsildarAssignInspectionsPage';
import { TahsildarAuditLogsPage } from '@/pages/tahsildar/TahsildarAuditLogsPage';
import { ImageComparisonWorkspacePage } from '@/pages/tahsildar/ImageComparisonWorkspacePage';
import { CropVerificationPage } from '@/pages/tahsildar/CropVerificationPage';
import { FinalVerificationReportsPage } from '@/pages/tahsildar/FinalVerificationReportsPage';
import { FieldWorkerDashboardPage } from '@/pages/field-worker/FieldWorkerDashboardPage';
import { AdminDashboardPage } from '@/pages/admin/AdminDashboardPage';
import { GisCropSurveyPage } from '@/pages/gis/GisCropSurveyPage';
import { GisReportsPage } from '@/pages/gis/GisReportsPage';

const ALL_ROLES: UserRole[] = ['farmer', 'tahsildar', 'field_worker', 'admin'];

export function App() {
  return (
    <LanguageProvider>
      <BrowserRouter>
        <Routes>
        {/* Public Routes */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth/login" element={<AuthPage />} />
        <Route path="/auth/register" element={<AuthPage />} />
        <Route path="/auth/activate" element={<AccountActivationPage />} />

        {/* Unified GIS & Remote Sensing Routes */}
        <Route path="/gis/crop-survey" element={<ProtectedRoute allowedRoles={ALL_ROLES}><GisCropSurveyPage /></ProtectedRoute>} />
        <Route path="/gis/reports" element={<ProtectedRoute allowedRoles={ALL_ROLES}><GisReportsPage /></ProtectedRoute>} />

        {/* Farmer Portal */}
        <Route path="/farmer/dashboard" element={<ProtectedRoute allowedRoles="farmer"><FarmerDashboardPage /></ProtectedRoute>} />
        <Route path="/farmer/register" element={<ProtectedRoute allowedRoles="farmer"><FarmerRegistrationPage /></ProtectedRoute>} />
        <Route path="/farmer/application-status" element={<FarmerApplicationStatusPage />} />
        <Route path="/farmer/upload-images" element={<ProtectedRoute allowedRoles="farmer"><LandImageUploadPage /></ProtectedRoute>} />
        <Route path="/farmer/properties" element={<ProtectedRoute allowedRoles="farmer"><FarmerPropertiesPage /></ProtectedRoute>} />
        <Route path="/farmer/inspection-status" element={<ProtectedRoute allowedRoles="farmer"><FarmerInspectionStatusPage /></ProtectedRoute>} />
        <Route path="/farmer/reports" element={<ProtectedRoute allowedRoles="farmer"><FarmerReportsPage /></ProtectedRoute>} />
        <Route path="/farmer/notifications" element={<ProtectedRoute allowedRoles="farmer"><FarmerNotificationsPage /></ProtectedRoute>} />

        {/* Tahsildar Portal */}
        <Route path="/tahsildar/dashboard" element={<ProtectedRoute allowedRoles="tahsildar"><TahsildarOverviewPage /></ProtectedRoute>} />
        <Route path="/tahsildar/registrations" element={<ProtectedRoute allowedRoles="tahsildar"><TahsildarRegistrationsPage /></ProtectedRoute>} />
        <Route path="/tahsildar/assign-inspections" element={<ProtectedRoute allowedRoles="tahsildar"><TahsildarAssignInspectionsPage /></ProtectedRoute>} />
        <Route path="/tahsildar/image-comparison" element={<ProtectedRoute allowedRoles="tahsildar"><ImageComparisonWorkspacePage /></ProtectedRoute>} />
        <Route path="/tahsildar/crop-verification" element={<ProtectedRoute allowedRoles="tahsildar"><CropVerificationPage /></ProtectedRoute>} />
        <Route path="/tahsildar/reports" element={<ProtectedRoute allowedRoles="tahsildar"><FinalVerificationReportsPage /></ProtectedRoute>} />
        <Route path="/tahsildar/audit-logs" element={<ProtectedRoute allowedRoles="tahsildar"><TahsildarAuditLogsPage /></ProtectedRoute>} />

        {/* Field Worker Portal */}
        <Route path="/field-worker/dashboard" element={<ProtectedRoute allowedRoles="field_worker"><FieldWorkerDashboardPage /></ProtectedRoute>} />
        <Route path="/field-worker/inspections" element={<ProtectedRoute allowedRoles="field_worker"><FieldWorkerDashboardPage /></ProtectedRoute>} />
        <Route path="/field-worker/drone-upload" element={<ProtectedRoute allowedRoles="field_worker"><FieldWorkerDashboardPage /></ProtectedRoute>} />
        <Route path="/field-worker/completed" element={<ProtectedRoute allowedRoles="field_worker"><FieldWorkerDashboardPage /></ProtectedRoute>} />

        {/* Admin Portal */}
        <Route path="/admin/dashboard" element={<ProtectedRoute allowedRoles="admin"><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="/admin/users" element={<ProtectedRoute allowedRoles="admin"><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="/admin/regions" element={<ProtectedRoute allowedRoles="admin"><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="/admin/analytics" element={<ProtectedRoute allowedRoles="admin"><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="/admin/audit-logs" element={<ProtectedRoute allowedRoles="admin"><AdminDashboardPage /></ProtectedRoute>} />
        <Route path="/admin/settings" element={<ProtectedRoute allowedRoles="admin"><AdminDashboardPage /></ProtectedRoute>} />

        {/* Catch-all */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </LanguageProvider>
  );
}

export default App;
