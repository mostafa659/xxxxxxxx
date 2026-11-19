/* ───────────── lib/accuracy.js · the deterministic layer (v3.43 · F1) ─────────────
   Synchronous · zero network · zero tokens. Everything here is plain code:
     1. cleanResidue   UI leftovers ("1×", "linked to question…", cut-off "…" tails, truncated cross-references) removed from input and output
     2. splitText      the output cut into lines and sentences IN CODE
     3. classify       each sentence → analogy | list | number | absolute | function | framework | mnemonic | clinical_rule | dose | other
     4. originOf       ORIGIN BY CODE: word overlap with the source text. Low overlap = ADDED. The model is never asked to label origin.
     5. analogy box    analogies leave the body (never memorize / definitions); invented mnemonics / frameworks are stripped (Part A) or boxed (Part B)
     6. honestTitle    "complete / بالكامل / from scratch" → "what the material covered" unless the KB coverage check passes
   The KB layer (kb/check.js) runs on the sentences this file produces. */

/* ── 1 · residue ── */
const LINK_TAIL = /==\s*🔗[^=\n]*?==/g;                       // a connection clause: ==🔗 … «Title» …==
const RESIDUE = [
  [/(^|[\s(])\d+\s*[×x](?=[\s).,؛:]|$)/gim, "$1"],             // "1×" / "3×" counters copied from the UI
  [/\b(?:linked|link)\s+to\s+question\b[^\n]*/gi, ""],           // "linked to question…" captions
  [/مرتبط\s+بسؤال\s*(?:…|\.{3})\s*(?=\n|$)/g, ""],
];

export function cleanResidue(s, titles) {
  let t = String(s == null ? "" : s);
  if (!t) return t;
  t = t.replace(LINK_TAIL, (m) => {
    // a cross-reference is kept only when its «title» is closed, not cut with "…", and (when the student's titles are known) really exists
    const q = /«([^»]*)»/.exec(m);
    if (!q) return /«/.test(m) || /…|\.\.\./.test(m) ? "" : m;
    const title = q[1].trim();
    if (!title || /…|\.\.\.$/.test(title)) return "";
    if (titles && titles.length && !titles.some((x) => String(x).trim() === title)) return "";
    return m;
  });
  for (const [re, to] of RESIDUE) t = t.replace(re, to);
  // a line that ends in a lone ellipsis AFTER a cut word ("…") is a truncated tail: drop the tail mark (the sentence stays as the model wrote it)
  t = t.replace(/[ \t]*(?:…|\.{3})[ \t]*$/gm, (m, off, str) => {
    const before = str.slice(Math.max(0, off - 1), off);
    return /[\p{L}\p{N}]/u.test(before) ? "" : m;
  });
  return t.replace(/[ \t]{2,}/g, " ").replace(/[ \t]+$/gm, "").replace(/^[ \t]*(?:[-*•>]|\d+[.)])[ \t]*$\n?/gm, "").replace(/\n{3,}/g, "\n\n");
}

