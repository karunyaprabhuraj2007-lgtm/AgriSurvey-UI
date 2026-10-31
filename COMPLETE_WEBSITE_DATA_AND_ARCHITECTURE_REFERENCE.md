# AgriSurvey AI — Complete Website Data & Technical Architecture Reference
**Platform:** AgriSurvey AI (PuneAgriMain) — Maharashtra Geospatial Crop Survey, Land Verification & Agricultural Intelligence Platform  
**Document Version:** 3.0.0 (Comprehensive Master Reference)  
**Release Status:** Production-Ready Release Candidate (RC-1)  
**Latest Update Date:** October 31, 2026  
**Target Geography:** State of Maharashtra, India (Pune District: Haveli, Baramati, Shirur, Daund)  
**GitHub Repository:** `https://github.com/karunyaprabhuraj2007-lgtm/AgriSurvey-UI` (Branch: `KARUNYA-PRABHURAJ-E`)  
**Firebase Project:** `agri-survey-4f115` (`agri-survey-4f115.firebaseapp.com`)  

---

## 1. Executive Summary & Core Mission

AgriSurvey AI is an integrated agricultural land registration, administration, photogrammetry verification, and remote sensing intelligence platform engineered for the land revenue and agricultural ecosystem of Maharashtra.

The platform bridges official land revenue records (7/12 extracts, Gat/Survey numbers under the Maharashtra Land Revenue Code, 1966) with modern Earth Observation (EO) and field intelligence:
1. **ESA Copernicus Sentinel-2 L2A Satellite Telemetry** (10m Bottom-of-Atmosphere optical imagery via AWS Earth Search STAC API).
2. **Esri World Imagery Wayback** providing dated sub-metre high-resolution satellite basemaps with capture dates and positional accuracy.
3. **Drone Photogrammetry & Orthomosaics** supporting direct GeoTIFF file ingestion with in-browser reprojection up to zoom level 23.
4. **Real EXIF/XMP Ingestion** extracting camera model, capture timestamps, latitude/longitude, altitude, and RTK lock flags from farmer and drone photos.
5. **Green-Minds ML / Phenology Template Matcher** (Python `GM-ML-V2` package + TypeScript runtime `crop-phenology.ts`) classifying crops across 12 Maharashtra crop categories with honest abstention on cloud-obscured dates.
6. **Statutory 4-Tier Role-Based Access Control** strictly enforcing separation between Farmers, Tahsildars (Revenue Officers), Field Workers (Drone Pilots), and Administrators.
7. **Dual-Persistence Engine** with full cloud support (PostgreSQL 15 + PostGIS + Firebase Firestore/Storage) and a zero-dependency local durable engine (`mock-db.ts` + IndexedDB `media-store.ts`) for instant offline demonstration.

---

## 2. Complete Technology Stack

| Layer | Technologies & Libraries | Version / Specs |
|---|---|---|
| **Core Framework** | React 19, TypeScript 6, Vite 8 | `react@^19.2.8`, `typescript@~6.0.2`, `vite@^8.3.0` |
| **Styling & Design System** | Tailwind CSS 4, Lucide Icons, Framer Motion | `@tailwindcss/vite@^4.3.3`, `lucide-react@^1.57.0`, `framer-motion@^14.2.0` |
| **GIS & Mapping** | Leaflet, React-Leaflet, Turf.js, GeoTIFF.js | `leaflet@^1.9.4`, `react-leaflet@^5.0.0`, `geotiff@^2.1.3` |
| **Metadata & Media** | Exifr, IndexedDB, HTML5 Canvas | `exifr@^7.1.3`, Custom `media-store.ts` |
| **Data Visualization** | Recharts | `recharts@^3.10.1` |
| **Forms & Validation** | React Hook Form, Zod, Hookform Resolvers | `react-hook-form@^7.90.0`, `zod@^4.6.7`, `@hookform/resolvers@^5.9.1` |
| **Report Generation** | jsPDF, jsPDF-AutoTable | `jspdf@^4.2.1`, `jspdf-autotable@^5.0.8` |
| **Cloud Services** | Firebase (Auth, Firestore, Storage), Supabase JS | `firebase@^11.x`, `@supabase/supabase-js@^2.117.3` |
| **Routing** | React Router DOM | `react-router-dom@^7.18.4` |
| **Python ML Engine** | LightGBM, Scikit-Learn, Rasterio, NumPy, Pandas, FastAPI | Located in `GM-ML-V2/` |

---

## 3. Complete Directory Structure

