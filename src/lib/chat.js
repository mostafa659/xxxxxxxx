/* ───────────── Chat with the tutor about ONE question ─────────────
   History is folded into a single prompt (the lesson already on screen is the context), so no change to the
   streaming/hedging engine in gemini.js was needed. Streams like everything else. */

import { CHIPS } from "./config.js";
import { getModelLists, runTask } from "./gemini.js";
import { weakFirst } from "./router.js";
import { sourceParts, sourceNote } from "./docs.js";
import { ARABIC_RULE } from "./text.js";
import { libraryContext } from "./library.js";
import { createFileCache, looksLikeFileError } from "./gfiles.js";
import { isBigAsk, isLibraryAsk, localOutline, runSliced, PLAN_SYSTEM, sliceInstruction } from "./chatflow.js";
import { getEnginePrefs } from "./providers.js";
import { readSources } from "./sources.js";
import { findSaved, saveAnswer, placeOf } from "./reuse.js";

/* v3.26 — the tutor chat was slow for three reasons, all fixed here:
   1 · it ALWAYS asked Gemini to think at the "high" level (4096-token budget): seconds of silence before the first word, for a
       "what does this mean?" question. Now a normal question thinks "low"; an objection, a calculation or a "compare / why" gets "medium".
   2 · for study material, every message re-sent the whole PDF / page images (up to 14 MB). Now they are uploaded once and remembered.
   3 · the library context sat inside the system prompt, so the system prompt changed on every message and Gemini's automatic prompt
       cache never hit. Now the system prompt is the same for the whole conversation and the changing part goes last.
   Big requests ("explain everything in detail") are written in parallel sections (chatflow.js). */
const CFG = { maxOut: 12000, firstMs: 45000, idleMs: 60000 };   // v3.27: 45 s (was 90): a request silent for 45 s is stuck, and the next lane takes over sooner

const HARD = /(معترض|مش موافق|غلط|ليه|لماذا|why|wrong|disagree|object|compar|قارن|فرق|احسب|calculate|dose|جرعة|اثبت|prove|تأكد|re-?check|الصح)/i;
/* v3.35 · an EASY question is answered by the weakest model with almost no thinking (so a strong model's tokens are not spent on "what does NPO mean?").
   Easy = one short, self-contained line, nothing attached, no number (doses, labs and calculations stay with the normal model), none of the HARD words
   (why / wrong / compare / re-check …), and not deep inside a long conversation. Pure text rules: this costs no request and no token. */
const EASY_MAX_CHARS = 140, EASY_MAX_WORDS = 22;
/* a short message can still ask for a BIG or CREATIVE job: those never count as easy */
const NOT_EASY = /(اشرح|شرح|لخ[صّ]|لخّص|summar|explain|امتحان|اختبار|exam|quiz|ارسم|رسم|draw|diagram|خطوات|steps?\b|مثال|example|تفصيل|detail|mnemonic|خطة|plan\b|اكتب|write|اعمل|ذاكرت|studied|حلل|analy[sz]e|اربط|relate)/i;
export function isEasyAsk(text, { files = 0, turns = 1 } = {}) {
  const t = String(text || "").trim();
  if (!t || files || turns > 4) return false;
  if (t.length > EASY_MAX_CHARS || t.split(/\s+/).length > EASY_MAX_WORDS || /[\n\r]/.test(t)) return false;
  if (HARD.test(t) || NOT_EASY.test(t) || /[0-9٠-٩]/.test(t)) return false;
  return true;
}
export function thinkFor(text) {
  const t = String(text || "");
  return HARD.test(t) || t.length > 400
    ? { levels: ["medium", "low"], budget: 2048 }
    : { levels: ["low", "minimal"], budget: 1024 };
}
/* ── Reply level (v3.27) ──
   The student chooses how much effort the tutor puts into the next answers. The level decides WHICH MODEL answers and HOW HARD it thinks:
     quick     the small fast model, almost no thinking, a short answer           → seconds
     balanced  the everyday model, thinking adapted to the question (the old behaviour) → about 10 s
     deep      the strong "Pro" model, medium thinking                              → about 30 s
     max       the strong "Pro" model, deepest thinking, checks itself             → one to two minutes
   A higher level is more accurate and more thorough, but the first word comes later: the app says so next to the selector. */
