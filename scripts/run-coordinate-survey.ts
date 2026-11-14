/**
 * AgriSurvey AI — run the Coordinate Crop Survey from the command line.
 *
 * Same engine as /gis/crop-survey → "Coordinate Survey (Excel)": every point in the sheet
 * is read on real Sentinel-2 L2A imagery (Earth Search STAC + COG range reads, no account
 * needed) and the answers are written back into a copy of the workbook.
 *
 *   npx tsx scripts/run-coordinate-survey.ts <sheet.xlsx|csv> [options]
 *
 * Options
 *   --year 2026              kharif season year (default: 2026)
 *   --crops soybean,cotton,tur,jowar
 *                            crop templates to consider (default: Akola set when the sheet
 *                            mentions Akola, otherwise every kharif template)
 *   --radius 20              sampled radius around each point, metres (10 / 20 / 30)
 *   --concurrency 3          points analysed in parallel
 *   --out <file.xlsx>        output path (default: <sheet>_AgriSurvey_filled.xlsx)
 *
 * Needs Node 18+ and internet access to earth-search.aws.element84.com and
 * sentinel-cogs.s3.us-west-2.amazonaws.com. Satellite image chips are embedded when
 * @napi-rs/canvas is installed (npm i -D @napi-rs/canvas); otherwise they are skipped.
 * Progress is checkpointed to <out>.progress.json so an interrupted run resumes.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { SEASONS } from '../src/lib/crop-phenology';
import { PointResult, applyYields, defaultWindows, markDuplicates, parseSurveyRows } from '../src/lib/coordinate-survey';

// ---------------------------------------------------------------------------
// Canvas for Node: the COG reader renders PNG chips with a <canvas>
// ---------------------------------------------------------------------------
let chips = false;
async function installCanvas() {
  try {
    const mod = (await import('@napi-rs/canvas' as string)) as {
      createCanvas: (w: number, h: number) => { getContext: (k: string) => unknown; toDataURL: (t?: string) => string };
      ImageData: unknown;
    };
    (globalThis as Record<string, unknown>).ImageData = mod.ImageData;
    (globalThis as Record<string, unknown>).document = {
      createElement: (tag: string) => {
        if (tag !== 'canvas') throw new Error(`document.createElement(${tag}) not available in Node`);
        let c = mod.createCanvas(1, 1);
        const el = {
          set width(w: number) {
            c = mod.createCanvas(w, (c as unknown as { height: number }).height);
          },
          set height(h: number) {
            c = mod.createCanvas((c as unknown as { width: number }).width, h);
          },
          getContext: (k: string) => c.getContext(k),
          toDataURL: (t?: string) => c.toDataURL(t ?? 'image/png'),
        };
        return el;
      },
    };
    chips = true;
  } catch {
    // No canvas: statistics still work, image chips are left out.
    (globalThis as Record<string, unknown>).ImageData = class {
      constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
    };
    (globalThis as Record<string, unknown>).document = {
      createElement: () => ({ width: 0, height: 0, getContext: () => ({ putImageData() {} }), toDataURL: () => '' }),
    };
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const sheetPath = process.argv[2];
  if (!sheetPath || sheetPath.startsWith('--')) {
    console.error('Usage: npx tsx scripts/run-coordinate-survey.ts <sheet.xlsx|csv> [--year 2026] [--crops soybean,cotton,tur,jowar] [--radius 20] [--out file.xlsx]');
    process.exit(2);
  }
  await installCanvas();
  // Imported after the canvas shim so module-level code sees it.
  const { runCoordinateSurvey, buildFilledWorkbook, worksheetRows } = await import('../src/services/coordinate-survey.service');

  const year = Number(arg('year') ?? 2026);
  const radiusM = Number(arg('radius') ?? 20);
  const concurrency = Number(arg('concurrency') ?? 3);
  const buf = await fs.readFile(sheetPath);
  const fileName = path.basename(sheetPath);
  const isCsv = /\.csv$/i.test(sheetPath);

  if (isCsv) throw new Error('CSV input: open it in Excel and save as .xlsx (or use the web module, which reads CSV).');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const ws = wb.worksheets.reduce((best, w) =>
    parseSurveyRows(worksheetRows(w)).points.length > parseSurveyRows(worksheetRows(best)).points.length ? w : best
  );
  const rows = worksheetRows(ws);
  const sheetName = ws.name;
  const parsed = parseSurveyRows(rows);
  const points = markDuplicates(parsed.points);
  if (!points.length) throw new Error(parsed.warnings.join(' ') || 'No coordinates found in the sheet.');

  const isAkola = /akola/i.test(`${parsed.layout.title ?? ''} ${fileName}`);
  const crops = arg('crops')?.split(',').map((s) => s.trim()) ?? (isAkola ? ['soybean', 'cotton', 'tur', 'jowar'] : SEASONS.kharif.crops);
  const windows = defaultWindows(year);
  const out = arg('out') ?? path.join(path.dirname(sheetPath), fileName.replace(/\.(xlsx|csv)$/i, '') + '_AgriSurvey_filled.xlsx');
  const progressFile = `${out}.progress.json`;

  console.log(`${parsed.layout.title ?? fileName}`);
  console.log(`${points.length} points (${points.filter((p) => p.sameAs !== undefined).length} repeat an earlier point within 10 m)`);
  for (const w of parsed.warnings) console.log(`note: ${w}`);
  console.log(`kharif ${year} · windows ${windows.map((w) => w.label).join(' and ')} · radius ${radiusM} m · crops ${crops.join(', ')}`);
  console.log(chips ? 'image chips: on' : 'image chips: off (npm i -D @napi-rs/canvas to embed them)');

  // Resume from checkpoint
  const done = new Map<number, PointResult>();
  try {
    const saved = JSON.parse(await fs.readFile(progressFile, 'utf8')) as PointResult[];
    for (const r of saved) if (r.status === 'done') done.set(r.point.srNo, r);
    if (done.size) console.log(`resuming: ${done.size} points already analysed (${progressFile})`);
  } catch {
    /* fresh run */
  }
  const todo = points.filter((p) => !done.has(p.srNo) && !(p.sameAs !== undefined && done.has(p.sameAs)));
  for (const p of points) if (!done.has(p.srNo) && p.sameAs !== undefined && done.has(p.sameAs)) done.set(p.srNo, { ...done.get(p.sameAs)!, point: p });

  const t0 = Date.now();
  let n = 0;
  const checkpoint = () => fs.writeFile(progressFile, JSON.stringify([...done.values()].map((r) => ({ ...r, images: chips ? r.images : [] }))));

  if (todo.length) {
    await runCoordinateSurvey(todo, {
      season: 'kharif',
      year,
      windows,
      radiusM,
      crops,
      concurrency,
      onPointDone: async (r) => {
        n++;
        if (!chips) r.images = [];
        if (r.status === 'done') done.set(r.point.srNo, r);
        const mins = (Date.now() - t0) / 60000;
        const eta = Math.round((mins / n) * (todo.length - n));
        console.log(
          `[${String(n).padStart(2)}/${todo.length}] #${r.point.srNo} ` +
            (r.status === 'error' ? `FAILED: ${r.error}` : `${r.crop?.cell} | ${r.observations.length} clear passes`) +
            (n < todo.length ? ` · ~${eta} min left` : '')
        );
        await checkpoint();
      },
    });
  }

  const failed = points.filter((p) => !done.has(p.srNo));
  const results = applyYields(
    points.map(
      (p) =>
        done.get(p.srNo) ?? {
          point: p,
          status: 'error' as const,
          error: 'Not analysed (network error); re-run the command to retry.',
          observations: [],
          passes: [],
          crop: null,
          windows: [],
          yield: null,
          images: [],
        }
    )
  );

  const blob = await buildFilledWorkbook({
    sheet: { ...parsed, points, fileName, kind: 'xlsx', sheetName, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer },
    results,
    windows,
    season: 'kharif',
    year,
    radiusM,
    crops,
    generatedBy: 'AgriSurvey AI — Coordinate Crop Survey (command-line runner)',
  });
  await fs.writeFile(out, Buffer.from(await blob.arrayBuffer()));
  console.log(`\nwrote ${out}`);
  if (failed.length) console.log(`${failed.length} points failed (${failed.map((p) => `#${p.srNo}`).join(', ')}); run the same command again to retry them.`);

  console.log('\nSr | Crop | ' + windows.map((w) => w.label).join(' | ') + ' | Yield kg/ha');
  for (const r of results) {
    if (r.status === 'error') console.log(`${r.point.srNo} | ${r.error}`);
    else console.log(`${r.point.srNo} | ${r.crop?.cell} | ${r.windows.map((w) => w.cell).join(' | ')} | ${r.yield?.estimate ?? '—'}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
