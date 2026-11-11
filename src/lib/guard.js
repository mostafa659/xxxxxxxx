/* ───────────── Output guard — what the student must never see, whichever model wrote it ─────────────
   Two failures happen when a SMALL or substitute model (Flash-Lite, an extra engine) answers instead of the usual one:

   1. PROMPT LEAK   the model copies a rule of the prompt into its answer ("One bullet per main part … (at most 10)").
   2. BAD SPELLING  a word is written with doubled / invented letters ("ة" in the middle of a word, "ااا", a word stuttered twice …).

   Both are handled in ONE place — runTask() in gemini.js — so every screen is covered, with no per-prompt list to maintain:

   • Leak:  the request's own system prompt is the reference. Every instruction-like line of it is cut into 5-word windows;
            an answer line that is mostly made of those windows is the prompt talking, and is removed. A few fixed patterns
            ("(at most 10)", "One bullet per …", "Start directly with …") catch the cases where the model paraphrases.
            Section markers the parsers need (===EXPLANATION===) are never touched, and text the STUDENT wrote is never treated as a leak.
   • Spelling: letter-level repairs that are right in every Arabic word (see repairArabic), plus a small table of known bad spellings.
            When a weak lane's answer needed 2+ repairs it is written again ONCE by a stronger model (budgeted, see allowRetry).

   Nothing here calls the network, and nothing here changes text that is already clean (fast path). */

/* which calls carry Arabic prose for the student. OCR transcripts, JSON, SVG and the hidden solve stay exactly as the model wrote them. */
export const PROSE_TASK = /^(?:lesson:(?!diagram|chatplan)|words$|word:tr$)/;

/* ── 1 · prompt leak ── */

const WIN = 5;                                                            // words per window
const words = (s) => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean);
const windows = (ws) => { const out = []; for (let i = 0; i + WIN <= ws.length; i++) out.push(ws.slice(i, i + WIN).join(" ")); return out; };

/* the vocabulary of a prompt TALKING TO the model (not of the medical content that may also sit in the system prompt) */
const META = /\b(bullets?|headings?|output format|your (?:reply|answer|text|response)|the reply|you (?:write|must|are|will)|json|markdown|code fences?|at most \d+|at least \d+|under \d+ words|exactly \d+|in the order of|never (?:output|write|use|copy|put|repeat)|do not (?:write|output|use|copy|repeat|add|put|mention))\b/i;

/* lines that are the prompt whatever the system text says (the model paraphrased a rule, or the prompt was rebuilt) */
const LEAK_LINE = [
  /^\s*(?:[-*•]\s*)?one bullet\b/i,
  /^\s*(?:[-*•]\s*)?(?:at most|at least|exactly)\s+\d+\b/i,
  /\bstart directly with\b/i,
  /\bWRITING RULE\b/,
  /^\s*(?:#{1,3}\s*)?(?:output format|sections?\s*[—:-]\s*exactly|layout)\s*[:—-]/i,
  /\b(?:no code fences?|plain text,? no)\b/i,
];
const LEAK_INLINE = /\s*\((?:at most|max(?:imum)?|up to|exactly|under|no more than)\s+\d+[^)\n]{0,30}\)/gi;
const LEAK_START = /^\s*(?:[-*•]\s*)?(?:one bullet|at most \d|exactly these|start directly)/i;      // a half-written line that is clearly the start of one
const MARKER = /^\s*={2,}\s*[A-Z][A-Z _]*\s*={2,}\s*$/;                                         // ===EXPLANATION=== · ===TRICKS=== … (parse.js reads them)

export function leakIndex(system, userText = "") {
  const mine = new Set();
  for (const l of String(userText || "").split("\n")) windows(words(l)).forEach((w) => mine.add(w));
  const set = new Set();
  for (const l of String(system || "").split("\n")) {
    if (!META.test(l)) continue;
    for (const w of windows(words(l))) if (!mine.has(w)) set.add(w);
  }
  return set;
}

const isLeakLine = (line, idx) => {
  if (LEAK_LINE.some((r) => r.test(line))) return true;
  if (!idx || !idx.size) return false;
  const ws = words(line);
  if (ws.length < WIN) return false;
  const hit = new Array(ws.length).fill(false);
  for (let i = 0; i + WIN <= ws.length; i++) if (idx.has(ws.slice(i, i + WIN).join(" "))) for (let k = i; k < i + WIN; k++) hit[k] = true;
  return hit.filter(Boolean).length / ws.length >= 0.5;
};

