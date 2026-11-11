/* ───────────── Exams made by the AI ─────────────
   The student says «اعملي امتحان 10 أسئلة على القلب» (or presses the exam button) → ONE request returns a JSON exam,
   which the chat shows as an interactive card (components/ExamCard.jsx).
   • built from the student's OWN saved questions / lessons when they match what he asked, otherwise from NCLEX knowledge
   • single-answer and "select all that apply" items; options are shuffled here (models love putting the key on B/C)

   v3.20 — WHY IT WAS SLOW, AND THE FIX. One request had to (1) THINK at the "high" level, then (2) write all N items one after
   another, and nothing was shown until the very last character arrived → 1–3 minutes of dots for 10 items.
   Now the exam is split into small batches (≈3 items each, at most 4) that run IN PARALLEL with light thinking, each batch is
   STREAMED, and every item is put on screen the moment it is complete. The first question usually appears in a few seconds and
   the rest is ready while the student is still answering it. Time ≈ one small batch instead of the sum of everything.  */

import { getModelLists, runTask } from "./gemini.js";
import { materialFor } from "./library.js";
import { sourceParts } from "./docs.js";
import { fixText, ARABIC_RULE } from "./text.js";

/* ── does this message ask for an exam? ── */
const CREATE = /(اعمل|اعملي|اعملّي|اعملى|اعملّى|هات|هاتلي|جهز|جهزلي|جهّز|اطلع|اطلعلي|ولد|ولّد|صمم|صمّم|اكتب|اكتبلي|ابني|اديني|عايز|عاوز|عاوزه|عايزه|محتاج|أريد|اريد|make|create|generate|give|build|prepare|write|i want|i need)/i;
const STRONG = /(امتحان|كويز|كويزات|quiz|exam|mcq|mock|practice test)/i;
const SOFT = /(اسئلة|أسئلة|اسئله|أسئله|questions)/i;          // "5 أسئلة على القلب" is an exam, "عندي أسئلة" is not
const WEAK = /(اختبار|test)/i;
const NOT_LAB = /(دم|بول|تحليل|ملخص|لخص|اشرح|شرح|blood|urine|lab|summary|explain)/i;
const DIRECT = /(امتحني|امتحنّي|اختبرني|اختبرنى|امتحنى|quiz me|test me|examine me)/i;

export function wantsExam(q) {
  const s = String(q || "");
  if (s.length > 500) return false;
  if (DIRECT.test(s)) return true;
  if (CREATE.test(s) && STRONG.test(s)) return true;
  if (CREATE.test(s) && SOFT.test(s) && /[\d\u0660-\u0669]|(^|\s)(خمسة|خمس|عشرة|عشر|عشرين|تلاتة|ثلاثة|اربعة|أربعة|ستة|سبعة|تمانية|تسعة)(\s|$)/.test(s)) return true;
  if (CREATE.test(s) && WEAK.test(s) && !NOT_LAB.test(s)) return true;
  return /^\s*(امتحان|كويز|quiz|exam)\b/i.test(s);
}

