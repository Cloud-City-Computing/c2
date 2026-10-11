import { readFileSync } from 'node:fs';
import { banners } from '/home/kadams/Repos/c2-wt/w6-cdx-29-admin-surfaces/cloudcodex/tests/design/buckets.js';
import { scanRawColorLiterals, scanAccentRampPositions, scanSuppressedOutlines } from '/home/kadams/Repos/c2-wt/w6-cdx-29-admin-surfaces/cloudcodex/vendor/cloud-city-design/gates/token-discipline.mjs';
const file = process.argv[2];
const src = readFileSync(file, 'utf8');
const marks = banners(src);
const f = [...scanRawColorLiterals(src, file), ...scanAccentRampPositions(src, file), ...scanSuppressedOutlines(src, file)];
const want = new RegExp(process.argv[3] ?? '.');
const lines = src.split('\n');
for (const x of f.sort((a,b)=>a.line-b.line)) {
  const mark = marks.filter(b => b.line <= x.line).pop();
  if (!mark || !want.test(mark.name)) continue;
  console.log(`${String(x.line).padStart(5)} [${mark.name.slice(0,18)}] ${lines[x.line-1].trim().slice(0,150)}`);
}