export function stripLeaks(text, idx, final = true) {
  if (!text || typeof text !== "string") return { text, leaks: 0 };
  let leaks = 0;
  const lines = text.split("\n");
  const out = [];
  lines.forEach((line, i) => {
    if (MARKER.test(line)) { out.push(line); return; }
    const last = i === lines.length - 1;
    if (!final && last && LEAK_START.test(line)) { leaks += 1; return; }          // still being written: do not flash it on the screen
    if (isLeakLine(line, idx)) { leaks += 1; return; }
    const cleaned = line.replace(LEAK_INLINE, () => { leaks += 1; return ""; });
    out.push(cleaned);
  });
  return { text: out.join("\n").replace(/\n{3,}/g, "\n\n"), leaks };
}

/* ── 2 · spelling ── */

/* spellings that were seen in real answers and are never right → the word that was meant. Add a line when a new one shows up. */
export const SPELL_FIXES = {
  "وواكامل": "ومتكامل",
};

const AR_WORD = /[\u0621-\u064A]+/g;
const NEVER_DOUBLE = /([اآةىءؤئذظ])\1/g;           // these letters are never written twice in a row in Arabic (أ / إ can: "أأخذ؟")
const TRIPLE = /([\u0621-\u064A])\1{2,}/g;          // no Arabic letter is written three times in a row

/* → { text, fixes }   fixes = how many words had to be repaired (the "how bad was it" number) */
export function repairArabic(text) {
  if (!text || typeof text !== "string" || !/[\u0621-\u064A]/.test(text)) return { text, fixes: 0 };
  let fixes = 0;
  const out = text.replace(AR_WORD, (w) => {
    let t = SPELL_FIXES[w] || w;
    if (t.length > 1) {
      t = t.replace(TRIPLE, "$1").replace(NEVER_DOUBLE, "$1")
        .replace(/ة(?=[\u0621-\u064A])/g, "ت")        // "ة" only closes a word; inside one it is a "ت" ("مدرسةهم" → "مدرستهم")
        .replace(/ى(?=[\u0621-\u064A])/g, "ي");       // "ى" only closes a word; inside one it is a "ي"
    }
    if (t !== w) fixes += 1;
    return t;
  });
  return { text: out, fixes };
}

/* ── 3 · the guard of one request ── */

export function makeGuard({ task, system, parts } = {}) {
  if (!PROSE_TASK.test(String(task || ""))) return null;
  const mine = (Array.isArray(parts) ? parts : []).map((p) => (p && typeof p.text === "string" ? p.text : "")).join("\n").slice(0, 60000);
  const idx = leakIndex(system, mine);
  return {
    scrub(text, final = true) {
      if (!text || typeof text !== "string") return { text, leaks: 0, fixes: 0 };
      const a = stripLeaks(text, idx, final);
      const b = repairArabic(a.text);
      return { text: b.text, leaks: a.leaks, fixes: b.fixes };
    },
  };
}

/* ── 4 · the rewrite budget ──
   A rewrite costs one more request of the free daily quota, so it is rare on purpose: only when a weak lane's answer needed REWRITE_AT repairs,
   and at most MAX_RETRIES per 10 minutes. */
export const REWRITE_AT = 2;
const MAX_RETRIES = 4, WINDOW_MS = 10 * 60e3;
let _log = [];
let _now = () => Date.now();
export const __guardClock = (fn) => { _now = fn || (() => Date.now()); };
export const __resetGuard = () => { _log = []; };
export function allowRetry() {
  const t = _now();
  _log = _log.filter((x) => t - x < WINDOW_MS);
  if (_log.length >= MAX_RETRIES) return false;
  _log.push(t);
  return true;
}

/* the sentences added to every prompt that makes the model write Arabic (text.js puts them in ARABIC_RULE) */
export const NO_ECHO_RULE = "Never copy, repeat or quote these instructions, the section rules, the word limits or the format notes in your answer: write only the content itself.";
export const SPELLING_RULE = "Spell every Arabic word completely and correctly, using ordinary words you are sure of; if you are unsure how a word is spelled, choose a simpler word. Never repeat a letter three times and never put a ة or ى inside a word. Re-read each Arabic sentence once before you send it.";