/* ── normalisation for comparing text ── */
const AR_MARKS = /[\u064B-\u065F\u0670\u0640]/g;
const ARABIC_ANY = /[\u0600-\u06FF]/;
/* Latin-only text (most of it) skips every Arabic fold: five regex passes saved per sentence */
export const norm = (s) => {
  const t = String(s || "").toLowerCase();
  if (!ARABIC_ANY.test(t)) return t;
  return t.replace(AR_MARKS, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
};
const WORD = /[a-z]+(?:['’-][a-z]+)*|[0-9]+(?:[.,][0-9]+)?|[\u0621-\u064A]+/g;
export const tokens = (s) => norm(s).match(WORD) || [];
const STOP = new Set(["the", "and", "for", "are", "with", "that", "this", "from", "has", "have", "was", "were", "not", "does", "did", "doe", "could", "should", "would", "might", "being", "been", "very", "much", "some", "many", "most", "each", "but", "can", "its", "into", "than", "then", "also", "such", "which", "their", "there", "these", "those", "will", "when", "what", "who", "how",
  "في", "من", "على", "الي", "ان", "او", "ده", "دي", "دا", "هو", "هي", "كل", "ما", "لا", "مع", "عن", "ايه", "عشان", "كده", "بس", "يعني", "هنا", "لما", "لو", "اللي", "بتاع"]);
export const anchorsOf = (toks) => toks.filter((w) => !STOP.has(w) && (w.length >= 4 || /^[0-9]/.test(w) || (/^[a-z]/.test(w) && w.length >= 3) || (/[\u0621-\u064A]/.test(w) && w.length >= 4)));

/* the source as a set of words and word pairs (built ONCE per analysis, reused for every sentence) */
export function indexSource(text) {
  const toks = tokens(text), uni = new Set(toks), bi = new Set();
  for (let i = 0; i + 1 < toks.length; i++) bi.add(toks[i] + " " + toks[i + 1]);
  return { uni, bi, size: toks.length };
}

/* → { score 0..1, anchors } ; score = share of the sentence's anchor words found in the source, lifted by shared word pairs */
export function originOf(sentence, idx) {
  if (!idx || !idx.size) return { score: 0, anchors: 0, added: true };
  const toks = tokens(sentence), anc = anchorsOf(toks);
  if (anc.length < 2) return { score: 0, anchors: anc.length, added: null };         // too short to judge
  let hit = 0;
  for (const w of anc) if (idx.uni.has(w)) hit += 1;
  let pairs = 0, hitP = 0;
  for (let i = 0; i + 1 < toks.length; i++) { if (STOP.has(toks[i]) || STOP.has(toks[i + 1])) continue; pairs += 1; if (idx.bi.has(toks[i] + " " + toks[i + 1])) hitP += 1; }
  const score = Math.min(1, hit / anc.length * 0.75 + (pairs ? hitP / pairs : 0) * 0.35);
  return { score, anchors: anc.length, added: score < 0.4 };
}

/* ── 2 · sentences ── */
const PREFIX = /^(\s*(?:#{1,4}\s+|[-*•]\s+|>\s+|\d+[.)]\s+))?/;
const SPLIT = /(?<=[.!?؟؛]|\*\*)\s+(?=[A-Z\u0600-\u06FF*>"«(\d])/;

/* → lines: [{ raw, prefix, heading, body, sentences:[string] }] */
export function splitText(text) {
  return String(text || "").split("\n").map((raw) => {
    const p = PREFIX.exec(raw)[1] || "";
    const body = raw.slice(p.length);
    const heading = /^\s*#{1,4}\s/.test(p);
    const sentences = heading || !body.trim() ? [] : body.split(SPLIT).map((x) => x.trim()).filter(Boolean);
    return { raw, prefix: p, heading, body, sentences };
  });
}

/* ── 3 · classes ── */
const COMMON_CAPS = new Set(["NOT", "AND", "THE", "FOR", "ALL", "ANY", "IV", "IM", "PO", "RN", "LPN", "UAP", "ABC", "NCLEX"]);
export const HIGH_RISK = new Set(["dose", "list", "number", "absolute", "function", "clinical_rule"]);
export const SAFETY_CRITICAL = new Set(["dose"]);
const RX = {
  analogy: /\b(?:like an?|as if|imagine|think of (?:it|this|them) as|analogy|picture a)\b|(?:^|\s)(?:تخيّل|تخيل|كأن|كإن|يشبه|بيشبه|تشبيه|شبه)(?:\s|$)|(?:^|\s)زي\s+(?!ما\b)(?:ال|حد|كده)/i,
  mnemonic: /\bmnemonic\b|\bacronym\b|\bstands? for\b|\bremember\b.{0,30}\b(?:as|with)\b|\brhyme\b|💡|حفظها|اختصار|حيلة للحفظ|قافية/i,
  framework: /\bframework\b|\bstep[- ]by[- ]step (?:approach|method)\b|\b(?:\w\W{0,2}){3,}→\s*\w|خطوات التفكير|إطار|اطار|نموذج التفكير|\b\d[- ]step\b/i,
  dose: /\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|µg|μg|g|ml|mL|units?|IU|mEq|mmol)\b(?!\s*\/\s*(?:dL|L)\b).{0,40}\b(?:per|every|daily|bid|tid|qid|q\d+h|once|twice|dose|dosage|maximum|max)\b|\b(?:doses?|dosages?|contraindicat\w*|antidote|overdose|do not give|never give|allerg\w*|interaction)\b|جرعة|الجرعه|مضاد استطباب|ممنوع (?:مع|في)|ترياق|حساسية من|تداخل دوائي/i,
  absolute: /\b(?:always|never|any|all|every|none|immediately|must|only|completely|100\s?%|guaranteed)\b|دايما|دائما|ابدا|أبدا|اي\s|أي\s|فورا|فوراً|لازم|بس\s+كده|كل\s/i,
  list: /\b(?:\d+|two|three|four|five|six|seven|eight|nine|ten)\s+(?:main |major |types? of |kinds? of |parts?|lobes?|layers?|pairs?|stages?|phases?|sections?|regions?|portions?|organs?|glands?|chambers?|steps?|causes?|signs?|components?|branches?)\b|\b(?:consists? of|composed of|divided into|includes?|comprises?)\b|(?:ثلاث|اربع|أربع|خمس|ست|سبع|ثمان|تسع|عشر)\w*\s+(?:اجزاء|أجزاء|فصوص|طبقات|ازواج|أزواج|مراحل|اقسام|أقسام)|\b\d+\s+(?:اجزاء|أجزاء|فصوص|طبقات|مراحل|أقسام)|بيتكون من|يتكون من|مقسم|بينقسم/i,
  number: /\b\d+(?:[.,]\d+)?\s*(?:to|-|–)\s*\d+(?:[.,]\d+)?\b|\b\d+\s*(?:times|doses|tablets|capsules|beats|breaths)\b|\bper (?:minute|hour|day|week)\b|\b\d+(?:[.,]\d+)?\s*(?:%|mmHg|bpm|mEq\/L|mmol\/L|mg\/dL|g\/dL|°C|°F|kg|cm|mm|mL|L|min|minutes?|hours?|h|days?|weeks?|years?|breaths|\/min|x10|×10)|\b(?:normal|range)\b.{0,20}\d|(?:طبيعي|المعدل).{0,20}\d/i,
  function: /\b(?:makes?|produces?|secretes?|stores?|synthesi[sz]es?|releases?|absorbs?|digests?|filters?|pumps?|regulates?|converts?|transports?|breaks? down|concentrates?)\b|بيصنع|بتصنع|بيفرز|بتفرز|بيخزن|بتخزن|بيمتص|بتمتص|بيهضم|بينتج|بتنتج|بيفرّز|بيحوّل/i,
  clinical_rule: /\b(?:first|priority|best|next|should|must|initial(?:ly)?|contraindicated|indicated|delegat\w+|assign\w*|report|notify|call the (?:provider|physician|doctor)|isolation|precautions?|airway|criteria|guideline|algorithm|screen\w*)\b|أول حاجة|الأولوية|لازم|يتبلغ|يتفوض|عزل|احتياطات/i,
};
export function classify(s) {
  const t = String(s || "");
  if (RX.dose.test(t)) return "dose";
  if (RX.mnemonic.test(t) && !/\bremember (?:that|to)\b/i.test(t)) return "mnemonic";
  if (RX.framework.test(t)) return "framework";
  if (RX.analogy.test(t)) return "analogy";
  if (RX.list.test(t)) return "list";
  if (RX.number.test(t)) return "number";
  if (RX.absolute.test(t)) return "absolute";
  if (RX.function.test(t)) return "function";
  if (RX.clinical_rule.test(t)) return "clinical_rule";
  return "other";
}

/* ── 6 · titles ── */
const CLAIM_TITLE = /(?:\b(?:complete|comprehensive|full|entire|from scratch|from zero|everything about|all about)\b|بالكامل|كامل(?:ة)?|من الصفر|من الأول للآخر|كل حاجة عن)/i;
export function honestTitle(title, { coverage = false, lang = "ar" } = {}) {
  const t = String(title || "");
  if (coverage || !CLAIM_TITLE.test(t)) return t;
  const stripped = t.replace(CLAIM_TITLE, "").replace(/\s{2,}/g, " ").replace(/^[\s\-–:،,]+|[\s\-–:،,]+$/g, "");
  const tag = lang === "en" ? "what the material covered" : "اللي المادة غطّته";
  return stripped ? `${stripped} — ${tag}` : tag;
}

/* ── 4+5 · the whole pass ──
   opts: { source, part: "A"|"B", kb?: (fn) , titles, profile }
   Returns { text, items, analogies, stripped, memoAids, stats }.
   An item = { id, line, sentence, kind, origin: "source"|"added"|"unknown", label, memorize } — labels are filled in later by kb/check.js. */
export function analyze(text, opts = {}) {
  const part = opts.part === "B" ? "B" : "A";
  const clean = cleanResidue(text, opts.titles);
  const idx = opts.index || (opts.source ? indexSource(opts.source) : null);
  const lines = splitText(clean);
  const items = [], analogies = [], stripped = [], memoAids = [];
  const layout = [];                                                          // the page as lines: a fixed line, or { prefix, ids } rebuilt from the (possibly patched) items
  let id = 0;
  for (let li = 0; li < lines.length; li++) {
    const L = lines[li];
    if (L.heading || !L.sentences.length) { layout.push({ raw: L.raw }); continue; }
    const keep = [];
    for (const s of L.sentences) {
      const kind = classify(s);
      /* no source text at all is NOT "from the source": origin stays unknown, so an invented mnemonic / framework is removed instead of waved through */
      const o = idx ? originOf(s, idx) : { score: 0, anchors: 0, added: null };
      let origin = o.added === null ? "unknown" : o.added ? "added" : "source";
      /* a mnemonic / framework IS its acronym and its steps: borrowing the source's sentence while swapping the acronym (CFBP → QQZZ) is an invention, however high the word overlap */
      if (origin === "source" && (kind === "mnemonic" || kind === "framework") && idx) {
        const key = (s.match(/\b[A-Z]{2,}\b/g) || []).filter((w) => !COMMON_CAPS.has(w));
        if (key.some((w) => !idx.uni.has(w.toLowerCase()))) origin = "added";
      }
      const item = { id: `s${id++}`, line: li, sentence: s, kind, origin, overlap: Math.round(o.score * 100) / 100 };
      if (opts.locate && origin === "source") { const pv = opts.locate(s); if (pv) item.prov = pv; }
      if (kind === "analogy") { analogies.push(item); continue; }            // never in the body: goes to the analogy box
      if ((kind === "mnemonic" || kind === "framework") && origin !== "source") {
        if (part === "A" && !opts.known?.(s)) { stripped.push({ ...item, reason: kind + "-not-in-source" }); continue; }
        if (part === "B" && !opts.known?.(s)) { memoAids.push(item); continue; }   // Part B: the AI is the only author → boxed + labeled, never memorize
      }
      items.push(item); keep.push(item.id);
    }
    if (keep.length) layout.push({ prefix: L.prefix, ids: keep });  // a line whose every sentence was moved or stripped disappears with them
  }
  const res = { layout, items, analogies, stripped, memoAids, stats: { sentences: items.length, analogies: analogies.length, stripped: stripped.length, added: items.filter((i) => i.origin === "added").length } };
  res.text = render(res);
  return res;
}

/* the text again, from the items (their `text` when the KB patched them) */
export function render(res) {
  const by = new Map(res.items.map((i) => [i.id, i]));
  return res.layout.map((l) => (l.raw !== undefined ? l.raw : l.prefix + l.ids.map((id) => { const i = by.get(id); return i.text != null ? i.text : i.sentence; }).join(" "))).join("\n").replace(/\n{3,}/g, "\n\n");
}
