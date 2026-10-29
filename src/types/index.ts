// AgriSurvey Type Definitions

export type UserRole = 'farmer' | 'tahsildar' | 'field_worker' | 'admin';

export type AccountStatus = 'active' | 'pending_approval' | 'pending_activation' | 'suspended' | 'deactivated';

export type RegistrationStatus =
  | 'DRAFT'
  | 'SUBMITTED'
  | 'PENDING_VERIFICATION'
  | 'PENDING_TAHSILDAR_REVIEW'
  | 'UNDER_REVIEW'
  | 'ADDITIONAL_INFORMATION_REQUIRED'
  | 'RESUBMITTED'
  | 'APPROVED'
  | 'REJECTED';

export type InspectionStatus =
  | 'NOT_STARTED'
  | 'ASSIGNED'
  | 'SCHEDULED'
  | 'IN_PROGRESS'
  | 'EVIDENCE_UPLOADED'
  | 'SUBMITTED_FOR_REVIEW'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'REINSPECTION_REQUIRED';

export type FinalVerificationStatus =
  | 'PENDING_REVIEW'
  | 'VERIFIED'
  | 'REJECTED'
  | 'ADDITIONAL_EVIDENCE_REQUIRED'
  | 'REINSPECTION_REQUIRED';

export type ComparisonResultType =
  | 'CONSISTENT'
  | 'INCONSISTENT'
  | 'INSUFFICIENT_EVIDENCE'
  | 'REQUIRES_REINSPECTION';

export type CropVerificationResultType =
  | 'MATCHES'
  | 'PARTIALLY_MATCHES'
  | 'DOES_NOT_MATCH'
  | 'UNABLE_TO_DETERMINE';

export type NotificationChannel = 'in_app' | 'sms' | 'both';

export type DeliveryStatusType =
  | 'pending'
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'provider_unavailable';

export type LandAreaUnit = 'Acres' | 'Hectares' | 'Cents';

export type LandType =
  | 'Agricultural Land'
  | 'Irrigated Land'
  | 'Rain-Fed Land'
  | 'Mixed Agricultural Land'
  | 'Other';

export type FarmType =
  | 'Crop Farming'
  | 'Horticulture'
  | 'Plantation'
  | 'Mixed Farming'
  | 'Other';

export type OwnershipCategory =
  | 'Individual Ownership'
  | 'Joint Ownership'
  | 'Leasehold'
  | 'Other';

export interface Profile {
  id: string;
  full_name: string;
  email: string | null;
  phone_number: string | null;
  role: UserRole;
  account_status: AccountStatus;
  preferred_language: string;
  username?: string;
  password?: string;
  generated_credentials?: {
    username: string;
    password: string;
    dispatched_at: string;
  };
  activation_token?: string;
  activation_expires_at?: string;
  created_at: string;
  updated_at: string;
}

export interface SmsMessage {
  id: string;
  recipient_phone: string;
  recipient_name: string;
  message: string;
  credentials?: {
    username: string;
    password: string;
  };
  sent_at: string;
  status: 'delivered' | 'sent';
}

export interface FarmerProfile {
  id: string;
  user_id: string;
  address: string;
  village: string;
  taluk: string;
  district: string;
  state: string;
  postal_code: string;
  identity_verification_status: string;
  identity_verification_reference?: string;
  created_at: string;
  updated_at: string;
}

export interface Property {
  id: string;
  farmer_id: string;
  property_reference: string;
  property_name: string | null;
  survey_number: string;
  subdivision_number: string | null;
  land_document_reference: string;
  land_area: number;
  land_area_unit: LandAreaUnit;
  land_type: LandType;
  farm_type: FarmType;
  ownership_category: OwnershipCategory;
  village: string;
  taluk: string;
  district: string;
  state: string;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  updated_at: string;
}

export interface RegistrationApplication {
  id: string;
  application_reference: string;
  farmer_id: string;
  property_id: string;
  status: RegistrationStatus;
  assigned_tahsildar_id: string | null;
  submitted_at: string;
  reviewed_at: string | null;
  rejection_reason: string | null;
  additional_information_request: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields for UI convenience
  property?: Property;
  farmer?: Profile;
  assigned_tahsildar?: Profile;
}

