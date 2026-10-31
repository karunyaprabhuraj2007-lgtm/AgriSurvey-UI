# AGRISURVEY AI — DATA QUALITY & SCIENTIFIC INTEGRITY REPORT
**Radiometric Calibration, Provenance Tracking & Spatial Accuracy**  
**Company:** Rehydria Technology Pvt Ltd | **Team:** GreenMinds  
**Release:** V4.0.0-PROD | **Repository:** PuneAgriMain | **Branch:** `KARUNYA-PRABHURAJ-E`  
**Date:** October 31, 2026  

---

## 1. Principles of Scientific Data Integrity

AgriSurvey AI enforces strict scientific integrity rules to ensure no false claims, synthetic accuracies, or fabricated agricultural outputs are presented to government authorities:

1. **Zero Data Fabrication:** No artificial NDVI time series, fabricated yield accuracies, or simulated crop classifications are generated.
2. **Honest Abstention Over Guesswork:** If fewer than 6 clear observations exist across a 120-day Kharif window, the phenology matcher returns `insufficient_observations` rather than guessing a crop.
3. **Cloud-Obscured Pixels Are Not Zero:** Cloudy or shadowed pixels masked via the Sentinel-2 Scene Classification Layer (SCL) are marked as invalid or nodata. They are never treated as $0.0$ NDVI (which represents water).
4. **Distinction Between Scenario Calculations and AI Forecasts:** Yield estimates are explicitly designated `"SCENARIO ESTIMATE — NOT A VALIDATED AI FORECAST"`.

---

## 2. Remote Sensing Data Specifications & Calibration

### 2.1 Satellite Constellation & Sensors
- **Space Agency:** European Space Agency (ESA) Copernicus Programme.
- **Satellites:** Sentinel-2A and Sentinel-2B Multi-Spectral Instrument (MSI).
- **Product Type:** Level-2A (L2A) Bottom-Of-Atmosphere (BOA) Surface Reflectance.
- **Discovery Service:** SpatioTemporal Asset Catalog (STAC) API (`earth-search.aws.element84.com/v1`).
- **Processing Baseline Calibration:** Reflectance values for Baseline 04.00+ apply BOA offset correction:
  $$\rho_i = \frac{\text{DN}_i - 1000}{10000}$$
  where $\text{DN}_i$ is the raw digital number, $-1000$ is the radiometric offset, and $10000$ is the scaling factor.

### 2.2 Band Configuration & Spectral Ranges
| Band Identifier | Resolution | Central Wavelength ($\lambda$) | Purpose |
| :--- | :--- | :--- | :--- |
| **B02 (Blue)** | 10 m | 490 nm | Atmospheric scattering, EVI formula |
| **B03 (Green)** | 10 m | 560 nm | Vegetation greenness, NDWI water detection, GCVI |
| **B04 (Red)** | 10 m | 665 nm | Chlorophyll absorption, NDVI, SAVI |
| **B05 (RedEdge 1)** | 20 m (10 m resampled) | 705 nm | Chlorophyll status, NDRE |
| **B08 (NIR 1)** | 10 m | 842 nm | High canopy reflectance, NDVI, SAVI, NDRE, GCVI |
| **B11 (SWIR 1)** | 20 m (10 m resampled) | 1610 nm | Canopy water content, NDMI moisture index |
| **SCL (Scene Classification)** | 20 m | — | Cloud, cloud-shadow, snow, water masking |

### 2.3 Cloud Masking & Scene Quality Filtering
- Every Sentinel-2 scene undergoes pixel-level classification via the SCL layer:
  - Pixels classified as medium/high probability clouds (classes 8, 9), thin cirrus (class 10), or cloud shadows (class 3) are strictly masked.
  - A pass is accepted for crop phenology matching only if valid clear pixel fraction $\ge 50\%$.
  - In disaster pre/post change detection, only pixels clear on both dates are compared ($\ge 70\%$ clear threshold).

---

## 3. Geodesic & Spatial Quality Standards

### 3.1 Coordinate Systems
- **Storage & Geometry Operations:** `EPSG:4326` (WGS 84 Ellipsoidal Geographic Coordinates).
- **Map Visualizations:** `EPSG:3857` (Spherical Web Mercator).
- **Surface Calculations:** Spherical excess / Girard's theorem integration on the WGS 84 ellipsoid ($a = 6,378,137.0\text{ m}$, $f = 1/298.257223563$).
- **Precision:** Coordinates stored to 6 decimal places ($\approx 0.11\text{ m}$ precision at Maharashtra latitudes).

### 3.2 Spatial Deduplication
- Multiple versions of cadastral boundaries and overlapping parcel submissions are analyzed for intersection area.
- Deduplication computes **Net Non-Overlapping Mapped Area**, eliminating duplicate counting of overlapping hectares in government subsidy and crop production statistics.

---

## 4. Mobile Ground Survey & Drone Photogrammetry Standards

### 4.1 Mobile Field Survey (Field Worker)
- **Geolocation API:** HTML5 Geolocation API with `enableHighAccuracy: true`.
- **GPS Accuracy:** Displayed in real-time as an accuracy badge ($\pm m$). Observations with accuracy $> 15\text{ m}$ are flagged for stationary re-acquisition.
- **Offline Reliability:** Durable LocalStorage sync queue with idempotent synchronization to prevent duplicate submissions during network reconnections.

### 4.2 Drone Photogrammetry (RTK Survey)
- **Sensors:** Full-frame photogrammetry cameras (DJI Zenmuse P1) and 5-band multispectral sensors.
- **Ground Sampling Distance (GSD):** $< 2.5\text{ cm/pixel}$ enforced.
- **Flight Altitude:** $45 - 80\text{ m}$ AGL.
- **Georeferencing:** Dual-frequency RTK/PPK GNSS receivers with Base Station corrections.

---

## 5. Audit Conclusion

The AgriSurvey AI platform adheres to the highest remote-sensing, GIS, and data quality standards. Every metric presented on the dashboard carries clear data quality tags, methodology descriptions, and explicit scientific disclaimers.