export const REPLY_LEVELS = [
  { id: "quick", label: "سريع", icon: "zap", wait: "ثواني", hint: "رد قصير وفوري. مناسب للمعنى والتعريف والأسئلة البسيطة." },
  { id: "balanced", label: "متوازن", icon: "scale", wait: "حوالي 10 ثواني", hint: "الاختيار الأنسب لأغلب الأسئلة." },
  { id: "deep", label: "عميق", icon: "brain", wait: "حوالي 30 ثانية", hint: "نموذج أقوى بيفكّر قبل ما يرد. للمقارنات والاعتراضات والحالات." },
  { id: "max", label: "أقصى دقة", icon: "target", wait: "من دقيقة لدقيقتين", hint: "أقوى نموذج وأعمق تفكير، وبيراجع نفسه. للأسئلة الصعبة والمهمة." },
];
export const DEFAULT_LEVEL = "balanced";
export const levelOf = (id) => REPLY_LEVELS.find((l) => l.id === id) || REPLY_LEVELS.find((l) => l.id === DEFAULT_LEVEL);

/* v3.27 — Google Search is on for every tutor answer: look the facts up first, answer from what was found, and let the app show the sources */
const SEARCH_RULE = `\n\nSEARCH FIRST (anti-hallucination): you have Google Search. For EVERY factual, clinical, drug, lab-value, procedure, NCLEX-rule or statistic claim you are about to make, search first and write from what the results say, preferring authoritative sources (WHO, CDC, NIH / MedlinePlus, FDA, NCSBN, nursing-school and major hospital pages, peer-reviewed or textbook-style references). If the results disagree, or nothing reliable comes back, say so plainly instead of guessing or filling the gap. Facts that come from the student's saved items (shown above) can be used as given. Search in ONE round (one or a few queries at once), then answer: never search again and again. Never write URLs, footnotes or a "sources" list yourself: the app shows the sources it found under your answer.`;

/* v3.32 — Google Search costs seconds before the first word (the model searches, reads, then writes). It is worth it when the answer needs a FACT from outside
   (a dose, a lab range, a rule, a statistic). It is wasted when the student only asks to re-say, translate, shorten or format what is already on the screen,
   or just says thanks: no new fact is written, so there is nothing to check. Those turns skip the search; every other turn searches exactly as before.
   The test is deliberately strict: a message must be SHORT and consist of such a request, and must not ask for any number, drug, dose, lab value, "normal",
   "guideline", "protocol" or "why" (those keep the search). When in doubt → search. */
const NO_FACT_AR = /^(?:\s*(?:ترجم(?:ها|ه|لي)?|ترجمة|اشرح(?:ها|ه|لي)?(?:\s+(?:تاني|مرة\s+تانية|ببساطة|أبسط|بشكل\s+أبسط))+|بسّ?ط(?:ها|ه|لي)?|لخّ?ص(?:ها|ه|لي)?\s*(?:دي|ده|دا|اللي\s+فوق)?|اختصر(?:ها|ه)?|كرر(?:ها|ه)?|أعد(?:ها|ه)?\s*(?:بشكل\s+أقصر)?|اكتب(?:ها|ه)?\s+(?:تاني|في\s+نقط|نقاط)|رتّ?ب(?:ها|ه)?|شكرا|شكراً|تمام|ماشي|اوكي|أوكي|حلو|جميل|طيب|فهمت|مفهوم)[\s.!؟?،,؛:\-ـ]*)+$/;
const NO_FACT_EN = /^(?:\s*(?:translate(?:\s+(?:it|this|that))?|(?:explain|say)\s+(?:it|this|that)(?:\s+(?:again|simpler|more\s+simply))+|simplify(?:\s+(?:it|this|that))?|summari[sz]e(?:\s+(?:it|this|that))?|shorten(?:\s+(?:it|this|that))?|repeat(?:\s+(?:it|this|that))?|rephrase(?:\s+(?:it|this|that))?|thanks?|thank\s+you|ok(?:ay)?|got\s+it|i\s+understand|nice|great)[\s.!?,;:\-]*)+$/i;
export function needsSearch(text) {
  const t = String(text || "").trim();
  if (!t) return true;
  if (t.length > 60) return true;                                         // a real question is rarely this short and still pure formatting
  if (/\d/.test(t)) return true;                                          // a number in the message → a fact is involved
  return !(NO_FACT_AR.test(t) || NO_FACT_EN.test(t));
}

