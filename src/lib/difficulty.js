/*
 * ClinixStudy · Adaptive difficulty (v3.70)
 *
 * A small Gemini model (the lightest lane, separate quota from the strong models) reads the question and says EASY, MEDIUM or HARD; the app then chooses
 * how much machinery to spend:
 *     easy   → "light"      no silent solve: part A + one writer that solves by itself            (2 requests)
 *     medium → "balanced"   today's default                                                        (3–4 requests)
 *     hard   → "deep"       strong-model solve (a SMALL / free key uses "deepflash": Flash with high thinking, because its strong lane has no quota)
 *     a source that prescribes numbered tasks → the one-request task-contract path (already "hard": no classifier request is spent on it)
 *
 * Design rules, each one is a cost or safety decision:
 *  • The classifier request is tiny (≈ 60 output tokens, no thinking), time-boxed (8 s), cached by question hash, and FAILS OPEN to the free rule-based estimate.
 *  • An under-powered clinical answer is worse than a slow one, so the model's verdict is never allowed to fall below the rule-based FLOOR by more than one step
 *    (rules say hard + model says easy → medium) and any detected calculation / dosing is at least medium. "When unsure, choose the higher" is in the prompt.
 *  • The model sees the source (text, image or PDF) exactly like the writers do; it does not answer the question.
 *  • It is a ROUTER: a wrong level costs time or depth, never a wrong clinical statement by itself. The writers and every gate downstream are unchanged.
 */
export const LEVELS = ["easy", "medium", "hard"];
const RANK = { easy: 0, medium: 1, hard: 2 };
export const ROUTE_BOX_MS = 8000;

/* ── 1 · free, rule-based estimate (also the floor and the fallback) ── */
const CALC = /\b(?:mL\/h(?:r|our)?|ml\/hr|gtt|drops?\/min|mg\/kg|mcg\/kg|units?\/kg|mEq|infuse|drip|titrat\w+|calculate|how many (?:mL|tablets|mg)|dose|dosage|rate of)\b|احسب|الجرعة|معدل التسريب/i;
const NEG = /\b(?:EXCEPT|NOT|LEAST|FIRST|BEST|PRIORITY|MOST (?:likely|appropriate|important)|requires? (?:further|follow)[- ]?(?:up|teaching)|contraindicated)\b/;
const MULTI = /\b(?:ABG|arterial blood gas|pH|PaCO2|HCO3|troponin|creatinine|eGFR|potassium|sodium|INR|aPTT|lactate|WBC|hemoglobin|platelet\w*|ECG|EKG|GCS|SpO2)\b/gi;
const DRUGS = /\b(?:warfarin|heparin|digoxin|lithium|insulin|amiodarone|vancomycin|gentamicin|tacrolimus|cyclosporin\w*|phenytoin|theophylline|methotrexate|aminophylline|nitroprusside|dopamine|norepinephrine)\b/gi;

export function heuristicLevel(text, { optionsCount = 0 } = {}) {
  const t = String(text || "");
  const reasons = [];
  let score = 0;
  const words = (t.match(/\S+/g) || []).length;
  if (words > 220) { score += 2; reasons.push("long stem"); } else if (words > 110) { score += 1; reasons.push("medium-long stem"); }
  const nums = (t.match(/\d+(?:\.\d+)?\s*(?:mg|mcg|mL|mmol|mEq|mmHg|bpm|%|g\/dL|mg\/dL|IU|units?|\/min|°C|°F)/gi) || []).length;
  if (nums >= 6) { score += 2; reasons.push("many measured values"); } else if (nums >= 3) { score += 1; reasons.push("several measured values"); }
  const labs = new Set((t.match(MULTI) || []).map((x) => x.toLowerCase())).size;
  if (labs >= 4) { score += 1; reasons.push("multi-system data"); }
  if (CALC.test(t)) { score += 2; reasons.push("calculation or dosing"); }
  if (NEG.test(t)) { score += 1; reasons.push("exam keyword (EXCEPT / NOT / FIRST / BEST …)"); }
  const dr = new Set((t.match(DRUGS) || []).map((x) => x.toLowerCase())).size;
  if (dr >= 2) { score += 2; reasons.push("interacting high-risk drugs"); } else if (dr === 1) { score += 1; reasons.push("high-risk drug"); }
  if (/\b(?:client|patient|nurse|admitted|presents?|presented|complains?|history of|diagnosed)\b|مريض|مريضة|ممرض/i.test(t)) { score += 2; reasons.push("clinical vignette (not a pure recall item)"); }
  if (optionsCount >= 5 || /\bselect all that apply\b|\bSATA\b/i.test(t)) { score += 1; reasons.push("select-all / many options"); }
  if (words < 25 && !reasons.length) reasons.push("very short, single idea");
  const level = score >= 5 ? "hard" : score >= 2 ? "medium" : "easy";
  return { level, score, reasons, calc: CALC.test(t) };
}

