# AGRISURVEY AI — V3.0.0 TO V4.0.0 UPGRADE ROADMAP
**Production Engineering & Implementation Sequence**  
**Company:** Rehydria Technology Pvt Ltd | **Team:** GreenMinds  
**Repository:** PuneAgriMain | **Target Release:** V4.0.0-PROD  
**Date:** October 31, 2026  

---

## 1. Overview & Architecture Strategy

This roadmap details the engineering execution order to bring AgriSurvey AI from V3.0.0 to V4.0.0, addressing 100% of the Maharashtra Geospatial & GIS-Based Crop Survey Challenge requirements.

### Architecture Principles:
1. **Preserve Working Foundations:** Maintain all 29 client routes, RBAC guards, UI theme, Supabase + local persistent MockDB, and Sentinel-2 STAC ingest pipelines.
2. **Honest Science & Zero Data Fabrication:** Distinguish scenario calculations from validated AI forecasts. Explicitly label data quality, missing imagery, and unobserved periods.
3. **Traceability:** Every aggregate, classification, and health assessment retains full provenance (scenes used, GPS accuracy, cloud percentage, reviewing officer).

---

## 2. Phase-by-Phase Execution Schedule

```
Phase 1: Compliance Audit & Gap Analysis [COMPLETED]
   ├── CHALLENGE_COMPLIANCE_AUDIT.md
   ├── IMPLEMENTATION_GAP_REPORT.md
   ├── AGRISURVEY_V3_TO_V4_ROADMAP.md
   └── DATA_VALIDATION_REPORT.md

Phase 2: Core Remote Sensing & Area Math (Modules A & B)
   ├── 4-Way Area Separation & Spatial Deduplication (plot.service.ts, geospatial.ts)
   ├── Multi-tier Acreage Aggregation (Plot -> Village -> Taluka -> District)
   ├── Full Classification Metrics (Precision, Recall, F1, Macro F1, Calibration)
   └── Conflict Resolution Queue (Discrepancy -> Tahsildar Review)

Phase 3: Vegetation Health & Yield Architecture (Modules C & D)
   ├── Crop Growth-Stage Reference Ranges & Anomaly Alerts
   ├── 6 Challenge-Compliant Health Statuses
   ├── Weather & Vegetation Correlation Matrix
   └── Modular Yield Architecture & Scenario Labeling

Phase 4: Statewide Hierarchy & Decision Dashboard (Modules E & G)
   ├── Pilot Taluka Demarcation (Haveli, Baramati, Shirur, Daund)
   ├── Dynamic Admin Analytics from Live DB
   └── 10 Core Government Policy Decision Metrics

Phase 5: Disaster Assessment & Field Mobile Sync (Modules F & H)
   ├── Disaster Screening to Field Inspection Dispatch
   ├── Mobile Survey 6-Stage Sync Lifecycle & GPS Accuracy Tracking
   └── Offline Durability Guarantee

Phase 6: Satellite/Drone Integrity, Security & Statutory Exports (Modules I, J, K)
   ├── SCL Cloud Masking & Scene Provenance Enforcement
   ├── MSG91 Credential Sandbox Protection
   └── GeoJSON Spatial Exports for all 10 Statutory Reports

Phase 7: Comprehensive Automated Verification (Module L)
   ├── End-to-End Compliance Test Script (scripts/test-challenge-compliance.ts)
   ├── Full Test Runner Execution (npm test)
   └── Production Client Build (npm run build)

Phase 8: Production Release Deliverables
   ├── AGRISURVEY_V4_IMPLEMENTATION_REPORT.md
   ├── AGRISURVEY_TEST_RESULTS.md
   ├── AGRISURVEY_DATA_QUALITY_REPORT.md
   └── AGRISURVEY_DEPLOYMENT_CHECKLIST.md
```

---

## 3. Detailed Phase Deliverables

### Phase 2: Core Area Estimation & Classification Validation
- **Deliverables:**
  - `src/lib/geospatial.ts`: Add `computeNetNonOverlappingArea()`.
  - `src/services/plot.service.ts`: Add `getAcreageAggregation()`, separating farmer-declared, ML-predicted, field-observed, and Tahsildar-verified hectares.
  - `src/services/crop-classification.service.ts`: Implement `evaluate()` with Confusion Matrix, per-class Precision/Recall/F1, Macro/Weighted F1, Brier calibration score, and taluka/season splits.
  - Automatically insert review records into `mockDb.inspections` when ML classification conflicts with farmer declaration.

### Phase 3: Vegetation Health & Yield Architecture
- **Deliverables:**
  - `src/lib/crop-phenology.ts` & `src/services/satellite-monitoring.service.ts`: Add reference NDVI curves for 12 crops across 6 growth stages.
  - Standardize 6 health classifications: *Healthy / Within expected range*, *Potential stress*, *Significant vegetation decline*, *Insufficient observations*, *Too early to assess*, *Field verification required*.
  - `src/services/yield-forecasting.service.ts`: Define `YieldModelInterface`, regression validation metrics (MAE, RMSE, R², Bias), and scenario estimate banner.

### Phase 4: Statewide Hierarchy & Government Oversight
- **Deliverables:**
  - `src/pages/gis/GisCropSurveyPage.tsx`: Add active pilot indicators for Haveli, Baramati, Shirur, Daund; show "Data Not Available" placeholder for non-pilot regions.
  - `src/services/analytics.service.ts`: Replace static arrays with live queries on `mockDb.farmPlots`, `mockDb.applications`, and `mockDb.reports`.
  - Add `getGovernmentDecisionMetrics()` supporting crop planning, subsidy verification, and disaster relief decisions.

### Phase 5: Disaster Screening & Mobile Offline Resilience
- **Deliverables:**
  - `src/services/disaster-assessment.service.ts`: Auto-route high/critical damage assessments to field worker inspection assignments.
  - `src/services/mobile-survey.service.ts`: Support all 6 sync lifecycle states (*Saved locally*, *Waiting to synchronize*, *Synchronizing*, *Successfully synchronized*, *Synchronization failed*, *Requires user action*).
  - Track GPS accuracy in meters and photo metadata.

### Phase 6: Data Integrity, Security & Statutory Exports
- **Deliverables:**
  - `src/services/msg91.service.ts`: Sandboxed fallback mode preventing frontend API key leakage.
  - `src/services/report.service.ts`: Add `exportReportGeoJson()` to enable QGIS/ArcGIS spatial layers for all statutory reports.

### Phase 7 & 8: Testing & Final Documentation
- **Deliverables:**
  - Run all test suites cleanly (`npm test`).
  - Verify complete production build (`npm run build`).
  - Publish all 4 final engineering deliverables.
