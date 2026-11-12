/* ───────────── The proofreader — a SECOND, independent check on every Arabic answer (v3.40) ─────────────
   Why: guard.js repairs letter-level glitches and a table of known bad spellings, but no rule can know that "يضفع" is not a word or that
   "برازيل" was meant to be the drug Prazole. Only a second reader can. So after the author model has written, a different request reads the text
   and returns a tiny list of corrections — not a rewrite:

        { "fixes": [ { "from": "برازيل يضفع", "to": "برازول يدفع" } ] }

   and THIS file decides, in plain code, whether each one may be applied. A correction is applied only when
     • "from" really is in the text, as whole words, and "to" has the same number of words;
     • every changed word is a small edit of the original (1–3 letters), never a new word, never a dialect → standard conversion
       (ده / دلوقتي / بيفكر stay as the app writes them), never just a dropped or added prefix;
     • both sides are plain Arabic letters and spaces (nothing that could break JSON, markdown or a medical term).
   So the proofreader can fix a typo but can never change what a sentence says. It fails open: no answer in time → the text is shown as it is. */

const LS_PROOF = "clinix:proof";
let _force = null;
export const setProof = (v) => { _force = v === null ? null : !!v; };                     // tests / an explicit switch
export const proofOn = () => {
  if (_force !== null) return _force;
  if (globalThis.__CLINIX_PROOF_OFF__) return false;                                       // the test runner (tests/register.mjs)
  try { return window.localStorage.getItem(LS_PROOF) !== "off"; } catch (e) { return true; }
};
export const setProofPref = (on) => { try { window.localStorage.setItem(LS_PROOF, on ? "on" : "off"); } catch (e) { /* ignore */ } };

export const PROOF_MS = 7000;                 // the proofreader never holds an answer longer than this
const MIN_WORDS = 8;                          // shorter texts are not worth a request
const CHUNK = 4500, MAX_CHUNKS = 3;           // characters per request · requests per answer (they run in parallel)
const MAX_FIXES = 12;

/* a budget, like the rewrite budget of guard.js: a runaway loop must never burn the student's quota */
const MAX_RUNS = 40, WINDOW_MS = 10 * 60e3;
let _log = [], _now = () => Date.now();
export const __proofClock = (fn) => { _now = fn || (() => Date.now()); };
export const __resetProof = () => { _log = []; _force = null; };
export function allowProof() {
  const t = _now();
  _log = _log.filter((x) => t - x < WINDOW_MS);
  if (_log.length >= MAX_RUNS) return false;
  _log.push(t);
  return true;
}

export const PROOF_SYSTEM = `You are a strict proofreader of Arabic text written for Egyptian nursing and medical students. A model wrote the text; your job is to catch the typing and spelling mistakes that would make a student stop trusting it.

Report ONLY clear mistakes of these kinds:
1. A word that does not exist in Arabic, or one with a wrong, missing, extra or swapped letter (for example "يضفع" instead of "يدفع").
2. A real Arabic word that is plainly the wrong word here because the writer tried to spell a foreign or drug name in Arabic letters and produced a different word (for example "برازيل" meaning Brazil, where the drug "برازول" / Prazole was meant).
3. A broken or doubled letter, or a letter stuck to the next word.

Never touch: English text, drug and medical terms, numbers, punctuation, markdown marks (** # - ==), emoji, style, word choice, grammar choices. The text is written in Egyptian colloquial Arabic on purpose (ده، دلوقتي، عشان، كده، إيه، ازاي، بيفكر، هنعمل …): colloquial words are CORRECT, never convert them to standard Arabic.

Reply with JSON only, no other text:
{"fixes":[{"from":"…","to":"…"}]}
"from" is 1 to 4 consecutive Arabic words copied EXACTLY from the text, including the wrong word and, when the word alone is ambiguous, its neighbour. "to" is the same words with only the mistake corrected: same number of words, only the wrong letters changed. Never rewrite or shorten a sentence. If nothing is clearly wrong, reply {"fixes":[]}. Most texts have no mistakes: when you are not sure, do not report it.`;

