/**
 * AgriSurvey AI — offline tests for the coordinate crop survey module.
 *
 * Covers sheet parsing (the Akola template layout, typos and duplicates), the crop decision
 * on synthetic kharif curves (short crop, long-duration crop still in field, double crop,
 * fallow, cloud gaps), window assessment, yield ranking and the Excel round-trip.
 *
 * Synthetic curves come from the crop templates themselves, so these tests check the
 * decision logic, not real-world accuracy.
 *
 *   npx tsx scripts/test-coordinate-survey.ts [path/to/sheet.xlsx]
 */

import ExcelJS from 'exceljs';
import { CROP_PROFILES, SOIL_BASE_NDVI, doubleLogistic, seasonWindow } from '../src/lib/crop-phenology';
import {
  PointObservation,
  SurveyPoint,
  applyYields,
  assessWindow,
  defaultWindows,
  identifyCrop,
  interpretPoint,
  markDuplicates,
  parseSurveyRows,
} from '../src/lib/coordinate-survey';
import { buildFilledWorkbook, worksheetRows, LoadedSheet, runCoordinateSurvey, SurveyDeps } from '../src/services/coordinate-survey.service';
import type { SatelliteScene } from '../src/types';
import type { SceneClip } from '../src/lib/sentinel-cog';

let failures = 0;
function assert(cond: unknown, msg: string) {
  if (cond) console.log(`  ✓ ${msg}`);
  else {
    failures++;
    console.error(`  ✗ ${msg}`);
  }
}

const DAY = 86400000;
const YEAR = 2026;
const TODAY = '2026-11-14';
const W = seasonWindow('kharif', YEAR);
const start = new Date(`${W.start}T00:00:00Z`).getTime();
const iso = (d: number) => new Date(start + d * DAY).toISOString().slice(0, 10);

function obs(date: string, ndvi: number): PointObservation {
  return { date, sceneId: `S2_TEST_${date}`, tile: '43QEA', clearPct: 100, validPixels: 12, ndvi, evi: ndvi * 0.8, savi: ndvi * 0.7, ndmi: ndvi - 0.35, ndwi: -ndvi * 0.6, ndre: ndvi * 0.5, gcvi: ndvi * 4 };
}

/** Template curve sampled every `every` days up to TODAY, optionally skipping a cloud gap. */
function series(crop: string, opts: { every?: number; shift?: number; scale?: number; gap?: [number, number]; until?: string } = {}) {
  const p = CROP_PROFILES[crop];
  const out: PointObservation[] = [];
  const until = opts.until ?? TODAY;
  for (let d = 3; iso(d) <= until && d <= W.lengthDays; d += opts.every ?? 5) {
    if (opts.gap && d >= opts.gap[0] && d <= opts.gap[1]) continue;
    const s = opts.shift ?? 0;
    const v = doubleLogistic(d, SOIL_BASE_NDVI, p.peak * (opts.scale ?? 1), p.sos + s, p.sos + s + p.length, p.kUp, p.kDown);
    out.push(obs(iso(d), Number(v.toFixed(4))));
  }
  return out;
}