export interface LandDocument {
  id: string;
  property_id: string;
  uploaded_by: string;
  document_type: string;
  storage_path: string;
  original_filename: string;
  mime_type: string;
  file_size: number;
  review_status: string;
  uploaded_at: string;
}

export interface FarmerLandImage {
  id: string;
  property_id: string;
  application_id: string;
  uploaded_by: string;
  storage_path: string;
  original_filename: string;
  capture_timestamp: string | null;
  latitude: number | null;
  longitude: number | null;
  metadata_status: string;
  uploaded_at: string;
}

export interface FieldInspection {
  id: string;
  property_id: string;
  application_id: string;
  assigned_worker_id: string | null;
  assigned_tahsildar_id: string | null;
  inspection_status: InspectionStatus;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  field_notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  property?: Property;
  application?: RegistrationApplication;
  assigned_worker?: Profile;
}

export interface DroneImagery {
  id: string;
  inspection_id: string;
  property_id: string;
  application_id: string;
  uploaded_by: string;
  storage_path: string;
  original_filename: string;
  capture_timestamp: string | null;
  latitude: number | null;
  longitude: number | null;
  mission_reference: string | null;
  metadata_status: string;
  processing_status: string;
  uploaded_at: string;
}

export interface ImageComparison {
  id: string;
  application_id: string;
  property_id: string;
  comparison_result: ComparisonResultType;
  similarity_score: number | null;
  similarity_model_version: string | null;
  review_notes: string | null;
  reviewed_by: string;
  reviewed_at: string;
  created_at: string;
}

export interface ComparisonImage {
  id: string;
  comparison_id: string;
  image_type: 'farmer' | 'drone';
  image_id: string;
  created_at: string;
}

export interface CropVerification {
  id: string;
  property_id: string;
  application_id: string;
  declared_crop_type: string;
  observed_crop_type: string;
  crop_category: string;
  cultivation_season: string;
  approximate_cultivated_area: number | null;
  irrigation_method: string | null;
  verification_result: CropVerificationResultType;
  ai_prediction: string | null;
  ai_confidence: number | null;
  ai_model_version: string | null;
  reviewer_notes: string | null;
  verified_by: string;
  verified_at: string;
  created_at: string;
}

export interface VerificationReport {
  id: string;
  report_reference: string;
  property_id: string;
  application_id: string;
  reviewed_by: string;
  final_status: FinalVerificationStatus;
  findings: Record<string, any>;
  discrepancies: string | null;
  supporting_evidence: Array<{ type: string; title: string; reference: string; date?: string }>;
  report_storage_path: string | null;
  created_at: string;
  // Joined
  property?: Property;
  application?: RegistrationApplication;
  reviewer?: Profile;
}

export interface Notification {
  id: string;
  recipient_user_id: string;
  notification_type: string;
  title: string;
  message: string;
  related_application_id: string | null;
  channel: NotificationChannel;
  delivery_status: DeliveryStatusType;
  read_at: string | null;
  created_at: string;
}

export type NotificationJobStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'SENT'
  | 'DELIVERED'
  | 'FAILED'
  | 'PROVIDER_UNAVAILABLE';

export interface AccountActivationToken {
  id: string;
  user_id: string;
  application_id: string;
  token: string;
  username: string;
  expires_at: string;
  used_at: string | null;
  created_at: string;
}

export interface NotificationJob {
  id: string;
  notification_id: string;
  application_id?: string | null;
  provider: string; // 'MSG91' | 'SIMULATED'
  recipient_phone?: string;
  template_id?: string;
  idempotency_key?: string;
  delivery_status: DeliveryStatusType | NotificationJobStatus;
  status?: NotificationJobStatus;
  body?: string;
  attempt_count: number;
  last_attempt_at: string | null;
  delivered_at: string | null;
  provider_message_reference: string | null;
  error_code: string | null;
  error_details?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  actor_user_id: string | null;
  actor_name?: string;
  action: string;
  entity_type: string;
  entity_id: string;
  previous_state: Record<string, any> | null;
  new_state: Record<string, any> | null;
  created_at: string;
}

export interface StaffRegion {
  id: string;
  staff_user_id: string;
  state: string;
  district: string;
  taluk: string;
  village: string | null;
  created_at: string;
}

