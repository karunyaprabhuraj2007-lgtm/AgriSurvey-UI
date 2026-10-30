/**
 * AgriSurvey AI — offline tests for the crop identification matcher, the disaster change
 * detector, the production scenario and the verification / evaluation loop.
 *
 * Synthetic curves are generated from the crop templates themselves, so these tests check
 * the decision logic, not real-world accuracy (that needs officer-verified fields).
 */

import { mockDb } from '../src/services/mock-db';
import { cropClassificationService } from '../src/services/crop-classification.service';
import { yieldForecastingService } from '../src/services/yield-forecasting.service';
import { summariseNdviChange } from '../src/services/disaster-assessment.service';
import { CROP_PROFILES, SOIL_BASE_NDVI, classifySeason, doubleLogistic, seasonWindow, savgol, gapFill } from '../src/lib/crop-phenology';

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

const DAY = 86400000;
function seriesFor(crop: string, season: 'kharif' | 'rabi', year: number, everyDays: number, fromDay = 0, toDay = Infinity, shift = 0) {
  const w = seasonWindow(season, year);
  const p = CROP_PROFILES[crop];
  const start = new Date(`${w.start}T00:00:00Z`).getTime();
  const out: { date: string; ndvi: number }[] = [];
  for (let d = fromDay; d <= Math.min(w.lengthDays, toDay); d += everyDays) {
    const sos = p.sos + shift;
    out.push({
      date: new Date(start + d * DAY).toISOString().slice(0, 10),
      ndvi: doubleLogistic(d, SOIL_BASE_NDVI, p.peak, sos, sos + p.length, p.kUp, p.kDown),
    });
  }
  return out;
}

