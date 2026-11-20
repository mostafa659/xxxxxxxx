/* ───────────── The dictionary: only words the student classified ─────────────
   level  2 = مهمة جدا (very important)   1 = مهمة (important)   -1 = مش مهمة (skipped, never saved)
   The dictionary shows levels 2 and 1 only, each in its own window. Words nobody classified are not in it.
   Entry: { key, term, line ("term — meaning — note"), level, qid, title, at }
   Module-level store + useSyncExternalStore, so every word card / popup on screen stays in sync. */

import { useSyncExternalStore } from "react";
import { store } from "./storage.js";

let state = { map: {} };
const subs = new Set();

export const vocabKey = (term) => String(term || "").replace(/[*=«»]/g, "").trim().toLowerCase();

export function initVocab(raw) {
  state = { map: raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {} };
}

const emit = () => { subs.forEach((f) => f()); store.set("clinix:vocab", state.map); };
const sub = (f) => { subs.add(f); return () => subs.delete(f); };
const snap = () => state;

/* level: 2 | 1 | -1 | 0 (0 = forget the word completely). Tapping the active level again clears it. */
export function setLevel(term, line, level, src) {
  const key = vocabKey(term);
  if (!key) return;
  const old = state.map[key];
  const map = { ...state.map };
  if (!level || (old && old.level === level)) delete map[key];
  else map[key] = {
    key, term: String(term).replace(/[*=«»]/g, "").trim(), line: line || (old && old.line) || term, level,
    qid: (src && src.qid) || (old && old.qid) || null, title: (src && src.title) || (old && old.title) || "",
    at: (old && old.at) || Date.now(),
  };
  state = { map };
  emit();
}

export const getLevel = (term) => (state.map[vocabKey(term)] || {}).level || 0;
export const getEntry = (term) => state.map[vocabKey(term)] || null;
export const useVocab = () => useSyncExternalStore(sub, snap);

export const listLevel = (map, level) => Object.values(map).filter((e) => e.level === level).sort((a, b) => a.term.localeCompare(b.term));
export const savedCount = (map) => Object.values(map).filter((e) => e.level > 0).length;

/* delete a word from the dictionary for good (any level, including "not important") */
export function removeWord(term) {
  const key = vocabKey(term);
  if (!key || !state.map[key]) return;
  const map = { ...state.map };
  delete map[key];
  state = { map };
  emit();
}

/* ── spaced review (Leitner boxes): a word you know moves up a box and comes back later, a word you missed comes back soon ── */
const DAYS = [0, 1, 3, 7, 14, 30];
export function reviewWord(term, ok) {
  const key = vocabKey(term);
  const e = state.map[key];
  if (!e) return;
  const box = ok ? Math.min(DAYS.length - 1, (e.box || 0) + 1) : 0;
  const due = Date.now() + (ok ? DAYS[box] * 86400e3 : 10 * 60e3);
  state = { map: { ...state.map, [key]: { ...e, box, due, seen: (e.seen || 0) + 1 } } };
  emit();
}
/* saved words that are due now, very-important first, then the ones missed most recently */
export const dueWords = (map) => Object.values(map).filter((e) => e.level > 0 && (e.due || 0) <= Date.now())
  .sort((a, b) => b.level - a.level || (a.due || 0) - (b.due || 0));
