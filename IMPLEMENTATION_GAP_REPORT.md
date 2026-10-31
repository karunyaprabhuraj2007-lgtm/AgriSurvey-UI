# AGRISURVEY AI — IMPLEMENTATION GAP REPORT
**Maharashtra Geospatial Crop Survey Platform (V3.0.0 → V4.0.0)**  
**Platform Architecture & Software Quality Assurance**  
**Repository:** PuneAgriMain | **Branch:** `KARUNYA-PRABHURAJ-E`  
**Date:** October 31, 2026  

---

## 1. Overview

This report provides a concrete, file-by-file blueprint of all functional and technical gaps identified during the comprehensive system audit. Every gap specifies the target source files, missing functionality, exact code changes required, database schema extensions, external API boundaries, and test criteria for verification.

---

## 2. Module-by-Module Technical Gaps & Required Actions

### Gap 1: Advanced Crop Area Estimation & 4-Way Accounting (Module A)
- **Existing Files:**
  - `src/services/plot.service.ts`
  - `src/lib/geospatial.ts`
  - `src/services/analytics.service.ts`
- **Missing Functionality:**
  - Multi-level spatial aggregation (District → Taluka → Village → Plot).
  - Explicit 4-way area accounting:
    1. `farmer_declared_area_ha`
    2. `ml_predicted_area_ha`
    3. `field_observed_area_ha`
    4. `tahsildar_verified_area_ha`
  - Overlap deduplication: Calculating net non-overlapping polygon area using bounding boxes and vertex intersection checks.
  - Dedicated categorization for fallow, mixed crops, and unclassified land.
- **Required Changes:**
  - Add `calculateAcreageAggregation(level, key)` to `PlotService`.
  - Add `computeNetNonOverlappingArea(coordinatesList)` to `src/lib/geospatial.ts`.
  - Add dynamic CSV and GeoJSON export for all aggregated area tables.
- **Database Modifications:**
  - In `FarmPlot` interface (`src/types/index.ts`), ensure fields exist for `farmer_declared_area_ha`, `field_observed_area_ha`, and `verified_area_ha`.
- **Test Cases:**
  - Verify that two overlapping 10-ha plots do not aggregate to 20 ha of mapped ground.
  - Verify 4-way area values match individual source records.
- **Completion Criteria:**
  - Calling `plotService.getAreaAggregation('taluk', 'Haveli')` returns valid 4-way area breakdown and net deduplicated mapped area.

---

### Gap 2: Crop Classification Validation & Confidence Calibration (Module B)
- **Existing Files:**
  - `src/services/crop-classification.service.ts`
  - `src/lib/crop-phenology.ts`
- **Missing Functionality:**
  - Multiclass confusion matrix data structure.
  - Per-class precision, recall, and F1 scores.
  - Macro F1 and weighted F1 metrics.
  - Confidence calibration scoring (Expected Calibration Error - ECE, Brier score).
  - Geographic evaluation splits across pilot talukas (Haveli vs Baramati vs Shirur vs Daund).
  - Automated review item dispatch to Tahsildar when ML prediction disagrees with farmer declaration.
- **Required Changes:**
  - Expand `evaluate()` in `CropClassificationService` to compute full classification metrics from ground-truth verified records.
  - Implement `evaluateByTaluka()` and `evaluateBySeason()` methods.
  - In `classifyPlotCrop()`, check if `predicted_crop !== plot.crop_type`; if mismatched, automatically create a Tahsildar inspection item.
- **Database Modifications:**
  - Update `ClassificationEvaluation` interface to include `precisionByCrop`, `recallByCrop`, `f1ByCrop`, `macroF1`, `weightedF1`, `brierScore`, and `ece`.
- **Test Cases:**
  - Verify confusion matrix math against synthetic known multi-class ground-truth samples.
  - Verify Tahsildar inspection item creation upon crop discrepancy.
- **Completion Criteria:**
  - Model evaluation returns precision, recall, F1, macro F1, and calibration score.

---