```
PuneAgriMain/
├── .env                                # Local environment configuration (Firebase, Supabase, MSG91)
├── .env.example                        # Example environment template
├── .gitignore                          # Clean gitignore excluding node_modules, .venv, *.mp4
├── index.html                          # HTML5 Entry Point with Inter font & Leaflet CSS
├── package.json                        # NPM package manifests & test scripts
├── tsconfig.json                       # TypeScript compiler configurations
├── vite.config.ts                      # Vite build configuration with @ path alias & proxy
├── dist/                               # Production build output
├── public/                             # Public static assets & video backgrounds
│
├── GM-ML-V2/                           # Specialized Machine Learning Engine (Python)
│   ├── MODEL_CARD.md                   # ML architecture documentation & benchmarks
│   ├── README.md                       # GM-ML-V2 operational guide
│   ├── START_HERE.txt                  # Quickstart execution notes
│   ├── STRUCTURE.md                    # Module relationship diagram
│   ├── requirements.txt                # Python dependencies (lightgbm, rasterio, scikit-learn)
│   ├── verify_real_data.py             # Script verifying real Sentinel-2 data against models
│   ├── data/
│   │   └── akola_sites.csv             # Ground truth agricultural sites (Maharashtra)
│   ├── src/cropsurvey/
│   │   ├── __init__.py                 # Package root
│   │   ├── config.py                   # 12 Crop classes, bounding boxes, indices config
│   │   ├── pipeline.py                 # End-to-end data processing pipeline
│   │   ├── composite.py                # 15-day maximum NDVI compositing
│   │   ├── growth.py                   # Phenology growth curve extractors
│   │   ├── periodic.py                 # Multi-temporal period evaluator
│   │   ├── windows.py                  # Cadastral windowing and coordinate slicing
│   │   ├── analyze.py                  # Agronomic analytical routines
│   │   ├── cli.py                      # Command line interface
│   │   ├── models/                     # Classifier, deep temporal, sequences, calibration
│   │   ├── preprocess/                 # Indices (NDVI, EVI, NDWI, NDMI, NDRE), timeseries
│   │   ├── sources/                    # Earth Search STAC, Bhoonidhi, drone, raster
│   │   ├── labels/                     # Field surveys & weak supervision
│   │   ├── estimate/                   # Area estimation & deduplication
│   │   ├── gis/                        # Webmap tile servers & export
│   │   └── webapp/                     # Standalone FastAPI periodic monitoring server
│   └── tests/
│       └── offline_fixture.py          # Synthetic test datasets
│
├── scripts/                            # Automated Verification Test Suites
│   ├── run-acceptance-tests.ts         # 12 Functional Acceptance Tests (100% Pass)
│   ├── test-farmer-workflow.ts         # Registration -> Review -> SMS -> Activation E2E Test
│   ├── test-geospatial-suite.ts        # 10 Geodesic, STAC, NDVI, Weather, Drone Tests
│   ├── test-gis-e2e.ts                 # Tests A through I (E2E GIS Crop Survey Suite)
│   └── test-ml-models.ts               # Offline Green-Minds ML model verification suite
│
├── src/
│   ├── main.tsx                        # React application bootstrap
│   ├── App.tsx                         # Master routing engine (29 routes + RBAC guards)
│   ├── App.css / index.css             # Tailwind CSS 4 theme rules & custom gradients
│   │
│   ├── types/                          # TypeScript Interface Specifications
│   │   ├── index.ts                    # Core system domain models (Profiles, Plots, Surveys)
│   │   └── language.ts                 # 10 Indic languages definitions
│   │
│   ├── lib/                            # Foundation Utilities & Helpers
│   │   ├── constants.ts                # Pune taluks, standard crop lists, UI constants
│   │   ├── permissions.ts              # RBAC role guards (canAccessRoleRoute, ROLE_DEFAULT_ROUTES)
│   │   ├── geospatial.ts               # Turf.js WGS84 geodesic ellipsoidal calculations
│   │   ├── validators.ts               # Zod schemas for multi-step registration & forms
│   │   ├── translations.ts             # Multilingual dictionary (10 languages)
│   │   ├── dashboard-localizer.ts      # Role-specific & crop-specific localizer
│   │   ├── firebase.ts                 # Firebase App, Auth, Firestore, Storage client
│   │   ├── supabase.ts                 # Supabase PostGIS client initialization
│   │   ├── crop-phenology.ts           # Green-Minds TS template matcher for 12 crops
│   │   ├── photo-metadata.ts           # Exifr EXIF/XMP reader (GPS, camera, capture date)
│   │   ├── media-store.ts              # Client-side IndexedDB original image store
│   │   ├── orthomosaic.ts              # GeoTIFF reader & canvas reprojector
│   │   ├── sentinel-cog.ts             # Cloud-Optimized GeoTIFF radiometric extraction
│   │   ├── wayback.ts                  # Esri World Imagery Wayback metadata & tile provider
│   │   └── evidence.ts                 # Supporting evidence compiler
│   │
│   ├── context/
│   │   └── LanguageContext.tsx         # Multilingual Context Provider (default: Marathi 'mr')
│   │
│   ├── components/                     # Reusable UI Components
│   │   ├── layout/
│   │   │   ├── Navbar.tsx              # Top sticky navigation with logo & Firebase live indicator
│   │   │   ├── Footer.tsx              # Portal footer with statutory disclaimers
│   │   │   └── DashboardLayout.tsx     # Role-specific dashboard sidebar & notification drawer
│   │   ├── ui/
│   │   │   ├── Button.tsx              # Standard accessible button variants
│   │   │   ├── Card.tsx                # Glassmorphic and standard card containers
│   │   │   ├── Badge.tsx               # Status badges with color-coding
│   │   │   ├── Modal.tsx               # Dialog overlay with focus lock
│   │   │   └── LanguageSwitcher.tsx    # 10-language quick selector
│   │   ├── maps/
│   │   │   ├── AgriculturalGISMap.tsx  # Interactive Leaflet GIS map with Turf drawing tools
│   │   │   ├── PropertyMap.tsx         # Cadastral parcel viewer
│   │   │   └── AgriculturalJurisdictionMap.tsx # Taluk/District administrative boundary map
│   │   ├── satellite/
│   │   │   ├── ContinuousMonitoringTimeline.tsx # 15-Day satellite observation gallery & curves
│   │   │   ├── HighResFieldMap.tsx     # Sub-metre Esri Wayback & Drone orthomosaic viewer
│   │   │   ├── LatestSentinelPanel.tsx # Newest clear Sentinel-2 pass inspector
│   │   │   ├── InspectionQueueTable.tsx# Priority inspection queue sorted by severity
│   │   │   ├── TahsildarSatelliteCoordinateModal.tsx # Full coordinate & radius inspector
│   │   │   ├── SatelliteSearchModal.tsx# STAC scene discovery modal
│   │   │   └── SceneClipImage.tsx      # Satellite scene clip thumbnail
│   │   ├── intelligence/
│   │   │   └── CropIntelligenceModal.tsx # AI crop prediction, yield scenario & disaster tool
│   │   ├── media/
│   │   │   └── EvidenceImage.tsx       # Geotagged photo viewer with camera metadata
│   │   ├── weather/
│   │   │   └── PlotWeatherDrawer.tsx   # Open-Meteo live agrometeorological drawer
│   │   ├── field-survey/
│   │   │   └── MobileFieldSurveyModal.tsx # Geotagged field survey recording tool
│   │   ├── plant-intelligence/
│   │   │   ├── CreateMonitoringUnitModal.tsx # Farm unit creator
│   │   │   ├── PlantObservationModal.tsx     # Observation recorder
│   │   │   └── PlantUnitDetailModal.tsx      # Health detail modal
│   │   └── auth/
│   │       └── ProtectedRoute.tsx      # Role-based route guard
│   │
│   ├── services/                       # Business Logic & Data Access Layer
│   │   ├── auth.service.ts             # Auth, role switching, Firebase/Supabase user sync
│   │   ├── registration.service.ts     # 4-step registration, 7/12 handling, Tahsildar review
│   │   ├── plot.service.ts             # Farm plot creation, geodesic WGS84 area calculation
│   │   ├── drone.service.ts            # Ground & aerial photo uploads, EXIF extraction
│   │   ├── inspection.service.ts       # Field drone inspection assignment & lifecycle
│   │   ├── crop-verification.service.ts# Crop matching, image comparison, AI predictions
│   │   ├── crop-classification.service.ts # Green-Minds phenology template inference
│   │   ├── satellite-monitoring.service.ts# Continuous 15-day satellite monitoring
│   │   ├── field-surveillance.service.ts  # Wayback high-res & drone orthomosaic service
│   │   ├── stac.service.ts             # Earth Search STAC Sentinel-2 scene discovery
│   │   ├── ndvi.service.ts             # Raster math (B08/B04), SCL cloud masking
│   │   ├── weather.service.ts          # Open-Meteo meteorological parameters
│   │   ├── disaster-assessment.service.ts # Pre- vs Post-event pixel change detection
│   │   ├── yield-forecasting.service.ts   # Scenario production estimation (t/ha × ha)
│   │   ├── report.service.ts           # 10 Statutory PDF/CSV agricultural reports
│   │   ├── notification.service.ts     # In-app alerts & notification job tracker
│   │   ├── msg91.service.ts            # MSG91 Flow API SMS gateway integration
│   │   ├── firebase.service.ts         # Firestore CRUD, Storage upload, Auth bridge
│   │   ├── plant-intelligence.service.ts  # Plant unit tracking
│   │   ├── plant-health.service.ts     # Crop thresholds & health telemetry
│   │   ├── mobile-survey.service.ts    # Offline field survey queue & sync
│   │   ├── analytics.service.ts        # District/Taluka statistical aggregations
│   │   └── mock-db.ts                  # Local durable persistent database engine
│   │
│   └── pages/                          # Application Route Views
│       ├── LandingPage.tsx             # Public landing page with features & FAQ
│       ├── AuthPage.tsx                # Sign In, Sign Up wizard & 1-click Demo Personas
│       ├── auth/
│       │   └── AccountActivationPage.tsx # 48-hour SMS activation token claim & password set
│       ├── farmer/
│       │   ├── FarmerDashboardPage.tsx      # Farmer summary, active plots & timeline
│       │   ├── FarmerRegistrationPage.tsx   # 4-step land registration wizard
│       │   ├── FarmerApplicationStatusPage.tsx # Public 2-factor application tracker
│       │   ├── FarmerPropertiesPage.tsx     # Registered parcels & PDF dossier export
│       │   ├── LandImageUploadPage.tsx      # Enforced 5-6 ground photo upload with GPS
│       │   ├── FarmerInspectionStatusPage.tsx # Drone flight scheduling & status
│       │   ├── FarmerReportsPage.tsx        # Official verification certificates
│       │   └── FarmerNotificationsPage.tsx  # In-app notification center
│       ├── tahsildar/
│       │   ├── TahsildarOverviewPage.tsx    # Officer statistics, quick review & GIS map
│       │   ├── TahsildarDashboardPage.tsx   # Legacy tabs & monitoring view
│       │   ├── TahsildarRegistrationsPage.tsx # Queue of pending 7/12 applications
│       │   ├── TahsildarAssignInspectionsPage.tsx # Drone pilot mission assignment
│       │   ├── ImageComparisonWorkspacePage.tsx # Dual-pane ground vs drone workspace
│       │   ├── CropVerificationPage.tsx     # Declared vs observed crop verification
│       │   ├── FinalVerificationReportsPage.tsx # Certified PDF compile & release
│       │   ├── FieldSurveillancePage.tsx    # Sub-metre Wayback & drone GeoTIFF map
│       │   └── TahsildarAuditLogsPage.tsx   # Immutable audit trail of administrative actions
│       ├── field-worker/
│       │   └── FieldWorkerDashboardPage.tsx # Mobile field inspection & drone survey portal
│       ├── admin/
│       │   └── AdminDashboardPage.tsx       # State oversight, acreage charts, system settings
│       └── gis/
│           ├── GisCropSurveyPage.tsx        # Statewide interactive crop survey GIS map
│           └── GisReportsPage.tsx           # 10 Statutory Agricultural Reports Hub
│
└── supabase/
    └── migrations/                     # PostgreSQL 15 + PostGIS Cloud Migrations
        ├── 20261014000001_initial_schema.sql
        ├── 20261014000002_rls_and_storage.sql
        ├── 20261014000003_seed_data.sql
        ├── 20261014000004_plant_intelligence_and_verification.sql
        └── 20261014000005_msg91_and_auth_workflow.sql
```

