# AGRISURVEY AI — PRODUCTION DEPLOYMENT CHECKLIST
**Maharashtra Geospatial Crop Survey Platform (V4.0.0-PROD)**  
**Company:** Rehydria Technology Pvt Ltd | **Team:** GreenMinds  
**Target Branch:** `KARUNYA-PRABHURAJ-E` | **Release Version:** V4.0.0-PROD  
**Date:** October 31, 2026  

---

## 1. Pre-Deployment System Verification

- [x] **Git Branch Integrity:** Verified on official branch `KARUNYA-PRABHURAJ-E`.
- [x] **Submodule Status:** `GM-ML-V2` tracked directly as source trees (zero broken gitlinks/404s).
- [x] **TypeScript Type Checking:** Clean compilation with `tsc -b` (zero errors).
- [x] **Production Bundle Build:** Built successfully via `npm run build` (3,361 modules transformed).
- [x] **All Automated Test Suites Passing:**
  - `scripts/test-ml-models.ts` (100% Pass)
  - `scripts/run-acceptance-tests.ts` (100% Pass)
  - `scripts/test-geospatial-suite.ts` (100% Pass)
  - `scripts/test-farmer-workflow.ts` (100% Pass)
  - `scripts/test-gis-e2e.ts` (100% Pass)
  - `scripts/test-challenge-compliance.ts` (100% Pass)

---

## 2. Environment Configuration & Security Hardening

- [x] **Credential Isolation (Module J):**
  - Confirmed: Client-side bundles do NOT leak `MSG91_AUTH_KEY`.
  - SMS dispatch operates in sandboxed simulation in frontend client development and via Supabase Edge Functions in production.
- [x] **Supabase Connectivity:**
  - `VITE_SUPABASE_URL`: Pre-configured with automatic graceful fallback to persistent local MockDB when credentials are omitted.
  - `VITE_SUPABASE_ANON_KEY`: Safe for client exposure with Row Level Security (RLS) policies enforced.
- [x] **Firebase Configuration:**
  - `src/lib/firebase.ts` guarded with `typeof window !== 'undefined'` to prevent Node.js test runner DNS deadlocks.
- [x] **Satellite STAC API Endpoint:**
  - STAC discovery configured for AWS Earth Search (`https://earth-search.aws.element84.com/v1`) with offline pre-cached fallback scenes for disconnected operations.

---

## 3. Database & Storage Migrations

The database schema supports both Supabase PostgreSQL (with PostGIS extensions) and the client-side durable engine (`mockDb`):
1. `supabase/migrations/20261014000001_initial_schema.sql` (Core entities: profiles, properties, applications, inspections).
2. `supabase/migrations/20261014000002_rls_and_storage.sql` (Row Level Security & storage buckets).
3. `supabase/migrations/20261014000003_seed_data.sql` (Maharashtra pilot seed records).
4. `supabase/migrations/20261014000004_plant_intelligence_and_verification.sql` (Continuous satellite monitoring, indices, inspection queues).
5. `supabase/migrations/20261014000005_msg91_and_auth_workflow.sql` (Notification jobs & audit trail).

---

## 4. Operational Runbook & Verification Steps

### Step 1: Clone & Dependency Installation
```bash
git clone https://github.com/karunyaprabhuraj2007-lgtm/AgriSurvey-UI.git PuneAgriMain
cd PuneAgriMain
git checkout KARUNYA-PRABHURAJ-E
npm install
```

### Step 2: Run Full Automated Verification Suite
```bash
npm test
```
*Expected Result:* All 6 test suites execute sequentially with 100% pass rate (78 assertions passed, exit code 0).

### Step 3: Compile Production Build
```bash
npm run build
```
*Expected Result:* Vite and TypeScript output production assets to `dist/` directory with 0 errors.

### Step 4: Launch Production Preview / Development Server
```bash
npm run preview # Production preview on port 4173
# OR
npm run dev     # Local development server on port 5173
```

---

## 5. User Roles & Default Test Identities

| Role | Username / Identity | Default Jurisdiction | Primary Responsibilities |
| :--- | :--- | :--- | :--- |
| **Farmer** | Ramesh Patil (`usr-farmer-01`) | Wagholi, Haveli, Pune | Land registration, parcel boundary drawing, 5-6 ground photo upload, application tracking |
| **Tahsildar** | Anand Deshmukh (`usr-tahsildar-01`) | Haveli Taluk, Pune | Application review, ground vs drone image comparison, crop verification, certified 7/12 report issuance |
| **Field Worker** | Prakash Jadhav (`usr-field-01`) | Haveli & Baramati | Mobile field surveys with GPS accuracy $\pm m$, RTK drone missions, inspection photo collection |
| **Administrator** | Shrikant Joshi (`usr-admin-01`) | Maharashtra State HQ | Statewide analytics, Government Decision Dashboard, staff region assignment, audit log monitoring |

---

## 6. Pilot Geography & Operational Boundaries

- **State:** Maharashtra
- **District:** Pune
- **Pilot Talukas:**
  1. **Haveli** (Villages: Wagholi, Uruli Kanchan, Manjari, Hadapsar Rural, Loni Kalbhor)
  2. **Baramati** (Villages: Malegaon, Supae, Somanthali, Korhale)
  3. **Shirur** (Villages: Sanaswadi, Koregaon Bhima, Shikrapur, Pabal)
  4. **Daund** (Villages: Kedgaon, Patas, Yavat, Varvand)
- **Non-Pilot Talukas & Districts:**
  - Display explicit `"DATA NOT AVAILABLE FOR THIS REGION"` notification with active pilot switcher.

---

## 7. Sign-off

- **Architecture:** Senior Geospatial Architect (Team GreenMinds)
- **Remote Sensing:** Remote Sensing Lead (Rehydria Technology)
- **Status:** **APPROVED FOR V4.0.0 PRODUCTION RELEASE**