const AR_NUM = { "واحد": 1, "اتنين": 2, "اثنين": 2, "تلاتة": 3, "ثلاثة": 3, "تلات": 3, "اربعة": 4, "أربعة": 4, "اربع": 4, "خمسة": 5, "خمس": 5, "ستة": 6, "ست": 6, "سبعة": 7, "سبع": 7, "تمانية": 8, "ثمانية": 8, "تمن": 8, "تسعة": 9, "تسع": 9, "عشرة": 10, "عشر": 10, "خمستاشر": 15, "عشرين": 20 };
export function examCount(q) {
  const s = String(q || "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660));
  const m = s.match(/(\d{1,2})/);
  if (m) return Math.max(1, Math.min(20, +m[1]));
  for (const [w, n] of Object.entries(AR_NUM)) if (new RegExp(`(^|\\s)${w}(\\s|$)`).test(s)) return n;
  return 5;
}

const SYSTEM = `You are a senior NCLEX-RN item writer. You write exam items that look and feel like the real NCLEX-RN, for an Arabic-speaking nursing student whose English is about A2 (keep the wording simple, but keep clinical terms in English).

WRITING RULES
- Each item = a short clinical scenario (age, setting, findings / lab values when useful) + ONE clear question. Test NCLEX thinking: priority, safety, ABCs, delegation, infection control, pharmacology, lab values, assessment before intervention, client teaching.
- Two item types: "single" (4 options, exactly one correct) and "multi" (select ALL that apply: 5 or 6 options, 2–4 correct). The assignment below tells you the type of each item: follow it.
- Distractors must be plausible and wrong for a clear clinical reason. Never use "all of the above" / "none of the above". Options similar in length. No trick wording, no ambiguity, no two defensible answers.
- Accuracy is everything: only standard, widely accepted nursing facts. Never invent doses, ranges or protocols. If a fact differs by region, avoid it.
- Different items must test different points (no near-duplicates). Other writers are writing the other items of the same exam AT THE SAME TIME, so stay inside the angle you are assigned for each item.
- SOURCE: if "STUDENT MATERIAL" is given and it matches what the student asked for (or he asks for an exam from his own questions), build the items on the facts, rules and traps in it — with NEW scenarios and numbers, never copy a question he already solved. Otherwise use general NCLEX knowledge on the requested topic. If no topic is named and no material is given, write a balanced mixed set.
- The app SHUFFLES the options after you write them and shows them as A, B, C… So NEVER refer to an option by its letter or position (no "option B", "choice 2", "the first answer", no \"both A and C\") — neither inside the options nor in the rationale. Name an option by its wording (e.g. \"Giving the drug now is wrong because…\").
- "rationale": 2–3 short sentences: why the key is right and why the strongest wrong option fails. Casual Egyptian Arabic, medical terms and key English phrases stay in English. "topic": 1–3 words in English (e.g. "Heart failure").

OUTPUT: valid JSON only (no markdown fences, no commentary). Item shape:
{"type":"single","stem":"…","options":["…","…","…","…"],"correct":[0],"rationale":"…","topic":"…"}
"correct" lists the zero-based indexes of the right options. The user message says exactly which wrapper object to write.${ARABIC_RULE}`;

/* what each item is about: spread over these angles so parallel batches do not repeat each other */
const ANGLES = [
  "pathophysiology + the key assessment findings (what the nurse sees / hears / measures)",
  "diagnostic and laboratory tests: normal vs abnormal values, preparation, what the result means for the nurse",
  "the PRIORITY nursing action (what to do first / the best next step)",
  "medications: action, major adverse effects, what to monitor, what to teach",
  "complications: recognising deterioration and the emergency response",
  "client teaching and discharge instructions (the answer that shows the client understood)",
  "delegation, safety, infection control and scope of practice",
  "special populations (older adult, child, pregnancy), nutrition and prevention",
];

const PER_BATCH = 3;      // items per request
const MAX_BATCHES = 4;    // parallel requests (the free key has a per-minute limit: do not go wild)

const shuffle = (arr) => { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/* The rationale is written BEFORE the options are shuffled. The prompt forbids "option B", but if one slips through it must follow
   its option to the new place, otherwise the student reads an explanation about the wrong choice. (No look-behind: old WebViews reject it.) */
const LTR_KEY = "(?:[Oo]ptions?|[Cc]hoices?|الاختيار(?:ات)?|الخيار(?:ات)?|اختيار|خيار|الإجابة|الاجابة)";
const LTR_ONE = "\\(?[A-F]\\)?(?![A-Za-z])";
const LTR_RE = new RegExp(`(^|[^A-Za-z])(${LTR_KEY})(\\s*)((?:${LTR_ONE})(?:\\s*(?:,|،|and|or|&|و|/)\\s*(?:${LTR_ONE}))*)`, "g");
export function remapLetters(text, inv) {
  if (!text) return text;
  return text.replace(LTR_RE, (all, pre, key, sp, list) => pre + key + sp + list.replace(/[A-F](?![A-Za-z])/g, (L) => {
    const n = inv[L.charCodeAt(0) - 65];
    return n == null ? L : String.fromCharCode(65 + n);
  }));
}

/* one raw item from the model → a finished item (options shuffled) or null */
function cleanQuestion(q) {
  if (!q || typeof q !== "object") return null;
  const opts = (Array.isArray(q.options) ? q.options : []).map((o) => String(o).replace(/^\s*\(?[A-Fa-f][).]\s+/, "").trim()).filter(Boolean);
  let correct = (Array.isArray(q.correct) ? q.correct : [q.correct]).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < opts.length);
  correct = [...new Set(correct)];
  if (opts.length < 2 || !correct.length || !String(q.stem || "").trim()) return null;
  const type = q.type === "multi" && correct.length > 1 ? "multi" : "single";
  if (type === "single" && correct.length > 1) correct = [correct[0]];
  const order = shuffle(opts.map((_, i) => i));
  const inv = []; order.forEach((old, now) => { inv[old] = now; });          // old position → new position
  return {
    type,
    stem: fixText(String(q.stem).trim()),
    options: order.map((i) => fixText(opts[i])),
    correct: order.map((old, now) => (correct.includes(old) ? now : -1)).filter((n) => n >= 0),
    rationale: remapLetters(fixText(String(q.rationale || "").trim()), inv),
    topic: fixText(String(q.topic || "").trim()).slice(0, 40),
  };
}

/* the complete item objects found so far inside a (possibly unfinished) streamed reply: {"questions":[ {…},{…}, {…unfinished */
function scanItems(text) {
  const out = [];
  const k = text.indexOf('"questions"');
  if (k < 0) return out;
  let i = text.indexOf("[", k);
  if (i < 0) return out;
  let depth = 0, inStr = false, esc = false, start = -1;
  for (i += 1; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') { inStr = true; continue; }
    if (c === "{") { if (depth === 0) start = i; depth++; }
    else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        const raw = text.slice(start, i + 1);
        let obj = null;
        try { obj = JSON.parse(raw); } catch (e) { try { obj = JSON.parse(raw.replace(/,\s*([}\]])/g, "$1")); } catch (e2) { obj = null; } }
        out.push(obj);
        start = -1;
      } else if (depth < 0) break;
    } else if (c === "]" && depth === 0) break;
  }
  return out;
}

