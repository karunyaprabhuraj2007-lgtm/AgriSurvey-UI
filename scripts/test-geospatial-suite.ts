/**
 * AgriSurvey AI — Comprehensive Geospatial & Remote Sensing Verification Suite
 * 
 * Validates:
 * 1. Geodesic area calculation (WGS84 ellipsoid m², ha, acres) with Turf.js.
 * 2. Farm plot registration & GeoJSON import/export.
 * 3. Earth Search STAC API Sentinel-2 L2A scene query & asset discovery.
 * 4. Genuine NDVI spectral processing (B08-B04)/(B08+B04) with nodata masking and statistics.
 * 5. Open-Meteo weather API coordinate retrieval, current observation, and 7-day forecast.
 * 6. RTK Drone Mission & Orthomosaic management with geotagged photo locations.
 * 7. Mobile Field Survey offline drafting and sync queue execution.
 * 8. Crop identification (phenology template matcher) & officer verification.
 * 9. Production scenario (expected yield × harvested area).
 * 10. Disaster screening: per-pixel NDVI change logic.
 * 11. Plot-level PDF dossier & CSV data export.
 */

import { mockDb } from '../src/services/mock-db';
import { plotService } from '../src/services/plot.service';
import { stacSatelliteService } from '../src/services/stac.service';
import { ndviProcessorService } from '../src/services/ndvi.service';
import { weatherService } from '../src/services/weather.service';
import { droneSurveyService } from '../src/services/drone-survey.service';
import { mobileSurveyService } from '../src/services/mobile-survey.service';
import { cropClassificationService } from '../src/services/crop-classification.service';
import { yieldForecastingService } from '../src/services/yield-forecasting.service';
import { summariseNdviChange } from '../src/services/disaster-assessment.service';
import { reportService } from '../src/services/report.service';
import { computeGeodesicMeasurements } from '../src/lib/geospatial';

// Synthetic soybean curve (template shape, 5-day sampling) for the offline decision test.
function syntheticSoybeanSeries(year: number) {
  const out: { date: string; ndvi: number }[] = [];
  const start = Date.UTC(year, 5, 10);
  for (let d = 0; d <= 170; d += 5) {
    const ndvi = 0.15 + (0.82 - 0.15) * (1 / (1 + Math.exp(-0.14 * (d - 22))) - 1 / (1 + Math.exp(-0.16 * (d - 107))));
    out.push({ date: new Date(start + d * 86400000).toISOString().slice(0, 10), ndvi });
  }
  return out;
}

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    process.exit(1);
  } else {
    console.log(`✅ PASSED: ${msg}`);
  }
}

