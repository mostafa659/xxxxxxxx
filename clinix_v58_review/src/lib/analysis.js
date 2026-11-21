/* ───────────── Analysis orchestration ─────────────
   Exam questions that arrive as images or scanned PDFs now receive a dedicated
   source-transcription request before answer generation. This is a second model
   reading pass, not an orthogonal OCR engine and not a human check. The answer
   remains hidden until deterministic checks reconcile critical extracted values.

   Text-first questions skip transcription. Lessons keep their separate source-reading
   / study-summary stage. See config.js for quota and request-count behaviour. */

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
import { auditClinicalCalculations, formatClinicalCalculationAudit, extractClinicalDataBlock, extractLabelledClinicalData, stripPartialClinicalDataBlock, renderClinicalAuditForStudent, stripOptionReviewSection, extractCorrectAnswerSection } from "./clinical-calculations.js";
import { auditClinicalSafety, formatClinicalSafetyAudit, isPotentialClinicalContext } from "./clinical-safety.js";
import { auditClinicalQuality, formatClinicalQualityAudit, formatGroundingSources, isHealthDomainContext, CLINICAL_QUALITY_INSTRUCTION } from "./clinical-quality.js";
import { readSources } from "./sources.js";
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

  /* Visual-question safety adds one source-transcription request before the solver; all final checks remain local. */
  let ocrText = "", assess = null, briefRaw = "";
  const verdictLog = [];                                        // {claimList, verdicts, links} of every proof request that carried claims
  const medicalGroundings = [];
  let medicalSearchAttempted = false;
  let medicalSearchPerformed = false;
  /* ONE source model for every source type: text / Word / audio / PDF text layer / a separate model transcription of an image or scanned PDF. */
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
  const questionNeedsTranscript = !L && (!doc ? !!dataUrl : itemsFromSaved(null, doc).some((x) => x.t === "image" || x.t === "pdf"));
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
      const sourceText = ocrText || sample();
      assess = assessSolve({ raw: brief, logprobs: res.logprobs, stem: sourceText, profile: prof(), sourceDataText: extractLabelledClinicalData(sourceText) });
      /* When the visual source-read stage did not run, the solve brief is only a partial model extraction—not an independent source. */
      if (!extraction) { const pb = parseBrief(brief); const t = cleanResidue([pb.data, pb.keyword, pb.concepts, ...pb.options.map((o) => o.why)].filter(Boolean).join("\n")); if (t.trim()) extraction = { sourceType: srcTypeOf(), text: t, complete: false, name: "solve-brief" }; }
      emitTrust({ phase: "solve", assess, banner: makeBanner(assess, has(chips, "en") ? "en" : "ar") });
      const calculationHandoff = formatClinicalCalculationAudit(assess.clinicalCalculationAudit);
      return `${brief}\nTIER: ${assess.tier}${calculationHandoff ? `\n${calculationHandoff}` : ""}`;
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

  /* The final text is recalculated in code before any answer is shown. Private source-data blocks are removed from every UI update. */
  const trustPass = (data) => {
    try {
      if (!data || typeof data.explanation !== "string" || !data.explanation.trim()) return data;
      const p = prof(), L = kind === "lesson", part = L ? "A" : "B";
      const model = srcModel();
      const expBlock = extractClinicalDataBlock(data.explanation);
      const trickBlock = extractClinicalDataBlock(data.tricks || "");
      const cleanExplanation = expBlock.text;
      const cleanTricks = trickBlock.text;
      const brief = parseBrief(briefRaw);
      const briefData = brief.data || "";
      const hiddenData = [expBlock.dataText, trickBlock.dataText].filter(Boolean).join("; ");
      const ocrData = extractLabelledClinicalData(ocrText);
      const localSourceData = extractLabelledClinicalData(sample());
      const authorityData = ocrData || localSourceData;
      const primaryData = hiddenData || briefData || authorityData;
      const chosenOption = brief.options.find((o) => o.mark === "yes");
      const chosenOptionText = chosenOption ? `${chosenOption.letter}) ${chosenOption.why}` : "";
      const audit = auditClinicalCalculations({
        dataText: primaryData,
        secondaryDataText: [hiddenData ? briefData : "", hiddenData || briefData ? ocrData : "", localSourceData].filter(Boolean),
        authorityDataText: authorityData,
        modelDataText: hiddenData || briefData,
        requireAuthorityInputs: true,
        narrative: stripOptionReviewSection(`${cleanExplanation}\n${cleanTricks}`),
        answerText: extractCorrectAnswerSection(cleanExplanation),
        calcText: brief.calc || "",
        contextText: `${ocrText}\n${briefRaw}\n${cleanExplanation}\n${cleanTricks}`,
        optionText: chosenOptionText,
      });
      const safetyAudit = auditClinicalSafety({
        caseText: `${ocrText}\n${sample()}\n${briefRaw}`,
        answerText: extractCorrectAnswerSection(cleanExplanation),
        selectedOptionText: chosenOptionText,
        narrative: stripOptionReviewSection(`${cleanExplanation}\n${cleanTricks}`),
      });
      const groundingSources = readSources(medicalGroundings);
      const qualityAudit = auditClinicalQuality({
        caseText: `${ocrText}\n${sample()}\n${briefRaw}`,
        answerText: extractCorrectAnswerSection(cleanExplanation),
        selectedOptionText: chosenOptionText,
        narrative: stripOptionReviewSection(`${cleanExplanation}\n${cleanTricks}`),
        sources: groundingSources.links,
        searchPerformed: medicalSearchPerformed,
      });
      if (questionNeedsTranscript && !ocrText.trim() && safetyAudit.triggered) {
        safetyAudit.conflicts.push({ code: "visual-source-transcription-unavailable", severity: "critical", message: "The source is an image/PDF, but the dedicated transcription pass did not complete. Critical patient values and answer options have not been independently cross-checked; do not accept a selected clinical answer." });
        safetyAudit.status = "blocked";
      }
      if (audit.triggered) {
        if (!assess && audit.conflicts.length) {
          assess = { tier: "LOW", answer: "", letters: [], runnerUp: null, perOption: [], perOptionAdvice: false, flags: [], concerns: [], reasons: [], issues: [], clinicalCalculationAudit: audit };
        } else if (assess) {
          assess.clinicalCalculationAudit = audit;
        }
        if (assess && audit.conflicts.length) {
          assess.tier = "LOW";
          assess.eligible = false;
          assess.answer = "";
          assess.letters = [];
          assess.flags = [...(assess.flags || []), ...audit.conflicts.map((c) => ({ code: c.code, msg: c.message }))];
          assess.concerns = [...(assess.concerns || []), ...audit.conflicts.map((c) => ({ code: c.code, en: c.message, ar: "الحساب المستقل كشف تعارضًا في الأرقام أو المعادلة؛ لا تعتمد الاختيار قبل تصحيحه." }))];
          assess.issues = [...new Set([...(assess.issues || []), ...audit.conflicts.map((c) => c.message)])];
        }
      }
      if (safetyAudit.conflicts.length) {
        const safetyFlags = safetyAudit.conflicts.map((c) => ({ code: c.code, msg: c.message }));
        const safetyConcerns = safetyAudit.conflicts.map((c) => ({ code: c.code, en: c.message, ar: c.message }));
        if (!assess) assess = { tier: "LOW", answer: "", letters: [], runnerUp: null, perOption: [], perOptionAdvice: false, flags: [], concerns: [], reasons: [], issues: [] };
        assess.clinicalSafetyAudit = safetyAudit;
        assess.tier = "LOW";
        assess.eligible = false;
        assess.answer = "";
        assess.letters = [];
        assess.flags = [...(assess.flags || []), ...safetyFlags];
        assess.concerns = [...(assess.concerns || []), ...safetyConcerns];
        assess.issues = [...new Set([...(assess.issues || []), ...safetyAudit.conflicts.map((c) => c.message)])];
      } else if (assess && safetyAudit.triggered) {
        assess.clinicalSafetyAudit = safetyAudit;
      }
      const run = (t) => {
        const r = verifyText({ text: t, sourceModel: model, profile: p, part, brief: briefRaw, titles: (history || []).map((h) => h.title) });
        applyCached(r.items);
        for (const v of verdictLog) applyVerdicts(r.items, v.claimList || [], v.verdicts || [], { links: v.links, profile: p });
        r.text = render(r);
        r.stats = trustStats(r, r.patches, r.gaps, { cards: r.cards, conflicts: r.conflicts });
        return r;
      };
      const rx = run(cleanExplanation);
      let ex = rx.text, mismatch = false;
      if (!L && assess) { const rec = reconcileLesson(ex, assess, has(chips, "en") ? "en" : "ar"); ex = rec.text; mismatch = rec.mismatch; }
      if (!L && audit.results.length && !audit.conflicts.length) {
        const calculationSection = renderClinicalAuditForStudent(audit, has(chips, "en") ? "en" : "ar");
        if (calculationSection && !/## 🧮 (?:مراجعة الحسابات|Calculation check)/.test(ex)) {
          const answerHeading = /^##\s*(?:✅\s*)?(?:الإجابة الصح|The correct answer)\s*$/m;
          const h = answerHeading.exec(ex);
          ex = h ? `${ex.slice(0, h.index)}${calculationSection}\n\n${ex.slice(h.index)}` : `${ex}\n\n${calculationSection}`;
        }
      }
      const safetySection = safetyAudit.conflicts.length || safetyAudit.advisories.length
        ? formatClinicalSafetyAudit(safetyAudit, has(chips, "en") ? "en" : "ar") : "";
      if (safetyAudit.conflicts.length) {
        // A hard, patient-specific safety conflict suppresses the generated clinical answer,
        // not just its green checkmark. The user sees the exact reason and missing evidence.
        ex = `## ⚠️ ${has(chips, "en") ? "Clinical answer not cleared" : "لم يتم اعتماد الإجابة السريرية"}\n\n${has(chips, "en") ? "The explanation and option-by-option recommendation are withheld because a high-impact safety rule was triggered. Reconcile the issue with a qualified clinician and current primary guidance." : "تم حجب الشرح والاختيار النهائي لأن قاعدة سلامة عالية الأهمية أطلقت تنبيهًا. يجب حل التعارض بالرجوع إلى مختص سريري وإرشاد أولي حديث."}\n\n${safetySection}`;
      } else if (safetySection && !/CLINICAL SAFETY REVIEW|مراجعة السلامة السريرية/.test(ex)) {
        ex = `${ex}\n\n## ⚠️ ${has(chips, "en") ? "Clinical safety review" : "مراجعة السلامة السريرية"}\n${safetySection}`;
      }
      const qualitySection = qualityAudit.advisories.length
        ? `## 🧭 ${has(chips, "en") ? "General healthcare quality checks" : "فحوص جودة الإجابة الصحية العامة"}\n${formatClinicalQualityAudit(qualityAudit, has(chips, "en") ? "en" : "ar")}`
        : "";
      if (qualitySection && !safetyAudit.conflicts.length) ex = `${ex}\n\n${qualitySection}`;
      const sourceSection = medicalSearchAttempted
        ? (formatGroundingSources(groundingSources.links, groundingSources.queries)
          || (has(chips, "en")
            ? "## External evidence check\nLive medical search was attempted, but no usable source links were returned. Time-sensitive claims remain unverified."
            : "## التحقق من المصادر الخارجية\nتمت محاولة البحث الطبي المباشر، لكن لم تُرجع المحاولة روابط مصادر قابلة للاستخدام. لذلك تظل الادعاءات المتغيرة بمرور الوقت غير متحققة خارجيًا."))
        : "";
      if (sourceSection && !safetyAudit.conflicts.length) ex = `${ex}\n\n${sourceSection}`;
      const rt = cleanTricks && !safetyAudit.conflicts.length ? run(cleanTricks) : null;
      const gaps = [...rx.gaps, ...(rt ? rt.gaps : [])];
      addGaps(p, gaps);
      const all = rt ? [rx, rt] : [rx];
      emitTrust({
        phase: "final", profile: profileKey(p), assess, banner: assess ? makeBanner(assess, has(chips, "en") ? "en" : "ar") : null, lessonMismatch: mismatch,
        calculationAudit: audit.triggered ? { status: audit.status, results: audit.results, missingInputs: audit.missingInputs, conflicts: audit.conflicts } : null,
        clinicalSafetyAudit: safetyAudit.triggered ? safetyAudit : null,
        clinicalQualityAudit: qualityAudit.triggered ? qualityAudit : null,
        medicalSearch: medicalSearchAttempted ? { performed: medicalSearchPerformed, sources: groundingSources.links.length, queries: groundingSources.queries } : null,
        stats: rt ? { ...rx.stats, unverified: rx.stats.unverified + rt.stats.unverified, corrected: rx.stats.corrected + rt.stats.corrected, verified: rx.stats.verified + rt.stats.verified, highRisk: rx.stats.highRisk + rt.stats.highRisk, unlabeledHighRisk: rx.stats.unlabeledHighRisk + rt.stats.unlabeledHighRisk, memorizable: rx.stats.memorizable + rt.stats.memorizable } : rx.stats,
        cards: rx.cards, conflicts: rx.conflicts, analogies: all.flatMap((r) => r.analogies.map((i) => i.sentence)), memoAids: all.flatMap((r) => r.memoAids.map((i) => i.sentence)), stripped: all.flatMap((r) => r.stripped.map((i) => ({ sentence: i.sentence, reason: i.reason }))),
        patches: all.flatMap((r) => r.patches), items: all.flatMap((r) => r.items.filter((i) => i.label !== "plain").map((i) => ({ id: i.id, kind: i.kind, label: i.label, note: i.note, sentence: i.before || i.sentence, text: i.text, memorize: !!i.memorize, source: i.sourceUrl || "", prov: i.prov || null, snippet: i.sourceSnippet || "" }))),
      });
      return { ...data, explanation: ex, tricks: safetyAudit.conflicts.length ? "" : (rt ? rt.text : cleanTricks) };
    } catch (e) {
      const clinical = kind === "question" || isPotentialClinicalContext(`${ocrText}\n${briefRaw}\n${data?.explanation || ""}\n${data?.tricks || ""}`);
      if (!clinical) return { ...data, explanation: stripPartialClinicalDataBlock(data.explanation || ""), tricks: stripPartialClinicalDataBlock(data.tricks || "") };
      // Fail closed: a validator exception must never turn into an unchecked clinical answer.
      const msg = "تعذر إكمال التحقق المستقل بسبب خطأ داخلي. لم يتم اعتماد أي اختيار أو تشخيص أو جرعة؛ أعد المحاولة أو راجع السؤال يدويًا مع مصدر طبي موثوق.";
      const failure = { tier: "LOW", calibrated: false, answer: "", letters: [], runnerUp: null, perOption: [], perOptionAdvice: false,
        flags: [{ code: "clinical-validation-failed-closed", msg }], concerns: [{ code: "clinical-validation-failed-closed", en: msg, ar: msg }],
        reasons: ["independent clinical validation failed"], issues: [String(e?.message || e || "unknown validation error")], eligible: false,
        clinicalSafetyAudit: { triggered: true, status: "blocked", conflicts: [{ code: "clinical-validation-failed-closed", severity: "critical", message: msg }], advisories: [] } };
      assess = failure;
      // The fail-closed recovery path must not call a potentially failing profile resolver again.
      let fallbackProfile = "unknown";
      try { fallbackProfile = profileKey(prof()); } catch { /* preserve the safe fallback */ }
      emitTrust({ phase: "final", profile: fallbackProfile, assess: failure, banner: makeBanner(failure, has(chips, "en") ? "en" : "ar"), clinicalSafetyAudit: failure.clinicalSafetyAudit, calculationAudit: null, validationFailed: true });
      return { ...data, explanation: `## ⚠️ تعذر التحقق السريري\n\n${msg}`, tricks: "" };
    }
  };
  { const _u = onUpdate; onUpdate = (name, data, meta) => {
    if (name !== "reason") return _u(name, data, meta);
    if (meta && meta.final) return _u(name, trustPass(data), meta);
    const safe = data && typeof data === "object" ? { ...data,
      // Question answers are clinical exam outputs: never stream an unvalidated choice before the final guards run.
      explanation: kind === "question" ? null : (typeof data.explanation === "string" ? stripPartialClinicalDataBlock(data.explanation) : data.explanation),
      tricks: kind === "question" ? null : (typeof data.tricks === "string" ? stripPartialClinicalDataBlock(data.tricks) : data.tricks),
    } : data;
    return _u(name, safe, meta);
  }; }

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
    const healthContext = isHealthDomainContext(`${ocrText}\n${briefRaw}\n${sample()}\n${note}\n${prompt.user}`);
    // One grounded evidence pass per analysis: solve-stage in deep mode, otherwise the main answer-writing stage.
    // Avoid attaching Google Search to OCR/word-list/formatting-only calls.
    const isAnswerStage = /^(?:solve:|lessonB|lessonM)/i.test(task);
    const useMedicalSearch = !!(healthContext && isAnswerStage && !medicalSearchAttempted);
    if (useMedicalSearch) medicalSearchAttempted = true;
    const originalSystem = prompt.system || "";
    const system = healthContext && isAnswerStage && !originalSystem.includes("UNIVERSAL HEALTHCARE ANSWER QUALITY PROTOCOL")
      ? `${originalSystem}\n\n${CLINICAL_QUALITY_INSTRUCTION}`
      : originalSystem;
    const noSearchSystem = useMedicalSearch
      ? `${system}\n\nSEARCH LIMITATION: live medical search was unavailable or not completed for this response. Do not imply current guideline or source verification; clearly identify time-sensitive claims that still need checking.`
      : undefined;
    const call = async (useFiles) => {
      const all = [...src, { text: note + prompt.user }];
      return runTask({
        apiKey, task,
        /* v3.35: reading the question text off the screenshot and listing its words are easy jobs: the WEAKEST model first (Flash-Lite), the middle one next and the
           strong one only if nothing else can answer. (A lesson's "ocr" stage is a study summary, not a transcript: it keeps the old order.) */
        models: orderForTask(apiKey, task, cfg.tier === "pro" || (task === "ocr" && !L) ? proFirst : task === "words" ? weakFirst(fastFirst) : fastFirst),      // v3.33: when the strong models are nearly spent today, the word list goes to Flash-Lite (quota.js)
        system: system + (L || task !== "ocr" ? ARABIC_RULE : ""),   // the OCR transcript must stay exactly as written
        noSearchSystem,
        search: useMedicalSearch,
        parts: useFiles ? await files.swap(all, signal) : all,
        spec: { levels: cfg.levels, budget: cfg.budget },
        maxOut: cfg.maxOut, firstMs: cfg.firstMs, idleMs: cfg.idleMs,
        signal, onText, onReport: (t) => reports.push(t),
        claimsFor: /^lesson/.test(task) ? claimsFor : undefined,
        onNotice: onNotice ? (x) => onNotice(/^(solve|lesson)/.test(task) ? "reason" : task, x) : undefined,   // "Google is busy, trying again (n of 3)" → a calm note, not an error
      });
    };
    const keep = (r) => {
      if (r && r.verdicts && r.verdicts.length) verdictLog.push({ claimList: r.claimList, verdicts: r.verdicts, links: r.links });
      if (useMedicalSearch && r) {
        medicalSearchPerformed = !!r.searched;
        if (r.grounding) medicalGroundings.push(r.grounding);
      }
      return r;
    };
    try { return keep(await call(true)); }
    catch (e) {
      /* Google could not use the uploaded file → send everything inline from now on (exactly the old behaviour) and repeat this request */
      if (files.used && !isAbort(e) && !(signal && signal.aborted) && looksLikeFileError(e)) {
        files.disable();
        try { return keep(await call(false)); }
        catch (retryError) { if (useMedicalSearch) medicalSearchAttempted = false; throw retryError; }
      }
      if (useMedicalSearch) medicalSearchAttempted = false;
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
    let text = "", model = "", tSolve = 0, over = false, failure = null;

    const compose = (final) => {
      const r = splitReason(text, final);
      const partialWarning = final && failure
        ? "\n\n## ⚠️ الإجابة غير مكتملة\nتعذر إكمال جزء من التحليل بسبب خطأ أثناء التوليد. لا تعتمد هذا النص كإجابة نهائية؛ أعد المحاولة أو استخدم مصدرًا موثوقًا/مراجعًا مختصًا."
        : "";
      return { explanation: (r.explanation || (final ? "" : null)) ? `${r.explanation || ""}${partialWarning}` : (final ? partialWarning : null), tricks: r.tricks };
    };
    const emit = (final) => {
      if (over || sig.aborted) return;
      onUpdate("reason", compose(final), { chars: text.length, model, final });
    };
    const fail = (err) => {
      if (over || sig.aborted) return;
      failure = err;
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
    let over = false, failure = null;
    const ready = (k) => S[k + "Done"] || !!S[k + "Fail"];
    const seg = (k, final) => splitReason(S[k], final || S[k + "Done"]);

    /* parts are shown in order and never jump: A first, then main once A is complete, then the memory sentences */
    const compose = (final) => {
      const out = [seg("a", final).explanation];
      if (final || ready("a")) out.push(seg("m", final).explanation);
      if (final || (ready("a") && ready("m"))) out.push(seg("t", final).explanation);
      let text = out.filter(Boolean).join("\n");
      if (final && failure) text += "\n\n## ⚠️ الإجابة غير مكتملة\nتعذر إكمال جزء من التحليل بسبب خطأ أثناء التوليد. لا تعتمد هذا النص كإجابة نهائية؛ أعد المحاولة أو استخدم مصدرًا موثوقًا/مراجعًا مختصًا.";
      const tricks = (S.combined ? seg("m", final) : seg("t", final)).tricks;
      return { explanation: text || (final ? (failure ? "## ⚠️ الإجابة غير مكتملة\nتعذر إكمال التوليد؛ أعد المحاولة." : "") : null), tricks };
    };
    const chars = () => S.a.length + S.m.length + S.t.length;
    const emit = (final) => {
      if (over || sig.aborted) return;
      onUpdate("reason", compose(final), { chars: chars(), model: S.mModel || S.aModel, final });
    };
    const fail = (err) => {
      if (over || sig.aborted) return;
      failure = err;
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
    start() {
      if (!questionNeedsTranscript) { tasksFor(kind).forEach(run); return; }
      // For visual questions, run a separate vision-model transcription first so solver DATA can be compared
      // with a second reading pass. This is not independent OCR; high-risk values still need human confirmation.
      let launched = false;
      const launchRemaining = () => {
        if (launched) return;
        launched = true;
        run("reason");
        run("words");
      };
      const previousDone = onDone;
      const previousError = onError;
      onDone = (name, m) => { previousDone(name, m); if (name === "ocr") launchRemaining(); };
      onError = (name, e, last) => { previousError(name, e, last); if (name === "ocr") launchRemaining(); };
      run("ocr");
    },
    retry(name) { if (TASK_KEYS[name]) run(name); },
    stop(name) { live[name]?.abort(); },
    cancel() { Object.values(live).forEach((c) => c.abort()); files.cancel(); },
  };
}
