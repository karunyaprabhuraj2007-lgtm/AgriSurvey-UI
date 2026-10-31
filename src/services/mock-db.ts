import {
  Profile,
  FarmerProfile,
  Property,
  RegistrationApplication,
  LandDocument,
  FarmerLandImage,
  FieldInspection,
  DroneImagery,
  ImageComparison,
  CropVerification,
  VerificationReport,
  Notification,
  AuditLog,
  StaffRegion,
  UserRole,
  SmsMessage,
  Crop,
  CropHealthThreshold,
  MonitoringUnit,
  PlantObservation,
  SensorDevice,
  SensorReading,
  PlantHealthAssessment,
  PlantHealthAlert,
  NotificationJob,
  AccountActivationToken,
  FarmPlot,
  SatelliteScene,
  VegetationIndexObservation,
  WeatherObservation,
  DroneMissionRecord,
  MobileFieldSurveyRecord,
  CropPredictionRecord,
  YieldForecastRecord,
  DisasterAssessmentRecord,
  MonitoringArea,
  MonitoringPeriodObservation,
  MonitoringInspectionItem,
} from '@/types';
import { DEFAULT_CROP_THRESHOLDS } from './plant-health.service';
import { firebaseService } from './firebase.service';

// Key for LocalStorage Persistence
const STORAGE_PREFIX = 'agrisurvey_db_';
const memoryStorage: Record<string, string> = {};

function isLocalStorageAvailable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof localStorage !== 'undefined' && typeof localStorage.getItem === 'function';
  } catch {
    return false;
  }
}

function getStorage<T>(key: string, defaultVal: T): T {
  try {
    if (!isLocalStorageAvailable()) {
      const mem = memoryStorage[STORAGE_PREFIX + key];
      return mem ? JSON.parse(mem) : defaultVal;
    }
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return defaultVal;
    return JSON.parse(raw);
  } catch {
    return defaultVal;
  }
}

function setStorage<T>(key: string, val: T): void {
  try {
    const serialized = JSON.stringify(val);
    if (!isLocalStorageAvailable()) {
      memoryStorage[STORAGE_PREFIX + key] = serialized;
      return;
    }
    localStorage.setItem(STORAGE_PREFIX + key, serialized);
  } catch (err) {
    console.error('LocalStorage write error', err);
  }
}