// =============================================================================
// Plant Intelligence & Health Analysis System Types
// =============================================================================

export type PlantHealthStatus =
  | 'Healthy'
  | 'Needs Attention'
  | 'At Risk'
  | 'Critical'
  | 'Insufficient Data';

export type MonitoringUnitType =
  | 'individual_plant'
  | 'plant_group'
  | 'plot'
  | 'crop_zone';

export type SensorParameter =
  | 'soil_moisture'
  | 'soil_temperature'
  | 'ambient_temperature'
  | 'relative_humidity'
  | 'soil_ph'
  | 'soil_ec'
  | 'light_intensity'
  | 'leaf_wetness'
  | 'rainfall'
  | 'water_level';

export interface Crop {
  id: string;
  name: string;
  scientific_name?: string;
  category: 'Cereal' | 'Cash Crop' | 'Horticulture' | 'Pulse' | 'Oilseed' | 'Vegetable' | 'Other';
  default_season: 'Kharif' | 'Rabi' | 'Zaid' | 'Perennial';
  description?: string;
}

export interface CropHealthThreshold {
  id: string;
  crop_name: string;
  parameter: SensorParameter;
  min_optimal: number;
  max_optimal: number;
  min_tolerable: number;
  max_tolerable: number;
  unit: string;
  description?: string;
}

export interface MonitoringUnit {
  id: string;
  property_id: string;
  unit_name: string;
  unit_type: MonitoringUnitType;
  crop_id?: string;
  crop_variety: string;
  planting_date?: string;
  zone_identifier: string;
  latitude?: number | null;
  longitude?: number | null;
  area_covered?: number;
  area_unit?: string;
  current_health_status: PlantHealthStatus;
  last_assessed_at?: string | null;
  created_at: string;
  updated_at: string;
  // Joined / computed fields
  property?: Property;
  crop?: Crop;
  latest_assessment?: PlantHealthAssessment;
  active_alerts_count?: number;
}

export interface PlantPhoto {
  id?: string;
  url: string;
  category: 'leaf' | 'stem' | 'fruit' | 'pest_disease' | 'overview';
  caption?: string;
  uploaded_at?: string;
}

export interface AIPrediction {
  condition: string;
  confidence: number; // 0 - 100 percentage
  potential_diseases: Array<{ name: string; probability: number }>;
  nutrient_deficiencies: Array<{ nutrient: string; likelihood: 'Low' | 'Moderate' | 'High' }>;
  pest_damage_detected: boolean;
  symptoms_detected: string[];
  disclaimer: string;
}

export interface PlantObservation {
  id: string;
  monitoring_unit_id: string;
  property_id: string;
  recorded_by: string;
  recorded_by_name?: string;
  observation_type: 'image' | 'manual' | 'sensor' | 'field_inspection';
  collection_method: string;
  data_source: 'farmer_mobile' | 'field_worker_tablet' | 'iot_gateway' | 'agronomist';
  timestamp: string;
  photographs?: PlantPhoto[];
  // Method C manual field observations:
  growth_stage?: 'Germination' | 'Vegetative' | 'Flowering' | 'Fruiting' | 'Maturity' | 'Harvesting';
  irrigation_condition?: 'Optimal' | 'Over-irrigated' | 'Moisture Deficit' | 'Severe Drought';
  wilting_observed?: boolean;
  leaf_discoloration?: 'None' | 'Chlorosis (Yellowing)' | 'Necrosis (Browning)' | 'Purpling' | 'Mottled';
  pest_observed?: boolean;
  pest_details?: string;
  visible_disease_symptoms?: string;
  general_notes?: string;
  // Method A AI prediction result:
  ai_prediction?: AIPrediction;
  created_at: string;
}

export interface SensorDevice {
  id: string;
  property_id: string;
  monitoring_unit_id?: string;
  device_serial: string;
  device_name: string;
  device_type: string;
  model_number?: string;
  status: 'active' | 'offline' | 'calibrating' | 'disconnected';
  last_heartbeat?: string;
  battery_level?: number;
  created_at: string;
}

export interface SensorReading {
  id: string;
  device_id?: string;
  property_id: string;
  monitoring_unit_id: string;
  parameter: SensorParameter;
  value: number;
  unit: string;
  recorded_at: string;
  source_device: string;
  data_quality: 'validated' | 'suspect' | 'raw';
  created_at: string;
}

