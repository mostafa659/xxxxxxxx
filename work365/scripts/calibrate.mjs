#!/usr/bin/env node
/* ───────────── tier calibration from a golden-set RUN (v3.43 · B10) ─────────────
   usage: node scripts/calibrate.mjs <profile> <results.json> [--min-n 300]
   results.json = [{ id, p1, margin, correct:true|false }] — one row per golden question, produced by running the solve request on tests/golden/questions/<profile>/*.json
   Prints the risk-coverage curve and accuracy per tier, picks the thresholds where the HIGH tier reaches the target precision (default 97 %), and prints the CAL entry
   for src/lib/calibration.js. With fewer than min-n rows the profile stays UNCALIBRATED. Never prints "zero errors". */
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export function riskCoverage(rows) {
  const s = [...rows].sort((a, b) => b.p1 - a.p1);
  let ok = 0; const out = [];
  s.forEach((r, i) => { ok += r.correct ? 1 : 0; out.push({ coverage: (i + 1) / s.length, accuracy: ok / (i + 1), p1: r.p1 }); });
  return out;
}
export function pickThresholds(rows, { target = 0.97, minN = 300, minHigh = 30 } = {}) {
  const calibrated = rows.length >= minN;
  const grid = [0.99, 0.97, 0.95, 0.93, 0.9, 0.85, 0.8];
  let chosen = null;
  for (const hi of grid) for (const mg of [0.7, 0.6, 0.5, 0.4]) {
    const set = rows.filter((r) => r.p1 >= hi && r.margin >= mg);
    if (set.length < minHigh) continue;
    const acc = set.filter((r) => r.correct).length / set.length;
    if (acc >= target && (!chosen || set.length > chosen.n)) chosen = { high: hi, margin: mg, n: set.length, acc };
  }
  const med = rows.filter((r) => r.p1 >= 0.6);
  const tiers = (hi) => ({ HIGH: rows.filter((r) => hi && r.p1 >= hi.high && r.margin >= hi.margin), MEDIUM: rows.filter((r) => !(hi && r.p1 >= hi.high && r.margin >= hi.margin) && r.p1 >= 0.6), LOW: rows.filter((r) => r.p1 < 0.6) });
  const t = tiers(chosen);
  const acc = (a) => (a.length ? Math.round((a.filter((r) => r.correct).length / a.length) * 1000) / 10 : null);
  return { calibrated: calibrated && !!chosen, n: rows.length, thresholds: chosen ? { high: chosen.high, margin: chosen.margin, medium: 0.6 } : null, highErr: chosen ? Math.round((1 - chosen.acc) * 1000) / 1000 : null, accuracyPerTier: { HIGH: acc(t.HIGH), MEDIUM: acc(t.MEDIUM), LOW: acc(t.LOW) }, sizes: { HIGH: t.HIGH.length, MEDIUM: t.MEDIUM.length, LOW: t.LOW.length }, mediumRows: med.length };
}
const main = () => {
  const [profile, file] = process.argv.slice(2);
  if (!profile || !file) { console.error("usage: calibrate.mjs <profile> <results.json>"); process.exit(2); }
  const rows = JSON.parse(fs.readFileSync(file, "utf8"));
  const r = pickThresholds(rows);
  console.log("accuracy per tier (%):", r.accuracyPerTier, "sizes:", r.sizes);
  console.log("risk-coverage (every 10th row):"); riskCoverage(rows).filter((_, i) => i % 10 === 0).forEach((x) => console.log(`  coverage ${(x.coverage * 100).toFixed(0)}%  accuracy ${(x.accuracy * 100).toFixed(1)}%`));
  console.log(r.calibrated ? `CAL[${JSON.stringify(profile)}] = ${JSON.stringify({ calibrated: true, n: r.n, thresholds: r.thresholds, highErr: r.highErr })};` : `NOT calibrated (n=${r.n}, need ≥300 and a HIGH tier that reaches the target); the profile stays capped at MEDIUM.`);
};
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
