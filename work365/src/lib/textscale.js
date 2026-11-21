/* ───────────── Text size — one independent size per text block ─────────────
   Every block of text in the app (a result card, a chat answer, an exam question, the word list …) has its own "Aa" button.
   The size it sets belongs to THAT block only: nothing else on the screen, and no other block, changes.

   • id       → which block ("q:explanation", "l:tricks", "chat:<message id>", "words:dictionary" …)
   • scale    → a plain multiplier (1 = the normal size of that block). The block's wrapper gets  style="--ts: <scale>"  and the
                rules at the end of styles.css (".ts-box") multiply that block's own font sizes by it.
   • stored   → one small JSON object in localStorage, so the sizes survive closing the app; written at most once per change.
   A block that was never touched has no entry (and costs nothing). Setting a block back to 1 deletes its entry. */

import { useSyncExternalStore, useCallback } from "react";
import { prefs } from "./storage.js";

export const STEPS = [0.8, 0.9, 1, 1.12, 1.25, 1.4, 1.6, 1.85, 2.1];
export const MIN_SCALE = STEPS[0];
export const MAX_SCALE = STEPS[STEPS.length - 1];
const KEY = "clinix:ts:v1";
const MAX_ENTRIES = 400;     // chat answers come and go: the oldest entries are dropped, the list can never grow without limit

const clamp = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));
/* the step closest to a value (so a stored 1.1 or a hand-edited 1.33 still lands on a real step) */
export const nearestStep = (v) => STEPS.reduce((best, s) => (Math.abs(s - v) < Math.abs(best - v) ? s : best), STEPS[2]);

function read() {
  try {
    const raw = JSON.parse(prefs.get(KEY, "{}"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out = {};
    Object.keys(raw).forEach((k) => { const n = Number(raw[k]); if (Number.isFinite(n) && n !== 1) out[k] = clamp(n); });
    return out;
  } catch (e) { return {}; }
}

let map = read();
const subs = new Set();
const persist = () => {
  const keys = Object.keys(map);
  if (keys.length > MAX_ENTRIES) keys.slice(0, keys.length - MAX_ENTRIES).forEach((k) => { delete map[k]; });
  prefs.set(KEY, JSON.stringify(map));
};

export const getScale = (id) => (id && map[id]) || 1;

export function setScale(id, value) {
  if (!id) return;
  const v = clamp(Number(value) || 1);
  if (v === getScale(id)) return;
  map = { ...map };
  if (v === 1) delete map[id]; else map[id] = v;
  persist();
  subs.forEach((f) => f());
}

/* one step bigger / smaller; returns the new scale */
export function stepScale(id, dir) {
  const cur = nearestStep(getScale(id));
  const i = STEPS.indexOf(cur);
  const next = STEPS[Math.min(STEPS.length - 1, Math.max(0, i + (dir > 0 ? 1 : -1)))];
  setScale(id, next);
  return next;
}

const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };

/* [scale, api] — re-renders ONLY the components that read this id */
export function useTextScale(id) {
  const scale = useSyncExternalStore(subscribe, () => getScale(id), () => 1);
  const inc = useCallback(() => stepScale(id, 1), [id]);
  const dec = useCallback(() => stepScale(id, -1), [id]);
  const reset = useCallback(() => setScale(id, 1), [id]);
  return [scale, { inc, dec, reset, set: (v) => setScale(id, v), canInc: scale < MAX_SCALE - 1e-6, canDec: scale > MIN_SCALE + 1e-6 }];
}

/* the wrapper's inline style: nothing at all while the block is at its normal size */
export const scaleStyle = (scale) => (scale && scale !== 1 ? { "--ts": scale } : undefined);

/* test hook */
export const _reset = () => { map = {}; subs.forEach((f) => f()); };