export interface PlantHealthAssessment {
  id: string;
  monitoring_unit_id: string;
  property_id: string;
  overall_status: PlantHealthStatus;
  assessment_timestamp: string;
  supporting_measurements: {
    soil_moisture?: { value: number; unit: string; status: 'optimal' | 'low' | 'high' | 'critical' };
    soil_ph?: { value: number; unit: string; status: 'optimal' | 'acidic' | 'alkaline' };
    soil_temperature?: { value: number; unit: string; status: 'optimal' | 'warning' };
    ambient_temperature?: { value: number; unit: string; status: 'optimal' | 'warning' };
    relative_humidity?: { value: number; unit: string; status: 'optimal' | 'warning' };
    soil_ec?: { value: number; unit: string; status: 'optimal' | 'saline' };
    leaf_wetness?: { value: number; unit: string; status: 'optimal' | 'high_risk' };
  };
  detected_anomalies: string[];
  possible_concerns: string[];
  suggested_next_steps: string[];
  data_freshness: string;
  confidence: number | null;
  assessment_method: string;
  model_version: string;
  is_preliminary: boolean;
  created_at: string;
}

export interface PlantHealthAlert {
  id: string;
  monitoring_unit_id: string;
  property_id: string;
  crop_name: string;
  unit_name?: string;
  property_name?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  reason: string;
  supporting_measurement: string;
  recommended_action: string;
  status: 'active' | 'acknowledged' | 'resolved';
  detected_at: string;
  acknowledged_at?: string;
  acknowledged_by?: string;
  resolved_at?: string;
  resolved_by?: string;
}

// =============================================================================
// Geospatial Farm Plot & Remote Sensing Types
// =============================================================================

export interface FarmPlot {
  id: string; // Stable unique plot UUID
  plot_reference: string; // e.g. MH-PUN-PLOT-2026-00412
  property_id: string;
  farmer_id: string;
  survey_number: string;
  subdivision_number: string | null;
  plot_name: string;
  boundary_coordinates: [number, number][]; // [lat, lon][]
  boundary_geojson?: any;
  area_sqm: number;
  area_hectares: number;
  area_acres: number;
  perimeter_meters: number;
  village: string;
  taluk: string;
  district: string;
  state: string;
  is_cadastral_verified: boolean;
  crop_type?: string;
  sowing_date?: string;
  created_at: string;
  updated_at: string;
  // Joined fields for display
  farmer_name?: string;
  farmer_phone?: string;
  latest_ndvi?: number;
  latest_weather?: string;
  verification_status?: string;
}

export interface SatelliteSceneAsset {
  href: string;
  title?: string;
  type?: string;
  roles?: string[];
  gsd?: number;
  /** raster:bands scale/offset converting DN to surface reflectance */
  scale?: number;
  offset?: number;
}

export interface SatelliteScene {
  id: string;
  scene_id: string;
  collection: string;
  acquisition_datetime: string;
  cloud_cover_percentage: number;
  footprint_coordinates: [number, number][]; // [lat, lon][]
  thumbnail_url?: string;
  visual_url?: string;
  assets: {
    red?: SatelliteSceneAsset;
    green?: SatelliteSceneAsset;
    blue?: SatelliteSceneAsset;
    nir?: SatelliteSceneAsset;
    swir16?: SatelliteSceneAsset;
    swir22?: SatelliteSceneAsset;
    scl?: SatelliteSceneAsset;
    thumbnail?: SatelliteSceneAsset;
    visual?: SatelliteSceneAsset;
  };
  intersects_plot?: boolean;
  /** Projection of the band rasters (e.g. 32643 for UTM 43N) */
  proj_epsg?: number;
  /** Sentinel-2 processing baseline, e.g. "05.10" */
  processing_baseline?: string;
  /** Whether the -1000 DN BOA offset was already removed from the COGs */
  boa_offset_applied?: boolean;
  /** MGRS tile, e.g. "43QDV" */
  mgrs_tile?: string;
  created_at: string;
}

