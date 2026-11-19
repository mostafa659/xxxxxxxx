/* ───────────── per-profile tier thresholds (v3.43 · B2/B10) ─────────────
   Written by `node scripts/calibrate.mjs <results.json>` from a profile's golden-set run (tests/golden/questions/<profile>/*.json). EMPTY on purpose in v3.43:
   no profile ships with a calibrated golden set (300+ human-verified items per profile could not be produced or licensed in this build), so every profile is
   capped at MEDIUM and shows "not calibrated for this subject".
   shape:  CAL["nursing/nclex-rn"] = { calibrated: true, n: 312, thresholds: { high: 0.93, margin: 0.6, medium: 0.7 }, highErr: 0.031 } */
export const CAL = {};
export const DEFAULT_THRESHOLDS = { high: 0.9, margin: 0.5, medium: 0.6 };