const LEVEL_NOTE = {
  quick: `\n\nREPLY LEVEL — QUICK: the student wants a fast answer. Give the shortest useful answer (about 60–90 words): the decision or definition first, then at most one clue or example. No long lists, no extra background.`,
  balanced: "",
  deep: `\n\nREPLY LEVEL — DEEP: the student chose a more careful answer. Reason it through before you write: check every option / claim against the clinical rule, and name the decisive clue. You may be a little longer than usual (up to about 250 words) when that makes the reasoning clear.`,
  max: `\n\nREPLY LEVEL — MAXIMUM ACCURACY: the student chose the most careful answer. Work the problem out independently from scratch, check it against standard nursing references and NCLEX logic, test the alternatives, and fix any weak step before answering. Say plainly how sure you are and what the answer depends on. Be as long as the explanation truly needs (up to about 400 words), but never padded.`,
};

/* the plan for one answer: models in order, thinking, timeouts, engine mode.
   `lists` = getModelLists(): { fast: [...], pro: [...] }. Plain logic (no network) so it is tested in Node. */
export function replyPlan(levelId, lists, text, { easy = false } = {}) {
  const id = levelOf(levelId).id;
  const fast = (lists && lists.fast) || [], pro = (lists && lists.pro) || [];
  const uniq = (a) => [...new Set(a)];
  if (id === "quick") {
    const lite = fast.filter((m) => /lite/.test(m));
    return {
      id, models: uniq([...lite, ...fast.filter((m) => !/lite/.test(m)), ...pro]),
      think: { levels: ["minimal", "low"], budget: 0 }, maxOut: 4000, firstMs: 30000, idleMs: 45000, engineMode: "speed", hedgeClass: null, slice: false,
    };
  }
  if (id === "deep") {
    return {
      id, models: uniq([...pro, ...fast]),
      think: { levels: ["medium", "low"], budget: 4096 }, maxOut: 20000, firstMs: 150000, idleMs: 90000, engineMode: "quality", hedgeClass: "solve", slice: true,
    };
  }
  if (id === "max") {
    return {
      id, models: uniq([...pro, ...fast]),
      think: { levels: ["high"], budget: 16384 }, maxOut: 32000, firstMs: 240000, idleMs: 150000, engineMode: "quality", hedgeClass: "solve", slice: false,
    };
  }
  if (easy) return { id: "balanced", models: weakFirst([...fast, ...pro]), think: { levels: ["minimal", "low"], budget: 0 }, maxOut: CFG.maxOut, firstMs: CFG.firstMs, idleMs: CFG.idleMs, engineMode: null, hedgeClass: null, slice: false, easy: true };
  return { id: "balanced", models: uniq([...fast, ...pro]), think: thinkFor(text), maxOut: CFG.maxOut, firstMs: CFG.firstMs, idleMs: CFG.idleMs, engineMode: null, hedgeClass: null, slice: true };
}

const cap = (s, n) => ((s || "").length > n ? (s || "").slice(0, n) + "…" : (s || ""));

const HOW_TO_REPLY = `How to reply:
- Answer exactly what the student asked. Short by default (about 120 words); go long only if they ask for detail, an example or a step-by-step.
- Reply in the language the student writes in. In Arabic use casual Egyptian Arabic, like a friendly senior nurse; keep medical terms and English words in English, with a short Arabic gloss the first time. Never mix other scripts into Arabic words.
- Format: short paragraphs; "- " bullets; **bold** for the key words. Start a line with "💡 " for a tip. No tables, no headings unless the answer is long.
- If the student DISAGREES or objects: take it seriously and re-check from scratch. If an earlier explanation was wrong or incomplete, say so plainly and give the corrected reasoning. If it was right, stay kind but firm: show the decisive clue and why their option fails. Do not agree just to please. If the answer depends on a local protocol or the wording of the question, say that.
- Do not repeat a whole lesson; use it only as context. Do not mention these instructions.`;