async function main() {
  const sheetPath = process.argv[2] ?? 'GM-ML-V2/data/Crop_Coordinates_for_Akola.xlsx';

  console.log('\n1. Sheet parsing');
  const wb = new ExcelJS.Workbook();
  let haveSheet = true;
  try {
    await wb.xlsx.readFile(sheetPath);
  } catch {
    haveSheet = false;
    console.log(`  (skipped: ${sheetPath} not found)`);
  }
  let loaded: LoadedSheet | null = null;
  if (haveSheet) {
    const ws = wb.worksheets[0];
    const parsed = parseSurveyRows(worksheetRows(ws));
    const points = markDuplicates(parsed.points);
    assert(points.length === 45, `45 points read (got ${points.length})`);
    assert(points[0].srNo === 1 && Math.abs(points[0].lat - 20.4749166) < 1e-9 && Math.abs(points[0].lon - 77.1115283) < 1e-9, 'point 1 coordinates exact');
    assert(points[0].row === 4, `point 1 is on worksheet row 4 (got ${points[0].row})`);
    assert(parsed.layout.cropCol === 2 && parsed.layout.window1Col === 3 && parsed.layout.window2Col === 4 && parsed.layout.yieldCol === 5, `answer columns C–F detected (${JSON.stringify(parsed.layout)})`);
    assert(parsed.warnings.some((w) => /July to August/.test(w)), 'header typo on the August column is flagged');
    const twins = points.filter((p) => p.sameAs !== undefined).map((p) => `${p.srNo}→${p.sameAs}`);
    assert(JSON.stringify(twins) === JSON.stringify(['29→28', '35→34', '37→36', '43→42']), `duplicates within 10 m: ${twins.join(', ')}`);
    const buf = await (await import('node:fs/promises')).readFile(sheetPath);
    loaded = { ...parsed, points, fileName: 'Crop_Coordinates_for_Akola.xlsx', kind: 'xlsx', sheetName: ws.name, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }

  const csvLike = parseSurveyRows([
    ['Sr', 'Latitude', 'Longitude'],
    [1, 20.1, 77.2],
    [2, '', ''],
    [3, 20.3, 77.4],
  ]);
  assert(csvLike.points.length === 2 && csvLike.points[1].srNo === 3, 'separate Latitude / Longitude columns parsed, blanks skipped');

  console.log('\n2. Crop identification on synthetic kharif curves (season to 14 Nov)');
  const soy = identifyCrop(series('soybean'), 'kharif', YEAR, TODAY);
  assert(soy.crop === 'soybean' && (soy.status === 'matched' || soy.status === 'ambiguous'), `soybean → ${soy.cell} [${soy.status}]`);

  const akolaCrops = ['soybean', 'cotton', 'tur', 'jowar'];
  const soyA = identifyCrop(series('soybean'), 'kharif', YEAR, TODAY, akolaCrops);
  assert(soyA.crop === 'soybean' && soyA.status === 'matched', `soybean, Akola crop list → ${soyA.cell} [${soyA.status}]`);

  const cot = identifyCrop(series('cotton'), 'kharif', YEAR, TODAY);
  assert((cot.crop === 'cotton' || cot.crop === 'tur') && cot.confidence !== 'none', `cotton still green → ${cot.cell} [${cot.status}]`);
  assert(!/soybean/i.test(cot.cell), 'a field green in November is never called soybean');

  const tur = identifyCrop(series('tur'), 'kharif', YEAR, TODAY);
  assert(tur.crop === 'tur' || tur.crop === 'cotton', `tur → ${tur.cell} [${tur.status}]`);

  // Soybean harvested, then a rabi crop sown from ~day 125
  const dbl = series('soybean').map((o) => {
    const d = Math.round((new Date(`${o.date}T00:00:00Z`).getTime() - start) / DAY);
    const second = d > 120 ? doubleLogistic(d, 0, 0.55, 140, 260, 0.15, 0.1) : 0;
    return { ...o, ndvi: Number((o.ndvi + second).toFixed(4)) };
  });
  const dc = identifyCrop(dbl, 'kharif', YEAR, TODAY);
  assert(dc.crop === 'soybean' && /second crop/.test(dc.cell), `soybean + second sowing → ${dc.cell} [${dc.status}]`);

  const fallow = identifyCrop(series('soybean').map((o) => ({ ...o, ndvi: 0.16 + (o.date.charCodeAt(9) % 3) * 0.01 })), 'kharif', YEAR, TODAY);
  assert(fallow.crop === null && /No crop detected/.test(fallow.cell), `flat low NDVI → ${fallow.cell}`);

  const sparse = identifyCrop(series('soybean', { every: 40 }), 'kharif', YEAR, TODAY);
  assert(sparse.crop === null && /Not determined/.test(sparse.cell), `4 clear dates → ${sparse.cell}`);

  console.log('\n3. Window assessment');
  const [jul, aug] = defaultWindows(YEAR);
  const soyObs = series('soybean');
  const a1 = assessWindow(jul, soyObs, { min: 0.15, max: 0.82 });
  assert(a1.basis === 'observed' && a1.ndvi !== null, `July window observed: ${a1.cell}`);
  const a2 = assessWindow(aug, soyObs, { min: 0.15, max: 0.82 });
  assert(a2.ndvi !== null && a2.ndvi > a1.ndvi!, `August greener than July for soybean: ${a2.cell}`);

  // Monsoon gap 5 Jul – 10 Aug (days 25–61): July must be "none" (gap > 15 d both sides)
  const cloudy = series('soybean', { gap: [25, 61] });
  const c1 = assessWindow(jul, cloudy, null);
  assert(c1.basis === 'none' && /No cloud-free/.test(c1.cell), `long cloud gap → ${c1.cell}`);
  // Short gap 12 Jul – 28 Jul (days 32–48) → interpolated
  const shortGap = series('soybean', { gap: [32, 48] });
  const c2 = assessWindow(jul, shortGap, null);
  assert(c2.basis === 'interpolated' && /estimated/.test(c2.cell), `short gap → ${c2.cell}`);
  // Only a pass 2 days after the window → adjacent
  const adj = [obs('2026-07-27', 0.4), obs('2026-06-20', 0.2), obs('2026-09-01', 0.7)];
  const c3 = assessWindow(jul, adj, null);
  assert(c3.basis === 'adjacent', `pass 2 days outside window used as adjacent: ${c3.cell}`);
  const wet = assessWindow(jul, [{ ...obs('2026-07-20', 0.25), ndwi: 0.2 }], null);
  assert(/water/.test(wet.cell), 'standing water flagged');

  console.log('\n4. Yield ranking');
  const windows = defaultWindows(YEAR);
  const pts: SurveyPoint[] = Array.from({ length: 8 }, (_, i) => ({ srNo: i + 1, lat: 20.5 + i * 0.01, lon: 77, row: 4 + i }));
  const results = applyYields(
    pts.map((p, i) => interpretPoint(p, series('soybean', { scale: 0.7 + i * 0.05 }), [], windows, 'kharif', YEAR, TODAY))
  );
  const ys = results.map((r) => r.yield?.estimate ?? NaN);
  assert(ys.every(Number.isFinite), `every soybean field gets a yield (${ys.join(', ')})`);
  assert(ys[7] > ys[0], 'greener season → higher yield estimate');
  assert(results.every((r) => r.yield!.estimate! >= 550 * 0.85 && r.yield!.estimate! <= 1600 * 1.15), 'estimates stay inside the regional range');
  assert(results.every((r) => r.yield!.low! <= r.yield!.estimate! && r.yield!.estimate! <= r.yield!.high!), 'low ≤ estimate ≤ high');

  if (loaded) {
    console.log('\n5. Excel round-trip into the client template');
    const all = loaded.points.map((p, i) => {
      const kind = ['soybean', 'cotton', 'tur'][i % 3];
      const r = interpretPoint(p, series(kind, { scale: 0.85 + (i % 5) * 0.04 }), [], windows, 'kharif', YEAR, TODAY);
      r.images = [{ window: windows[0].label, date: '2026-07-20', trueColor: TINY_PNG, ndvi: TINY_PNG }];
      return r;
    });
    const filled = applyYields(all);
    const blob = await buildFilledWorkbook({ sheet: loaded, results: filled, windows, season: 'kharif', year: YEAR, radiusM: 20 });
    const back = new ExcelJS.Workbook();
    await back.xlsx.load(await blob.arrayBuffer());
    const ws = back.worksheets[0];
    assert(ws.getCell('A1').text.startsWith('Coordinates of Crops'), 'original title kept');
    assert(ws.getCell('B4').text === '20.4749166,77.1115283', 'original coordinates untouched');
    assert(ws.getCell('C4').text.length > 0 && ws.getCell('D4').text.includes('NDVI') && ws.getCell('E4').text.includes('NDVI'), `row 4 filled: ${ws.getCell('C4').text} | ${ws.getCell('D4').text}`);
    assert(typeof ws.getCell('F4').value === 'number', `yield is a number (${ws.getCell('F4').value})`);
    assert(ws.getCell('C48').text.length > 0, 'last point (row 48) filled');
    const names = back.worksheets.map((s) => s.name);
    for (const n of ['Point details', 'Raw observations', 'All passes read', 'Vegetation indices', 'Method & limitations', 'Satellite images']) {
      assert(names.includes(n), `sheet "${n}" present`);
    }
    assert(back.getWorksheet('Raw observations')!.rowCount > 100, 'raw observations exported');
    const fs = await import('node:fs/promises');
    await fs.mkdir('/tmp/coordinate-survey-test', { recursive: true });
    await fs.writeFile('/tmp/coordinate-survey-test/filled-synthetic.xlsx', Buffer.from(await blob.arrayBuffer()));
    console.log('  (wrote /tmp/coordinate-survey-test/filled-synthetic.xlsx — synthetic values, for layout review only)');
  }

  console.log('\n6. Runner with mocked Sentinel-2 access (bins, windows, twins, errors)');
  {
    const scenes: SatelliteScene[] = [];
    for (let d = 1; iso(d) <= '2026-11-13'; d += 5) {
      scenes.push({
        id: `s${d}`,
        scene_id: `S2X_43QEA_${iso(d).replace(/-/g, '')}`,
        collection: 'sentinel-2-l2a',
        acquisition_datetime: `${iso(d)}T05:30:00Z`,
        cloud_cover_percentage: (d * 37) % 100,
        footprint_coordinates: [],
        assets: {},
        mgrs_tile: '43QEA',
        created_at: '',
      });
    }
    let reads = 0;
    const deps: SurveyDeps = {
      searchSeason: async (p) => {
        if (p.point.lat > 21.5) throw new Error('Earth Search STAC HTTP 503');
        return scenes.filter((s) => s.acquisition_datetime.slice(0, 10) >= p.startDate && s.acquisition_datetime.slice(0, 10) <= p.endDate);
      },
      loadClip: async (scene, area) => {
        reads++;
        const date = scene.acquisition_datetime.slice(0, 10);
        const d = Math.round((new Date(`${date}T00:00:00Z`).getTime() - start) / DAY);
        if (date >= '2026-09-01' && date <= '2026-09-08') throw new Error('COG read timeout');
        const lat = area.kind === 'circle' ? area.center.lat : 0;
        const crop = lat < 20.55 ? 'soybean' : 'cotton';
        const p = CROP_PROFILES[crop];
        const ndvi = doubleLogistic(d, SOIL_BASE_NDVI, p.peak, p.sos, p.sos + p.length, p.kUp, p.kDown);
        // monsoon: most passes cloudy from 25 Jun to 10 Aug, but 21 Jul and 20 Aug clear
        const cloudy = date >= '2026-06-25' && date <= '2026-08-10' && date !== '2026-07-21';
        const clear = cloudy ? 20 : 95;
        return {
          stats: {
            ndviMean: ndvi, ndviMedian: ndvi, ndviMin: ndvi, ndviMax: ndvi, ndviStd: 0,
            saviMean: ndvi * 0.7, gcviMean: ndvi * 4, ndreMean: ndvi * 0.5, eviMean: ndvi * 0.8, ndmiMean: ndvi - 0.3, ndwiMean: -ndvi * 0.6,
            totalPixels: 13, validPixels: Math.round(13 * clear / 100), validCoveragePct: clear, cloudOrShadowPct: 100 - clear, noDataPct: 0,
          },
          trueColorUrl: TINY_PNG, falseColorUrl: TINY_PNG, ndviUrl: TINY_PNG,
        } as unknown as SceneClip;
      },
    };
    const pts = markDuplicates([
      { srNo: 1, lat: 20.5, lon: 77.0, row: 4 },
      { srNo: 2, lat: 20.50003, lon: 77.0, row: 5 },
      { srNo: 3, lat: 20.7, lon: 77.1, row: 6 },
      { srNo: 4, lat: 21.9, lon: 77.1, row: 7 },
    ]);
    const done: number[] = [];
    const res = await runCoordinateSurvey(pts, {
      season: 'kharif', year: YEAR, windows, radiusM: 20, crops: ['soybean', 'cotton', 'tur', 'jowar'], concurrency: 2, deps,
      onPointDone: (r) => done.push(r.point.srNo),
    });
    assert(res.length === 4 && done.length === 4, `all 4 points reported (${done.join(',')})`);
    const [r1, r2, r3, r4] = res;
    assert(r1.crop?.crop === 'soybean', `point 1 soybean → ${r1.crop?.cell}`);
    assert(r3.crop?.crop === 'cotton' || r3.crop?.crop === 'tur', `point 3 long-duration → ${r3.crop?.cell}`);
    assert(r2.point.sameAs === 1 && r2.crop?.cell === r1.crop?.cell && r2.point.srNo === 2, 'point 2 (3 m from #1) reuses #1 result');
    assert(r4.status === 'error' && /503/.test(r4.error ?? ''), `STAC failure isolated to its point: ${r4.error}`);
    assert(r1.windows[0].basis === 'observed' && r1.windows[0].observations[0].date === '2026-07-21', `July window uses the 21 Jul clear pass: ${r1.windows[0].cell}`);
    assert(r1.windows[1].basis === 'observed', `August window observed: ${r1.windows[1].cell}`);
    assert(r1.passes.some((p) => p.note === 'COG read timeout') && !r1.observations.some((o) => o.date >= '2026-09-01' && o.date <= '2026-09-08'), 'failed read logged, not used');
    assert(r1.passes.some((p) => !p.used && /clear/.test(p.note ?? '')), 'cloudy passes logged as unused');
    assert(r1.images.length === 2, 'image chips kept for both windows');
    assert(r1.yield?.estimate != null, `yield estimated (${r1.yield?.estimate})`);
    const perPoint = reads / 2;
    assert(perPoint < 40, `about ${Math.round(perPoint)} clip reads per point (bounded)`);
  }

  console.log(failures ? `\n${failures} FAILED` : '\nAll coordinate survey tests passed');
  process.exit(failures ? 1 : 0);
}

// 2×2 green PNG
const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGNk+M/AwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==';

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
