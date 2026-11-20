/* ───────────── Analysis orchestration ─────────────
   v3.23 — FEWER REQUESTS (Google's quota counts every one):

     ocr      → LESSONS only (v3.40.10): the background study summary. A question no longer asks for a transcript of itself.
     words    → new_words                                  fast model, no thinking
     reason   → explanation + tricks, by LESSON_MODE (config.js / VITE_LESSON_MODE):
                "fast" (default): silent solve → part A ∥ part B-main ∥ part B-traps  (three short streams at once, 6 requests)
                "split": part A ∥ part B (4 requests)   ·   "single": one long request (3 requests, slowest)

   Before v3.23: ocr + words + solve + lessonA + lessonB (+ glitch rewrites + duplicate "hedged" fallbacks).
   Now: no rewrites, no duplicates; a busy moment is handled by the retry engine (2 s · 4 s · 8 s) in gemini.js. */

import { MODES, LESSON_MODE, LESSON_SLICES, SLICE_MIN_PAGES } from "./config.js";
import { buildOcrPrompt, buildWordsPrompt, buildSolvePrompt, buildLessonPrompt, buildLessonAPrompt, buildLessonBPrompt, buildStudySummaryPrompt, buildStudyLessonPrompt, buildStudyAPrompt, buildStudyBPrompt, buildStudyHeadPrompt, buildStudySlicePrompt, buildStudyTailPrompt, studyHeadings } from "./prompts.js";
import { createSlicedLesson, shouldSlice } from "./lessonflow.js";
import { fixText, ARABIC_RULE } from "./text.js";
import { cleanOcr, cleanWords, cleanBrief, splitReason } from "./parse.js";
import { inferProfile, profileKey } from "./profile.js";
import { ensureKb, verifyText } from "./trust.js";
import { buildSourceModel } from "./provenance.js";
import { cleanResidue } from "./accuracy.js";
import { kbReady } from "./kb/index.js";
import { prepareSpecializedPrompt } from "./kb/specialized-prompt.js";
import { render, indexSource, HIGH_RISK } from "./accuracy.js";
import { stats as trustStats } from "./trust.js";
import { assessSolve, parseBrief, banner as makeBanner, reconcileLesson } from "./solvecheck.js";
import { selectClaims, applyCached, applyVerdicts } from "./claims.js";
import { addGaps } from "./reports.js";
import { getModelLists, runTask } from "./gemini.js";
import { weakFirst } from "./router.js";
import { sourceParts, sourceNote, itemsFromSaved } from "./docs.js";
import { createFileCache, looksLikeFileError } from "./gfiles.js";
import { stageOf, summarize } from "./latency.js";
import { isSmallKey, orderForTask } from "./quota.js";
import { PAID, SOLVE_BOX, tasksFor } from "./config.js";

export const TASK_KEYS = {
  ocr: ["original_question_text"],
  words: ["new_words"],
  reason: ["explanation", "tricks"],
};

const SIMPLE_CFG = {
  ocr: { tier: "fast", levels: ["minimal", "low"], budget: 0, maxOut: 4000, firstMs: 40000, idleMs: 30000 },
  words: { tier: "fast", levels: ["low", "minimal"], budget: 1024, maxOut: 12000, firstMs: 45000, idleMs: 30000 },   // 1024: the model has to check every word's CEFR level, a few more thinking tokens make that check honest
};

const has = (ids, id) => Array.isArray(ids) && ids.includes(id);
const isAbort = (err) => !err || err.name === "AbortError";
const secs = (ms) => Math.round(ms / 100) / 10;