export interface VegetationIndexObservation {
  id: string;
  plot_id: string;
  scene_id: string;
  scene_acquisition_date: string;
  calculation_date: string;
  ndvi_mean: number;
  ndvi_min: number;
  ndvi_max: number;
  valid_pixel_coverage_pct: number;
  vegetation_classification:
    | 'Very High Density'
    | 'Moderate Density'
    | 'Sparse / Stressed'
    | 'Bare Soil / Tilled'
    | 'Non-Vegetated / Water';
  raster_bounds: [[number, number], [number, number]]; // Leaflet LatLngBoundsExpression
  raster_data_url?: string; // Georeferenced false-color overlay
  processing_method: string;
  processing_status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  error_message?: string;
  created_at: string;
}

export interface DailyWeatherItem {
  date: string;
  temp_max_celsius: number;
  temp_min_celsius: number;
  precipitation_mm: number;
  rain_probability?: number;
}

export interface WeatherObservation {
  id: string;
  plot_id: string;
  latitude: number;
  longitude: number;
  elevation_meters?: number;
  observation_timestamp: string;
  temperature_celsius: number;
  relative_humidity_pct: number;
  precipitation_mm: number;
  wind_speed_kmh: number;
  weather_condition: string;
  weather_code: number;
  daily_forecast: DailyWeatherItem[];
  provider: string; // 'Open-Meteo'
  quality_status: 'LIVE' | 'CACHED' | 'UNAVAILABLE';
  fetched_at: string;
}

export interface GeotaggedPhoto {
  id: string;
  url: string;
  filename: string;
  latitude: number;
  longitude: number;
  altitude_meters?: number;
  captured_at: string;
}

export interface DroneMissionRecord {
  id: string;
  mission_reference: string;
  plot_id: string;
  title: string;
  pilot_name: string;
  flight_date: string;
  flight_altitude_meters: number;
  camera_sensor: string;
  photos_count: number;
  geotagged_photos: GeotaggedPhoto[];
  orthomosaic_url?: string;
  orthomosaic_bounds?: [[number, number], [number, number]];
  status: 'SCHEDULED' | 'IN_FLIGHT' | 'PROCESSED' | 'FAILED';
  notes?: string;
  created_at: string;
}

export interface MobileFieldSurveyRecord {
  id: string;
  survey_reference: string;
  plot_id: string;
  surveyor_id: string;
  surveyor_name: string;
  survey_date: string;
  latitude: number;
  longitude: number;
  gps_accuracy_meters: number;
  crop_type: string;
  growth_stage: 'Germination' | 'Vegetative' | 'Flowering' | 'Fruiting' | 'Maturity' | 'Harvesting';
  sowing_date?: string;
  soil_condition: 'Dry' | 'Moist' | 'Waterlogged' | 'Cracked';
  irrigation_type: 'Canal' | 'Borewell / Tube' | 'Drip' | 'Sprinkler' | 'Rainfed';
  photos: string[];
  field_notes?: string;
  sync_status: 'DRAFT' | 'PENDING_SYNC' | 'SYNCHRONIZING' | 'SYNCHRONIZED' | 'FAILED';
  synced_at?: string;
  created_at: string;
}

export interface CropPredictionRecord {
  id: string;
  plot_id: string;
  predicted_crop: string;
  confidence_score: number; // 0-100
  class_probabilities: Record<string, number>;
  model_version: string;
  features_analyzed: {
    ndvi_mean: number;
    ndwi: number;
    b02_blue: number;
    b03_green: number;
    b04_red: number;
    b08_nir: number;
    season: string;
  };
  verified_crop?: string;
  verification_status: 'AI_PREDICTION' | 'CONFIRMED' | 'DISCREPANCY_MARKED';
  reviewer_id?: string;
  reviewer_name?: string;
  reviewer_notes?: string;
  reviewed_at?: string;
  created_at: string;
}

export interface YieldForecastRecord {
  id: string;
  plot_id: string;
  crop_type: string;
  cultivated_area_hectares: number;
  estimated_yield_tonnes_per_ha: number;
  estimated_total_tonnes: number;
  historical_baseline_tonnes_per_ha: number;
  deviation_percentage: number;
  water_source_factor: number;
  rainfall_anomaly_factor: number;
  ndvi_canopy_factor: number;
  uncertainty_range_tonnes: { min: number; max: number };
  model_type: 'Historical Baseline + Environmental Calibration' | 'ML Regression';
  data_sources: string[];
  forecast_date: string;
}

