# AGRISURVEY AI — DATA VALIDATION & REMOTE SENSING INTEGRITY REPORT
**Scientific Integrity, Coordinate Reference Systems & Radiometric Calibration**  
**Company:** Rehydria Technology Pvt Ltd | **Team:** GreenMinds  
**Release:** V3.0.0 → V4.0.0 | **Branch:** `KARUNYA-PRABHURAJ-E`  
**Date:** October 31, 2026  

---

## 1. Scientific & Ethical Mandate

AgriSurvey AI operates under strict remote-sensing and agricultural data integrity guidelines:
1. **Zero Data Fabrication:** No artificial NDVI peaks, fabricated model accuracies, or simulated crop classifications are introduced to make demonstrations appear successful.
2. **Honest Abstention:** When satellite observations are cloud-obscured, corrupted, or insufficient (< 6 clear passes across a 120-day window), the system returns `INSUFFICIENT OBSERVATIONS` or `AMBIGUOUS`. It never forces a prediction.
3. **No Unvalidated AI Yield:** Yield calculations are strictly labeled `"SCENARIO ESTIMATE — NOT A VALIDATED AI FORECAST"`. Planted area is never assumed equal to harvested area.

---

## 2. Coordinate Reference Systems (CRS) & Geodesic Area Calculations

### 2.1 Geographic vs Projected CRS Handling
- **Storage CRS:** `EPSG:4326` (WGS84 ellipsoidal coordinates: latitude, longitude in decimal degrees).
- **Web Mapping Display:** `EPSG:3857` (Spherical Mercator for Leaflet / OpenLayers slippy maps).
- **Surface Area Computation:**
  - Area calculations **never** multiply `Δlat * Δlon` degrees directly.
  - Algorithms implement spherical excess / Girard’s theorem trapezoidal integration across ellipsoidal vertices (`calculateGeodesicAreaSquareMeters` in `src/lib/geospatial.ts`).
  - Standard outputs:
    $$\text{Square Metres } (m^2) \rightarrow \text{Hectares } (ha = m^2 / 10000) \rightarrow \text{Acres } (ac = ha \times 2.4710538)$$

### 2.2 Boundary Validation Checks
Every incoming boundary polygon undergoes the following integrity checks:
1. Vertices $\ge 3$ closed loop.
2. Self-intersection detection.
3. Coordinate bounds check within Maharashtra territory ($15.6^\circ\text{N} - 22.0^\circ\text{N}, 72.6^\circ\text{E} - 80.9^\circ\text{E}$).
4. Area reasonableness ($> 100\text{ m}^2$ to $< 500\text{ ha}$).

---

## 3. Satellite Data Ingest & Radiometric Calibration

### 3.1 Primary Satellite Pipeline
- **Constellation:** European Space Agency (ESA) Copernicus Sentinel-2A & Sentinel-2B.
- **Product Level:** Level-2A (L2A) Bottom-Of-Atmosphere (BOA) surface reflectance.
- **Access Route:** SpatioTemporal Asset Catalog (STAC) via AWS Earth Search (`earth-search.aws.element84.com/v1`).
- **Spatial Resolution:**
  - Band 4 (Red, 665 nm): 10 metres.
  - Band 8 (NIR, 842 nm): 10 metres.
  - Band 11 (SWIR 1, 1610 nm): 20 metres (resampled to 10 m).
  - Band 5 (RedEdge 1, 705 nm): 20 metres (resampled to 10 m).
  - Band 3 (Green, 560 nm): 10 metres.

### 3.2 BOA Scale & Offset Handling
- Products acquired after January 25, 2022 (Processing Baseline 04.00+) incorporate a radiometric offset:
  $$\rho = \frac{\text{DN} - 1000}{10000}$$
- `src/lib/sentinel-cog.ts` automatically parses the STAC metadata to apply baseline offsets, preventing negative NDVI artifacts in shadow pixels.

### 3.3 Scene Classification Layer (SCL) Cloud Masking
Pixels are masked prior to index calculation using the 20 m SCL band:
- **Valid Pixels:** Class 4 (Vegetation), Class 5 (Not-vegetated / Bare soil), Class 6 (Water).
- **Masked Pixels:** Class 0 (No Data), Class 1 (Saturated/Defective), Class 3 (Cloud Shadows), Class 8 (Cloud Medium Probability), Class 9 (Cloud High Probability), Class 10 (Thin Cirrus), Class 11 (Snow/Ice).
- **Rule:** If valid clear coverage over the plot is $< 50\%$, the pass is marked as cloudy and discarded from phenology matching. Cloud-obscured pixels are **never treated as zero NDVI**.

---

## 4. Multi-Spectral Vegetation Indices Verification

AgriSurvey AI implements 7 peer-reviewed spectral indices:

| Index | Formula | Primary Agricultural Diagnostic Role | Valid Physical Range |
| :--- | :--- | :--- | :--- |
| **NDVI** | $(B08 - B04) / (B08 + B04)$ | Canopy density & photosynthetic activity | $[-1.0, +1.0]$ (Crops: $0.15 - 0.90$) |
| **EVI** | $2.5 \times (B08 - B04) / (B08 + 6 \times B04 - 7.5 \times B02 + 1)$ | High-biomass canopy monitoring (Sugarcane) without saturation | $[-1.0, +1.0]$ |
| **SAVI** | $((B08 - B04) / (B08 + B04 + 0.5)) \times 1.5$ | Soil-adjusted index for early emergence & sparse crops | $[-1.0, +1.0]$ |
| **NDWI** | $(B03 - B08) / (B03 + B08)$ | Surface water body & flood inundation detection | $[-1.0, +1.0]$ |
| **NDMI** | $(B08 - B11) / (B08 + B11)$ | Crop canopy water content & moisture stress screening | $[-1.0, +1.0]$ |
| **NDRE** | $(B08 - B05) / (B08 + B05)$ | Chlorophyll content & nitrogen status in dense canopies | $[-1.0, +1.0]$ |
| **GCVI** | $(B08 / B03) - 1$ | Green chlorophyll index for leaf area index (LAI) proxy | $[0.0, +15.0]$ |

---

## 5. Drone Orthomosaic Sub-Centimetre Photogrammetry

- **Sensors:** DJI Zenmuse P1 / MicaSense RedEdge-P.
- **Ground Sampling Distance (GSD):** Enforced $< 2.5\text{ cm/pixel}$.
- **Georeferencing:** Dual-frequency RTK/PPK GNSS receivers with Base Station correction.
- **Tiling:** Cloud-Optimized GeoTIFF (COG) serving slippy map tiles through OpenLayers / Leaflet canvas overlays.

---

## 6. Audit Verdict

All remote-sensing calculations in AgriSurvey AI strictly adhere to peer-reviewed spectral formulations and honest data representations. No synthetic scores are passed off as live satellite measurements.