async function main() {
  console.log('\n--- 1. Numerical helpers ---');
  const flat = savgol([0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3, 0.3]);
  assert(flat.every((v) => Math.abs(v - 0.3) < 1e-9), 'Savitzky–Golay leaves a constant series unchanged');
  const quad = Array.from({ length: 15 }, (_, i) => 0.01 * i * i);
  assert(savgol(quad).every((v, i) => Math.abs(v - quad[i]) < 1e-9), 'Savitzky–Golay (order 2) reproduces a quadratic exactly');
  const gf = gapFill([0, 10, 20, 30, 40, 50], [0.2, 0.3, 0.4, 0.5, 0.6, 0.7], [0, 5, 10, 15]);
  assert(gf !== null && Math.abs(gf[1] - 0.25) < 1e-9, 'Gap fill interpolates linearly between clear dates');

  console.log('\n--- 2. Matcher verdicts ---');
  const few = classifySeason('kharif', 2025, seriesFor('soybean', 'kharif', 2025, 40));
  assert(few.verdict.status === 'insufficient_observations', `Fewer than 6 clear dates → insufficient (${few.observations.length} dates)`);

  const bare = classifySeason(
    'kharif',
    2025,
    seriesFor('soybean', 'kharif', 2025, 5).map((o) => ({ date: o.date, ndvi: 0.14 + (o.date.charCodeAt(9) % 3) * 0.005 }))
  );
  assert(bare.verdict.status === 'no_match' && bare.verdict.crop === null, `Bare soil all season → no crop (${bare.verdict.status})`);

  let exactHits = 0;
  let wrongMatches = 0;
  for (const crop of ['soybean', 'cotton', 'tur', 'rice', 'maize', 'jowar', 'bajra']) {
    const c = classifySeason('kharif', 2025, seriesFor(crop, 'kharif', 2025, 5));
    if (c.scores[0]?.crop === crop) exactHits++;
    if (c.verdict.status === 'matched' && c.verdict.crop !== crop) wrongMatches++;
    if (c.verdict.status === 'ambiguous') {
      assert(c.verdict.candidates?.includes(crop), `${crop}: ambiguous verdict lists the true crop among candidates`);
    }
  }
  assert(exactHits === 7, `Every noise-free kharif template is its own best fit (${exactHits}/7)`);
  assert(wrongMatches === 0, 'No noise-free template is confidently matched to a different crop');

  const soy = classifySeason('kharif', 2025, seriesFor('soybean', 'kharif', 2025, 5, 0, Infinity, 10));
  assert(soy.scores[0].crop === 'soybean' && soy.scores[0].shiftDays === 10, `Late sowing (+10 d) is recovered by the shift search (${soy.scores[0].shiftDays} d)`);
  assert(soy.phenology !== null && soy.phenology.peakValue > 0.7, 'Phenology reports the measured peak');

  console.log('\n--- 3. Unobserved season edges (monsoon cloud) ---');
  // Sugarcane is green from the first day of the kharif window.
  const caneObserved = classifySeason('kharif', 2025, seriesFor('sugarcane', 'kharif', 2025, 5));
  assert(caneObserved.verdict.status === 'truncated_window', `Green at an observed window start → truncated_window (${caneObserved.verdict.status})`);
  // Soybean seen only from day 60 (cloud before) — the start was never seen.
  const soyLate = classifySeason('kharif', 2025, seriesFor('soybean', 'kharif', 2025, 5, 60));
  assert(soyLate.verdict.status === 'insufficient_observations', `Start of season not observed → insufficient, not truncated (${soyLate.verdict.status})`);
  assert(soyLate.verdict.crop === null, 'No crop is claimed when the start was not observed');
  // Season in progress: data stop at day 70 while the crop is still green.
  const inProgress = classifySeason('kharif', 2025, seriesFor('cotton', 'kharif', 2025, 5, 0, 70));
  assert(inProgress.verdict.crop === null || inProgress.verdict.status === 'ambiguous', `Season cut off at day 70 → no confident crop (${inProgress.verdict.status})`);

  console.log('\n--- 4. Disaster change detection (pixel level) ---');
  const n = 100;
  const inArea = new Uint8Array(n).fill(1);
  inArea.fill(0, 90); // 90 plot pixels
  const valid = new Uint8Array(n).fill(1);
  const postValid = new Uint8Array(n).fill(1);
  postValid.fill(0, 0, 10); // 10 plot pixels cloudy after
  const pre = new Float32Array(n).fill(0.7);
  const post = new Float32Array(n).fill(0.68);
  post.fill(0.3, 10, 40); // 30 compared pixels lose 0.4
  const sum = summariseNdviChange({ ndvi: pre, valid, inArea }, { ndvi: post, valid: postValid, inArea }, 0.15)!;
  assert(sum.plotPixels === 90 && sum.compared === 80, `Only pixels clear on both dates are compared (${sum.compared}/${sum.plotPixels})`);
  assert(sum.changed === 30 && Math.abs(sum.affectedPct - 37.5) < 1e-9, `Affected share = 30/80 = 37.5% (${sum.affectedPct})`);
  assert(Math.abs(sum.medianDelta - -0.02) < 1e-6, `Median change is the typical pixel, not the damaged ones (${sum.medianDelta.toFixed(3)})`);
  const none = summariseNdviChange({ ndvi: pre, valid, inArea }, { ndvi: post, valid: new Uint8Array(n), inArea }, 0.15);
  assert(none === null, 'No pixel clear on both dates → no result (not zero damage)');

  console.log('\n--- 5. Production scenario ---');
  const plot = mockDb.farmPlots.find((p) => p.boundary_coordinates?.length >= 3)!;
  const sc = await yieldForecastingService.forecastPlotYield(plot.id, { cropKey: 'soybean', expectedYieldTPerHa: 1.2, harvestedAreaHa: plot.area_hectares });
  assert(sc.estimate_kind === 'SCENARIO' && sc.yield_source === 'USER_ENTERED', 'Scenario is labelled as a scenario with user-entered yield');
  assert(Math.abs(sc.estimated_total_tonnes - Math.round(1.2 * plot.area_hectares * 100) / 100) < 0.011, `Production = 1.2 t/ha × ${plot.area_hectares} ha (${sc.estimated_total_tonnes} t)`);
  let rejected = false;
  try {
    await yieldForecastingService.forecastPlotYield(plot.id, { cropKey: 'soybean', expectedYieldTPerHa: 1.2, harvestedAreaHa: plot.area_hectares * 3 });
  } catch {
    rejected = true;
  }
  assert(rejected, 'Harvested area larger than the plot is rejected');

  console.log('\n--- 6. Verification and evaluation ---');
  const record = await cropClassificationService.classifyFromObservations(plot.id, 'kharif', 2025, seriesFor('bajra', 'kharif', 2025, 5), 'synthetic test series');
  assert(record.verification_status === 'AI_PREDICTION' && record.observations.length > 0, `Saved prediction keeps its observations (${record.verdict_status})`);
  const before = cropClassificationService.evaluate();

  mockDb.setCurrentUserByRole('farmer');
  let farmerBlocked = false;
  try {
    await cropClassificationService.verifyCropPrediction({ predictionId: record.id, verifiedCrop: 'bajra', reviewerNotes: 'self-declared' });
  } catch {
    farmerBlocked = true;
  }
  assert(farmerBlocked, 'A farmer cannot record ground verification');

  mockDb.setCurrentUserByRole('tahsildar');
  let notesRequired = false;
  try {
    await cropClassificationService.verifyCropPrediction({ predictionId: record.id, verifiedCrop: 'bajra', reviewerNotes: '  ' });
  } catch {
    notesRequired = true;
  }
  assert(notesRequired, 'Verification requires a note on how it was verified');

  const v = await cropClassificationService.verifyCropPrediction({ predictionId: record.id, verifiedCrop: 'bajra', reviewerNotes: 'Field visit, test' });
  assert(v.verified_crop === 'bajra' && v.reviewer_name === mockDb.currentUser.full_name, 'Verification records the crop and the logged-in officer');
  assert(
    v.verification_status === (record.predicted_crop === 'bajra' ? 'CONFIRMED' : 'DISCREPANCY_MARKED'),
    `Status reflects agreement with the satellite verdict (${v.verification_status})`
  );
  const after = cropClassificationService.evaluate();
  assert(after.verified === before.verified + 1, 'Evaluation counts the newly verified record');
  assert(
    cropClassificationService.getTrainingSamples().some((s) => s.prediction_id === record.id && s.observations.length === record.observations.length),
    'A labelled training sample (NDVI series + ground crop) is stored'
  );
  if (after.answered === 0) assert(after.accuracy === null, 'Accuracy is null (not invented) when nothing has been answered');

  console.log(failures ? `\n${failures} ML TEST(S) FAILED\n` : '\nALL ML MODEL TESTS PASSED\n');
  // Firestore sync retries keep Node alive; exit explicitly like the other suites.
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