### Gap 3: Crop Health & Vegetation Intelligence (Module C)
- **Existing Files:**
  - `src/services/satellite-monitoring.service.ts`
  - `src/services/ndvi.service.ts`
  - `src/components/satellite/ContinuousMonitoringTimeline.tsx`
- **Missing Functionality:**
  - Growth-stage-aware reference curves for major Maharashtra crops (Sugarcane, Soybean, Cotton, Onion, Wheat, Maize, Tur, Jowar).
  - Standardized health classifications:
    - *Healthy / Within expected range*
    - *Potential stress*
    - *Significant vegetation decline*
    - *Insufficient observations*
    - *Too early to assess*
    - *Field verification required*
  - Moisture stress screening using NDWI / NDMI.
  - Weather and vegetation correlation matrix.
- **Required Changes:**
  - Add `CROP_STAGE_REFERENCE_RANGES` dictionary to `src/lib/crop-phenology.ts` or `plant-health.service.ts`.
  - Add `assessPlotHealth()` method in `SatelliteMonitoringService` returning challenge-compliant monitoring classifications.
  - Add explicit disclaimer: *"These are monitoring classifications, not disease diagnoses."*
- **Test Cases:**
  - Verify that a 30% drop in NDVI during peak vegetative stage triggers *Significant vegetation decline*.
  - Verify that cloud-obscured observations return *Insufficient observations*, not zero NDVI.
- **Completion Criteria:**
  - Every observation contains calibrated indices, health classification, and explicit data quality flags.

---

### Gap 4: Yield Forecasting Architecture & Scenario Labeling (Module D)
- **Existing Files:**
  - `src/services/yield-forecasting.service.ts`
  - `src/components/intelligence/CropIntelligenceModal.tsx`
- **Missing Functionality:**
  - Modular `YieldModelInterface` for future ML regression integrations.
  - Input completeness indicators and regression metrics (MAE, RMSE, R², Bias).
  - Prominent badge and disclaimer: `"SCENARIO ESTIMATE — NOT A VALIDATED AI FORECAST"`.
  - Formula: `Estimated production = Estimated yield per hectare × Harvested area` (strictly rejecting harvested > planted).
- **Required Changes:**
  - Add `YieldModelInterface` definition and `scenarioYieldModel` implementation.
  - Add model validation hooks to calculate MAE, RMSE, and bias if historical yield records exist.
- **Test Cases:**
  - Attempting to pass `harvestedArea > plotArea` must throw a validation error.
  - Forecast records must have `estimate_kind: 'SCENARIO'`.
- **Completion Criteria:**
  - Production calculation mathematically verifies `yield * harvested_area` with zero false claims of AI predictive accuracy.

---

### Gap 5: Statewide Administrative Hierarchy & Non-Pilot Handling (Module E)
- **Existing Files:**
  - `src/pages/gis/GisCropSurveyPage.tsx`
  - `src/lib/geospatial.ts`
- **Missing Functionality:**
  - Clear visual demarcation of Active Pilot Talukas (Haveli, Baramati, Shirur, Daund).
  - Non-pilot regions must display: `"DATA NOT AVAILABLE FOR THIS REGION"` with guidance on pilot jurisdiction.
  - Map layer filters for Crop Distribution, Survey Coverage, Verification Status, Health Alerts, and Disaster Screening.
- **Required Changes:**
  - Add `PILOT_TALUKAS = ['haveli', 'baramati', 'shirur', 'daund']` constant.
  - Update `GisCropSurveyPage.tsx` to display non-pilot availability notices when non-pilot regions are selected.
- **Test Cases:**
  - Selecting a non-pilot taluka (e.g., Junnar) displays the Data Not Available state.
- **Completion Criteria:**
  - Platform explicitly highlights pilot jurisdiction and truthfully discloses data coverage.

---

### Gap 6: Disaster Assessment & Inspection Routing (Module F)
- **Existing Files:**
  - `src/services/disaster-assessment.service.ts`
- **Missing Functionality:**
  - Automated field verification task generation for plots with critical/severe disaster screening results.
  - Pre/post satellite scene metadata tracking (Scene ID, date, valid pixel %).