---

## 4. Complete Application Routes & Permissions Matrix

Every route is protected by `ProtectedRoute.tsx` with role-based access control (RBAC):

| Route Path | View Component | Allowed Roles | Description |
|---|---|---|---|
| `/` | `LandingPage` | Public (All) | Hero, public features, workflow explainer, FAQ |
| `/auth/login` | `AuthPage` | Public (All) | User login with 1-click Demo Persona auto-fill |
| `/auth/register` | `AuthPage` | Public (All) | Citizen registration & land signup wizard |
| `/auth/activate` | `AccountActivationPage` | Public (All) | 48h single-use token activation & password establishment |
| `/farmer/application-status` | `FarmerApplicationStatusPage` | Public / Farmer | 2-factor lookup (Application Reference + Phone) |
| `/gis/crop-survey` | `GisCropSurveyPage` | All Roles | Interactive statewide GIS plot viewer, NDVI & STAC |
| `/gis/reports` | `GisReportsPage` | All Roles | Downloadable 10 statutory agricultural reports (PDF/CSV) |
| `/farmer/dashboard` | `FarmerDashboardPage` | `farmer` | Farmer overview, active parcels, 15-day satellite monitor |
| `/farmer/register` | `FarmerRegistrationPage` | `farmer` | 4-step land registration (Personal, Identity, Land, 7/12) |
| `/farmer/properties` | `FarmerPropertiesPage` | `farmer` | My land parcels, survey numbers, master PDF export |
| `/farmer/upload-images` | `LandImageUploadPage` | `farmer` | Mandatory 5–6 ground photos with EXIF GPS metadata |
| `/farmer/inspection-status`| `FarmerInspectionStatusPage` | `farmer` | Drone inspection tracking, pilot details & flight status |
| `/farmer/reports` | `FarmerReportsPage` | `farmer` | Official certified verification reports with digital seal |
| `/farmer/notifications` | `FarmerNotificationsPage` | `farmer` | Farmer's alert center & SMS dispatch logs |
| `/tahsildar/dashboard` | `TahsildarOverviewPage` | `tahsildar` | Officer dashboard, jurisdiction statistics & quick actions |
| `/tahsildar/registrations` | `TahsildarRegistrationsPage` | `tahsildar` | Review queue (Approve, Reject with reason, Request Info) |
| `/tahsildar/assign-inspections`| `TahsildarAssignInspectionsPage` | `tahsildar`| Dispatch drone pilots and field workers to parcels |
| `/tahsildar/image-comparison`| `ImageComparisonWorkspacePage` | `tahsildar` | Dual-pane ground vs aerial photos with distance check |
| `/tahsildar/crop-verification`| `CropVerificationPage` | `tahsildar` | Official crop matching (Declared vs Observed vs ML) |
| `/tahsildar/reports` | `FinalVerificationReportsPage` | `tahsildar` | Compile, digitally seal, and issue official PDF certificates |
| `/tahsildar/field-surveillance`| `FieldSurveillancePage` | `tahsildar` | Sub-metre Wayback satellite maps & drone GeoTIFF overlay |
| `/tahsildar/audit-logs` | `TahsildarAuditLogsPage` | `tahsildar` | Immutable revenue log tracking all administrative actions |
| `/field-worker/dashboard` | `FieldWorkerDashboardPage` | `field_worker`| Pilot dashboard, assigned missions, village queue |
| `/field-worker/inspections`| `FieldWorkerDashboardPage` | `field_worker`| Scheduled drone missions with flight parameter checklist |
| `/field-worker/drone-upload`| `FieldWorkerDashboardPage` | `field_worker`| Real EXIF drone photo ingestion & orthomosaic link |
| `/field-worker/completed` | `FieldWorkerDashboardPage` | `field_worker`| Historical completed surveys and sync archive |
| `/admin/dashboard` | `AdminDashboardPage` | `admin` | State director overview, divisional velocity charts |
| `/admin/users` | `AdminDashboardPage` | `admin` | Staff accounts, user role management & activation status |
| `/admin/regions` | `AdminDashboardPage` | `admin` | District & Taluk staff jurisdiction assignments |
| `/admin/analytics` | `AdminDashboardPage` | `admin` | Crop acreage aggregations, surveyor throughput |
| `/admin/audit-logs` | `AdminDashboardPage` | `admin` | System-wide immutable administrative audit ledger |
| `/admin/settings` | `AdminDashboardPage` | `admin` | Gateway API credentials, satellite thresholds, storage |