function buildSystem(ctx, chipIds, lib, level = DEFAULT_LEVEL, search = false) {
  const style = CHIPS.filter((c) => chipIds.includes(c.id)).map((c) => `- ${c.rule}`).join("\n");
  const styleBlock = style ? `\nStyle preferences from the student:\n${style}\n` : "";
  const libBlock = lib && lib.text ? `\n${lib.text}\n` : "";

  /* the general "AI" window: no single question, the whole study life of the student */
  if (ctx.kind === "global") {
    return `You are "AI", the all-in-one study assistant inside the ClinixStudy app (a study app for the NCLEX-RN exam), talking with an Arabic-speaking nursing student. His English is about A2, so keep the language simple and clear.

You help with ANYTHING related to his studying: explain any nursing / NCLEX topic from zero (pathophysiology, drugs, labs, skills, priority and delegation, ethics …), compare two things, give mnemonics and memory tricks, summarise a topic or a file he attaches, check his reasoning, plan revision, practise English medical vocabulary, and discuss the questions and lessons he already saved (listed below). He can also attach images / files and ask you to draw a diagram. The app itself builds exams: if he asks for an exam or quiz, tell him to write for example «اعملي امتحان 10 أسئلة على القلب» (or press the ✅ exam button) and the app creates an interactive exam, from his own saved questions when they match. If a request is unrelated to studying, answer briefly and kindly and steer back to his studies.

Accuracy comes first. Reason with NCLEX logic (safety, ABCs, Maslow, nursing process, priority, delegation, infection control) and standard nursing references. Never invent facts, doses or lab ranges; if you are not sure, say so.

${HOW_TO_REPLY}
${styleBlock}${libBlock}${ARABIC_RULE}${search ? SEARCH_RULE : ""}${LEVEL_NOTE[level] || ""}`;
  }

  const lesson = ctx.kind === "lesson";
  return `You are a warm, sharp senior NCLEX-RN tutor chatting with a nursing student about ${lesson ? "ONE piece of study material (attached files; the summary and the lesson you already gave are below)" : "ONE practice question (given below)"}. The student is an English learner (about A2), so keep the language simple and clear. You can also see the rest of his saved library (below, when he has one), so connect this ${lesson ? "material" : "question"} to what he studied before when it genuinely helps.

Accuracy comes first. Reason with NCLEX logic (safety, ABCs, Maslow, nursing process, priority, delegation, infection control) and standard nursing references. Never invent facts, doses or lab ranges; if you are not sure, say so.

${HOW_TO_REPLY}
${styleBlock}
=== ${lesson ? "SUMMARY OF THE STUDY MATERIAL" : "THE QUESTION (as read from the student's file)"} ===
${cap(ctx.question, 7000) || "(not transcribed yet — read it from the attached source)"}

=== LESSON ALREADY SHOWN TO THE STUDENT ===
${cap(ctx.explanation, 7000) || "(none yet)"}
${ctx.tricks ? `\n=== TRAPS ALREADY SHOWN ===\n${cap(ctx.tricks, 3000)}` : ""}
${libBlock}${ARABIC_RULE}${search ? SEARCH_RULE : ""}${LEVEL_NOTE[level] || ""}`;
}