export function createAnalysis({ kind = "question", history, dataUrl, doc, extra, chips, apiKey, modeId, profile: profileArg, onUpdate, onDone, onError, onNotice, onTrust }) {
  const L = kind === "lesson";                 // study material (books, notes, slides, pasted text) instead of one exam question
  const mode = MODES[modeId] || MODES.balanced;
  const wordsCap = L ? { a: Math.round(mode.write.words.a * 1.7), b: Math.round(mode.write.words.b * 1.4) } : mode.write.words;
  const lists = getModelLists(apiKey);
  const src = sourceParts(doc, dataUrl);       // the screenshot, the PDF or the text document
  const note = sourceNote(doc, extra, kind);   // "" for a plain screenshot
  const live = {};

  /* ── v3.43 · the accuracy architecture around the SAME requests (no request, token or wait is added) ── */
  let ocrText = "", assess = null, briefRaw = "";
  const verdictLog = [];                                        // {claimList, verdicts, links} of every proof request that carried claims
  /* ONE source model for every source type (lib/provenance.js): text / Word / audio / a PDF's text layer / the extraction stage's OCR of a screenshot or scanned PDF */
  let extraction = null;                                        // { sourceType, text, complete } — what the extraction STAGE read (the only text a screenshot or scanned PDF ever has)
  const srcItems = () => (doc ? itemsFromSaved(null, doc) : dataUrl ? [{ t: "image", name: "image" }] : []);
  const srcTypeOf = () => { const it = srcItems(); return it.some((x) => x.t === "image") ? "image" : it.some((x) => x.t === "pdf") ? "pdf" : "text"; };
  let _model = null, _modelKey = "";
  const srcModel = () => {                                      // built once per extraction state (items never change during an analysis): never on the request path twice
    const key = extraction ? `${extraction.complete}:${extraction.text.length}` : "-";
    if (_model && _modelKey === key) return _model;
    _modelKey = key;
    return (_model = buildSourceModel({ items: srcItems(), extractions: extraction ? [{ ...extraction }] : [] }));
  };
  let _prof = null, _profKey = "";
  const sample = () => (doc ? itemsFromSaved(null, doc).map((x) => (x.t === "text" ? x.text : x.t === "pdf" ? x.ptext || "" : "")).join("\n").slice(0, 20000) : "");   // a keyword scan needs a sample, not the whole book
  const prof = () => {
    if (profileArg) return profileArg;
    const documentText = sample();
    const detectionText = `${ocrText}\n${briefRaw}\n${documentText}`;
    const key = `${ocrText.length}:${briefRaw.length}:${documentText.length}`;
    if (_prof && _profKey === key) return _prof;
    _profKey = key;
    return (_prof = inferProfile(detectionText));
  };
  ensureKb(prof()).catch(() => {});                              // lazy, off the critical path: the KB loads while the first request is in flight
  const emitTrust = (t) => { try { onTrust && onTrust(t); } catch (e) { /* the UI must never break the analysis */ } };

  /* the solve stage's result → the brief for the lesson parts (+ its TIER) and the first assessment (banner appears as soon as the solve ends) */
  const takeBrief = (res) => {
    const brief = cleanBrief(res && res.text) || null;
    if (!brief) return null;
    briefRaw = brief;
    try {
      assess = assessSolve({ raw: brief, logprobs: res.logprobs, stem: ocrText, profile: prof() });
      /* when no OCR stage ran (small keys skip it), the solve brief IS the model's reading of the image: its DATA / KEYWORD / options become a PARTIAL extraction, so the image is never an empty source */
      if (!extraction) { const pb = parseBrief(brief); const t = cleanResidue([pb.data, pb.keyword, pb.concepts, ...pb.options.map((o) => o.why)].filter(Boolean).join("\n")); if (t.trim()) extraction = { sourceType: srcTypeOf(), text: t, complete: false, name: "solve-brief" }; }
      emitTrust({ phase: "solve", assess, banner: makeBanner(assess, has(chips, "en") ? "en" : "ar") });
      return `${brief}\nTIER: ${assess.tier}`;
    } catch (e) { return brief; }
  };

  /* claims for the proof request: unresolved high-risk sentences of THIS part (never on a small key: proof itself is skipped there) */
  const claimsFor = (text) => {
    const p = prof();
    if (!kbReady(p)) return [];
    const r = verifyText({ text, sourceModel: srcModel(), profile: p, part: kind === "lesson" ? "A" : "B", brief: briefRaw });
    applyCached(r.items);
    return selectClaims(r.items);
  };

  /* the final text → patched in place (F1 + F2 + verdicts + B8). Streaming text is shown as written; this is the "late patch". */
  const trustPass = (data) => {
    try {
      if (!data || typeof data.explanation !== "string" || !data.explanation.trim()) return data;
      const p = prof(), L = kind === "lesson", part = L ? "A" : "B";
      const model = srcModel();                                    // the same model for typed text, Word, audio, PDF and screenshots
      const run = (t) => {
        const r = verifyText({ text: t, sourceModel: model, profile: p, part, brief: briefRaw, titles: (history || []).map((h) => h.title) });
        applyCached(r.items);
        for (const v of verdictLog) applyVerdicts(r.items, v.claimList || [], v.verdicts || [], { links: v.links, profile: p });
        r.text = render(r);
        r.stats = trustStats(r, r.patches, r.gaps, { cards: r.cards, conflicts: r.conflicts });
        return r;
      };
      const rx = run(data.explanation);
      let ex = rx.text, mismatch = false;
      if (!L && assess) { const rec = reconcileLesson(ex, assess, has(chips, "en") ? "en" : "ar"); ex = rec.text; mismatch = rec.mismatch; }
      const rt = data.tricks ? run(data.tricks) : null;
      const gaps = [...rx.gaps, ...(rt ? rt.gaps : [])];
      addGaps(p, gaps);
      const all = rt ? [rx, rt] : [rx];
      emitTrust({
        phase: "final", profile: profileKey(p), assess, banner: assess ? makeBanner(assess, has(chips, "en") ? "en" : "ar") : null, lessonMismatch: mismatch,
        stats: rt ? { ...rx.stats, unverified: rx.stats.unverified + rt.stats.unverified, corrected: rx.stats.corrected + rt.stats.corrected, verified: rx.stats.verified + rt.stats.verified, highRisk: rx.stats.highRisk + rt.stats.highRisk, unlabeledHighRisk: rx.stats.unlabeledHighRisk + rt.stats.unlabeledHighRisk, memorizable: rx.stats.memorizable + rt.stats.memorizable } : rx.stats,
        cards: rx.cards, conflicts: rx.conflicts, analogies: all.flatMap((r) => r.analogies.map((i) => i.sentence)), memoAids: all.flatMap((r) => r.memoAids.map((i) => i.sentence)), stripped: all.flatMap((r) => r.stripped.map((i) => ({ sentence: i.sentence, reason: i.reason }))),
        patches: all.flatMap((r) => r.patches), items: all.flatMap((r) => r.items.filter((i) => i.label !== "plain").map((i) => ({ id: i.id, kind: i.kind, label: i.label, note: i.note, sentence: i.before || i.sentence, text: i.text, memorize: !!i.memorize, source: i.sourceUrl || "", prov: i.prov || null, snippet: i.sourceSnippet || "" }))),
      });
      return { ...data, explanation: ex, tricks: rt ? rt.text : data.tricks };
    } catch (e) { return data; }                                 // an accuracy-layer problem must never become the student's problem
  };
  { const _u = onUpdate; onUpdate = (name, data, meta) => _u(name, name === "reason" && meta && meta.final ? trustPass(data) : data, meta); }

  /* v3.32 · where did the time go? Every model call of this analysis leaves a trace (gemini.js → onReport); when a stage finishes, its traces are
     summarised (latency.js) and travel with the "done" message as `lat`, so the screen can say "ضاع 310ث في 503×2" instead of just "409ث". */
  let reports = [];
  const _onDone = onDone;
  onDone = (name, m) => { const sum = summarize(reports.filter((r) => stageOf(r.task) === name)); _onDone(name, sum ? { ...m, lat: sum } : m); };

  const fastFirst = [...lists.fast, ...lists.pro];
  const proFirst = [...lists.pro, ...lists.fast];

  /* the big files of the source are uploaded ONCE and every request refers to them by a link (lib/gfiles.js); small sources stay inline */
  const files = createFileCache({ apiKey });

  /* one model call (one request at a time; busy → retried with backoff inside runTask) */
  const stageOnce = async (task, cfg, prompt, signal, onText) => {
    const call = async (useFiles) => {
      const all = [...src, { text: note + prompt.user }];
      return runTask({
        apiKey, task,
        /* v3.35: reading the question text off the screenshot and listing its words are easy jobs: the WEAKEST model first (Flash-Lite), the middle one next and the
           strong one only if nothing else can answer. (A lesson's "ocr" stage is a study summary, not a transcript: it keeps the old order.) */
        models: orderForTask(apiKey, task, cfg.tier === "pro" ? proFirst : (task === "words" || (task === "ocr" && !L)) ? weakFirst(fastFirst) : fastFirst),      // v3.33: when the strong models are nearly spent today, the word list goes to Flash-Lite (quota.js)
        system: prompt.system + (L || task !== "ocr" ? ARABIC_RULE : ""),   // the OCR transcript must stay exactly as written
        parts: useFiles ? await files.swap(all, signal) : all,
        spec: { levels: cfg.levels, budget: cfg.budget },
        maxOut: cfg.maxOut, firstMs: cfg.firstMs, idleMs: cfg.idleMs,
        signal, onText, onReport: (t) => reports.push(t),
        claimsFor: /^lesson/.test(task) ? claimsFor : undefined,
        onNotice: onNotice ? (x) => onNotice(/^(solve|lesson)/.test(task) ? "reason" : task, x) : undefined,   // "Google is busy, trying again (n of 3)" → a calm note, not an error
      });
    };
    const keep = (r) => { if (r && r.verdicts && r.verdicts.length) verdictLog.push({ claimList: r.claimList, verdicts: r.verdicts, links: r.links }); return r; };
    try { return keep(await call(true)); }
    catch (e) {
      /* Google could not use the uploaded file → send everything inline from now on (exactly the old behaviour) and repeat this request */
      if (files.used && !isAbort(e) && !(signal && signal.aborted) && looksLikeFileError(e)) { files.disable(); return keep(await call(false)); }
      throw e;
    }
  };

  /* The model now and then drops stray letters of another script inside Arabic words. text.js already removes them from the
     screen. (v3.23: the old "ask for a full clean rewrite" is gone — on a 2000-word lesson it silently DOUBLED the waiting time.) */
  const stage = (task, cfg, prompt, signal, onText) => stageOnce(task, cfg, prompt, signal, onText);
  /* Question-solving and answer-teaching requests receive a small specialist context.
     Lessons/study documents remain on their existing path. No extra model request is made. */
  const stageWithSpecialized = (task, cfg, prompt, signal, onText, queryHint = "") => {
    if (L) return stage(task, cfg, prompt, signal, onText);
    const query = [ocrText, briefRaw, sample(), queryHint].filter(Boolean).join("\n");
    return prepareSpecializedPrompt(prompt, { query, profile: prof(), limit: 3 })
      .then(({ prompt: enriched }) => {
        if (signal && signal.aborted) throw Object.assign(new Error("Aborted"), { name: "AbortError" });
        return stage(task, cfg, enriched, signal, onText);
      });
  };

  /* ── ocr + words: one stage each ── */
  const SIMPLE = {
    ocr: L
      ? { prompt: () => buildStudySummaryPrompt(chips, extra, prof()), apply: (full) => { const t = cleanResidue(fixText(String(full || "").replace(/^```[a-z]*\n?|\n?```$/gim, "").trim())); extraction = { sourceType: srcTypeOf(), text: t, complete: false, name: "map" }; return { original_question_text: t }; } }
      : { prompt: () => buildOcrPrompt(), apply: (full) => { const t = cleanResidue(cleanOcr(full)); ocrText = t; extraction = { sourceType: srcTypeOf(), text: t, complete: true, name: "ocr" }; return { original_question_text: t }; } },
    words: { prompt: () => buildWordsPrompt(chips, kind), apply: (full, final) => ({ new_words: cleanWords(full, final) }) },
  };

  function runSimple(name) {
    const def = SIMPLE[name];
    live[name]?.abort();
    const ctrl = new AbortController();
    live[name] = ctrl;

    const t0 = performance.now();
    let lastFull = "", ttft = null;
    stage(name, L && name === "words" ? { ...SIMPLE_CFG.words, maxOut: 14000 } : SIMPLE_CFG[name], def.prompt(), ctrl.signal, (full, model) => {
      if (ctrl.signal.aborted) return;
      if (ttft === null) ttft = performance.now() - t0;
      lastFull = full;
      onUpdate(name, def.apply(full, false), { chars: full.length, model, final: false });
    }).then(({ text, model }) => {
      if (ctrl.signal.aborted) return;
      onUpdate(name, def.apply(text, true), { chars: text.length, model, final: true });
      onDone(name, { ms: performance.now() - t0, chars: text.length, model, ttft });
    }).catch((err) => {
      if (isAbort(err) || ctrl.signal.aborted) return;
      onError(name, err, lastFull ? def.apply(lastFull, true) : null);
    });
  }

  /* ── reason = ONE lesson request (deep mode: a silent strong-model solve first) ── */
  function runReasonSingle() {
    live.reason?.abort();
    const ctrl = new AbortController();
    live.reason = ctrl;
    const sig = ctrl.signal;

    const t0 = performance.now();
    const since = () => performance.now() - t0;
    let text = "", model = "", tSolve = 0, over = false;

    const compose = (final) => {
      const r = splitReason(text, final);
      return { explanation: r.explanation || (final ? "" : null), tricks: r.tricks };
    };
    const emit = (final) => {
      if (over || sig.aborted) return;
      onUpdate("reason", compose(final), { chars: text.length, model, final });
    };
    const fail = (err) => {
      if (over || sig.aborted) return;
      over = true;
      ctrl.abort();
      onError("reason", err, text ? compose(true) : null);
    };

    /* the single request that writes explanation + tricks */
    function writeLesson(brief) {
      if (over || sig.aborted) return;
      const words = wordsCap.a + wordsCap.b;
      /* no verified brief (balanced mode, or the solve stage failed) → this request also has to solve, so it gets the "solve" thinking budget */
      const solo = !L && !brief;
      const cfg = solo
        ? { ...mode.write, tier: mode.solve.tier, levels: mode.solve.levels, budget: mode.solve.budget,
            maxOut: mode.write.maxOut + mode.solve.maxOut, idleMs: mode.solve.idleMs, firstMs: mode.solve.firstMs }
        : L ? (mode.writeA || mode.write) : mode.write;
      const prompt = L ? buildStudyLessonPrompt({ profile: prof(), history, extra, chips, words }) : buildLessonPrompt({ history, brief, extra, chips, words });
      stageWithSpecialized(`lesson${brief ? "B" : "X"}:${mode.id}`, cfg, prompt, sig, (full, m) => {
        text = full; model = m; emit(false);
      }).then((res) => {
        if (over || sig.aborted) return;
        text = res.text; model = res.model; over = true;
        onUpdate("reason", compose(true), { chars: text.length, model, final: true });
        onDone("reason", { ms: since(), chars: text.length, model, stages: { solve: secs(tSolve), total: secs(since()) } });
      }).catch((err) => {
        if (isAbort(err) || sig.aborted) return;
        fail(err);
      });
    }

    /* deep mode only: a careful, silent strong-model solve → its short verified brief grounds the lesson.
       Balanced mode skips it (the lesson request thinks by itself): 3 requests per analysis instead of 5. */
    if (L || mode.id !== "deep") writeLesson(null);
    else stageWithSpecialized(`solve:${mode.id}`, mode.solve, buildSolvePrompt(prof()), sig, () => {}, briefRaw)
      .then((r0) => { tSolve = since(); writeLesson(takeBrief(r0)); })
      .catch((err) => {
        if (isAbort(err) || sig.aborted) return;
        if (err.fatal || err.busy) return fail(err);   // Google is overloaded: another request right now would only make it worse
        tSolve = since();
        writeLesson(null);                              // no verified brief → the lesson request solves it by itself
      });
  }

  /* ── reason, FAST (default): THREE short requests at the same time ──
       solve (silent, tiny output)  ──►  part B-main (steps · options · answer · vary)   ┐
       part A (basics, needs no answer; starts at t = 0)                                  ├─ all streaming together
                                        part B-traps (memory sentences + tricks)          ┘
     The old slow part was ONE request that had to think AND write options + traps. With the verified brief in hand,
     main and traps are each short and need almost no thinking, so the whole lesson takes about  solve + (the longest short part). */
  function runReasonFast() {
    live.reason?.abort();
    const ctrl = new AbortController();
    live.reason = ctrl;
    const sig = ctrl.signal;

    const t0 = performance.now();
    const since = () => performance.now() - t0;
    const S = { a: "", m: "", t: "", aDone: false, aFail: null, mDone: false, mFail: null, tDone: false, tFail: null, combined: false, aModel: "", mModel: "", t0s: {} };
    let over = false;
    const ready = (k) => S[k + "Done"] || !!S[k + "Fail"];
    const seg = (k, final) => splitReason(S[k], final || S[k + "Done"]);

    /* parts are shown in order and never jump: A first, then main once A is complete, then the memory sentences */
    const compose = (final) => {
      const out = [seg("a", final).explanation];
      if (final || ready("a")) out.push(seg("m", final).explanation);
      if (final || (ready("a") && ready("m"))) out.push(seg("t", final).explanation);
      const text = out.filter(Boolean).join("\n");
      const tricks = (S.combined ? seg("m", final) : seg("t", final)).tricks;
      return { explanation: text || (final ? "" : null), tricks };
    };
    const chars = () => S.a.length + S.m.length + S.t.length;
    const emit = (final) => {
      if (over || sig.aborted) return;
      onUpdate("reason", compose(final), { chars: chars(), model: S.mModel || S.aModel, final });
    };
    const fail = (err) => {
      if (over || sig.aborted) return;
      over = true;
      ctrl.abort();
      onError("reason", err, chars() ? compose(true) : null);
    };
    const settle = () => {
      if (over || sig.aborted) return;
      if (!ready("a") || !ready("m") || !ready("t")) return;
      const err = S.mFail || S.tFail || S.aFail;
      if (err) return fail(err);
      over = true;
      onUpdate("reason", compose(true), { chars: chars(), model: S.mModel, final: true });
      onDone("reason", { ms: since(), chars: chars(), model: S.mModel, stages: { solve: secs(S.t0s.solve || 0), a: secs(S.t0s.a || 0), b: secs(since()) } });
    };
    const run = (k, task, cfg, prompt) => {
      const onTextPart = (full, model) => { S[k] = full; S[k + "Model"] = model; emit(false); };
      const request = /(?:lessonM|lessonT|lessonBm|lessonBx):/.test(task)
        ? stageWithSpecialized(task, cfg, prompt, sig, onTextPart, briefRaw)
        : stage(task, cfg, prompt, sig, onTextPart);
      return request.then(({ text, model }) => {
        S[k] = text; S[k + "Model"] = model; S[k + "Done"] = true; S.t0s[k] = since();
        emit(false); settle();
      }).catch((err) => {
        if (isAbort(err) || sig.aborted) return;
        if (err.fatal) return fail(err);
        S[k + "Fail"] = err; emit(false); settle();
      });
    };

    /* part A: no answer needed → starts at once */
    run("a", `lessonA:${mode.id}`, mode.writeA || mode.write, L ? buildStudyAPrompt({ profile: prof(), history, extra, chips, words: wordsCap.a }) : buildLessonAPrompt({ profile: prof(), history, extra, chips, words: wordsCap.a }));

    /* the two short parts that need the verified answer */
    const startBC = (brief) => {
      if (over || sig.aborted) return;
      if (!L && !brief) {
        /* no verified brief → ONE part B that solves by itself (the old way); the "traps" slot is filled by it */
        S.combined = true; S.tDone = true;
        const cfg = { ...mode.write, tier: mode.solve.tier, levels: mode.solve.levels, budget: mode.solve.budget,
          maxOut: mode.write.maxOut + mode.solve.maxOut, idleMs: mode.solve.idleMs, firstMs: mode.solve.firstMs };
        return run("m", `lessonBx:${mode.id}`, cfg, buildLessonBPrompt({ history, brief: null, extra, chips, words: wordsCap.b }));
      }
      const cfgM = { ...mode.write, maxOut: Math.min(mode.write.maxOut, 12000) };
      const cfgT = { ...mode.write, maxOut: 6000 };
      /* v3.33 · a SMALL key (every free key, until quota.js sees evidence of a big quota; a paid setup declares itself with VITE_PAID / a gateway): main and traps are written by ONE request instead of two. The prompt is the same one
         the app already uses for the whole of part B (no `part`), the verified brief is still in it, the sections and the total length are the same; only the
         number of requests changes (6 → 5 per question), which is the one thing a free key cannot afford: 20 strong-model requests a day, 5 a minute. */
      if (!L && !PAID && isSmallKey(apiKey)) {
        S.combined = true; S.tDone = true;
        return run("m", `lessonBm:${mode.id}`, cfgM, buildLessonBPrompt({ history, brief, extra, chips, words: wordsCap.b }));
      }
      if (L) {
        run("m", `lessonM:${mode.id}`, cfgM, buildStudyBPrompt({ profile: prof(), history, extra, chips, words: wordsCap.b, part: "main" }));
        run("t", `lessonT:${mode.id}`, cfgT, buildStudyBPrompt({ profile: prof(), history, extra, chips, words: wordsCap.b, part: "traps" }));
      } else {
        run("m", `lessonM:${mode.id}`, cfgM, buildLessonBPrompt({ history, brief, extra, chips, words: wordsCap.b, part: "main" }));
        run("t", `lessonT:${mode.id}`, cfgT, buildLessonBPrompt({ history, brief, extra, chips, words: wordsCap.b, part: "traps" }));
      }
    };

    if (L) { S.t0s.solve = 0; startBC(null); }
    else {
      /* v3.36 · the solve is TIME-BOXED. Everything after it (main + traps) used to wait for it with no limit: one request stuck in Google's queue (429 / 503 / a silent
         connection) held the whole lesson for minutes, although the writing itself takes ~40 s. Now: the brief arrives inside the box → the verified path, exactly as
         before; it does not → the solve is cancelled and the writer starts at once WITHOUT the brief (it solves by itself: the path that already existed for a failed solve). */
      const solveCtrl = new AbortController();
      const link = () => solveCtrl.abort();
      sig.addEventListener("abort", link, { once: true });
      let moved = false, boxed = false, timer = null;
      const go = (brief) => {
        if (moved) return;
        moved = true; clearTimeout(timer); sig.removeEventListener("abort", link);
        S.t0s.solve = since();
        startBC(brief);
      };
      timer = setTimeout(() => { if (moved || sig.aborted) return; boxed = true; solveCtrl.abort(); go(null); }, SOLVE_BOX[mode.id] || 30000);
      stageWithSpecialized(`solve:${mode.id}`, mode.solve, buildSolvePrompt(prof()), solveCtrl.signal, () => {}, briefRaw)
        .then((r0) => { if (boxed || sig.aborted) return; go(takeBrief(r0)); })
        .catch((err) => {
          if (boxed || sig.aborted || isAbort(err)) return;
          if (err.fatal || err.busy) { moved = true; clearTimeout(timer); return fail(err); }
          go(null);
        });
    }
  }

  /* ── reason, SPLIT ("split" mode): the lesson is written by TWO requests at the same time ──
     part A (the question, the English decoding, the basics) needs no answer and starts at t = 0;
     part B (steps · options · answer · memo · tricks) starts at t = 0 too in balanced mode (it solves by itself),
     or right after the silent strong-model solve in deep mode. Each part is only HALF as long, so the wall-clock time is
     about half of one long request — this is what makes it fast; the retry engine in gemini.js is what keeps the quota safe. */
  function runReasonSplit() {
    live.reason?.abort();
    const ctrl = new AbortController();
    live.reason = ctrl;
    const sig = ctrl.signal;

    const t0 = performance.now();
    const since = () => performance.now() - t0;
    const S = { a: "", b: "", aDone: false, aFail: null, bDone: false, bFail: null, aModel: "", bModel: "", t: {} };
    let over = false;

    /* part A streams as it is written; part B is appended once A is complete, so the text the student is reading never jumps */
    const compose = (final) => {
      const a = splitReason(S.a, final || S.aDone).explanation;
      const b = splitReason(S.b, final);
      const withB = final || S.aDone || !!S.aFail;
      const text = withB ? [a, b.explanation].filter(Boolean).join("\n") : a;
      return { explanation: text || (final ? "" : null), tricks: b.tricks };
    };
    const chars = () => S.a.length + S.b.length;
    const emit = (final) => {
      if (over || sig.aborted) return;
      onUpdate("reason", compose(final), { chars: chars(), model: S.bModel || S.aModel, final });
    };
    const fail = (err) => {
      if (over || sig.aborted) return;
      over = true;
      ctrl.abort();
      onError("reason", err, S.a || S.b ? compose(true) : null);
    };
    const settle = () => {
      if (over || sig.aborted) return;
      if (!(S.aDone || S.aFail) || !(S.bDone || S.bFail)) return;
      const err = S.bFail || S.aFail;
      if (err) return fail(err);
      over = true;
      onUpdate("reason", compose(true), { chars: chars(), model: S.bModel, final: true });
      onDone("reason", { ms: since(), chars: chars(), model: S.bModel, stages: { solve: secs(S.t.solve || 0), a: secs(S.t.a || 0), b: secs(since()) } });
    };

    /* deep mode only: the careful silent solve. Balanced mode skips it (part B thinks by itself). */
    if (L || mode.id !== "deep") { S.t.solve = 0; startB(null); }
    else stageWithSpecialized(`solve:${mode.id}`, mode.solve, buildSolvePrompt(prof()), sig, () => {}, briefRaw)
      .then((r0) => { S.t.solve = since(); startB(takeBrief(r0)); })
      .catch((err) => {
        if (isAbort(err) || sig.aborted) return;
        if (err.fatal || err.busy) return fail(err);
        S.t.solve = since();
        startB(null);
      });

    stage(`lessonA:${mode.id}`, mode.writeA || mode.write, L ? buildStudyAPrompt({ profile: prof(), history, extra, chips, words: wordsCap.a }) : buildLessonAPrompt({ profile: prof(), history, extra, chips, words: wordsCap.a }), sig, (full, model) => {
      S.a = full; S.aModel = model; emit(false);
    }).then(({ text, model }) => {
      S.a = text; S.aModel = model; S.aDone = true; S.t.a = since();
      emit(false); settle();
    }).catch((err) => {
      if (isAbort(err) || sig.aborted) return;
      if (err.fatal) return fail(err);
      S.aFail = err; emit(false); settle();
    });

    function startB(brief) {
      if (over || sig.aborted) return;
      const cfg = brief || L
        ? mode.write
        : { ...mode.write, tier: mode.solve.tier, levels: mode.solve.levels, budget: mode.solve.budget,
            maxOut: mode.write.maxOut + mode.solve.maxOut, idleMs: mode.solve.idleMs, firstMs: mode.solve.firstMs };
      const bPrompt = L ? buildStudyBPrompt({ profile: prof(), history, extra, chips, words: wordsCap.b }) : buildLessonBPrompt({ history, brief, extra, chips, words: wordsCap.b });
      stageWithSpecialized(`${brief ? "lessonB" : "lessonBx"}:${mode.id}`, cfg, bPrompt, sig, (full, model) => {
        S.b = full; S.bModel = model; emit(false);
      }).then(({ text, model }) => {
        S.b = text; S.bModel = model; S.bDone = true;
        settle();
      }).catch((err) => {
        if (isAbort(err) || sig.aborted) return;
        if (err.fatal) return fail(err);
        S.bFail = err; settle();
      });
    }
  }

  /* ── reason, SLICED (long study material): plan → several tutors write their topics at the same moment (lib/lessonflow.js) ── */
  const sliced = L && LESSON_MODE !== "single" && shouldSlice({ doc, slices: LESSON_SLICES, minPages: SLICE_MIN_PAGES });
  function runReasonSliced() {
    live.reason?.abort();
    const flow = createSlicedLesson({
      stage,
      prompts: {
        head: (w) => buildStudyHeadPrompt({ profile: prof(), history, extra, chips, words: w }),
        slice: (o) => buildStudySlicePrompt({ profile: prof(), history, extra, chips, ...o }),
        tail: (w) => buildStudyTailPrompt({ profile: prof(), history, extra, chips, words: w }),
      },
      cfg: {
        head: { ...mode.write, maxOut: Math.min(mode.write.maxOut, 8000) },
        slice: mode.writeA || mode.write,                       // the same model settings the single "basics" request had
        tail: { ...mode.write, maxOut: Math.min(mode.write.maxOut, 9000) },
      },
      headings: studyHeadings(chips),
      words: { head: Math.round(wordsCap.a * 0.22), basics: Math.round(wordsCap.a * 0.78), must: Math.round(wordsCap.b * 0.5), tail: Math.round(wordsCap.b * 0.52) },
      maxSlices: LESSON_SLICES,
      onUpdate, onDone, onError,
    });
    live.reason = { abort: () => flow.abort() };
    flow.start();
  }

  function runReason() {
    if (sliced) runReasonSliced();
    else if (LESSON_MODE === "single") runReasonSingle();
    else if (LESSON_MODE === "split") runReasonSplit();
    else runReasonFast();
  }

  function run(name) {
    reports = reports.filter((r) => stageOf(r.task) !== name);        // a new run of a stage starts a clean ledger
    if (name === "reason") runReason();
    else runSimple(name);
  }

  return {
    start() { tasksFor(kind).forEach(run); },   // v3.40.10: a question runs reason + words only (no transcript of the question: it is already in the attachment); a lesson also runs its background summary first
    retry(name) { if (TASK_KEYS[name]) run(name); },
    stop(name) { live[name]?.abort(); },
    cancel() { Object.values(live).forEach((c) => c.abort()); files.cancel(); },
  };
}