---

## 5. Database Architecture & Collections

### A. Dual-Engine Persistence Model
1. **Cloud Mode:** PostgreSQL 15+ with PostGIS spatial extensions in `supabase/migrations/` + Firebase Firestore & Cloud Storage.
2. **Local Simulation Mode:** Synchronous durable store in `mock-db.ts` utilizing browser `localStorage` + IndexedDB `media-store.ts` for full-resolution imagery. Allows 100% offline functionality without external cloud dependencies.

### B. Core Data Schemas (32 Collections)

| # | Collection / Table | Primary Key | Key Attributes | Purpose |
|---|---|---|---|---|
| 1 | `profiles` | `id` (`usr-*`) | `full_name`, `email`, `phone_number`, `role`, `account_status`, `preferred_language` | Master user accounts |
| 2 | `farmer_profiles` | `id` (`fp-*`) | `user_id`, `address`, `village`, `taluk`, `district`, `identity_doc_ref` | Masked identity & address details |
| 3 | `properties` | `id` (`prop-*`) | `farmer_id`, `survey_number`, `land_area`, `land_area_unit`, `latitude`, `longitude` | Land revenue parcels (7/12) |
| 4 | `registration_applications` | `id` (`app-*`) | `application_reference`, `farmer_id`, `property_id`, `status`, `assigned_tahsildar_id` | Application review lifecycle |
| 5 | `land_documents` | `id` (`doc-*`) | `property_id`, `document_type`, `storage_path`, `is_verified` | Uploaded 7/12 extracts & deeds |
| 6 | `farmer_land_images` | `id` (`fli-*`) | `property_id`, `storage_path`, `latitude`, `longitude`, `metadata_status`, `original_filename` | Enforced 5–6 ground photographs |
| 7 | `field_inspections` | `id` (`insp-*`) | `property_id`, `assigned_worker_id`, `inspection_status`, `scheduled_at`, `field_notes` | Drone inspection missions |
| 8 | `drone_imagery` | `id` (`drn-*`) | `inspection_id`, `storage_path`, `latitude`, `longitude`, `mission_reference`, `exif_altitude` | Aerial drone photogrammetry |
| 9 | `image_comparisons` | `id` (`cmp-*`) | `application_id`, `comparison_result`, `similarity_score`, `review_notes` | Tahsildar comparison records |
| 10 | `crop_verifications` | `id` (`cv-*`) | `declared_crop_type`, `observed_crop_type`, `cultivation_season`, `verification_result` | Statutory crop confirmations |
| 11 | `verification_reports` | `id` (`rep-*`) | `report_reference`, `final_status`, `discrepancies`, `findings`, `digital_seal` | Certified legal verification dossiers |
| 12 | `notifications` | `id` (`notif-*`)| `recipient_user_id`, `title`, `message`, `channel`, `read_at`, `delivery_status` | In-app alerts & SMS logs |
| 13 | `notification_jobs` | `id` (`job-*`) | `notification_id`, `provider`, `delivery_status`, `provider_message_reference` | MSG91 DLT tracking jobs |
| 14 | `audit_logs` | `id` (`aud-*`) | `actor_user_id`, `action`, `entity_type`, `previous_state`, `new_state` | Immutable tamper-proof ledger |
| 15 | `staff_regions` | `id` (`sr-*`) | `staff_user_id`, `district`, `taluk` | Geographic jurisdiction bounds |
| 16 | `activation_tokens` | `id` (`act-*`) | `user_id`, `token`, `expires_at`, `used_at` | 48h single-use SMS activation tokens |
| 17 | `farm_plots` | `id` (`plot-*`) | `plot_reference`, `boundary_coordinates`, `area_sqm`, `area_hectares`, `area_acres` | High-precision GIS cadastral bounds |
| 18 | `satellite_scenes` | `id` (`sc-*`) | `scene_id`, `collection`, `cloud_cover_percentage`, `footprint_coordinates`, `assets` | Sentinel-2 L2A catalog items |
| 19 | `vegetation_observations`| `id` (`veg-*`) | `plot_id`, `scene_id`, `ndvi_mean`, `ndvi_min`, `ndvi_max`, `valid_pixel_coverage_pct` | Genuine spectral calculations |
| 20 | `weather_observations` | `id` (`wth-*`) | `plot_id`, `temperature_c`, `humidity_pct`, `precipitation_mm`, `forecast_7d` | Open-Meteo live observations |
| 21 | `drone_missions` | `id` (`dm-*`) | `mission_reference`, `flight_altitude_m`, `overlap_forward_pct`, `orthomosaic_url` | Mission flight telemetry |
| 22 | `mobile_surveys` | `id` (`ms-*`) | `plot_id`, `gps_latitude`, `gps_longitude`, `gps_accuracy_meters`, `growth_stage` | Geotagged ground survey records |
| 23 | `crop_predictions` | `id` (`cp-*`) | `plot_id`, `predicted_crop`, `verdict_status`, `candidate_crops`, `template_fits` | Green-Minds ML phenology records |
| 24 | `yield_forecasts` | `id` (`yf-*`) | `plot_id`, `expected_yield_tonnes_per_ha`, `harvested_area_hectares`, `estimated_total_tonnes` | Production scenarios |
| 25 | `disaster_assessments` | `id` (`da-*`) | `plot_id`, `event_type`, `pre_event_scene_id`, `post_event_scene_id`, `affected_area_acres` | Pixel-level damage assessments |
| 26 | `monitoring_areas` | `id` (`area-*`) | `name`, `latitude`, `longitude`, `radius_km`, `preferred_crop`, `preferred_season` | Continuous 15-day satellite AOIs |
| 27 | `period_observations` | `id` (`pobs-*`)| `monitoring_area_id`, `period_start`, `period_end`, `ndvi_mean`, `is_cloud_outage` | 15-Day chronological observations |
| 28 | `inspection_queue` | `id` (`iq-*`) | `monitoring_area_id`, `priority`, `flag_reason`, `ndvi_anomaly_delta`, `status` | Anomaly inspection alerts |
| 29 | `crops` | `id` (`crop-*`) | `name`, `scientific_name`, `category`, `default_season`, `description` | Agronomic crop taxonomy |
| 30 | `crop_thresholds` | `id` (`ct-*`) | `crop_id`, `min_ndvi_healthy`, `moisture_stress_threshold`, `optimal_temperature_range` | Phenology baseline thresholds |
| 31 | `monitoring_units` | `id` (`unit-*`) | `property_id`, `unit_name`, `crop_variety`, `current_health_status`, `area_covered` | Sub-plot monitoring units |
| 32 | `plant_observations` | `id` (`pobs-*`)| `unit_id`, `observation_date`, `canopy_condition`, `water_stress_observed` | Periodic agronomic field audits |