/* ── 2 · the model's verdict ── */
export function buildDifficultyPrompt() {
  return {
    system: `You are a router for a nursing/medical exam-study app. Read the attached question (text, image or PDF) and decide how much reasoning it needs. Do NOT answer it, do NOT explain it.

EASY   one fact or definition, a recognition item, one-step selection with clearly different options, no patient-data interplay.
MEDIUM a typical clinical vignette needing 2–3 steps: prioritisation, interpreting a few findings, a drug with its nursing action, a simple one-formula calculation.
HARD   multi-step or multi-system reasoning; conflicting or borderline data; a dose/rate calculation with unit conversions; interacting drugs; lab/ABG interpretation that must be combined with the history; EXCEPT/NOT wording with two defensible options; an uncommon condition; or an open case with several parts.

When unsure between two levels choose the HIGHER one: an under-powered answer is worse than a slower one.
Reply with ONE line of JSON and nothing else: {"level":"easy|medium|hard","reason":"at most 12 words"}`,
    user: "Classify the attached question.",
  };
}

export function parseDifficulty(raw) {
  const t = String(raw || "").replace(/```[a-z]*|```/gi, " ");
  let level = null, reason = "";
  try { const m = /\{[\s\S]*?\}/.exec(t); if (m) { const j = JSON.parse(m[0]); level = String(j.level || "").toLowerCase().trim(); reason = String(j.reason || "").slice(0, 120); } } catch (e) { /* fall through to the loose reading */ }
  if (!LEVELS.includes(level)) { const m = /\b(easy|medium|hard)\b/i.exec(t); level = m ? m[1].toLowerCase() : null; }
  return LEVELS.includes(level) ? { level, reason } : null;
}

/* ── 3 · combine: the model decides, the rules keep it from falling too low ── */
export function combineLevels(model, rules) {
  if (!model) return { level: rules.level, source: "rules", floored: false };
  let level = model.level, floored = false;
  if (RANK[rules.level] - RANK[level] >= 2) { level = LEVELS[RANK[rules.level] - 1]; floored = true; }          // hard by the rules, easy by the model → medium
  if (rules.calc && RANK[level] < 1) { level = "medium"; floored = true; }                                         // anything with a calculation is at least medium
  return { level, source: "model", floored };
}

/* ── 4 · level → analysis preset ── */
export function modeForLevel(level, { small = false } = {}) {
  if (level === "easy") return "light";
  if (level === "hard") return small ? "deepflash" : "deep";
  return "balanced";
}
export const LEVEL_AR = { easy: "سهل", medium: "متوسط", hard: "قوي" };

/* ── 5 · cache: the same question is never classified twice ── */
const LS = "clinix:route:v1", MAX = 40, TTL = 30 * 864e5;
let _now = () => Date.now();
export const __routeClock = (fn) => { _now = fn || (() => Date.now()); };
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export const routeKey = (text, extra = "") => `${hash(`${text}\n${extra}`)}.${String(text).length}`;
const read = () => { try { return JSON.parse(window.localStorage.getItem(LS) || "[]").filter((e) => e && _now() - e.t < TTL); } catch (e) { return []; } };
export const getRoute = (key) => read().find((e) => e.k === key) || null;
export function putRoute(key, v) { try { window.localStorage.setItem(LS, JSON.stringify([{ k: key, t: _now(), ...v }, ...read().filter((e) => e.k !== key)].slice(0, MAX))); } catch (e) { /* optional */ } }
export const clearRoutes = () => { try { window.localStorage.removeItem(LS); } catch (e) { /* ignore */ } };