const metaOf = (text, key) => {
  const m = text.match(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`));
  if (!m) return "";
  try { return JSON.parse(`"${m[1]}"`); } catch (e) { return m[1]; }
};

function parseJson(raw) {
  let t = String(raw || "").replace(/^\s*```[a-z]*\s*$/gim, "").trim();
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("bad json");
  t = t.slice(a, b + 1);
  try { return JSON.parse(t); } catch (e) { return JSON.parse(t.replace(/,\s*([}\]])/g, "$1")); }
}

/* near-duplicate detector (two batches can still pick the same fact) */
const words = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9\u0600-\u06FF]+/).filter((w) => w.length > 3));
const similar = (a, b) => {
  const A = words(a), B = words(b);
  if (A.size < 6 || B.size < 6) return false;
  let n = 0; A.forEach((w) => { if (B.has(w)) n++; });
  return n / (A.size + B.size - n) >= 0.62;
};

/* how many items per request, and what each item is about */
function planBatches(count, hasFiles) {
  const nb = Math.min(hasFiles ? 2 : MAX_BATCHES, Math.max(1, Math.ceil(count / PER_BATCH)));
  const out = [];
  let from = 0, rest = count;
  for (let b = 0; b < nb; b++) {
    const n = Math.ceil(rest / (nb - b));
    const items = [];
    for (let i = from; i < from + n; i++) items.push({ no: i + 1, type: count >= 5 && i % 4 === 3 ? "multi" : "single", angle: ANGLES[i % ANGLES.length] });
    out.push({ items, withMeta: b === 0 });
    from += n; rest -= n;
  }
  return out;
}

const OWN_RE = /(أسئلتي|اسئلتي|أسئلتى|ذاكرت|ذاكرتها|شروحاتي|شرحي|مادتي|المكتبة|من اللي|saved|my (own )?(questions|notes|library|material))/i;