---

## 6. Deep Technical Breakdown of Core Modules

### 1. Farmer Registration & Onboarding Pipeline
- **4-Step Wizard (`FarmerRegistrationPage.tsx`):**
  1. *Personal Details:* Full name, mobile number, Marathi preferred UI.
  2. *Identity & Privacy:* Masked identity document references (Voter ID, PAN). Full Aadhaar is never stored or transmitted in plaintext.
  3. *Property Details:* Survey Number, Gat Number, Village, Taluk, District, declared acreage.
  4. *Document Upload:* 7/12 extract uploaded to private storage.
- **Automated Workflow:**
  - Assigns unique application tracking ID (`AGRI-APP-2026-XXXXXX`).
  - Routes automatically to the responsible Taluk Tahsildar based on `staff_regions`.
  - Dispatches SMS acknowledgment via MSG91.
  - On Tahsildar approval, issues a single-use 48-hour secure token (`AccountActivationPage.tsx`) allowing the farmer to establish a secure password.

### 2. Real Field & Drone Photogrammetry Ingestion
- **EXIF/XMP Parsing (`photo-metadata.ts`):**
  - Uses `exifr` to extract genuine hardware metadata: Camera Make/Model, Date/Time Original, GPS Coordinates, GPS Altitude, and DJI RTK lock metadata.
  - Leaves missing metadata unpopulated rather than fabricating false coordinates.