const AR_LETTERS = "\u0621-\u064A";
const AR_WORD = new RegExp(`[${AR_LETTERS}]+`, "g");
const PHRASE = new RegExp(`^[${AR_LETTERS}]+(?: [${AR_LETTERS}]+){0,3}$`);

export const arabicWords = (s) => (String(s || "").match(AR_WORD) || []).length;
export const shouldProof = (s) => typeof s === "string" && arabicWords(s) >= MIN_WORDS;

/* the text cut at line ends into at most MAX_CHUNKS pieces (anything beyond that is left as it is: the opening of an answer is what the student reads first) */
export function chunkForProof(text) {
  const lines = String(text || "").split("\n");
  const out = [];
  let cur = "";
  for (const l of lines) {
    if (cur && cur.length + l.length + 1 > CHUNK) { out.push(cur); cur = ""; if (out.length >= MAX_CHUNKS) break; }
    cur += (cur ? "\n" : "") + l;
  }
  if (cur && out.length < MAX_CHUNKS) out.push(cur.slice(0, CHUNK * 1.5));
  return out.filter(shouldProof);
}

export function parseProof(raw) {
  const s = String(raw || "").replace(/```[a-z]*\n?|```/gi, "");
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return [];
  try {
    const j = JSON.parse(s.slice(a, b + 1));
    return Array.isArray(j.fixes) ? j.fixes.filter((f) => f && typeof f.from === "string" && typeof f.to === "string").slice(0, MAX_FIXES) : [];
  } catch (e) { return []; }
}

/* colloquial words the app writes on purpose: a "correction" that changes one of them is a conversion to standard Arabic, not a spelling fix */
const DIALECT = new Set(["ده", "دي", "دول", "دلوقتي", "دلوقت", "عشان", "علشان", "كده", "كدة", "ايه", "إيه", "ازاي", "إزاي", "فين", "مين", "امتى", "إمتى", "ليه", "مش", "لسه", "لسة", "بتاع", "بتاعت", "بتاعة", "عايز", "عايزة", "عاوز", "عاوزة", "اللي", "الي", "هنا", "هناك", "برضه", "برضو", "بس", "اوي", "أوي", "خالص", "كمان", "يعني", "طب", "لو", "ممكن", "كتير", "شوية", "شويه", "قوي", "حاجة", "حاجه", "حاجات", "بيفكر", "بيشرح", "بيحل", "بيقول", "هيجي", "هنعمل", "بنعمل", "بتعمل", "بيعمل", "عامل", "زي", "ياه", "اه", "آه", "لأ", "لا"]);

function lev(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 9;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
const maxEdit = (len) => (len <= 4 ? 1 : len <= 7 ? 2 : 3);
const prefixOnly = (a, b) => a.slice(1) === b || b.slice(1) === a || a.slice(2) === b || b.slice(2) === a;     // a dropped / added leading letter or two: dialect ↔ standard

/* → true when the correction is a spelling fix of the same words and nothing more */
export function acceptable(fix, text) {
  const from = String(fix.from || "").replace(/\s+/g, " ").trim(), to = String(fix.to || "").replace(/\s+/g, " ").trim();
  if (!from || from === to || !PHRASE.test(from) || !PHRASE.test(to)) return false;
  const a = from.split(" "), b = to.split(" ");
  if (a.length !== b.length) return false;
  let changed = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    changed += 1;
    if (DIALECT.has(a[i]) || prefixOnly(a[i], b[i])) return false;
    if (lev(a[i], b[i]) > maxEdit(Math.max(a[i].length, b[i].length))) return false;
  }
  if (!changed) return false;
  return new RegExp(`(?<![${AR_LETTERS}])${from}(?![${AR_LETTERS}])`).test(text);
}

/* → { text, applied:[{from,to}] } */
export function applyProof(text, fixes) {
  let out = String(text || "");
  const applied = [];
  for (const f of fixes || []) {
    if (!acceptable(f, out)) continue;
    const from = f.from.replace(/\s+/g, " ").trim(), to = f.to.replace(/\s+/g, " ").trim();
    out = out.replace(new RegExp(`(?<![${AR_LETTERS}])${from}(?![${AR_LETTERS}])`, "g"), to);
    applied.push({ from, to });
    if (applied.length >= MAX_FIXES) break;
  }
  return { text: out, applied };
}