export async function askChat({ apiKey, history, ctx, chipIds = [], attach = [], library, signal, onText, onCodes, onStage, level = DEFAULT_LEVEL }) {
  const lists = getModelLists(apiKey);
  const turns = history
    .filter((m) => m.text && !m.err)
    .slice(-12)
    .map((m) => `${m.role === "user" ? "Student" : "Tutor"}: ${cap(m.text, m.role === "user" ? 2000 : 1800)}${m.atts && m.atts.length ? ` [attached: ${m.atts.map((a) => a.name).join(", ")}]` : ""}`)
    .join("\n\n");
  const userTurns = history.filter((m) => m.role === "user" && m.text);
  const lastText = (userTurns[userTurns.length - 1] || {}).text || "";

  /* what the student is asking about right now → which saved items to show the model in full */
  let lib = null;
  if (library && library.questions && library.questions.length) {
    const last = userTurns[userTurns.length - 1];
    const before = userTurns[userTurns.length - 2];
    const query = [last && last.text, last && last.text.length < 40 && before ? before.text : "", ctx.title || "", ctx.kind === "global" ? "" : cap(ctx.question, 200)].filter(Boolean).join("\n");
    lib = libraryContext({ questions: library.questions, topics: library.topics, query, focusId: library.focusId, focusTopicId: library.focusTopicId });
    if (onCodes && lib.codes) onCodes(lib.codes);
  }
  /* the changing part (library context + the conversation) goes LAST: the system prompt and the files in front of it stay identical
     from one message to the next, which is what lets Gemini reuse its cache */
  const libText = lib && lib.text ? `${lib.text}\n\n` : "";
  const user = `${libText}${turns}\n\nWrite the Tutor's next reply to the student's last message.`;
  const plan = replyPlan(level, lists, lastText, { easy: isEasyAsk(lastText, { files: attach.length, turns: userTurns.length }) && !isBigAsk(lastText, { files: attach.length }) && !isLibraryAsk(lastText) });
  const { models } = plan;
  /* Google Search before every answer (the student can switch it off). One exception: "summarise what I studied" is a summary of the student's OWN
     saved items, which are shown to the writers in full and cited by code: a web search would only add waiting, never a fact to check. */
  const libOnly = ctx.kind === "global" && !!(library && library.questions && library.questions.length) && isLibraryAsk(lastText);
  const searchOn = getEnginePrefs().search !== false && !libOnly && needsSearch(lastText);
  /* v3.35 · the same EASY question asked again (same words, first message, nothing attached, same place): the saved answer is shown at once: no request, no token (reuse.js).
     Never a piece of an old answer pasted into a new request, never a merely similar question: that would cost more tokens and no less time. */
  const reuseOk = plan.easy === true && getEnginePrefs().reuse !== false && history.length === 1 && !attach.length;
  const place = placeOf(ctx);
  if (reuseOk) {
    const hit = findSaved({ text: lastText, place });
    if (hit) { if (onText) onText(hit.answer); return { text: hit.answer, model: "saved", sources: hit.sources || null, searchOn: !!hit.searched, cached: true }; }
  }
  const system = buildSystem(ctx, chipIds, null, plan.id, searchOn);
  const found = [];                                         // what Google Search used, one entry per request (a big answer has several writers)

  const hasText = !!(ctx.question && ctx.question.trim());
  const attachCtx = ctx.kind !== "global" && (ctx.kind === "lesson" || !hasText);   // study material: the model always sees the real files
  const base = attachCtx ? [...sourceParts(ctx.doc, ctx.imageUrl), { text: sourceNote(ctx.doc, "", ctx.kind) }] : [];
  const files = attach.length
    ? [{ text: "The student attached these files to his LAST message (read them and use them in your answer):" }, ...sourceParts({ kind: "bundle", items: attach }, null)]
    : [];
  const media = [...base, ...files];

  /* big files are uploaded once and remembered (lib/gfiles.js); any problem → they go inline, exactly as before */
  const cache = createFileCache({ apiKey, persist: true });
  const think = plan.think;
  /* `o` overrides the level's plan for ONE call (the tiny outline request of a big answer never needs the strong model) */
  const one = async (sys, usr, task, spec, maxOut, cb, o = null) => {
    const p = o || plan;
    const srch = o && o.search !== undefined ? o.search : searchOn;      // the tiny outline request never searches
    const call = async (useFiles) => runTask({
      apiKey, models: p.models || models, task, system: sys,
      parts: [...(useFiles ? await cache.swap(media, signal) : media), { text: usr }],
      spec, maxOut, firstMs: p.firstMs, idleMs: p.idleMs, signal, onText: cb, search: srch,
      /* v3.34: the same prompt minus the "search first" rule, used when the engine has to send the request without the search tool (gemini.js) */
      ...(srch ? { noSearchSystem: String(sys).split(SEARCH_RULE).join("") } : {}),
      /* only a Gemini lane can search: an answer that must carry sources never starts on a small extra engine */
      ...(srch ? { engineMode: "quality" } : p.engineMode ? { engineMode: p.engineMode } : {}), ...(p.hedgeClass ? { hedgeClass: p.hedgeClass } : {}),
    });
    const track = (r) => { if (r && r.grounding) found.push(r.grounding); return r; };
    try { return track(await call(true)); }
    catch (e) {
      if (cache.used && !(e && e.name === "AbortError") && !(signal && signal.aborted) && looksLikeFileError(e)) { cache.disable(); return track(await call(false)); }
      throw e;
    }
  };

  /* a big request: outline → sections written at the same time (never for a short question, never when the student turned it off).
     v3.27: "summarise what I studied" is recognised as a big request (it was written as one endless answer before), it is split into up to 4
     sections, and its outline comes from the student's own topics: no planning request, no waiting for it, and every writer sees the full
     text of the saved items it owns. Any other big request still gets its outline from a quick model (the smallest, fastest one first). */
  if (plan.slice && getEnginePrefs().slice && isBigAsk(lastText, { files: attach.length })) {
    const libAsk = ctx.kind === "global" && !!(library && library.questions && library.questions.length) && isLibraryAsk(lastText);
    const maxSlices = libAsk ? 4 : 3;
    const given = libAsk ? localOutline(library.topics, library.questions, maxSlices) : null;
    const quickModels = [...lists.fast.filter((m) => /lite/.test(m)), ...lists.fast.filter((m) => !/lite/.test(m)), ...lists.pro];
    const userFor = (outline, k) => {
      const ids = outline[k] && outline[k].ids;
      if (!ids || !ids.length) return user;
      const sl = libraryContext({ questions: library.questions, topics: library.topics, query: lastText, forceIds: ids });
      return `${sl.text ? sl.text + "\n\n" : ""}${turns}\n\nWrite the Tutor's next reply to the student's last message.`;
    };
    if (onStage && !given) onStage({ kind: "plan" });
    const sliced = await runSliced({
      signal, onText, maxSlices, outline: given,
      outlineFrom: (o) => onStage && onStage({ kind: "write", n: o.length, done: 0 }),
      onProgress: (p) => onStage && onStage({ kind: "write", n: p.n, done: p.done }),
      ask: (kind, cb) => {
        if (kind === "plan") {
          return one(PLAN_SYSTEM, `${cap(turns, 3500)}\n\nReturn the JSON outline for the student's last message.`, "lesson:chatplan", { levels: ["minimal", "low"], budget: 0 }, 1200, null,
            { models: quickModels, firstMs: CFG.firstMs, idleMs: CFG.idleMs, search: false });
        }
        return one(system + sliceInstruction(kind.outline, kind.slice), userFor(kind.outline, kind.slice), "lesson:chatpart", think, plan.maxOut, cb);
      },
    });
    if (sliced.sliced) return { text: sliced.text, model: sliced.model, sources: readSources(found), searchOn };
  }
  const r = await one(system, user, "lesson:chat", think, plan.maxOut, onText);
  const sourcesOut = readSources(found);
  if (reuseOk && r.text) saveAnswer({ text: lastText, place, answer: r.text, sources: sourcesOut, searched: searchOn });
  return { text: r.text, model: r.model, sources: sourcesOut, searchOn };
}


/* the prompt for the image model: the lesson is the context, the student's sentence is the request */
export function imagePrompt(ctx, request) {
  return `Create the image the student asks for. It is study material for an Arabic-speaking nursing student preparing for the NCLEX-RN.
Style (unless the student asks for another one): a clean, accurate, well-labelled educational illustration or diagram, flat colours, high contrast, light background, uncluttered. Any text inside the image must be short, spelled correctly, large and legible, in English (Arabic labels only if the student asks for them). Medical accuracy comes first: never invent anatomy, values or drugs.

CONTEXT — the question and lesson he is studying (use it only to make the picture relevant):
${cap(ctx.question, 1500) || "(none)"}
${cap(ctx.explanation, 1500)}

STUDENT REQUEST: ${request}`;
}