- **Client-Side Media Store (`media-store.ts`):**
  - Keeps original high-resolution photos in IndexedDB for immediate rendering without network latency.
  - Uploads in the background to Firebase Storage (`agri-survey-4f115.firebasestorage.app`).
- **Enforced 5–6 Ground Photographs (`LandImageUploadPage.tsx`):**
  - Validates that photos represent distinct designated viewpoints: North Boundary Stone, Crop Row Canopy, Irrigation Infrastructure, East Marker, Pump Shed, Landscape View.

### 3. Tahsildar Decision & Review Portal
- **Jurisdiction Queuing:** Officers only see applications within their appointed Taluk (e.g., Haveli, Baramati).
- **3-Way Action Engine:**
  - `APPROVE`: Provisions username (`MH-PUN-HAV-XXXXX`), generates activation token, triggers SMS via MSG91.
  - `REJECT`: Requires statutory justification; permanently recorded in audit logs.
  - `REQUEST_INFO`: Asks farmer for supplementary records.
- **Drone Mission Assignment (`TahsildarAssignInspectionsPage.tsx`):**
  - Dispatches certified drone pilots to approved parcels.

### 4. Side-by-Side Image Comparison Workspace (`ImageComparisonWorkspacePage.tsx`)
- Displays real uploaded ground photos alongside aerial drone imagery.
- Automatically calculates the geographic distance in metres between camera GPS tags.
- Interactive checklist covering Boundary Stone Alignment, Declared Crop Concordance, Irrigation Verification.
- Includes recent clear Sentinel-2 satellite pass for the parcel.

### 5. High-Resolution Field Surveillance (`FieldSurveillancePage.tsx`)
- **Esri World Imagery Wayback (`wayback.ts`):**
  - Queries Esri's Wayback metadata service for exact tile capture dates, image provider, resolution, and accuracy.
  - Includes release selector allowing comparison across dated historical captures.