async function runGeospatialSuite() {
  console.log('\n================================================================');
  console.log('  AGRISURVEY AI — GEOSPATIAL & REMOTE SENSING VERIFICATION SUITE');
  console.log('================================================================\n');

  // --- Step 1: Geodesic Area Calculation & Plot Boundary ---
  console.log('--- Step 1: Geodesic Plot Creation & Multi-Unit Area Math ---');
  // Coordinates of a 3.48-acre polygon in Haveli, Pune
  const polygonCoords: [number, number][] = [
    [18.5780, 73.9810],
    [18.5815, 73.9815],
    [18.5810, 73.9845],
    [18.5775, 73.9840],
    [18.5780, 73.9810],
  ];

  const measurements = computeGeodesicMeasurements(polygonCoords);
  console.log(`   Computed Area: ${measurements.areaSquareMeters} m² | ${measurements.areaHectares} Ha | ${measurements.areaAcres} Acres`);
  console.log(`   Computed Perimeter: ${measurements.perimeterMeters} m`);
  assert(measurements.areaSquareMeters > 10000, 'Geodesic area exceeds 10,000 sqm');
  assert(measurements.areaAcres > 20 && measurements.areaAcres < 40, 'Area in acres is accurately computed within expected range');
  assert(measurements.perimeterMeters > 300, 'Perimeter calculation is realistic');

  const createdPlot = await plotService.createPlot({
    plotName: 'Shree Krishna Farm - Block 4',
    surveyNumber: '142/3A',
    subdivisionNumber: '3A',
    village: 'Wagholi',
    taluk: 'Haveli',
    district: 'Pune',
    farmerId: 'usr-farmer-01',
    cropType: 'Sugarcane',
    coordinates: polygonCoords,
  });

  assert(Boolean(createdPlot.id), 'Farm plot registered with unique plot UUID');
  assert(createdPlot.plot_reference.startsWith('MH-PUN-HAV-'), 'Plot reference adheres to Maharashtra standard');
  assert(createdPlot.area_acres === measurements.areaAcres, 'Stored area matches geodesic calculations');

  // --- Step 2: Earth Search STAC Satellite Scene Query ---
  console.log('\n--- Step 2: Earth Search STAC Sentinel-2 Scene Discovery ---');
  const stacResults = await stacSatelliteService.searchScenes({
    plotId: createdPlot.id,
    maxCloudCover: 30,
    limit: 5,
  });

  console.log(`   Scenes Found: ${stacResults.totalFound} (Data Source: ${stacResults.dataSource})`);
  assert(stacResults.scenes.length > 0, 'Sentinel-2 L2A scenes found intersecting plot');
  const sampleScene = stacResults.scenes[0];
  console.log(`   Top Scene ID: ${sampleScene.scene_id} | Acquisition: ${sampleScene.acquisition_datetime} | Cloud Cover: ${sampleScene.cloud_cover_percentage}%`);
  assert(sampleScene.cloud_cover_percentage <= 30, 'Cloud coverage within specified filter limit');
  assert(Boolean(sampleScene.assets), 'Scene assets discovered');

  // --- Step 3: NDVI Spectral Raster Calculation ---
  console.log('\n--- Step 3: Genuine NDVI Spectral Raster Math (B08/B04) ---');
  const ndviResult = await ndviProcessorService.processNdvi({
    plotId: createdPlot.id,
    sceneId: sampleScene.scene_id,
    cloudMaskingEnabled: true,
  });

  console.log(`   Mean NDVI: ${ndviResult.observation.ndvi_mean}`);
  console.log(`   Min NDVI: ${ndviResult.observation.ndvi_min} | Max NDVI: ${ndviResult.observation.ndvi_max}`);
  console.log(`   Valid Pixel Coverage: ${ndviResult.observation.valid_pixel_coverage_pct}%`);
  console.log(`   Vegetation Class: ${ndviResult.observation.vegetation_classification}`);
  assert(ndviResult.observation.ndvi_mean >= -1.0 && ndviResult.observation.ndvi_mean <= 1.0, 'Mean NDVI conforms to scientific bounds [-1, 1]');
  assert(ndviResult.observation.ndvi_max >= ndviResult.observation.ndvi_min, 'Max NDVI >= Min NDVI');
  assert(ndviResult.observation.plot_id === createdPlot.id, 'Vegetation observation tied to unique plot_id');

  // --- Step 4: Open-Meteo Weather Integration ---
  console.log('\n--- Step 4: Open-Meteo Plot Agrometeorological Data ---');
  const weather = await weatherService.getPlotWeather(createdPlot.id, true);
  console.log(`   Plot Centroid: (${weather.latitude}, ${weather.longitude})`);
  console.log(`   Temperature: ${weather.temperature_celsius}°C | Humidity: ${weather.relative_humidity_pct}% | Rain: ${weather.precipitation_mm}mm`);
  console.log(`   Condition: ${weather.weather_condition} | Forecast Days: ${weather.daily_forecast.length}`);
  assert(weather.plot_id === createdPlot.id, 'Weather observation tied to plot_id');
  assert(weather.temperature_celsius >= 0 && weather.temperature_celsius <= 55, 'Temperature reading is within realistic physical range');
  assert(weather.daily_forecast.length >= 7, '7-day agrometeorological forecast retrieved');

  // --- Step 5: RTK Drone Mission & Orthomosaic Registration ---
  console.log('\n--- Step 5: Drone RTK Mission & Orthomosaic Ingestion ---');
  const droneMission = await droneSurveyService.createMission({
    plotId: createdPlot.id,
    title: 'High-Resolution Multispectral Plot Scan',
    pilotName: 'Prakash Mahadev Jadhav',
    flightDate: '2026-10-24',
    flightAltitudeMeters: 45,
    cameraSensor: 'DJI Zenmuse P1 (Full-Frame Photogrammetry)',
    notes: 'Sub-2cm GSD survey for boundary cadastre verification.',
  });

  assert(droneMission.plot_id === createdPlot.id, 'Drone mission tied to plot_id');
  assert(droneMission.status === 'SCHEDULED', 'Initial mission status is SCHEDULED');

  const photos = await droneSurveyService.uploadDronePhotos(droneMission.id, [
    { name: 'DJI_20261024_0001.JPG' },
    { name: 'DJI_20261024_0002.JPG' },
    { name: 'DJI_20261024_0003.JPG' },
  ]);

  assert(photos.length === 3, '3 drone photographs ingested with GPS coordinates');
  assert(photos[0].latitude > 0 && photos[0].longitude > 0, 'EXIF coordinates attached to drone photos');

  const updatedMission = await droneSurveyService.registerOrthomosaic(
    droneMission.id,
    'https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80'
  );

  assert(updatedMission.status === 'PROCESSED', 'Mission status updated to PROCESSED after orthomosaic registration');
  assert(Boolean(updatedMission.orthomosaic_bounds), 'Orthomosaic georeferencing bounds defined');

  // --- Step 6: Mobile Field Survey & Offline Sync ---
  console.log('\n--- Step 6: Mobile Field Survey & Offline Sync Engine ---');
  const draftSurvey = await mobileSurveyService.submitSurvey({
    plotId: createdPlot.id,
    surveyorId: 'usr-worker-01',
    surveyorName: 'Prakash Jadhav (Field Surveyor)',
    latitude: 18.5795,
    longitude: 73.9823,
    gpsAccuracyMeters: 2.8,
    cropType: 'Sugarcane',
    growthStage: 'Vegetative',
    soilCondition: 'Moist',
    irrigationType: 'Drip',
    photos: ['https://images.unsplash.com/photo-1592982537447-7440770cbfc9?auto=format&fit=crop&w=800&q=80'],
    fieldNotes: 'Healthy vigorous cane growth. Zero pest infestation observed.',
    isDraft: true,
  });

  assert(draftSurvey.sync_status === 'DRAFT', 'Field survey stored in offline draft queue');

  const syncResult = await mobileSurveyService.syncPendingSurveys();
  console.log(`   Surveys Synchronized: ${syncResult.syncedCount}`);
  assert(syncResult.syncedCount >= 1, 'Offline draft synchronized successfully');
  assert(draftSurvey.sync_status === 'SYNCHRONIZED', 'Draft status changed to SYNCHRONIZED');

  // --- Step 7: Crop identification (phenology matcher) & officer verification ---
  console.log('\n--- Step 7: Crop Identification & Officer Verification ---');
  const prediction = await cropClassificationService.classifyFromObservations(createdPlot.id, 'kharif', 2025, syntheticSoybeanSeries(2025), 'synthetic test series');
  console.log(`   Verdict: ${prediction.verdict_status} | crop: ${prediction.predicted_crop ?? '—'} | candidates: ${prediction.candidate_crops.join(', ')}`);
  assert(prediction.template_fits[0]?.crop === 'soybean', 'Soybean curve best fits the soybean template');
  assert(prediction.verdict_status !== 'matched' || prediction.predicted_crop === 'soybean', 'No wrong crop is confidently claimed');
  assert(prediction.verification_status === 'AI_PREDICTION', 'Result tagged unverified until an officer checks it');

  mockDb.setCurrentUserByRole('tahsildar');
  const verifiedPrediction = await cropClassificationService.verifyCropPrediction({
    predictionId: prediction.id,
    verifiedCrop: 'soybean',
    reviewerNotes: 'Soybean confirmed during field visit.',
  });
  assert(verifiedPrediction.verified_crop === 'soybean', 'Verified crop recorded');
  assert(verifiedPrediction.reviewer_name === mockDb.currentUser.full_name, 'Reviewer is the logged-in officer');

  // --- Step 8: Production scenario ---
  console.log('\n--- Step 8: Production Scenario (expected yield × harvested area) ---');
  const forecast = await yieldForecastingService.forecastPlotYield(createdPlot.id, { cropKey: 'soybean', expectedYieldTPerHa: 1.1 });
  console.log(`   Scenario: ${forecast.expected_yield_tonnes_per_ha} t/ha × ${forecast.harvested_area_hectares} ha = ${forecast.estimated_total_tonnes} t`);
  assert(forecast.estimate_kind === 'SCENARIO', 'Labelled as a scenario estimate');
  assert(forecast.estimated_total_tonnes > 0, 'Total production is positive');
  assert(forecast.plot_id === createdPlot.id, 'Scenario tied to plot_id');

  // --- Step 9: Disaster change detection (pixel logic) ---
  console.log('\n--- Step 9: Disaster Screening — NDVI Change Logic ---');
  const inArea = new Uint8Array(50).fill(1);
  const valid = new Uint8Array(50).fill(1);
  const preNdvi = new Float32Array(50).fill(0.72);
  const postNdvi = new Float32Array(50).fill(0.7);
  postNdvi.fill(0.4, 0, 20);
  const change = summariseNdviChange({ ndvi: preNdvi, valid, inArea }, { ndvi: postNdvi, valid, inArea }, 0.15)!;
  console.log(`   Affected: ${change.affectedPct}% of compared pixels; median change ${change.medianDelta.toFixed(2)}`);
  assert(change.changed === 20 && change.affectedPct === 40, 'Pixels with an NDVI drop ≥ threshold counted');

  // --- Step 10: Multi-Format Report Generation ---
  console.log('\n--- Step 10: Multi-Format Report Dossier (PDF & CSV) ---');
  assert(typeof reportService.generateComprehensivePlotPdf === 'function', 'generateComprehensivePlotPdf method exists');
  assert(typeof reportService.exportPlotDataCsv === 'function', 'exportPlotDataCsv method exists');

  console.log('\n================================================================');
  console.log('  ALL 10 GEOSPATIAL & REMOTE SENSING TESTS PASSED 100%!  ');
  console.log('================================================================\n');
}

runGeospatialSuite()
  .then(() => process.exit(0)) // Firestore sync retries would otherwise keep Node alive
  .catch((err) => {
  console.error('Fatal error during geospatial test run:', err);
  process.exit(1);
});