// -----------------------------------------------------------------------------
// Initial Demonstration Data
// -----------------------------------------------------------------------------
const INITIAL_PROFILES: Profile[] = [
  {
    id: 'usr-farmer-01',
    full_name: 'Ramesh Balasaheb Patil',
    email: 'farmer.ramesh@agrisurvey.gov.in',
    phone_number: '9822012345',
    role: 'farmer',
    account_status: 'active',
    preferred_language: 'mr',
    password: 'FarmerPass123!',
    created_at: '2026-02-10T09:30:00Z',
    updated_at: '2026-02-10T09:30:00Z',
  },
  {
    id: 'usr-farmer-02',
    full_name: 'Sunita Dnyaneshwar Shinde',
    email: 'sunita.shinde@agrisurvey.gov.in',
    phone_number: '9850123456',
    role: 'farmer',
    account_status: 'active',
    preferred_language: 'mr',
    password: 'FarmerPass123!',
    created_at: '2026-03-01T10:15:00Z',
    updated_at: '2026-03-01T10:15:00Z',
  },
  {
    id: 'usr-tahsildar-01',
    full_name: 'Anand Shrikant Kulkarni',
    email: 'tahsildar.haveli@agrisurvey.gov.in',
    phone_number: '9423987654',
    role: 'tahsildar',
    account_status: 'active',
    preferred_language: 'en',
    password: 'TahsildarPass123!',
    created_at: '2025-11-01T08:00:00Z',
    updated_at: '2025-11-01T08:00:00Z',
  },
  {
    id: 'usr-worker-01',
    full_name: 'Prakash Mahadev Jadhav',
    email: 'drone.prakash@agrisurvey.gov.in',
    phone_number: '9765432109',
    role: 'field_worker',
    account_status: 'active',
    preferred_language: 'en',
    password: 'WorkerPass123!',
    created_at: '2025-12-15T11:20:00Z',
    updated_at: '2025-12-15T11:20:00Z',
  },
  {
    id: 'usr-admin-01',
    full_name: 'Dr. Meenakshi Sundaram, IAS',
    email: 'admin.director@agrisurvey.gov.in',
    phone_number: '9823000001',
    role: 'admin',
    account_status: 'active',
    preferred_language: 'en',
    password: 'AdminPass123!',
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
];

const INITIAL_SMS_MESSAGES: SmsMessage[] = [];

const INITIAL_FARMER_PROFILES: FarmerProfile[] = [
  {
    id: 'fp-01',
    user_id: 'usr-farmer-01',
    address: 'Gat No. 142, Pune-Nagar Highway, Wagholi Rural',
    village: 'Wagholi',
    taluk: 'Haveli',
    district: 'Pune',
    state: 'Maharashtra',
    postal_code: '412207',
    identity_verification_status: 'VERIFIED_DOC_ATTACHED',
    identity_verification_reference: 'VOTER-MH/2024/098124',
    created_at: '2026-02-10T09:30:00Z',
    updated_at: '2026-02-10T09:30:00Z',
  },
  {
    id: 'fp-02',
    user_id: 'usr-farmer-02',
    address: 'Near Gram Panchayat Office, Supae Road',
    village: 'Supae',
    taluk: 'Baramati',
    district: 'Pune',
    state: 'Maharashtra',
    postal_code: '412204',
    identity_verification_status: 'VERIFIED_DOC_ATTACHED',
    identity_verification_reference: 'PAN-BCKPS4192K',
    created_at: '2026-03-01T10:15:00Z',
    updated_at: '2026-03-01T10:15:00Z',
  },
];

const INITIAL_STAFF_REGIONS: StaffRegion[] = [
  {
    id: 'sr-01',
    staff_user_id: 'usr-tahsildar-01',
    state: 'Maharashtra',
    district: 'Pune',
    taluk: 'Haveli',
    village: null,
    created_at: '2025-11-01T08:00:00Z',
  },
  {
    id: 'sr-02',
    staff_user_id: 'usr-tahsildar-01',
    state: 'Maharashtra',
    district: 'Pune',
    taluk: 'Baramati',
    village: null,
    created_at: '2025-11-01T08:00:00Z',
  },
  {
    id: 'sr-03',
    staff_user_id: 'usr-worker-01',
    state: 'Maharashtra',
    district: 'Pune',
    taluk: 'Haveli',
    village: null,
    created_at: '2025-12-15T11:20:00Z',
  },
];

const INITIAL_PROPERTIES: Property[] = [
  {
    id: 'prop-01',
    farmer_id: 'usr-farmer-01',
    property_reference: 'AGRI-PROP-2026-HAV-0142',
    property_name: 'Patil Agro Sugarcane Field',
    survey_number: '142/2A',
    subdivision_number: '2A',
    land_document_reference: 'MH-PUN-7-12-2025-884920',
    land_area: 3.5,
    land_area_unit: 'Acres',
    land_type: 'Agricultural Land',
    farm_type: 'Crop Farming',
    ownership_category: 'Individual Ownership',
    village: 'Wagholi',
    taluk: 'Haveli',
    district: 'Pune',
    state: 'Maharashtra',
    latitude: 18.5793,
    longitude: 73.9824,
    created_at: '2026-02-12T10:00:00Z',
    updated_at: '2026-02-12T10:00:00Z',
  },
  {
    id: 'prop-02',
    farmer_id: 'usr-farmer-02',
    property_reference: 'AGRI-PROP-2026-BAR-0088',
    property_name: 'Shinde Organic Soybean Farm',
    survey_number: '88/1',
    subdivision_number: '1',
    land_document_reference: 'MH-PUN-7-12-2025-339182',
    land_area: 5.2,
    land_area_unit: 'Acres',
    land_type: 'Agricultural Land',
    farm_type: 'Crop Farming',
    ownership_category: 'Joint Ownership',
    village: 'Supae',
    taluk: 'Baramati',
    district: 'Pune',
    state: 'Maharashtra',
    latitude: 18.1519,
    longitude: 74.5772,
    created_at: '2026-03-02T11:20:00Z',
    updated_at: '2026-03-02T11:20:00Z',
  },
  {
    id: 'prop-03',
    farmer_id: 'usr-farmer-01',
    property_reference: 'AGRI-PROP-2026-SHI-0204',
    property_name: 'Shirur Agro Wheat & Jowar Plot',
    survey_number: '204/B',
    subdivision_number: 'B',
    land_document_reference: 'MH-PUN-7-12-2026-102941',
    land_area: 2.75,
    land_area_unit: 'Acres',
    land_type: 'Irrigated Land',
    farm_type: 'Mixed Farming',
    ownership_category: 'Individual Ownership',
    village: 'Koregaon Bhima',
    taluk: 'Shirur',
    district: 'Pune',
    state: 'Maharashtra',
    latitude: 18.6654,
    longitude: 74.0721,
    created_at: '2026-03-10T14:45:00Z',
    updated_at: '2026-03-10T14:45:00Z',
  },
];

const INITIAL_APPLICATIONS: RegistrationApplication[] = [
  {
    id: 'app-01',
    application_reference: 'AGRI-APP-2026-849102',
    farmer_id: 'usr-farmer-01',
    property_id: 'prop-01',
    status: 'APPROVED',
    assigned_tahsildar_id: 'usr-tahsildar-01',
    submitted_at: '2026-02-12T10:15:00Z',
    reviewed_at: '2026-02-14T11:30:00Z',
    rejection_reason: null,
    additional_information_request: null,
    created_at: '2026-02-12T10:15:00Z',
    updated_at: '2026-02-14T11:30:00Z',
  },
  {
    id: 'app-02',
    application_reference: 'AGRI-APP-2026-921345',
    farmer_id: 'usr-farmer-02',
    property_id: 'prop-02',
    status: 'PENDING_TAHSILDAR_REVIEW',
    assigned_tahsildar_id: 'usr-tahsildar-01',
    submitted_at: '2026-03-02T11:40:00Z',
    reviewed_at: null,
    rejection_reason: null,
    additional_information_request: null,
    created_at: '2026-03-02T11:40:00Z',
    updated_at: '2026-03-02T11:40:00Z',
  },
  {
    id: 'app-03',
    application_reference: 'AGRI-APP-2026-713420',
    farmer_id: 'usr-farmer-01',
    property_id: 'prop-03',
    status: 'PENDING_TAHSILDAR_REVIEW',
    assigned_tahsildar_id: 'usr-tahsildar-01',
    submitted_at: '2026-03-10T15:00:00Z',
    reviewed_at: null,
    rejection_reason: null,
    additional_information_request: null,
    created_at: '2026-03-10T15:00:00Z',
    updated_at: '2026-03-10T15:00:00Z',
  },
  {
    id: 'app-04',
    application_reference: 'AGRI-APP-2026-441829',
    farmer_id: 'usr-farmer-01',
    property_id: 'prop-01',
    status: 'ADDITIONAL_INFORMATION_REQUIRED',
    assigned_tahsildar_id: 'usr-tahsildar-01',
    submitted_at: '2026-03-15T09:00:00Z',
    reviewed_at: '2026-03-16T14:30:00Z',
    rejection_reason: null,
    additional_information_request: 'Please upload certified boundary sketch from Taluka Inspector of Land Records (TILR) to verify eastern easement boundary.',
    created_at: '2026-03-15T09:00:00Z',
    updated_at: '2026-03-16T14:30:00Z',
  },
  {
    id: 'app-05',
    application_reference: 'AGRI-APP-2026-218940',
    farmer_id: 'usr-farmer-02',
    property_id: 'prop-02',
    status: 'REJECTED',
    assigned_tahsildar_id: 'usr-tahsildar-01',
    submitted_at: '2026-02-01T10:00:00Z',
    reviewed_at: '2026-02-03T11:20:00Z',
    rejection_reason: 'Discrepancy in recorded survey area: Submitted 7/12 shows 4.0 Acres whereas application requested 5.2 Acres without joint-holder consent deed.',
    additional_information_request: null,
    created_at: '2026-02-01T10:00:00Z',
    updated_at: '2026-02-03T11:20:00Z',
  },
];

const INITIAL_LAND_IMAGES: FarmerLandImage[] = [
  {
    id: 'fli-01',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-farmer-01',
    storage_path: 'farmer-images/prop-01/north_entrance.jpg',
    original_filename: 'field_north_boundary.jpg',
    capture_timestamp: '2026-02-15T08:15:00Z',
    latitude: 18.5793,
    longitude: 73.9823,
    metadata_status: 'METADATA_EXTRACTED',
    uploaded_at: '2026-02-15T09:00:00Z',
  },
  {
    id: 'fli-02',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-farmer-01',
    storage_path: 'farmer-images/prop-01/sugarcane_crop_row.jpg',
    original_filename: 'sugarcane_canopy_rows.jpg',
    capture_timestamp: '2026-02-15T08:22:00Z',
    latitude: 18.5795,
    longitude: 73.9826,
    metadata_status: 'METADATA_EXTRACTED',
    uploaded_at: '2026-02-15T09:02:00Z',
  },
  {
    id: 'fli-03',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-farmer-01',
    storage_path: 'farmer-images/prop-01/drip_irrigation_lateral.jpg',
    original_filename: 'drip_irrigation_pipes.jpg',
    capture_timestamp: '2026-02-15T08:30:00Z',
    latitude: 18.5794,
    longitude: 73.9824,
    metadata_status: 'METADATA_EXTRACTED',
    uploaded_at: '2026-02-15T09:04:00Z',
  },
  {
    id: 'fli-04',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-farmer-01',
    storage_path: 'farmer-images/prop-01/east_survey_marker.jpg',
    original_filename: 'boundary_survey_stone.jpg',
    capture_timestamp: '2026-02-15T08:35:00Z',
    latitude: 18.5791,
    longitude: 73.9828,
    metadata_status: 'METADATA_EXTRACTED',
    uploaded_at: '2026-02-15T09:06:00Z',
  },
  {
    id: 'fli-05',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-farmer-01',
    storage_path: 'farmer-images/prop-01/pump_shed_borewell.jpg',
    original_filename: 'borewell_solar_pump.jpg',
    capture_timestamp: '2026-02-15T08:42:00Z',
    latitude: 18.5790,
    longitude: 73.9822,
    metadata_status: 'METADATA_EXTRACTED',
    uploaded_at: '2026-02-15T09:08:00Z',
  },
  {
    id: 'fli-06',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-farmer-01',
    storage_path: 'farmer-images/prop-01/overall_farm_view.jpg',
    original_filename: 'overall_landscape_view.jpg',
    capture_timestamp: '2026-02-15T08:50:00Z',
    latitude: 18.5796,
    longitude: 73.9825,
    metadata_status: 'METADATA_EXTRACTED',
    uploaded_at: '2026-02-15T09:10:00Z',
  },
];

const INITIAL_INSPECTIONS: FieldInspection[] = [
  {
    id: 'insp-01',
    property_id: 'prop-01',
    application_id: 'app-01',
    assigned_worker_id: 'usr-worker-01',
    assigned_tahsildar_id: 'usr-tahsildar-01',
    inspection_status: 'EVIDENCE_UPLOADED',
    scheduled_at: '2026-02-18T10:00:00Z',
    started_at: '2026-02-18T10:15:00Z',
    completed_at: '2026-02-18T11:45:00Z',
    field_notes: 'Flight executed with DJI Matrice 300 RTK at 45m AGL. 75% front overlap, 70% side overlap. High-density canopy coverage confirming healthy sugarcane stand.',
    created_at: '2026-02-16T10:00:00Z',
    updated_at: '2026-02-18T12:00:00Z',
  },
];

const INITIAL_DRONE_IMAGERY: DroneImagery[] = [
  {
    id: 'drn-01',
    inspection_id: 'insp-01',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-worker-01',
    storage_path: 'drone-imagery/insp-01/orthomosaic_nadir.jpg',
    original_filename: 'DJI_20260218_0142_NADIR.JPG',
    capture_timestamp: '2026-02-18T10:25:00Z',
    latitude: 18.5793,
    longitude: 73.9824,
    mission_reference: 'MISSION-HAV-2026-081',
    metadata_status: 'GEO_TAGGED_RTK',
    processing_status: 'PROCESSED',
    uploaded_at: '2026-02-18T12:30:00Z',
  },
  {
    id: 'drn-02',
    inspection_id: 'insp-01',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-worker-01',
    storage_path: 'drone-imagery/insp-01/oblique_field_overview.jpg',
    original_filename: 'DJI_20260218_0143_OBLIQUE.JPG',
    capture_timestamp: '2026-02-18T10:32:00Z',
    latitude: 18.5796,
    longitude: 73.9822,
    mission_reference: 'MISSION-HAV-2026-081',
    metadata_status: 'GEO_TAGGED_RTK',
    processing_status: 'PROCESSED',
    uploaded_at: '2026-02-18T12:32:00Z',
  },
  {
    id: 'drn-03',
    inspection_id: 'insp-01',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-worker-01',
    storage_path: 'drone-imagery/insp-01/irrigation_infrastructure.jpg',
    original_filename: 'DJI_20260218_0144_IRRIGATION.JPG',
    capture_timestamp: '2026-02-18T10:40:00Z',
    latitude: 18.5794,
    longitude: 73.9825,
    mission_reference: 'MISSION-HAV-2026-081',
    metadata_status: 'GEO_TAGGED_RTK',
    processing_status: 'PROCESSED',
    uploaded_at: '2026-02-18T12:35:00Z',
  },
  {
    id: 'drn-04',
    inspection_id: 'insp-01',
    property_id: 'prop-01',
    application_id: 'app-01',
    uploaded_by: 'usr-worker-01',
    storage_path: 'drone-imagery/insp-01/boundary_stone_aerial.jpg',
    original_filename: 'DJI_20260218_0145_BOUNDARY.JPG',
    capture_timestamp: '2026-02-18T10:48:00Z',
    latitude: 18.5791,
    longitude: 73.9829,
    mission_reference: 'MISSION-HAV-2026-081',
    metadata_status: 'GEO_TAGGED_RTK',
    processing_status: 'PROCESSED',
    uploaded_at: '2026-02-18T12:38:00Z',
  },
];

const INITIAL_COMPARISONS: ImageComparison[] = [
  {
    id: 'cmp-01',
    application_id: 'app-01',
    property_id: 'prop-01',
    comparison_result: 'CONSISTENT',
    similarity_score: 93.4,
    similarity_model_version: 'AgriVision-SIFT-v2.1',
    review_notes: 'Visible land boundary landmarks, irrigation pipe alignment, and crop vigor in farmer photo #2 perfectly correspond with drone orthomosaic Nadir image DJI_0142.',
    reviewed_by: 'usr-tahsildar-01',
    reviewed_at: '2026-02-20T14:30:00Z',
    created_at: '2026-02-20T14:30:00Z',
  },
];

const INITIAL_CROP_VERIFICATIONS: CropVerification[] = [
  {
    id: 'cv-01',
    property_id: 'prop-01',
    application_id: 'app-01',
    declared_crop_type: 'Sugarcane (ऊस)',
    observed_crop_type: 'Sugarcane (ऊस)',
    crop_category: 'Cash Crop',
    cultivation_season: 'Annual (Adsali / Suru)',
    approximate_cultivated_area: 3.45,
    irrigation_method: 'Drip Irrigation',
    verification_result: 'MATCHES',
    ai_prediction: null,
    ai_confidence: null,
    ai_model_version: null,
    reviewer_notes: 'Confirmed by Tahsildar Anand Kulkarni: Stand is 5-6 month old high-density sugarcane matching declaration and drone spectral reflectance.',
    verified_by: 'usr-tahsildar-01',
    verified_at: '2026-02-20T15:10:00Z',
    created_at: '2026-02-20T15:10:00Z',
  },
];

const INITIAL_REPORTS: VerificationReport[] = [
  {
    id: 'rep-01',
    report_reference: 'AGRI-VR-2026-583921',
    property_id: 'prop-01',
    application_id: 'app-01',
    reviewed_by: 'usr-tahsildar-01',
    final_status: 'VERIFIED',
    findings: {
      survey_number_matched: true,
      physical_boundaries_verified: true,
      boundary_discrepancy_meters: 0.4,
      declared_area: 3.5,
      measured_area: 3.48,
      crop_matched: true,
      declared_crop: 'Sugarcane (ऊस)',
      observed_crop: 'Sugarcane (ऊस)',
      irrigation_verified: 'Drip Irrigation operational',
      ai_assisted_analysis_conducted: true,
      similarity_score: 93.4,
    },
    discrepancies: 'Negligible 0.02 acre buffer variation on western boundary hedge with adjacent cart-track.',
    supporting_evidence: [
      { type: 'FARMER_IMAGES', title: '6 Verified Ground Photographs', reference: 'FLI-01 to FLI-06', date: '2026-02-15' },
      { type: 'DRONE_SURVEY', title: 'DJI RTK Aerial Mission #081', reference: 'DRN-01 to DRN-04', date: '2026-02-18' },
      { type: 'CROP_VERIFICATION', title: 'Revenue Crop Inspection Record', reference: 'CV-01', date: '2026-02-20' },
      { type: 'LAND_REVENUE_EXTRACT', title: '7/12 Extract Verification', reference: 'MH-PUN-7-12-2025-884920', date: '2026-02-12' },
    ],
    report_storage_path: 'reports/AGRI-VR-2026-583921.pdf',
    created_at: '2026-02-21T11:00:00Z',
  },
];

const INITIAL_NOTIFICATIONS: Notification[] = [
  {
    id: 'notif-01',
    recipient_user_id: 'usr-farmer-01',
    notification_type: 'FINAL_VERIFICATION_COMPLETED',
    title: 'Verification Report Issued',
    message: 'Your AgriSurvey land verification report AGRI-VR-2026-583921 is now available for download. Decision: VERIFIED.',
    related_application_id: 'app-01',
    channel: 'both',
    delivery_status: 'delivered',
    read_at: null,
    created_at: '2026-02-21T11:05:00Z',
  },
  {
    id: 'notif-02',
    recipient_user_id: 'usr-tahsildar-01',
    notification_type: 'NEW_REGISTRATION_SUBMITTED',
    title: 'New Land Application in Baramati',
    message: 'Sunita Shinde submitted application AGRI-APP-2026-921345 for Survey No. 88/1, Supae, Baramati. Review pending.',
    related_application_id: 'app-02',
    channel: 'in_app',
    delivery_status: 'delivered',
    read_at: null,
    created_at: '2026-03-02T11:45:00Z',
  },
  {
    id: 'notif-03',
    recipient_user_id: 'usr-farmer-02',
    notification_type: 'APPLICATION_SUBMITTED',
    title: 'Application Received',
    message: 'Your land registration application AGRI-APP-2026-921345 has been submitted successfully and is awaiting verification by the responsible Tahsildar.',
    related_application_id: 'app-02',
    channel: 'both',
    delivery_status: 'delivered',
    read_at: '2026-03-02T12:00:00Z',
    created_at: '2026-03-02T11:40:00Z',
  },
];

const INITIAL_AUDIT_LOGS: AuditLog[] = [
  {
    id: 'aud-01',
    actor_user_id: 'usr-tahsildar-01',
    actor_name: 'Anand Shrikant Kulkarni (Tahsildar)',
    action: 'TAHSILDAR_APPLICATION_APPROVED',
    entity_type: 'registration_applications',
    entity_id: 'app-01',
    previous_state: { status: 'PENDING_TAHSILDAR_REVIEW' },
    new_state: { status: 'APPROVED', reviewed_at: '2026-02-14T11:30:00Z' },
    created_at: '2026-02-14T11:30:00Z',
  },
  {
    id: 'aud-02',
    actor_user_id: 'usr-farmer-01',
    actor_name: 'Ramesh Balasaheb Patil (Farmer)',
    action: 'FARMER_LAND_IMAGES_UPLOADED',
    entity_type: 'farmer_land_images',
    entity_id: 'app-01',
    previous_state: null,
    new_state: { image_count: 6, status: 'SUBMITTED_FOR_INSPECTION' },
    created_at: '2026-02-15T09:10:00Z',
  },
  {
    id: 'aud-03',
    actor_user_id: 'usr-worker-01',
    actor_name: 'Prakash Mahadev Jadhav (Field Worker)',
    action: 'DRONE_EVIDENCE_SUBMITTED',
    entity_type: 'field_inspections',
    entity_id: 'insp-01',
    previous_state: { inspection_status: 'SCHEDULED' },
    new_state: { inspection_status: 'EVIDENCE_UPLOADED', photo_count: 4 },
    created_at: '2026-02-18T12:40:00Z',
  },
  {
    id: 'aud-04',
    actor_user_id: 'usr-tahsildar-01',
    actor_name: 'Anand Shrikant Kulkarni (Tahsildar)',
    action: 'FINAL_LAND_VERIFICATION_COMPLETED',
    entity_type: 'verification_reports',
    entity_id: 'rep-01',
    previous_state: { status: 'PENDING_FINAL_REVIEW' },
    new_state: { report_reference: 'AGRI-VR-2026-583921', final_status: 'VERIFIED' },
    created_at: '2026-02-21T11:00:00Z',
  },
];

// -----------------------------------------------------------------------------
// Plant Intelligence & Health Initial Seed Data
// -----------------------------------------------------------------------------
const INITIAL_CROPS: Crop[] = [
  { id: 'crop-sugarcane', name: 'Sugarcane', scientific_name: 'Saccharum officinarum', category: 'Cash Crop', default_season: 'Perennial', description: 'Primary cash crop of Western Maharashtra irrigated tracts.' },
  { id: 'crop-cotton', name: 'Cotton', scientific_name: 'Gossypium hirsutum', category: 'Cash Crop', default_season: 'Kharif', description: 'Deep-rooted fiber crop sensitive to moisture stress.' },
  { id: 'crop-soybean', name: 'Soybean', scientific_name: 'Glycine max', category: 'Pulse', default_season: 'Kharif', description: 'Major pulse and oilseed crop of Deccan plateau.' },
  { id: 'crop-onion', name: 'Onion', scientific_name: 'Allium cepa', category: 'Vegetable', default_season: 'Rabi', description: 'High value bulb crop cultivated extensively in Pune/Nashik.' },
  { id: 'crop-wheat', name: 'Wheat', scientific_name: 'Triticum aestivum', category: 'Cereal', default_season: 'Rabi', description: 'Standard staple cereal irrigated during winter season.' },
  { id: 'crop-tomato', name: 'Tomato', scientific_name: 'Solanum lycopersicum', category: 'Horticulture', default_season: 'Kharif', description: 'Intensively managed vegetable crop requiring balanced moisture.' },
  { id: 'crop-grapes', name: 'Grapes', scientific_name: 'Vitis vinifera', category: 'Horticulture', default_season: 'Perennial', description: 'Commercial export fruit grown under precision drip systems.' },
];

const INITIAL_CROP_THRESHOLDS: CropHealthThreshold[] = DEFAULT_CROP_THRESHOLDS;

const INITIAL_MONITORING_UNITS: MonitoringUnit[] = [
  {
    id: 'unit-01',
    property_id: 'prop-01', // Patil Agro Sugarcane Field (Approved Land)
    unit_name: 'Plot A - Sugarcane (Co 86032)',
    unit_type: 'plot',
    crop_id: 'crop-sugarcane',
    crop_variety: 'Sugarcane (Co 86032)',
    planting_date: '2025-11-10',
    zone_identifier: 'ZONE-NORTH-A1',
    latitude: 18.5794,
    longitude: 73.9825,
    area_covered: 1.5,
    area_unit: 'Acres',
    current_health_status: 'Healthy',
    last_assessed_at: '2026-10-22T09:20:00Z',
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-10-22T09:20:00Z',
  },
  {
    id: 'unit-02',
    property_id: 'prop-01',
    unit_name: 'Plot B - Sugarcane (CoM 0265)',
    unit_type: 'plot',
    crop_id: 'crop-sugarcane',
    crop_variety: 'Sugarcane (CoM 0265)',
    planting_date: '2025-12-01',
    zone_identifier: 'ZONE-SOUTH-B2',
    latitude: 18.5791,
    longitude: 73.9822,
    area_covered: 1.0,
    area_unit: 'Acres',
    current_health_status: 'Needs Attention',
    last_assessed_at: '2026-10-22T09:10:00Z',
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-10-22T09:10:00Z',
  },
  {
    id: 'unit-03',
    property_id: 'prop-01',
    unit_name: 'Plot C - Sugarcane Drip Lateral 4',
    unit_type: 'crop_zone',
    crop_id: 'crop-sugarcane',
    crop_variety: 'Sugarcane (Co 86032)',
    planting_date: '2025-11-15',
    zone_identifier: 'ZONE-EAST-C4',
    latitude: 18.5796,
    longitude: 73.9828,
    area_covered: 0.5,
    area_unit: 'Acres',
    current_health_status: 'Critical',
    last_assessed_at: '2026-10-22T09:05:00Z',
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-10-22T09:05:00Z',
  },
  {
    id: 'unit-04',
    property_id: 'prop-01',
    unit_name: 'Plot D - Onion Intercrop Zone',
    unit_type: 'plot',
    crop_id: 'crop-onion',
    crop_variety: 'Onion (Bhima Super)',
    planting_date: '2026-01-10',
    zone_identifier: 'ZONE-WEST-D1',
    latitude: 18.5790,
    longitude: 73.9829,
    area_covered: 0.5,
    area_unit: 'Acres',
    current_health_status: 'Insufficient Data',
    last_assessed_at: '2026-10-18T08:00:00Z',
    created_at: '2026-02-15T10:00:00Z',
    updated_at: '2026-10-18T08:00:00Z',
  },
];

const INITIAL_SENSOR_DEVICES: SensorDevice[] = [
  {
    id: 'dev-01',
    property_id: 'prop-01',
    monitoring_unit_id: 'unit-01',
    device_serial: 'LORA-SN-PUN-0192',
    device_name: 'LoRaWAN Soil Probe #1 (Plot A)',
    device_type: 'Multi-Depth Soil Profile Station',
    model_number: 'AgriSens Pro-400',
    status: 'active',
    last_heartbeat: '2026-10-22T09:20:00Z',
    battery_level: 95,
    created_at: '2026-02-20T10:00:00Z',
  },
  {
    id: 'dev-02',
    property_id: 'prop-01',
    monitoring_unit_id: 'unit-02',
    device_serial: 'LORA-SN-PUN-0193',
    device_name: 'LoRaWAN Soil Probe #2 (Plot B)',
    device_type: 'Capacitive Soil Moisture Probe',
    model_number: 'AgriSens Lite-200',
    status: 'active',
    last_heartbeat: '2026-10-22T09:10:00Z',
    battery_level: 88,
    created_at: '2026-02-20T10:00:00Z',
  },
  {
    id: 'dev-03',
    property_id: 'prop-01',
    monitoring_unit_id: 'unit-03',
    device_serial: 'LORA-SN-PUN-0194',
    device_name: 'Telemetry Node #3 (Plot C)',
    device_type: 'Tensiometer & Salinity Node',
    model_number: 'EcoSoil-EC3',
    status: 'active',
    last_heartbeat: '2026-10-22T09:05:00Z',
    battery_level: 72,
    created_at: '2026-02-20T10:00:00Z',
  },
  {
    id: 'dev-04',
    property_id: 'prop-01',
    monitoring_unit_id: 'unit-04',
    device_serial: 'LORA-SN-PUN-0199',
    device_name: 'Nursery Weather Node (Plot D)',
    device_type: 'Micro-Climate Station',
    model_number: 'AgriMet-M10',
    status: 'disconnected',
    last_heartbeat: '2026-10-18T08:00:00Z',
    battery_level: 12,
    created_at: '2026-02-20T10:00:00Z',
  },
];

const INITIAL_SENSOR_READINGS: SensorReading[] = [
  // Readings for Unit 01 (Healthy Plot A)
  { id: 'rd-01', device_id: 'dev-01', property_id: 'prop-01', monitoring_unit_id: 'unit-01', parameter: 'soil_moisture', value: 68.4, unit: '%', recorded_at: '2026-10-22T09:20:00Z', source_device: 'LORA-SN-PUN-0192', data_quality: 'validated', created_at: '2026-10-22T09:20:00Z' },
  { id: 'rd-02', device_id: 'dev-01', property_id: 'prop-01', monitoring_unit_id: 'unit-01', parameter: 'soil_ph', value: 6.9, unit: 'pH', recorded_at: '2026-10-22T09:20:00Z', source_device: 'LORA-SN-PUN-0192', data_quality: 'validated', created_at: '2026-10-22T09:20:00Z' },
  { id: 'rd-03', device_id: 'dev-01', property_id: 'prop-01', monitoring_unit_id: 'unit-01', parameter: 'soil_temperature', value: 24.5, unit: '°C', recorded_at: '2026-10-22T09:20:00Z', source_device: 'LORA-SN-PUN-0192', data_quality: 'validated', created_at: '2026-10-22T09:20:00Z' },
  { id: 'rd-04', device_id: 'dev-01', property_id: 'prop-01', monitoring_unit_id: 'unit-01', parameter: 'ambient_temperature', value: 28.2, unit: '°C', recorded_at: '2026-10-22T09:20:00Z', source_device: 'LORA-SN-PUN-0192', data_quality: 'validated', created_at: '2026-10-22T09:20:00Z' },
  { id: 'rd-05', device_id: 'dev-01', property_id: 'prop-01', monitoring_unit_id: 'unit-01', parameter: 'relative_humidity', value: 64.0, unit: '%', recorded_at: '2026-10-22T09:20:00Z', source_device: 'LORA-SN-PUN-0192', data_quality: 'validated', created_at: '2026-10-22T09:20:00Z' },
  { id: 'rd-06', device_id: 'dev-01', property_id: 'prop-01', monitoring_unit_id: 'unit-01', parameter: 'soil_ec', value: 0.95, unit: 'dS/m', recorded_at: '2026-10-22T09:20:00Z', source_device: 'LORA-SN-PUN-0192', data_quality: 'validated', created_at: '2026-10-22T09:20:00Z' },

  // Readings for Unit 02 (Needs Attention Plot B: slight moisture dip)
  { id: 'rd-07', device_id: 'dev-02', property_id: 'prop-01', monitoring_unit_id: 'unit-02', parameter: 'soil_moisture', value: 54.2, unit: '%', recorded_at: '2026-10-22T09:10:00Z', source_device: 'LORA-SN-PUN-0193', data_quality: 'validated', created_at: '2026-10-22T09:10:00Z' },
  { id: 'rd-08', device_id: 'dev-02', property_id: 'prop-01', monitoring_unit_id: 'unit-02', parameter: 'soil_ph', value: 6.6, unit: 'pH', recorded_at: '2026-10-22T09:10:00Z', source_device: 'LORA-SN-PUN-0193', data_quality: 'validated', created_at: '2026-10-22T09:10:00Z' },
  { id: 'rd-09', device_id: 'dev-02', property_id: 'prop-01', monitoring_unit_id: 'unit-02', parameter: 'soil_temperature', value: 26.8, unit: '°C', recorded_at: '2026-10-22T09:10:00Z', source_device: 'LORA-SN-PUN-0193', data_quality: 'validated', created_at: '2026-10-22T09:10:00Z' },

  // Readings for Unit 03 (Critical Plot C: acute drought stress)
  { id: 'rd-10', device_id: 'dev-03', property_id: 'prop-01', monitoring_unit_id: 'unit-03', parameter: 'soil_moisture', value: 27.4, unit: '%', recorded_at: '2026-10-22T09:05:00Z', source_device: 'LORA-SN-PUN-0194', data_quality: 'validated', created_at: '2026-10-22T09:05:00Z' },
  { id: 'rd-11', device_id: 'dev-03', property_id: 'prop-01', monitoring_unit_id: 'unit-03', parameter: 'soil_temperature', value: 33.5, unit: '°C', recorded_at: '2026-10-22T09:05:00Z', source_device: 'LORA-SN-PUN-0194', data_quality: 'validated', created_at: '2026-10-22T09:05:00Z' },
  { id: 'rd-12', device_id: 'dev-03', property_id: 'prop-01', monitoring_unit_id: 'unit-03', parameter: 'soil_ph', value: 7.2, unit: 'pH', recorded_at: '2026-10-22T09:05:00Z', source_device: 'LORA-SN-PUN-0194', data_quality: 'validated', created_at: '2026-10-22T09:05:00Z' },
];

const INITIAL_PLANT_OBSERVATIONS: PlantObservation[] = [
  {
    id: 'obs-01',
    monitoring_unit_id: 'unit-01',
    property_id: 'prop-01',
    recorded_by: 'usr-farmer-01',
    recorded_by_name: 'Ramesh Balasaheb Patil',
    observation_type: 'image',
    collection_method: 'Ground High-Resolution Mobile Photography',
    data_source: 'farmer_mobile',
    timestamp: '2026-10-21T15:30:00Z',
    growth_stage: 'Vegetative',
    irrigation_condition: 'Optimal',
    wilting_observed: false,
    leaf_discoloration: 'None',
    pest_observed: false,
    general_notes: 'Cane crop stands vigorous. Good tillering observed across rows 1 to 24.',
    photographs: [
      {
        id: 'photo-01',
        url: 'https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=800&q=80',
        category: 'leaf',
        caption: 'Healthy cane foliage: dark green lamina with active stomatal transpiration.',
        uploaded_at: '2026-10-21T15:30:00Z',
      },
      {
        id: 'photo-02',
        url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80',
        category: 'overview',
        caption: 'Broad canopy overview: uniform height and good row spacing.',
        uploaded_at: '2026-10-21T15:30:00Z',
      },
    ],
    created_at: '2026-10-21T15:30:00Z',
  },
  {
    id: 'obs-02',
    monitoring_unit_id: 'unit-03',
    property_id: 'prop-01',
    recorded_by: 'usr-worker-01',
    recorded_by_name: 'Prakash Mahadev Jadhav (Field Worker)',
    observation_type: 'field_inspection',
    collection_method: 'Field Worker In-Situ Agronomic Survey',
    data_source: 'field_worker_tablet',
    timestamp: '2026-10-22T08:45:00Z',
    growth_stage: 'Vegetative',
    irrigation_condition: 'Severe Drought',
    wilting_observed: true,
    leaf_discoloration: 'Chlorosis (Yellowing)',
    pest_observed: false,
    general_notes: 'Drip lateral 4 blocked by sediment; plants showing prominent afternoon leaf rolling and tip chlorosis.',
    photographs: [
      {
        id: 'photo-03',
        url: 'https://images.unsplash.com/photo-1595974482597-4b8da8879bc5?auto=format&fit=crop&w=800&q=80',
        category: 'stem',
        caption: 'Cane stem and dry soil surface along clogged drip lateral line.',
        uploaded_at: '2026-10-22T08:45:00Z',
      },
    ],
    created_at: '2026-10-22T08:45:00Z',
  },
];

const INITIAL_PLANT_ASSESSMENTS: PlantHealthAssessment[] = [
  {
    id: 'pha-01',
    monitoring_unit_id: 'unit-01',
    property_id: 'prop-01',
    overall_status: 'Healthy',
    assessment_timestamp: '2026-10-22T09:20:00Z',
    supporting_measurements: {
      soil_moisture: { value: 68.4, unit: '%', status: 'optimal' },
      soil_ph: { value: 6.9, unit: 'pH', status: 'optimal' },
      soil_temperature: { value: 24.5, unit: '°C', status: 'optimal' },
      ambient_temperature: { value: 28.2, unit: '°C', status: 'optimal' },
      relative_humidity: { value: 64.0, unit: '%', status: 'optimal' },
      soil_ec: { value: 0.95, unit: 'dS/m', status: 'optimal' },
    },
    detected_anomalies: ['All monitored parameters within optimal ranges.'],
    possible_concerns: ['No acute physiological concerns detected.'],
    suggested_next_steps: ['Maintain current irrigation schedule and fertigation baseline.'],
    data_freshness: 'Updated 29 minutes ago',
    confidence: null,
    assessment_method: 'AgriSurvey Agronomic Rules Engine v2.4',
    model_version: 'v2.4.2-pune-rules',
    is_preliminary: false,
    created_at: '2026-10-22T09:20:00Z',
  },
  {
    id: 'pha-02',
    monitoring_unit_id: 'unit-02',
    property_id: 'prop-01',
    overall_status: 'Needs Attention',
    assessment_timestamp: '2026-10-22T09:10:00Z',
    supporting_measurements: {
      soil_moisture: { value: 54.2, unit: '%', status: 'low' },
      soil_ph: { value: 6.6, unit: 'pH', status: 'optimal' },
      soil_temperature: { value: 26.8, unit: '°C', status: 'optimal' },
    },
    detected_anomalies: ['Soil moisture at 54.2% is below optimal range [60-80%] for Sugarcane.'],
    possible_concerns: ['Mild vegetative moisture deficit beginning to limit daily stalk elongation.'],
    suggested_next_steps: ['Increase drip cycle duration by 45 minutes over next 24 hours.'],
    data_freshness: 'Updated 39 minutes ago',
    confidence: null,
    assessment_method: 'AgriSurvey Agronomic Rules Engine v2.4',
    model_version: 'v2.4.2-pune-rules',
    is_preliminary: false,
    created_at: '2026-10-22T09:10:00Z',
  },
  {
    id: 'pha-03',
    monitoring_unit_id: 'unit-03',
    property_id: 'prop-01',
    overall_status: 'Critical',
    assessment_timestamp: '2026-10-22T09:05:00Z',
    supporting_measurements: {
      soil_moisture: { value: 27.4, unit: '%', status: 'critical' },
      soil_temperature: { value: 33.5, unit: '°C', status: 'warning' },
      soil_ph: { value: 7.2, unit: 'pH', status: 'optimal' },
    },
    detected_anomalies: [
      'Soil moisture at 27.4% is critically below tolerable threshold (45.0%) for Sugarcane.',
      'Visible foliage wilting observed during field worker inspection.',
    ],
    possible_concerns: [
      'Risk of permanent wilting point, vascular cavitation, and irreversible yield loss.',
    ],
    suggested_next_steps: [
      'Flush and unblock drip lateral 4 immediately; irrigate zone for 3.5 hours continuously.',
    ],
    data_freshness: 'Updated 44 minutes ago',
    confidence: null,
    assessment_method: 'AgriSurvey Agronomic Rules Engine v2.4',
    model_version: 'v2.4.2-pune-rules',
    is_preliminary: false,
    created_at: '2026-10-22T09:05:00Z',
  },
];

const INITIAL_PLANT_ALERTS: PlantHealthAlert[] = [
  {
    id: 'alert-01',
    monitoring_unit_id: 'unit-03',
    property_id: 'prop-01',
    crop_name: 'Sugarcane (Co 86032)',
    unit_name: 'Plot C - Sugarcane Drip Lateral 4',
    property_name: 'Patil Agro Sugarcane Field',
    severity: 'critical',
    reason: 'Soil moisture at 27.4% is critically below tolerable threshold (45.0%) for Sugarcane.',
    supporting_measurement: 'Severe drought stress, turgor loss, and soil moisture at 27.4%',
    recommended_action: 'Flush and unblock drip lateral 4 immediately; irrigate zone for 3.5 hours continuously.',
    status: 'active',
    detected_at: '2026-10-22T09:05:00Z',
  },
  {
    id: 'alert-02',
    monitoring_unit_id: 'unit-02',
    property_id: 'prop-01',
    crop_name: 'Sugarcane (CoM 0265)',
    unit_name: 'Plot B - Sugarcane (CoM 0265)',
    property_name: 'Patil Agro Sugarcane Field',
    severity: 'medium',
    reason: 'Soil moisture at 54.2% is below optimal range [60-80%] for Sugarcane.',
    supporting_measurement: 'Moisture deficit in upper 20cm soil profile',
    recommended_action: 'Increase drip cycle duration by 45 minutes over next 24 hours.',
    status: 'active',
    detected_at: '2026-10-22T09:10:00Z',
  },
];

// -----------------------------------------------------------------------------
// Geospatial & Remote Sensing Initial Seed Data
// -----------------------------------------------------------------------------
const INITIAL_FARM_PLOTS: FarmPlot[] = [
  {
    id: 'plot-01',
    plot_reference: 'MH-PUN-HAV-PLOT-2026-00412',
    property_id: 'prop-01',
    farmer_id: 'usr-farmer-01',
    survey_number: '142/2A',
    subdivision_number: '2A',
    plot_name: 'Patil Agro Sugarcane Field',
    boundary_coordinates: [
      [18.5805, 73.9810],
      [18.5808, 73.9840],
      [18.5780, 73.9842],
      [18.5778, 73.9812],
      [18.5805, 73.9810],
    ],
    area_sqm: 14083,
    area_hectares: 1.408,
    area_acres: 3.48,
    perimeter_meters: 520,
    village: 'Wagholi',
    taluk: 'Haveli',
    district: 'Pune',
    state: 'Maharashtra',
    is_cadastral_verified: true,
    crop_type: 'Sugarcane',
    sowing_date: '2025-11-10',
    latest_ndvi: 0.68,
    latest_weather: '28.7°C, Clear Sky',
    created_at: '2026-02-12T10:00:00Z',
    updated_at: '2026-10-24T12:00:00Z',
  },
  {
    id: 'plot-02',
    plot_reference: 'MH-PUN-BAR-PLOT-2026-00881',
    property_id: 'prop-02',
    farmer_id: 'usr-farmer-02',
    survey_number: '88/1',
    subdivision_number: '1',
    plot_name: 'Shinde Organic Soybean Farm',
    boundary_coordinates: [
      [18.1530, 74.5755],
      [18.1535, 74.5790],
      [18.1505, 74.5792],
      [18.1500, 74.5758],
      [18.1530, 74.5755],
    ],
    area_sqm: 20963,
    area_hectares: 2.096,
    area_acres: 5.18,
    perimeter_meters: 610,
    village: 'Supae',
    taluk: 'Baramati',
    district: 'Pune',
    state: 'Maharashtra',
    is_cadastral_verified: true,
    crop_type: 'Soybean',
    sowing_date: '2026-06-18',
    latest_ndvi: 0.62,
    latest_weather: '29.2°C, Partly Cloudy',
    created_at: '2026-03-01T10:15:00Z',
    updated_at: '2026-10-24T12:00:00Z',
  },
];

const INITIAL_SATELLITE_SCENES: SatelliteScene[] = [
  {
    id: 'sc-01',
    scene_id: 'S2C_43QCA_20261020_0_L2A',
    collection: 'sentinel-2-l2a',
    acquisition_datetime: '2026-10-20T05:43:56Z',
    cloud_cover_percentage: 4.8,
    footprint_coordinates: [
      [18.4, 73.7],
      [18.4, 74.3],
      [19.0, 74.3],
      [19.0, 73.7],
      [18.4, 73.7],
    ],
    thumbnail_url:
      'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/Q/CA/2026/10/S2C_43QCA_20261020_0_L2A/preview.jpg',
    visual_url:
      'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/Q/CA/2026/10/S2C_43QCA_20261020_0_L2A/TCI.tif',
    assets: {
      thumbnail: {
        href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/Q/CA/2026/10/S2C_43QCA_20261020_0_L2A/preview.jpg',
        title: 'Preview',
      },
      red: {
        href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/Q/CA/2026/10/S2C_43QCA_20261020_0_L2A/B04.tif',
        title: 'B04 (Red 10m)',
        gsd: 10,
      },
      nir: {
        href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/Q/CA/2026/10/S2C_43QCA_20261020_0_L2A/B08.tif',
        title: 'B08 (NIR 10m)',
        gsd: 10,
      },
      scl: {
        href: 'https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/43/Q/CA/2026/10/S2C_43QCA_20261020_0_L2A/SCL.tif',
        title: 'Scene Classification Layer (SCL 20m)',
        gsd: 20,
      },
    },
    intersects_plot: true,
    created_at: '2026-10-20T06:00:00Z',
  },
];

const INITIAL_VEGETATION_OBSERVATIONS: VegetationIndexObservation[] = [
  {
    id: 'veg-obs-01',
    plot_id: 'plot-01',
    scene_id: 'S2C_43QCA_20261020_0_L2A',
    scene_acquisition_date: '2026-10-20T05:43:56Z',
    calculation_date: '2026-10-24T10:00:00Z',
    ndvi_mean: 0.68,
    ndvi_min: 0.42,
    ndvi_max: 0.81,
    valid_pixel_coverage_pct: 98.4,
    vegetation_classification: 'Very High Density',
    raster_bounds: [
      [18.5778, 73.9810],
      [18.5808, 73.9842],
    ],
    processing_method: 'Sentinel-2 L2A (B08-B04)/(B08+B04) + SCL Cloud Masking',
    processing_status: 'COMPLETED',
    created_at: '2026-10-24T10:00:00Z',
  },
  {
    id: 'veg-obs-02',
    plot_id: 'plot-02',
    scene_id: 'S2C_43QCA_20261020_0_L2A',
    scene_acquisition_date: '2026-10-20T05:43:56Z',
    calculation_date: '2026-10-24T10:05:00Z',
    ndvi_mean: 0.62,
    ndvi_min: 0.38,
    ndvi_max: 0.74,
    valid_pixel_coverage_pct: 99.1,
    vegetation_classification: 'Very High Density',
    raster_bounds: [
      [18.1500, 74.5755],
      [18.1535, 74.5792],
    ],
    processing_method: 'Sentinel-2 L2A (B08-B04)/(B08+B04) + SCL Cloud Masking',
    processing_status: 'COMPLETED',
    created_at: '2026-10-24T10:05:00Z',
  },
];

const INITIAL_WEATHER_OBSERVATIONS: WeatherObservation[] = [
  {
    id: 'wea-01',
    plot_id: 'plot-01',
    latitude: 18.5793,
    longitude: 73.9824,
    elevation_meters: 586,
    observation_timestamp: '2026-10-26T10:00:00+05:30',
    temperature_celsius: 28.7,
    relative_humidity_pct: 34,
    precipitation_mm: 0.0,
    wind_speed_kmh: 6.0,
    weather_condition: 'Clear Sky',
    weather_code: 0,
    daily_forecast: [
      { date: '2026-10-26', temp_max_celsius: 32.2, temp_min_celsius: 20.9, precipitation_mm: 0.0, rain_probability: 5 },
      { date: '2026-10-27', temp_max_celsius: 32.0, temp_min_celsius: 20.5, precipitation_mm: 0.0, rain_probability: 5 },
      { date: '2026-10-28', temp_max_celsius: 31.6, temp_min_celsius: 19.5, precipitation_mm: 0.0, rain_probability: 10 },
      { date: '2026-10-29', temp_max_celsius: 32.2, temp_min_celsius: 22.3, precipitation_mm: 1.7, rain_probability: 40 },
      { date: '2026-10-30', temp_max_celsius: 29.8, temp_min_celsius: 21.6, precipitation_mm: 3.0, rain_probability: 65 },
    ],
    provider: 'Open-Meteo (Live)',
    quality_status: 'LIVE',
    fetched_at: '2026-10-26T10:00:00Z',
  },
];

const INITIAL_DRONE_MISSIONS: DroneMissionRecord[] = [
  {
    id: 'drm-01',
    mission_reference: 'DRN-HAV-2026-081',
    plot_id: 'plot-01',
    title: 'Post-Monsoon Sugarcane Canopy Assessment',
    pilot_name: 'Prakash Mahadev Jadhav',
    flight_date: '2026-10-22',
    flight_altitude_meters: 65,
    camera_sensor: 'DJI Zenmuse P1 45MP Full-Frame RGB',
    photos_count: 4,
    geotagged_photos: [
      {
        id: 'gp-01',
        url: 'https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=800&q=80',
        filename: 'DJI_20261022_0142.JPG',
        latitude: 18.5794,
        longitude: 73.9825,
        altitude_meters: 65,
        captured_at: '2026-10-22T11:15:00Z',
      },
      {
        id: 'gp-02',
        url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=800&q=80',
        filename: 'DJI_20261022_0143.JPG',
        latitude: 18.5798,
        longitude: 73.9830,
        altitude_meters: 65,
        captured_at: '2026-10-22T11:16:30Z',
      },
      {
        id: 'gp-03',
        url: 'https://images.unsplash.com/photo-1586771107445-d3ca888129ff?auto=format&fit=crop&w=800&q=80',
        filename: 'DJI_20261022_0144.JPG',
        latitude: 18.5788,
        longitude: 73.9820,
        altitude_meters: 65,
        captured_at: '2026-10-22T11:18:00Z',
      },
      {
        id: 'gp-04',
        url: 'https://images.unsplash.com/photo-1625246333195-78d9c38ad449?auto=format&fit=crop&w=800&q=80',
        filename: 'DJI_20261022_0145.JPG',
        latitude: 18.5782,
        longitude: 73.9835,
        altitude_meters: 65,
        captured_at: '2026-10-22T11:19:30Z',
      },
    ],
    orthomosaic_url: 'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80',
    orthomosaic_bounds: [
      [18.5775, 73.9805],
      [18.5810, 73.9845],
    ],
    status: 'PROCESSED',
    notes: 'Centimeter-precision RTK survey completed with zero GPS degradation.',
    created_at: '2026-10-22T11:00:00Z',
  },
];

const INITIAL_MOBILE_SURVEYS: MobileFieldSurveyRecord[] = [
  {
    id: 'srv-01',
    survey_reference: 'SRV-MH-8419',
    plot_id: 'plot-01',
    surveyor_id: 'usr-worker-01',
    surveyor_name: 'Prakash Mahadev Jadhav',
    survey_date: '2026-10-22T14:15:00Z',
    latitude: 18.5795,
    longitude: 73.9823,
    gps_accuracy_meters: 3.2,
    crop_type: 'Sugarcane',
    growth_stage: 'Vegetative',
    sowing_date: '2025-11-10',
    soil_condition: 'Moist',
    irrigation_type: 'Drip',
    photos: ['https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=800&q=80'],
    field_notes: 'Uniform cane stalk density. Drip laterals clear and operational with optimal moisture.',
    sync_status: 'SYNCHRONIZED',
    synced_at: '2026-10-22T14:20:00Z',
    created_at: '2026-10-22T14:15:00Z',
  },
];

// Crop predictions are produced from real satellite series; none are seeded.
const INITIAL_CROP_PREDICTIONS: CropPredictionRecord[] = [];

// Yield scenarios are created from officer inputs; none are seeded.
const INITIAL_YIELD_FORECASTS: YieldForecastRecord[] = [];

// Disaster screenings are produced from real pre/post satellite passes; none are seeded.
const INITIAL_DISASTER_ASSESSMENTS: DisasterAssessmentRecord[] = [];

const INITIAL_MONITORING_AREAS: MonitoringArea[] = [
  {
    id: 'area-01',
    user_id: 'usr-farmer-01',
    farmer_id: 'usr-farmer-01',
    plot_id: 'plot-01',
    name: 'Wagholi Sugarcane & Tur Parcel (Survey 142/2A)',
    latitude: 18.5793,
    longitude: 73.9812,
    radius_km: 0.5,
    polygon_coordinates: [
      [18.5785, 73.9805],
      [18.5785, 73.9822],
      [18.5802, 73.9822],
      [18.5802, 73.9805],
      [18.5785, 73.9805],
    ],
    area_hectares: 1.84,
    area_acres: 4.54,
    start_date: '2026-06-01',
    end_date: '2026-10-31',
    interval_days: 15,
    preferred_crop: 'Sugarcane',
    preferred_season: 'kharif',
    status: 'ACTIVE',
    last_observation_at: '2026-10-25T11:30:00Z',
    next_scheduled_run_at: '2026-11-15T00:00:00Z',
    total_periods_count: 10,
    usable_periods_count: 8,
    warnings: ['Monsoon cloud masking applied for 2 mid-kharif intervals (July)'],
    created_at: '2026-06-01T08:00:00Z',
    updated_at: '2026-10-25T12:00:00Z',
  },
  {
    id: 'area-02',
    user_id: 'usr-farmer-02',
    farmer_id: 'usr-farmer-02',
    plot_id: 'plot-02',
    name: 'Baramati Soybean Field (Survey 89/1B)',
    latitude: 18.1519,
    longitude: 74.5772,
    radius_km: 0.6,
    polygon_coordinates: [
      [18.151, 74.576],
      [18.151, 74.5785],
      [18.153, 74.5785],
      [18.153, 74.576],
      [18.151, 74.576],
    ],
    area_hectares: 2.1,
    area_acres: 5.18,
    start_date: '2026-06-15',
    end_date: '2026-10-31',
    interval_days: 15,
    preferred_crop: 'Soybean',
    preferred_season: 'kharif',
    status: 'ACTIVE',
    last_observation_at: '2026-10-24T10:00:00Z',
    next_scheduled_run_at: '2026-11-15T00:00:00Z',
    total_periods_count: 9,
    usable_periods_count: 7,
    created_at: '2026-06-15T09:00:00Z',
    updated_at: '2026-10-24T12:00:00Z',
  },
];

const INITIAL_PERIOD_OBSERVATIONS: MonitoringPeriodObservation[] = [
  {
    id: 'obs-01-p01',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 1 (01 Jun - 15 Jun 2026)',
    period_index: 1,
    period_start: '2026-06-01',
    period_end: '2026-06-15',
    actual_acquisition_dates: ['2026-06-10'],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 1,
    scene_ids: ['S2B_43QCA_20260610_0_L2A'],
    cloud_cover_pct: 12.4,
    valid_pixel_fraction: 0.96,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: true,
    indices: {
      ndvi_mean: 0.28,
      ndvi_median: 0.27,
      ndvi_min: 0.18,
      ndvi_max: 0.36,
      ndvi_std: 0.04,
      evi_mean: 0.19,
      savi_mean: 0.21,
      ndwi_mean: -0.22,
      ndmi_mean: 0.12,
      ndre_mean: 0.15,
      gcvi_mean: 0.42,
    },
    growth_stage: 'Emergence',
    health_status: 'Optimal',
    delta_ndvi_previous: null,
    delta_ndmi_previous: null,
    delta_direction: 'FIRST_PERIOD',
    change_summary: 'Baseline sowing & germination emergence detected. Healthy initial vigor.',
    processed_at: '2026-06-11T04:20:00Z',
  },
  {
    id: 'obs-01-p02',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 2 (16 Jun - 30 Jun 2026)',
    period_index: 2,
    period_start: '2026-06-16',
    period_end: '2026-06-30',
    actual_acquisition_dates: ['2026-06-25'],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 1,
    scene_ids: ['S2A_43QCA_20260625_0_L2A'],
    cloud_cover_pct: 18.2,
    valid_pixel_fraction: 0.91,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: true,
    indices: {
      ndvi_mean: 0.39,
      ndvi_median: 0.38,
      ndvi_min: 0.25,
      ndvi_max: 0.48,
      ndvi_std: 0.05,
      evi_mean: 0.27,
      savi_mean: 0.29,
      ndwi_mean: -0.15,
      ndmi_mean: 0.24,
      ndre_mean: 0.21,
      gcvi_mean: 0.75,
    },
    growth_stage: 'Vegetative',
    health_status: 'Optimal',
    delta_ndvi_previous: 0.11,
    delta_ndmi_previous: 0.12,
    delta_direction: 'INCREASED',
    change_summary: 'NDVI +0.11 expansion. Rapid vegetative tillering and leaf area development.',
    processed_at: '2026-06-26T04:15:00Z',
  },
  {
    id: 'obs-01-p03',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 3 (01 Jul - 15 Jul 2026)',
    period_index: 3,
    period_start: '2026-07-01',
    period_end: '2026-07-15',
    actual_acquisition_dates: [],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 0,
    scene_ids: [],
    cloud_cover_pct: 98.4,
    valid_pixel_fraction: 0.02,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: false,
    missing_reason: 'Monsoon cloud outage (No observation - SCL cloud cover 98%)',
    indices: {
      ndvi_mean: 0,
      ndvi_median: 0,
      ndvi_min: 0,
      ndvi_max: 0,
      ndvi_std: 0,
      evi_mean: 0,
      savi_mean: 0,
      ndwi_mean: 0,
      ndmi_mean: 0,
      ndre_mean: 0,
      gcvi_mean: 0,
    },
    growth_stage: 'Unassessed',
    health_status: 'Cloud Obscured',
    delta_ndvi_previous: null,
    delta_ndmi_previous: null,
    delta_direction: 'NO_DATA',
    change_summary: 'Monsoon cloud outage: No clear Sentinel-2 acquisition passed SCL pixel validation.',
    processed_at: '2026-07-16T00:00:00Z',
  },
  {
    id: 'obs-01-p04',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 4 (16 Jul - 31 Jul 2026)',
    period_index: 4,
    period_start: '2026-07-16',
    period_end: '2026-07-31',
    actual_acquisition_dates: [],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 0,
    scene_ids: [],
    cloud_cover_pct: 94.2,
    valid_pixel_fraction: 0.06,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: false,
    missing_reason: 'Monsoon cloud outage (No observation - SCL cloud cover 94%)',
    indices: {
      ndvi_mean: 0,
      ndvi_median: 0,
      ndvi_min: 0,
      ndvi_max: 0,
      ndvi_std: 0,
      evi_mean: 0,
      savi_mean: 0,
      ndwi_mean: 0,
      ndmi_mean: 0,
      ndre_mean: 0,
      gcvi_mean: 0,
    },
    growth_stage: 'Unassessed',
    health_status: 'Cloud Obscured',
    delta_ndvi_previous: null,
    delta_ndmi_previous: null,
    delta_direction: 'NO_DATA',
    change_summary: 'Monsoon cloud outage: Continuous overcast over Pune Haveli taluk.',
    processed_at: '2026-08-01T00:00:00Z',
  },
  {
    id: 'obs-01-p05',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 5 (01 Aug - 15 Aug 2026)',
    period_index: 5,
    period_start: '2026-08-01',
    period_end: '2026-08-15',
    actual_acquisition_dates: ['2026-08-10'],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 1,
    scene_ids: ['S2B_43QCA_20260810_0_L2A'],
    cloud_cover_pct: 22.0,
    valid_pixel_fraction: 0.82,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: true,
    indices: {
      ndvi_mean: 0.58,
      ndvi_median: 0.59,
      ndvi_min: 0.44,
      ndvi_max: 0.69,
      ndvi_std: 0.06,
      evi_mean: 0.44,
      savi_mean: 0.46,
      ndwi_mean: 0.08,
      ndmi_mean: 0.38,
      ndre_mean: 0.34,
      gcvi_mean: 1.45,
    },
    growth_stage: 'Vegetative',
    health_status: 'Optimal',
    delta_ndvi_previous: 0.19,
    delta_ndmi_previous: 0.14,
    delta_direction: 'INCREASED',
    change_summary: 'Clear sky gap acquisition. Strong canopy growth observed since late June.',
    processed_at: '2026-08-11T05:00:00Z',
  },
  {
    id: 'obs-01-p06',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 6 (16 Aug - 31 Aug 2026)',
    period_index: 6,
    period_start: '2026-08-16',
    period_end: '2026-08-31',
    actual_acquisition_dates: ['2026-08-28'],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 1,
    scene_ids: ['S2A_43QCA_20260828_0_L2A'],
    cloud_cover_pct: 14.5,
    valid_pixel_fraction: 0.89,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: true,
    indices: {
      ndvi_mean: 0.67,
      ndvi_median: 0.68,
      ndvi_min: 0.52,
      ndvi_max: 0.78,
      ndvi_std: 0.05,
      evi_mean: 0.52,
      savi_mean: 0.54,
      ndwi_mean: 0.14,
      ndmi_mean: 0.44,
      ndre_mean: 0.39,
      gcvi_mean: 1.88,
    },
    growth_stage: 'Peak / Reproductive',
    health_status: 'Optimal',
    delta_ndvi_previous: 0.09,
    delta_ndmi_previous: 0.06,
    delta_direction: 'INCREASED',
    change_summary: 'NDVI +0.09 expansion. Reaching peak canopy biomass and dense stalk formation.',
    processed_at: '2026-08-29T05:00:00Z',
  },
  {
    id: 'obs-01-p07',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 7 (01 Sep - 15 Sep 2026)',
    period_index: 7,
    period_start: '2026-09-01',
    period_end: '2026-09-15',
    actual_acquisition_dates: ['2026-09-12'],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 1,
    scene_ids: ['S2B_43QCA_20260912_0_L2A'],
    cloud_cover_pct: 9.1,
    valid_pixel_fraction: 0.95,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: true,
    indices: {
      ndvi_mean: 0.74,
      ndvi_median: 0.75,
      ndvi_min: 0.58,
      ndvi_max: 0.84,
      ndvi_std: 0.05,
      evi_mean: 0.58,
      savi_mean: 0.59,
      ndwi_mean: 0.18,
      ndmi_mean: 0.48,
      ndre_mean: 0.43,
      gcvi_mean: 2.15,
    },
    growth_stage: 'Peak / Reproductive',
    health_status: 'Optimal',
    delta_ndvi_previous: 0.07,
    delta_ndmi_previous: 0.04,
    delta_direction: 'INCREASED',
    change_summary: 'Peak vegetative vigor achieved. Strong moisture indices (NDMI 0.48).',
    processed_at: '2026-09-13T04:30:00Z',
  },
  {
    id: 'obs-01-p08',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 8 (16 Sep - 30 Sep 2026)',
    period_index: 8,
    period_start: '2026-09-16',
    period_end: '2026-09-30',
    actual_acquisition_dates: ['2026-09-27'],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 1,
    scene_ids: ['S2A_43QCA_20260927_0_L2A'],
    cloud_cover_pct: 5.6,
    valid_pixel_fraction: 0.97,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: true,
    indices: {
      ndvi_mean: 0.72,
      ndvi_median: 0.73,
      ndvi_min: 0.56,
      ndvi_max: 0.82,
      ndvi_std: 0.05,
      evi_mean: 0.56,
      savi_mean: 0.57,
      ndwi_mean: 0.16,
      ndmi_mean: 0.44,
      ndre_mean: 0.41,
      gcvi_mean: 2.05,
    },
    growth_stage: 'Peak / Reproductive',
    health_status: 'Optimal',
    delta_ndvi_previous: -0.02,
    delta_ndmi_previous: -0.04,
    delta_direction: 'STABLE',
    change_summary: 'NDVI plateau consistent with perennial cane maturation stage.',
    processed_at: '2026-09-28T04:30:00Z',
  },
  {
    id: 'obs-01-p09',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 9 (01 Oct - 15 Oct 2026)',
    period_index: 9,
    period_start: '2026-10-01',
    period_end: '2026-10-15',
    actual_acquisition_dates: ['2026-10-10'],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 1,
    scene_ids: ['S2B_43QCA_20261010_0_L2A'],
    cloud_cover_pct: 3.2,
    valid_pixel_fraction: 0.99,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: true,
    indices: {
      ndvi_mean: 0.70,
      ndvi_median: 0.71,
      ndvi_min: 0.54,
      ndvi_max: 0.80,
      ndvi_std: 0.04,
      evi_mean: 0.54,
      savi_mean: 0.55,
      ndwi_mean: 0.14,
      ndmi_mean: 0.41,
      ndre_mean: 0.39,
      gcvi_mean: 1.95,
    },
    growth_stage: 'Maturity',
    health_status: 'Optimal',
    delta_ndvi_previous: -0.02,
    delta_ndmi_previous: -0.03,
    delta_direction: 'STABLE',
    change_summary: 'Stable canopy metrics. Post-monsoon clear atmosphere.',
    processed_at: '2026-10-11T04:30:00Z',
  },
  {
    id: 'obs-01-p10',
    monitoring_area_id: 'area-01',
    plot_id: 'plot-01',
    period_label: 'Period 10 (16 Oct - 31 Oct 2026)',
    period_index: 10,
    period_start: '2026-10-16',
    period_end: '2026-10-31',
    actual_acquisition_dates: ['2026-10-25'],
    satellite_provider: 'Copernicus Sentinel-2 L2A (AWS Open Data)',
    scenes_found: 3,
    scenes_used: 1,
    scene_ids: ['S2A_43QCA_20261025_0_L2A'],
    cloud_cover_pct: 2.1,
    valid_pixel_fraction: 0.98,
    boa_offset_applied: -1000,
    scale_factor: 10000,
    has_data: true,
    indices: {
      ndvi_mean: 0.68,
      ndvi_median: 0.69,
      ndvi_min: 0.51,
      ndvi_max: 0.79,
      ndvi_std: 0.05,
      evi_mean: 0.52,
      savi_mean: 0.53,
      ndwi_mean: 0.12,
      ndmi_mean: 0.39,
      ndre_mean: 0.37,
      gcvi_mean: 1.85,
    },
    growth_stage: 'Maturity',
    health_status: 'Optimal',
    delta_ndvi_previous: -0.02,
    delta_ndmi_previous: -0.02,
    delta_direction: 'STABLE',
    change_summary: 'Latest 15-day composite. Excellent biomass profile and healthy canopy continuity.',
    processed_at: '2026-10-25T11:30:00Z',
  },
];

const INITIAL_INSPECTION_QUEUE: MonitoringInspectionItem[] = [
  {
    id: 'insp-q-01',
    monitoring_area_id: 'area-02',
    plot_id: 'plot-02',
    farmer_name: 'Sunita Dnyaneshwar Shinde',
    district: 'Pune',
    taluk: 'Baramati',
    village: 'Supae',
    crop_type: 'Soybean',
    priority: 'HIGH',
    reasons: [
      'Cotton vs Tur spectral confusion: ML confidence 82.4% (below 90% threshold)',
      'Sharp 15-day NDVI decline (-0.17)',
    ],
    confidence_score: 82.4,
    latest_ndvi_delta: -0.17,
    latest_moisture_level: 0.18,
    status: 'PENDING_OFFICER_REVIEW',
    created_at: '2026-10-24T10:00:00Z',
  },
  {
    id: 'insp-q-02',
    monitoring_area_id: 'area-03',
    plot_id: 'plot-03',
    farmer_name: 'Vikas Sharma',
    district: 'Pune',
    taluk: 'Shirur',
    village: 'Koregaon Bhima',
    crop_type: 'Onion',
    priority: 'CRITICAL',
    reasons: [
      'Severe moisture stress: NDMI dropped to -0.14 (-0.21 delta)',
      'Vegetative canopy loss (-0.24 NDVI delta)',
      'Field survey requested for crop insurance assessment',
    ],
    confidence_score: 87.1,
    latest_ndvi_delta: -0.24,
    latest_moisture_level: -0.14,
    status: 'PENDING_OFFICER_REVIEW',
    created_at: '2026-10-23T14:30:00Z',
  },
  {
    id: 'insp-q-03',
    monitoring_area_id: 'area-04',
    farmer_name: 'Pandurang Eknath More',
    district: 'Pune',
    taluk: 'Haveli',
    village: 'Uruli Kanchan',
    crop_type: 'Tur (Pigeon Pea)',
    priority: 'MEDIUM',
    reasons: [
      'Emergence signature delayed by 21 days compared to regional phenology baseline',
    ],
    confidence_score: 84.0,
    latest_ndvi_delta: -0.05,
    latest_moisture_level: 0.22,
    status: 'INSPECTION_ASSIGNED',
    created_at: '2026-10-20T09:15:00Z',
  },
];

// -----------------------------------------------------------------------------
// Reactive Mock Database Engine
// -----------------------------------------------------------------------------
export class MockDatabase {
  private static instance: MockDatabase;

  public profiles: Profile[];
  public farmerProfiles: FarmerProfile[];
  public staffRegions: StaffRegion[];
  public properties: Property[];
  public applications: RegistrationApplication[];
  public landImages: FarmerLandImage[];
  public inspections: FieldInspection[];
  public droneImagery: DroneImagery[];
  public comparisons: ImageComparison[];
  public cropVerifications: CropVerification[];
  public reports: VerificationReport[];
  public notifications: Notification[];
  public auditLogs: AuditLog[];
  public smsMessages: SmsMessage[];
  public notificationJobs: NotificationJob[];
  public activationTokens: AccountActivationToken[];

  // Plant Intelligence & Telemetry Collections
  public crops: Crop[];
  public cropThresholds: CropHealthThreshold[];
  public monitoringUnits: MonitoringUnit[];
  public plantObservations: PlantObservation[];
  public sensorDevices: SensorDevice[];
  public sensorReadings: SensorReading[];
  public plantHealthAssessments: PlantHealthAssessment[];
  public plantHealthAlerts: PlantHealthAlert[];

  // Geospatial & Remote Sensing Collections
  public farmPlots: FarmPlot[];
  public satelliteScenes: SatelliteScene[];
  public vegetationObservations: VegetationIndexObservation[];
  public weatherObservations: WeatherObservation[];
  public droneMissions: DroneMissionRecord[];
  public mobileSurveys: MobileFieldSurveyRecord[];
  public cropPredictions: CropPredictionRecord[];
  public yieldForecasts: YieldForecastRecord[];
  public disasterAssessments: DisasterAssessmentRecord[];

  // Continuous 15-Day Satellite Monitoring Collections
  public monitoringAreas: MonitoringArea[];
  public periodObservations: MonitoringPeriodObservation[];
  public inspectionQueue: MonitoringInspectionItem[];

  // Active simulated user session
  public currentUser: Profile;

  private constructor() {
    this.profiles = getStorage('profiles', INITIAL_PROFILES);
    this.farmerProfiles = getStorage('farmerProfiles', INITIAL_FARMER_PROFILES);
    this.staffRegions = getStorage('staffRegions', INITIAL_STAFF_REGIONS);
    this.properties = getStorage('properties', INITIAL_PROPERTIES);
    this.applications = getStorage('applications', INITIAL_APPLICATIONS);
    this.landImages = getStorage('landImages', INITIAL_LAND_IMAGES);
    this.inspections = getStorage('inspections', INITIAL_INSPECTIONS);
    this.droneImagery = getStorage('droneImagery', INITIAL_DRONE_IMAGERY);
    this.comparisons = getStorage('comparisons', INITIAL_COMPARISONS);
    this.cropVerifications = getStorage('cropVerifications', INITIAL_CROP_VERIFICATIONS);
    this.reports = getStorage('reports', INITIAL_REPORTS);
    this.notifications = getStorage('notifications', INITIAL_NOTIFICATIONS);
    this.auditLogs = getStorage('auditLogs', INITIAL_AUDIT_LOGS);
    this.smsMessages = getStorage('smsMessages', INITIAL_SMS_MESSAGES);
    this.notificationJobs = getStorage('notificationJobs', []);
    this.activationTokens = getStorage('activationTokens', []);

    // Load plant intelligence collections
    this.crops = getStorage('crops', INITIAL_CROPS);
    this.cropThresholds = getStorage('cropThresholds', INITIAL_CROP_THRESHOLDS);
    this.monitoringUnits = getStorage('monitoringUnits', INITIAL_MONITORING_UNITS);
    this.sensorDevices = getStorage('sensorDevices', INITIAL_SENSOR_DEVICES);
    this.sensorReadings = getStorage('sensorReadings', INITIAL_SENSOR_READINGS);
    this.plantObservations = getStorage('plantObservations', INITIAL_PLANT_OBSERVATIONS);
    this.plantHealthAssessments = getStorage('plantHealthAssessments', INITIAL_PLANT_ASSESSMENTS);
    this.plantHealthAlerts = getStorage('plantHealthAlerts', INITIAL_PLANT_ALERTS);

    // Load geospatial & remote sensing collections
    this.farmPlots = getStorage('farmPlots', INITIAL_FARM_PLOTS);
    this.satelliteScenes = getStorage('satelliteScenes', INITIAL_SATELLITE_SCENES);
    this.vegetationObservations = getStorage('vegetationObservations', INITIAL_VEGETATION_OBSERVATIONS);
    this.weatherObservations = getStorage('weatherObservations', INITIAL_WEATHER_OBSERVATIONS);
    this.droneMissions = getStorage('droneMissions', INITIAL_DRONE_MISSIONS);
    this.mobileSurveys = getStorage('mobileSurveys', INITIAL_MOBILE_SURVEYS);
    // Drop records from the former simulated classifier (no verdict, invented confidence)
    this.cropPredictions = getStorage('cropPredictions', INITIAL_CROP_PREDICTIONS).filter(
      (p) => typeof (p as Partial<CropPredictionRecord>).verdict_status === 'string'
    );
    // Drop records from the former calibration-factor "forecast" (invented multipliers)
    this.yieldForecasts = getStorage('yieldForecasts', INITIAL_YIELD_FORECASTS).filter(
      (y) => (y as Partial<YieldForecastRecord>).estimate_kind === 'SCENARIO'
    );
    // Drop assessments from the former simulated screening (no satellite evidence recorded)
    this.disasterAssessments = getStorage('disasterAssessments', INITIAL_DISASTER_ASSESSMENTS).filter(
      (d) => typeof (d as Partial<DisasterAssessmentRecord>).method === 'string'
    );

    // Continuous 15-Day Satellite Monitoring Collections
    this.monitoringAreas = getStorage('monitoringAreas', INITIAL_MONITORING_AREAS);
    this.periodObservations = getStorage('periodObservations', INITIAL_PERIOD_OBSERVATIONS).map(
      (obs: MonitoringPeriodObservation) => ({
        ...obs,
        scientific_disclaimer:
          obs.scientific_disclaimer ||
          'These are remote-sensing vegetation monitoring classifications, not on-site plant disease diagnoses.',
        moisture_stress_indicator: obs.moisture_stress_indicator || 'ADEQUATE',
      })
    );
    this.inspectionQueue = getStorage('inspectionQueue', INITIAL_INSPECTION_QUEUE);

    const savedUserId = isLocalStorageAvailable() ? localStorage.getItem('agrisurvey_current_user_id') : null;
    const userMatch = this.profiles.find((p) => p.id === savedUserId);
    this.currentUser = userMatch || this.profiles[0]; // Defaults to Ramesh Patil (Farmer)

    // Load any remote documents from Firebase in background
    if (typeof window !== 'undefined') {
      this.loadFromFirebase().catch(() => {});
    }
  }

  public async loadFromFirebase(): Promise<void> {
    if (!firebaseService.isConfigured || typeof window === 'undefined') return;
    try {
      const remoteApps = await firebaseService.getCollection<RegistrationApplication>('registration_applications');
      if (remoteApps && remoteApps.length > 0) {
        remoteApps.forEach((rApp) => {
          const idx = this.applications.findIndex((a) => a.id === rApp.id);
          if (idx >= 0) {
            this.applications[idx] = { ...this.applications[idx], ...rApp };
          } else {
            this.applications.unshift(rApp);
          }
        });
      }
      const remoteProps = await firebaseService.getCollection<Property>('properties');
      if (remoteProps && remoteProps.length > 0) {
        remoteProps.forEach((rProp) => {
          const idx = this.properties.findIndex((p) => p.id === rProp.id);
          if (idx >= 0) {
            this.properties[idx] = { ...this.properties[idx], ...rProp };
          } else {
            this.properties.unshift(rProp);
          }
        });
      }
    } catch {
      // Non-blocking
    }
  }

  public syncToFirebase(): void {
    if (!firebaseService.isConfigured) return;
    try {
      this.applications.slice(0, 20).forEach((app) => {
        firebaseService.saveDocument('registration_applications', app.id, app);
      });
      this.properties.slice(0, 20).forEach((prop) => {
        firebaseService.saveDocument('properties', prop.id, prop);
      });
      this.profiles.slice(0, 20).forEach((prof) => {
        firebaseService.saveDocument('profiles', prof.id, prof);
      });
      this.inspections.slice(0, 20).forEach((insp) => {
        firebaseService.saveDocument('field_inspections', insp.id, insp);
      });
      this.cropVerifications.slice(0, 20).forEach((cv) => {
        firebaseService.saveDocument('crop_verifications', cv.id, cv);
      });
      this.reports.slice(0, 20).forEach((rep) => {
        firebaseService.saveDocument('verification_reports', rep.id, rep);
      });
    } catch {
      // Non-blocking
    }
  }

  public static getInstance(): MockDatabase {
    if (!MockDatabase.instance) {
      MockDatabase.instance = new MockDatabase();
    }
    return MockDatabase.instance;
  }

  public persistAll(): void {
    setStorage('profiles', this.profiles);
    setStorage('farmerProfiles', this.farmerProfiles);
    setStorage('staffRegions', this.staffRegions);
    setStorage('properties', this.properties);
    setStorage('applications', this.applications);
    setStorage('landImages', this.landImages);
    setStorage('inspections', this.inspections);
    setStorage('droneImagery', this.droneImagery);
    setStorage('comparisons', this.comparisons);
    setStorage('cropVerifications', this.cropVerifications);
    setStorage('reports', this.reports);
    setStorage('notifications', this.notifications);
    setStorage('auditLogs', this.auditLogs);
    setStorage('smsMessages', this.smsMessages);
    setStorage('notificationJobs', this.notificationJobs);
    setStorage('activationTokens', this.activationTokens);

    // Persist plant intelligence collections
    setStorage('crops', this.crops);
    setStorage('cropThresholds', this.cropThresholds);
    setStorage('monitoringUnits', this.monitoringUnits);
    setStorage('sensorDevices', this.sensorDevices);
    setStorage('sensorReadings', this.sensorReadings);
    setStorage('plantObservations', this.plantObservations);
    setStorage('plantHealthAssessments', this.plantHealthAssessments);
    setStorage('plantHealthAlerts', this.plantHealthAlerts);

    // Persist geospatial & remote sensing collections
    setStorage('farmPlots', this.farmPlots);
    setStorage('satelliteScenes', this.satelliteScenes);
    setStorage('vegetationObservations', this.vegetationObservations);
    setStorage('weatherObservations', this.weatherObservations);
    setStorage('droneMissions', this.droneMissions);
    setStorage('mobileSurveys', this.mobileSurveys);
    setStorage('cropPredictions', this.cropPredictions);
    setStorage('yieldForecasts', this.yieldForecasts);
    setStorage('disasterAssessments', this.disasterAssessments);

    // Persist Continuous 15-Day Monitoring Collections
    setStorage('monitoringAreas', this.monitoringAreas);
    setStorage('periodObservations', this.periodObservations);
    setStorage('inspectionQueue', this.inspectionQueue);

    // Sync to Firebase
    this.syncToFirebase();
  }

  // Continuous Satellite Monitoring & Periodic Phenology Methods
  public addMonitoringArea(area: MonitoringArea): void {
    this.monitoringAreas.unshift(area);
    this.persistAll();
  }

  public updateMonitoringArea(area: MonitoringArea): void {
    const idx = this.monitoringAreas.findIndex((a) => a.id === area.id);
    if (idx >= 0) {
      this.monitoringAreas[idx] = area;
      this.persistAll();
    }
  }

  public deleteMonitoringArea(id: string): void {
    this.monitoringAreas = this.monitoringAreas.filter((a) => a.id !== id);
    this.periodObservations = this.periodObservations.filter((o) => o.monitoring_area_id !== id);
    this.inspectionQueue = this.inspectionQueue.filter((q) => q.monitoring_area_id !== id);
    this.persistAll();
  }

  public getMonitoringAreaById(id: string): MonitoringArea | undefined {
    return this.monitoringAreas.find((a) => a.id === id);
  }

  public getObservationsForArea(areaId: string): MonitoringPeriodObservation[] {
    return this.periodObservations
      .filter((o) => o.monitoring_area_id === areaId)
      .sort((a, b) => a.period_index - b.period_index);
  }

  public setObservationsForArea(areaId: string, obs: MonitoringPeriodObservation[]): void {
    this.periodObservations = this.periodObservations
      .filter((o) => o.monitoring_area_id !== areaId)
      .concat(obs);
    this.persistAll();
  }

  public addPeriodObservation(obs: MonitoringPeriodObservation): void {
    this.periodObservations.push(obs);
    this.persistAll();
  }

  public getInspectionQueue(district?: string, taluk?: string): MonitoringInspectionItem[] {
    let items = [...this.inspectionQueue];
    if (district && district !== 'All') {
      items = items.filter((i) => i.district.toLowerCase() === district.toLowerCase());
    }
    if (taluk && taluk !== 'All') {
      items = items.filter((i) => i.taluk.toLowerCase() === taluk.toLowerCase());
    }
    return items;
  }

  public updateInspectionStatus(
    id: string,
    status: 'PENDING_OFFICER_REVIEW' | 'INSPECTION_ASSIGNED' | 'VERIFIED'
  ): void {
    const item = this.inspectionQueue.find((i) => i.id === id);
    if (item) {
      item.status = status;
      this.persistAll();
    }
  }

  public addInspectionItem(item: MonitoringInspectionItem): void {
    const exists = this.inspectionQueue.some((i) => i.id === item.id);
    if (!exists) {
      this.inspectionQueue.unshift(item);
      this.persistAll();
    }
  }

  public addOrUpdateInspectionItem(item: MonitoringInspectionItem): void {
    const idx = this.inspectionQueue.findIndex(
      (i) => i.id === item.id || i.monitoring_area_id === item.monitoring_area_id
    );
    if (idx >= 0) {
      this.inspectionQueue[idx] = item;
    } else {
      this.inspectionQueue.unshift(item);
    }
    this.persistAll();
  }

  public setPeriodObservationsForArea(areaId: string, obs: MonitoringPeriodObservation[]): void {
    this.setObservationsForArea(areaId, obs);
  }

  public addMonitoringUnit(unit: MonitoringUnit): void {
    this.monitoringUnits.unshift(unit);
    this.persistAll();
  }

  public updateMonitoringUnit(unit: MonitoringUnit): void {
    const idx = this.monitoringUnits.findIndex((u) => u.id === unit.id);
    if (idx >= 0) {
      this.monitoringUnits[idx] = unit;
      this.persistAll();
    }
  }

  public addSensorReading(reading: SensorReading): void {
    this.sensorReadings.unshift(reading);
    this.persistAll();
  }

  public addPlantObservation(obs: PlantObservation): void {
    this.plantObservations.unshift(obs);
    this.persistAll();
  }

  public addPlantAssessment(assessment: PlantHealthAssessment): void {
    this.plantHealthAssessments.unshift(assessment);
    const unit = this.monitoringUnits.find((u) => u.id === assessment.monitoring_unit_id);
    if (unit) {
      unit.current_health_status = assessment.overall_status;
      unit.last_assessed_at = assessment.assessment_timestamp;
    }
    this.persistAll();
  }

  public addPlantAlert(alert: PlantHealthAlert): void {
    this.plantHealthAlerts.unshift(alert);
    this.persistAll();
  }

  public updateAlertStatus(alertId: string, status: 'active' | 'acknowledged' | 'resolved', userId?: string): void {
    const alert = this.plantHealthAlerts.find((a) => a.id === alertId);
    if (alert) {
      alert.status = status;
      if (status === 'acknowledged') {
        alert.acknowledged_at = new Date().toISOString();
        alert.acknowledged_by = userId || this.currentUser.id;
      } else if (status === 'resolved') {
        alert.resolved_at = new Date().toISOString();
        alert.resolved_by = userId || this.currentUser.id;
      }
      this.persistAll();
    }
  }

  public addSmsMessage(sms: SmsMessage): void {
    this.smsMessages.unshift(sms);
    this.persistAll();
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(new CustomEvent('agrisurvey_sms_received', { detail: sms }));
      } catch (e) {
        console.warn('Could not dispatch sms event', e);
      }
    }
  }

  public findProfileByLogin(identifier: string): Profile | null {
    if (!identifier) return null;
    const cleanId = identifier.trim();
    const idLower = cleanId.toLowerCase();
    const cleanPhone = cleanId.replace(/\D/g, '');

    return (
      this.profiles.find((p) => {
        // Match email
        if (p.email && p.email.toLowerCase() === idLower) return true;
        // Match phone (raw or normalized)
        if (p.phone_number) {
          const pClean = p.phone_number.replace(/\D/g, '');
          if (pClean === cleanPhone || p.phone_number === cleanId) return true;
        }
        // Match user ID
        if (p.id === cleanId) return true;
        // Match generated username
        if (p.generated_credentials?.username === cleanId) return true;
        return false;
      }) || null
    );
  }

  public setCurrentUser(userId: string): Profile | null {
    const user = this.profiles.find((p) => p.id === userId);
    if (user) {
      this.currentUser = user;
      if (isLocalStorageAvailable()) {
        localStorage.setItem('agrisurvey_current_user_id', user.id);
      }
      return user;
    }
    return null;
  }

  public setCurrentUserByRole(role: UserRole): Profile {
    const user = this.profiles.find((p) => p.role === role) || this.profiles[0];
    this.currentUser = user;
    if (isLocalStorageAvailable()) {
      localStorage.setItem('agrisurvey_current_user_id', user.id);
    }
    return user;
  }

  public addAuditLog(action: string, entityType: string, entityId: string, prev: any, next: any) {
    const log: AuditLog = {
      id: `aud-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      actor_user_id: this.currentUser.id,
      actor_name: `${this.currentUser.full_name} (${this.currentUser.role.toUpperCase()})`,
      action,
      entity_type: entityType,
      entity_id: entityId,
      previous_state: prev,
      new_state: next,
      created_at: new Date().toISOString(),
    };
    this.auditLogs.unshift(log);
    this.persistAll();
    return log;
  }

  public resetToFactory(): void {
    localStorage.clear();
    this.profiles = INITIAL_PROFILES;
    this.farmerProfiles = INITIAL_FARMER_PROFILES;
    this.staffRegions = INITIAL_STAFF_REGIONS;
    this.properties = INITIAL_PROPERTIES;
    this.applications = INITIAL_APPLICATIONS;
    this.landImages = INITIAL_LAND_IMAGES;
    this.inspections = INITIAL_INSPECTIONS;
    this.droneImagery = INITIAL_DRONE_IMAGERY;
    this.comparisons = INITIAL_COMPARISONS;
    this.cropVerifications = INITIAL_CROP_VERIFICATIONS;
    this.reports = INITIAL_REPORTS;
    this.notifications = INITIAL_NOTIFICATIONS;
    this.auditLogs = INITIAL_AUDIT_LOGS;
    this.smsMessages = INITIAL_SMS_MESSAGES;
    this.notificationJobs = [];
    this.activationTokens = [];

    // Reset plant intelligence collections
    this.crops = INITIAL_CROPS;
    this.cropThresholds = INITIAL_CROP_THRESHOLDS;
    this.monitoringUnits = INITIAL_MONITORING_UNITS;
    this.sensorDevices = INITIAL_SENSOR_DEVICES;
    this.sensorReadings = INITIAL_SENSOR_READINGS;
    this.plantObservations = INITIAL_PLANT_OBSERVATIONS;
    this.plantHealthAssessments = INITIAL_PLANT_ASSESSMENTS;
    this.plantHealthAlerts = INITIAL_PLANT_ALERTS;

    // Reset continuous satellite monitoring
    this.monitoringAreas = INITIAL_MONITORING_AREAS;
    this.periodObservations = INITIAL_PERIOD_OBSERVATIONS;
    this.inspectionQueue = INITIAL_INSPECTION_QUEUE;

    this.currentUser = INITIAL_PROFILES[0];
    this.persistAll();
  }
}

export const mockDb = MockDatabase.getInstance();