- **In-Browser GeoTIFF Drone Orthomosaic Overlay (`orthomosaic.ts`):**
  - Uploads genuine GeoTIFFs (EPSG:4326, EPSG:3857, or WGS84 UTM zones 43N/44N).
  - Reprojects and rasterizes tiles onto the Leaflet canvas with zoom support up to level 23.

### 6. ESA Copernicus Sentinel-2 L2A STAC & Spectral Raster Engine
- **AWS Earth Search STAC API v1 (`stac.service.ts`):**
  - Endpoint: `https://earth-search.aws.element84.com/v1`
  - Queries collection `sentinel-2-l2a` for BOA (Bottom-of-Atmosphere) reflectance over parcel bounds.
- **7 Spectral Indices Math (`ndvi.service.ts`):**
  - **NDVI:** `(B08 - B04) / (B08 + B04)` — Biomass & canopy vigor.
  - **EVI:** `2.5 * (B08 - B04) / (B08 + 6*B04 - 7.5*B02 + 1)` — High-biomass saturation compensation.
  - **SAVI:** `((B08 - B04) / (B08 + B04 + 0.5)) * 1.5` — Bare soil attenuation.
  - **NDWI:** `(B03 - B08) / (B03 + B08)` — Surface water & ponding.
  - **NDMI:** `(B08 - B11) / (B08 + B11)` — Canopy moisture stress.
  - **NDRE:** `(B08 - B05) / (B08 + B05)` — Chlorophyll activity & nitrogen.
  - **GCVI:** `(B08 / B03) - 1` — Leaf greenness index.
- **Scene Classification Layer (SCL):**
  - Cloud, shadow, and water masking. Transparently flags monsoon overcast periods as *"Monsoon Cloud Outage"* rather than hallucinating vegetation figures.

### 7. Green-Minds ML / Phenology Template Matcher
- **Python ML Package (`GM-ML-V2/`):**
  - 158-feature phenological vector extraction (`build_features`).
  - LightGBM crop classifier with Isotonic probability calibration across 12 crop classes (ECE: 0.0046).
- **TypeScript Runtime (`crop-phenology.ts`):**
  - Matches multi-temporal Sentinel-2 NDVI time series against Maharashtra agronomic crop templates.
  - Dynamic shift search (±15 days) accommodating variable sowing dates.
  - Savitzky–Golay smoothing and linear gap-filling for missing observations.
  - **Honest Abstention:** If clear passes < 6, if the start of season is unobserved, or if spectral curves match multiple crops (e.g. Cotton vs Tur), the system abstains with `ambiguous` or `insufficient_observations` and routes the parcel to the Tahsildar inspection queue.

### 8. Agrometeorology (`weather.service.ts`)
- Queries Open-Meteo coordinate API (`https://api.open-meteo.com/v1/forecast`) for plot centroids.
- Delivers real-time Temperature, Relative Humidity, Precipitation, Wind Speed, and 7-day daily agricultural forecasts.

### 9. Disaster Screening & Pixel Change Detection (`disaster-assessment.service.ts`)
- Pixel-by-pixel differential math comparing pre-event and post-event clear Sentinel-2 passes.
- Computes affected area in square metres, hectares, and acres, median NDVI delta, and percentage of parcel damaged.

### 10. Multi-Format Statutory Report Suite (`report.service.ts`)
- Generates 10 official agricultural registers in PDF (client-side via `jsPDF` + `jspdf-autotable`) and CSV formats:
  1. District Crop Sowing Summary
  2. Taluka Crop Acreage Report
  3. Village-wise Land Verification Register
  4. Discrepancy & Anomaly Audit Register
  5. Flood & Drought Damage Assessment Dossier
  6. Drone Photogrammetry Mission Log
  7. Satellite Vegetation Index (NDVI) Time-Series Report
  8. Field Survey Ground Verification Register
  9. Crop Yield Scenario & Estimation Sheet
  10. Complete Land Parcel Master Verification Dossier
- Includes official digital seal, officer signature block, and statutory disclaimer under the Maharashtra Land Revenue Code, 1966.

### 11. Communication & SMS Gateway (`msg91.service.ts`)
- Integrates with MSG91 Flow API using DLT-registered templates (`AGRSRV`).
- Dispatches approval credentials, activation links, and status updates.
- Transparent fallback in development mode with complete transaction logging in `notification_jobs`.

### 12. Multilingual Localization Engine (`translations.ts`, `LanguageContext.tsx`)
- Full UI localization across **10 Indic languages**:
  - `mr`: मराठी (Marathi — Default Platform Language)
  - `en`: English
  - `hi`: हिन्दी (Hindi)
  - `ta`: தமிழ் (Tamil)
  - `te`: తెలుగు (Telugu)
  - `kn`: ಕನ್ನಡ (Kannada)
  - `gu`: ગુજરાતી (Gujarati)
  - `bn`: বাংলা (Bengali)
  - `pa`: ਪੰਜਾਬੀ (Punjabi)
  - `ml`: മലയാളം (Malayalam)

---

## 7. Demo Personas & Credentials

For streamlined testing and demonstration, use the 1-click **Demo Personas** buttons on `/auth/login` or log in with these pre-configured credentials:

| Role | Persona Name | Jurisdiction | Login Identifier / Email | Default Password |
|---|---|---|---|---|
| **Farmer** | Ramesh Balasaheb Patil | Wagholi, Haveli Taluk | `farmer.ramesh@agrisurvey.gov.in` (or phone `9822012345`) | `FarmerPass123!` |
| **Farmer (Rabi)** | Sunita Dnyaneshwar Shinde | Supae, Baramati Taluk | `sunita.shinde@agrisurvey.gov.in` (or phone `9850123456`) | `FarmerPass123!` |
| **Tahsildar** | Anand Shrikant Kulkarni | Haveli & Baramati Taluks | `tahsildar.haveli@agrisurvey.gov.in` (or phone `9423987654`) | `TahsildarPass123!` |
| **Field Worker** | Prakash Mahadev Jadhav | Haveli Drone Missions | `drone.prakash@agrisurvey.gov.in` (or phone `9765432109`) | `WorkerPass123!` |
| **Administrator** | Dr. Meenakshi Sundaram, IAS | State Revenue Division | `admin.director@agrisurvey.gov.in` (or phone `9823000001`) | `AdminPass123!` |

*(In development mode, `AgriPass123!` or `TestPass123!` also acts as a master override password).*

---

## 8. Verification & Test Suite Execution

The repository includes 5 automated test runners validating all platform capabilities:

```bash
# 1. Run Complete Automated Test Suite (All 5 suites)
npm test

# Or run individual verification suites:
npx tsx scripts/test-ml-models.ts          # Validates Green-Minds ML matcher, abstentions & disaster logic
npx tsx scripts/run-acceptance-tests.ts   # Validates all 12 functional acceptance requirements
npx tsx scripts/test-geospatial-suite.ts  # Validates WGS84 geodesic math, STAC API, NDVI, Weather, Drone
npx tsx scripts/test-farmer-workflow.ts    # Validates signup, Tahsildar approval, SMS, and activation
npx tsx scripts/test-gis-e2e.ts           # Validates Tests A through I (E2E GIS Crop Survey Suite)

# 2. Production Typecheck & Build
npm run build
```

---

## 9. Environment Variables Configuration (`.env`)

```env
# Frontend Safe Configuration (VITE_ prefixed)
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=

# Firebase Cloud Integration
VITE_FIREBASE_API_KEY=AIzaSyCWjPl8exc3L6KIs9dRGabIrLjITedCCDA
VITE_FIREBASE_AUTH_DOMAIN=agri-survey-4f115.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=agri-survey-4f115
VITE_FIREBASE_STORAGE_BUCKET=agri-survey-4f115.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=264249361176
VITE_FIREBASE_APP_ID=1:264249361176:web:318c0fbe015289a53e146d

# MSG91 SMS Notification Configuration
VITE_MSG91_AUTH_KEY=
VITE_MSG91_SENDER_ID=AGRSRV
VITE_MSG91_APPROVAL_TEMPLATE_ID=
VITE_APP_LOGIN_URL=http://localhost:5173/auth/login

# Backend Edge Functions / Server Environment
MSG91_AUTH_KEY=
MSG91_SENDER_ID=AGRSRV
MSG91_APPROVAL_TEMPLATE_ID=
APP_LOGIN_URL=http://localhost:5173/auth/login
```

---

## 10. Blueprint for "Next Level" Platform Expansion

Use this blueprint when upgrading and expanding the platform:

```
                                  AGRISURVEY AI — NEXT-LEVEL ROADMAP
                                  
   Current Foundation (V3.0)                       Next-Level Upgrades (V4.0)
 ┌───────────────────────────────┐               ┌─────────────────────────────────────────┐
 │ • React 19 + Vite 8 + Leaflet │               │ • WebGL/MapLibre 3D Terrain Rendering   │
 │ • Sentinel-2 L2A 10m STAC     │  ──────────►  │ • PlanetScope 3m Daily Constellation    │
 │ • Esri Wayback Sub-metre      │               │ • SAR Sentinel-1 All-Weather Radar      │
 │ • In-Browser GeoTIFF Overlays │               │ • Mahabhulekh / e-Pik Pahani Live APIs  │
 │ • Green-Minds ML Matcher      │               │ • Native Offline PWA with BackgroundSync│
 │ • Dual-Engine Persistence     │               │ • IoT Soil Moisture LoRaWAN Ingestion   │
 └───────────────────────────────┘               └─────────────────────────────────────────┘
```

1. **State Cadastral System Integration (Mahabhulekh & e-Pik Pahani):**
   - Direct REST/SOAP API integration with Maharashtra's Bhulekh servers for automated 7/12 land title, mutation, and ownership verification.
2. **Sentinel-1 SAR (Synthetic Aperture Radar) Ingestion:**
   - Add C-band dual-polarization (VV/VH) radar backscatter processing to achieve 100% cloud penetration during peak monsoon overcast (July–August).
3. **MapLibre GL / WebGL 3D Terrain Rendering:**
   - Elevate 2D Leaflet maps into 3D terrain representations using Copernicus 30m DEM elevation tiles.
4. **Offline Mobile PWA (Progressive Web App):**
   - Service worker caching for complete offline operation on low-cost smartphones used by village Talathis and drone operators in rural hinterlands.
5. **IoT LoRaWAN Sensor Network Integration:**
   - Direct telemetry feeds for in-situ soil moisture, canopy temperature, and automated drip valve control.