export interface DisasterAssessmentRecord {
  id: string;
  event_reference: string;
  event_name: string;
  event_type: 'HEAVY_RAINFALL_FLOOD' | 'DROUGHT_STRESS' | 'HAILSTORM_DAMAGE' | 'PEST_DETERIORATION';
  plot_id: string;
  pre_event_date: string;
  post_event_date: string;
  pre_event_ndvi: number;
  post_event_ndvi: number;
  ndvi_change_delta: number; // post - pre
  affected_area_sqm: number;
  affected_area_hectares: number;
  affected_area_acres: number;
  affected_percentage: number;
  damage_severity: 'NEGLIGIBLE' | 'MODERATE' | 'SEVERE' | 'CRITICAL';
  inspection_priority: 'ROUTINE' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  verification_status: 'PRELIMINARY_AI_OBSERVATION' | 'FIELD_VERIFIED' | 'COMPENSATION_APPROVED';
  surveyor_notes?: string;
  assessed_at: string;
}

export type MonitoringStatus =
  | 'ACTIVE'
  | 'PROCESSING'
  | 'WAITING_NEXT_PERIOD'
  | 'OBSERVATION_AVAILABLE'
  | 'INSUFFICIENT_IMAGERY'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED';

export interface MonitoringArea {
  id: string;
  user_id: string;
  farmer_id: string;
  plot_id?: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_km: number;
  polygon_coordinates?: [number, number][];
  area_hectares: number;
  area_acres: number;
  start_date: string;
  end_date: string;
  interval_days: number;
  preferred_crop?: string;
  preferred_season?: 'kharif' | 'rabi' | 'summer' | 'annual';
  status: MonitoringStatus;
  last_observation_at?: string;
  next_scheduled_run_at?: string;
  total_periods_count: number;
  usable_periods_count: number;
  warnings?: string[];
  created_at: string;
  updated_at: string;
}

export interface MonitoringPeriodObservation {
  id: string;
  monitoring_area_id: string;
  plot_id?: string;
  period_label: string;
  period_index: number;
  period_start: string;
  period_end: string;
  actual_acquisition_dates: string[];
  satellite_provider: string;
  scenes_found: number;
  scenes_used: number;
  scene_ids: string[];
  cloud_cover_pct: number;
  valid_pixel_fraction: number;
  boa_offset_applied: number;
  scale_factor: number;
  has_data: boolean;
  missing_reason?: string;
  indices: {
    ndvi_mean: number;
    ndvi_median: number;
    ndvi_min: number;
    ndvi_max: number;
    ndvi_std: number;
    evi_mean: number;
    savi_mean: number;
    ndwi_mean: number;
    ndmi_mean: number;
    ndre_mean: number;
    gcvi_mean: number;
  };
  growth_stage:
    | 'Emergence'
    | 'Vegetative'
    | 'Peak / Reproductive'
    | 'Maturity'
    | 'Harvested / Senesced'
    | 'Fallow'
    | 'Unassessed';
  health_status: 'Optimal' | 'Mild Stress' | 'High Stress' | 'Cloud Obscured' | 'Insufficient Data';
  delta_ndvi_previous: number | null;
  delta_ndmi_previous: number | null;
  delta_direction: 'INCREASED' | 'DECREASED' | 'STABLE' | 'FIRST_PERIOD' | 'NO_DATA';
  change_summary: string;
  crop_prediction?: {
    crop_name: string;
    confidence: number;
    ranking: Array<{ crop: string; fit: number }>;
    needs_field_check: boolean;
    model_version: string;
  };
  image_urls?: {
    rgb?: string;
    ndvi_map?: string;
    nir_false_color?: string;
  };
  processed_at: string;
}

export interface MonitoringInspectionItem {
  id: string;
  monitoring_area_id: string;
  plot_id?: string;
  farmer_name: string;
  district: string;
  taluk: string;
  village: string;
  crop_type: string;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'ROUTINE';
  reasons: string[];
  confidence_score: number;
  latest_ndvi_delta: number;
  latest_moisture_level: number;
  status: 'PENDING_OFFICER_REVIEW' | 'INSPECTION_ASSIGNED' | 'VERIFIED';
  created_at: string;
}