- **Required Changes:**
  - In `assessPlotDisaster()`, when severity is `CRITICAL` or `SEVERE`, add an entry to `mockDb.inspections` for field verification.
- **Test Cases:**
  - Running a flood assessment with >50% damage generates a pending field inspection.
- **Completion Criteria:**
  - Disaster records maintain pre/post scene IDs, pixel coverage %, and field verification links.

---

### Gap 7: Government Decision Dashboard Dynamic Analytics (Module G)
- **Existing Files:**
  - `src/services/analytics.service.ts`
  - `src/pages/admin/AdminDashboardPage.tsx`
- **Missing Functionality:**
  - Replace hardcoded static monthly and district distribution arrays with dynamic aggregations from `mockDb.farmPlots`, `mockDb.applications`, and `mockDb.reports`.
  - Provide traceable metrics answering 10 core government decision questions.
- **Required Changes:**
  - Rewrite `getRegistrationsOverTime()`, `getDistrictDistribution()`, and `getCropDistribution()` in `AnalyticsService`.
  - Add `getGovernmentDecisionMetrics()` answering:
    1. Total kharif acreage mapped
    2. Subsidy verification pass rate
    3. High-stress drought acreage
    4. Disaster compensation claims pending
    5. Discrepancy resolution turnaround time
- **Test Cases:**
  - Inserting a new plot updates the district distribution acres immediately.
- **Completion Criteria:**
  - Admin dashboard reflects live database state with zero hardcoded values.

---

### Gap 8: Mobile Field Survey Sync Statuses & Geolocation Integrity (Module H)
- **Existing Files:**
  - `src/services/mobile-survey.service.ts`
  - `src/components/field-survey/MobileFieldSurveyModal.tsx`
- **Missing Functionality:**
  - Explicit sync status indicators: *Saved locally*, *Waiting to synchronize*, *Synchronizing*, *Successfully synchronized*, *Synchronization failed*, *Requires user action*.
  - GPS accuracy (±m) display and source validation.
- **Required Changes:**
  - Update `MobileSurveyService` to support all 6 sync lifecycle statuses.
  - Ensure offline surveys queue in LocalStorage and sync idempotently.
- **Test Cases:**
  - Disconnect simulation stores survey as `SAVED_LOCALLY`; calling sync transitions to `SYNCHRONIZED`.
- **Completion Criteria:**
  - Survey modal displays live GPS accuracy badge and granular sync status indicators.

---

### Gap 9: Security & Credential Protection (Module J)
- **Existing Files:**
  - `src/services/msg91.service.ts`
  - `.env`
  - `.env.example`
- **Missing Functionality:**
  - Prevent frontend bundle exposure of `VITE_MSG91_AUTH_KEY`.
- **Required Changes:**
  - Ensure SMS service runs in simulated/secure mode in frontend client, warning if keys are passed client-side.
  - Document server-side dispatch architecture in Supabase Edge Functions.
- **Test Cases:**
  - Running client build without MSG91 keys does not throw errors and cleanly simulates SMS delivery in development.
- **Completion Criteria:**
  - Zero credential leakage in browser console or bundle inspection.

---

### Gap 10: Reporting & Statutory Spatial Exports (Module K)
- **Existing Files:**
  - `src/services/report.service.ts`
  - `src/pages/gis/GisReportsPage.tsx`
- **Missing Functionality:**
  - Standardized GeoJSON export option for all statutory reports containing plot spatial boundaries.
  - Inclusion of CRS (EPSG:4326), bounding box, and generation timestamp in metadata headers.
- **Required Changes:**
  - Add `exportReportGeoJson(reportId)` to `ReportService`.
  - Add GeoJSON download button in `GisReportsPage.tsx`.
- **Test Cases:**
  - Exporting a Kharif Crop Acreage report produces valid GeoJSON readable by QGIS / ArcGIS.
- **Completion Criteria:**
  - All statutory reports support PDF, CSV, and GeoJSON formats.