export async function makeExam({ apiKey, request, questions, topics, focusId, focusTopicId, attach = [], extra = "", signal, onStatus, onProgress }) {
  const count = examCount(request);
  const lists = getModelLists(apiKey);
  const models = [...lists.fast, ...lists.pro];
  const mat = materialFor({ questions, topics, query: request, focusId, focusTopicId });
  /* the student's own items go to the model only when they match the request (or he asked for them): otherwise they are just noise and extra input */
  const useMat = !!mat.text && (mat.matched || OWN_RE.test(request));
  const files = attach.length ? [{ text: "The student attached these files: build the exam from them." }, ...sourceParts({ kind: "bundle", items: attach }, null)] : [];
  const shared = `STUDENT REQUEST: ${request}\n\n${extra ? `WHAT THE STUDENT IS LOOKING AT RIGHT NOW (use it when the request says "this question / this topic"):\n${extra}\n\n` : ""}${useMat ? `STUDENT MATERIAL (his saved questions and lessons — use it ${mat.matched ? "as the source" : "because he asked for an exam from his own questions"}):\n${mat.text}\n\n` : "STUDENT MATERIAL: not used for this request — use general NCLEX knowledge on the requested topic.\n\n"}`;

  /* ── the batches ── */
  const batches = planBatches(count, attach.length > 0).map((b) => ({ ...b, seen: 0, items_out: [], done: false, error: null }));
  let title = "", intro = "", lastSig = "";

  /* what the student may see right now: the batches in order, up to and including the first one that is still writing */
  const snapshot = () => {
    const list = [];
    let allDone = true;
    for (const b of batches) {
      for (const q of b.items_out) if (q && !list.some((x) => similar(x.stem, q.stem))) list.push(q);
      if (!b.done) { allDone = false; break; }
    }
    return { list: list.slice(0, count), allDone };
  };
  const emit = (force) => {
    const { list, allDone } = snapshot();
    const sig = `${list.length}|${allDone}|${title}`;
    if (!force && sig === lastSig) return;
    lastSig = sig;
    if (list.length && onProgress) {
      onProgress({ title: fixText(title || "امتحان").slice(0, 80), intro: fixText(intro).slice(0, 240), questions: list, total: count, loading: !allDone && list.length < count });
    }
  };
  const absorb = (b, text) => {          // an item, once seen, is never changed afterwards (a restarted answer cannot rewrite what is on screen)
    const found = scanItems(text);
    for (let j = b.seen; j < found.length; j++) b.items_out.push(cleanQuestion(found[j]));
    b.seen = Math.max(b.seen, found.length);
    if (b.withMeta) { title = title || metaOf(text, "title"); intro = intro || metaOf(text, "intro"); }
  };

  const inner = new AbortController();
  const link = () => inner.abort();
  if (signal) { if (signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" }); signal.addEventListener("abort", link); }
  let fatal = null;
  onStatus && onStatus("بيكتب الأسئلة…");
  const onNotice = (n) => onStatus && onStatus(`Google زحمة شوية… بنحاول تاني بعد ${Math.max(1, Math.ceil((n.waitMs || 1000) / 1000))} ث`);

  const runBatch = async (b, avoid = "") => {
    const n = b.items.length;
    const plan = b.items.map((it) => `- Item ${it.no} of ${count}: type "${it.type}" · angle: ${it.angle}`).join("\n");
    const wrapper = b.withMeta
      ? `{"title":"<short Arabic title, e.g. امتحان قصور القلب>","intro":"<one friendly Arabic sentence>","questions":[ … ]}  — write "title" and "intro" FIRST, then "questions".`
      : `{"questions":[ … ]}  — nothing else: no title, no intro.`;
    const user = `${shared}THE WHOLE EXAM has ${count} items, but YOU write ONLY the ${n} item${n > 1 ? "s" : ""} listed here (exactly ${n}, in this order). The angle is where the item's question should come from, inside the requested topic; if the topic or the student material does not fit an angle, take the closest different point:\n${plan}\n${avoid}\nWrite this JSON object: ${wrapper}`;
    try {
      const res = await runTask({
        apiKey, models, task: "exam:part", system: SYSTEM, parts: [...files, { text: user }],
        spec: { levels: ["low", "minimal"], budget: 1024 }, maxOut: 6000 + n * 1400,
        hedgeMs: 10000, firstMs: 90000, idleMs: 45000, signal: inner.signal, onNotice,
        onText: (t) => { absorb(b, t); emit(); },
      });
      absorb(b, res.text);
      if (!b.items_out.some(Boolean)) {                 // the streamed scan found nothing usable → parse the whole reply once
        try { (parseJson(res.text).questions || []).forEach((q) => b.items_out.push(cleanQuestion(q))); } catch (e) { /* handled by the count check below */ }
      }
    } catch (e) {
      if (e && e.name === "AbortError") return;
      b.error = e;
      if (e && (e.fatal || e.blocked)) { fatal = fatal || e; inner.abort(); }
    } finally {
      b.done = true;
      emit();
    }
  };

  try {
    await Promise.all(batches.map((b) => runBatch(b)));
    if (signal && signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
    if (fatal) throw fatal;

    /* some items were lost (a batch failed, an item was malformed, or two items were near-duplicates) → ONE top-up request for exactly the missing ones */
    let { list } = snapshot();
    if (list.length && list.length < count) {
      const missing = count - list.length;
      const from = list.length;
      const items = [];
      for (let i = from; i < from + missing; i++) items.push({ no: i + 1, type: count >= 5 && i % 4 === 3 ? "multi" : "single", angle: ANGLES[(i + 3) % ANGLES.length] });
      const avoid = `ALREADY WRITTEN — do not repeat these points:\n${list.map((q) => `- ${q.stem.slice(0, 110)}`).join("\n")}\n`;
      const extraBatch = { items, withMeta: false, seen: 0, items_out: [], done: false, error: null };
      batches.push(extraBatch);
      onStatus && onStatus("بنكمّل الأسئلة الناقصة…");
      await runBatch(extraBatch, avoid);
      if (signal && signal.aborted) throw Object.assign(new Error("aborted"), { name: "AbortError" });
      if (fatal) throw fatal;
    }
  } finally {
    if (signal) signal.removeEventListener("abort", link);
  }

  const { list } = snapshot();
  if (!list.length) {
    const first = batches.map((b) => b.error).find(Boolean);
    throw first || Object.assign(new Error("ما قدرتش أطلّع امتحان سليم المرة دي. جرّب تاني."), { detail: "exam: no valid questions" });
  }
  return {
    exam: {
      title: fixText(title || "امتحان").slice(0, 80), intro: fixText(intro).slice(0, 240), questions: list, total: list.length, loading: false,
      answers: {}, cur: 0, done: false, at: Date.now(),
    },
    requested: count, short: list.length < count, fromMaterial: useMat && !!mat.matched, titles: mat.titles,
  };
}
