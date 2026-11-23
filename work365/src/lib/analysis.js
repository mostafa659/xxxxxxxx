/* ───────────── Analysis orchestration ─────────────
   Exam questions that arrive as images or scanned PDFs now receive a dedicated
   source-transcription request before answer generation. This is a second model
   reading pass, not an orthogonal OCR engine and not a human check. The answer
   remains hidden until deterministic checks reconcile critical extracted values.

   Text-first questions skip transcription. Lessons keep their separate source-reading
   / study-summary stage. See config.js for quota and request-count behaviour. */

import { MODES, LESSON_MODE, LESSON_SLICES, SLICE_MIN_PAGES, CONTRACT, contractEnabled } from "./config.js";
import { buildOcrPrompt, buildWordsPrompt, buildSolvePrompt, buildLessonPrompt, buildLessonAPrompt, buildLessonBPrompt, buildStudySummaryPrompt, buildStudyLessonPrompt, buildStudyAPrompt, buildStudyBPrompt, buildStudyHeadPrompt, buildStudySlicePrompt, buildStudyTailPrompt, studyHeadings, buildContractOncePrompt, buildContractRepairPrompt } from "./prompts.js";
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
import { auditClinicalCalculations, formatClinicalCalculationAudit, extractClinicalDataBlock, extractLabelledClinicalData, mergeOriginalSourceText, mergeExtractedClinicalData, replaceAuditItemsByMessage, stripPartialClinicalDataBlock, renderClinicalAuditForStudent, renderClinicalCalculationConflictForStudent, blocksClinicalSynthesisForCalculationConflict, buildPreGenerationCalculationHandoff, stripOptionReviewSection, extractCorrectAnswerSection, isBlockingConflict, GENERIC_CALCULATION_CONFLICT_AR, FORMULA_WITHHELD_AR } from "./clinical-calculations.js";
import { filterTrustForBlockedClinicalSynthesis } from "./studentview.js";
import { auditClinicalSafety, formatClinicalSafetyAudit, isPotentialClinicalContext } from "./clinical-safety.js";
import { auditClinicalQuality, formatClinicalQualityAudit, formatGroundingSources, isHealthDomainContext, CLINICAL_QUALITY_INSTRUCTION } from "./clinical-quality.js";
import { readSources } from "./sources.js";
import { selectClaims, applyCached, applyVerdicts } from "./claims.js";
import { addGaps } from "./reports.js";
import { getModelLists, runTask } from "./gemini.js";
import { weakFirst, tierOf } from "./router.js";
import { buildDifficultyPrompt, parseDifficulty, heuristicLevel, combineLevels, modeForLevel, routeKey, getRoute, putRoute, ROUTE_BOX_MS, LEVELS } from "./difficulty.js";
import { parseTaskContract, parseItemOutput, auditItems, defects, assembleAnswer, targetWords } from "./taskcontract.js";
import { auditCitations, annotateCitations } from "./citation-audit.js";
import { getContractResult, putContractResult, contractKey } from "./contract-cache.js";
import { selectAnchors, formatAnchors, formatAnchorReferences } from "./clinical-anchors.js";
import { auditReasoningTraps, formatReasoningTraps } from "./reasoning-traps.js";
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

export function createAnalysis({ kind = "question", history, dataUrl, doc, extra, chips, apiKey, modeId, withWords = true, onRoute = () => {}, profile: profileArg, onUpdate, onDone, onError, onNotice, onTrust }) {
  const L = kind === "lesson";                 // study material (books, notes, slides, pasted text) instead of one exam question
  let mode = MODES[modeId] || MODES.balanced;                 // v3.70: "auto" starts as balanced and is replaced by the router's choice before the answer is written
  let wordsCap = L ? { a: Math.round(mode.write.words.a * 1.7), b: Math.round(mode.write.words.b * 1.4) } : mode.write.words;
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
  // Precompute supported arithmetic from the already-read source before parallel lesson writers start.
  // The final audit remains separate and still verifies the generated answer against the source channels.
  const sourceCalculationHandoff = () => buildPreGenerationCalculationHandoff(mergeOriginalSourceText(ocrText, sample()));
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
      // Keep every available representation of the original source. Choosing the
      // first non-empty transcription silently discarded text-layer fields when
      // an OCR pass was only partially complete.
      const sourceText = mergeOriginalSourceText(ocrText, sample());
      assess = assessSolve({ raw: brief, logprobs: res.logprobs, stem: sourceText, profile: prof(), sourceDataText: extractLabelledClinicalData(sourceText) });
      /* When the visual source-read stage did not run, the solve brief is only a partial model extraction—not an independent source. */
      if (!extraction) { const pb = parseBrief(brief); const t = cleanResidue([pb.data, pb.keyword, pb.concepts, ...pb.options.map((o) => o.why)].filter(Boolean).join("\n")); if (t.trim()) extraction = { sourceType: srcTypeOf(), text: t, complete: false, name: "solve-brief" }; }
      const solveBanner = makeBanner(assess, has(chips, "en") ? "en" : "ar");
      // The solve phase runs BEFORE the safety/quality gates: on clinical content it must not display the preliminary conclusion at all.
      if (solveBanner && isPotentialClinicalContext(`${sourceText}\n${brief}`)) { solveBanner.likely = ""; solveBanner.runnerUp = ""; solveBanner.perOption = []; }
      emitTrust({ phase: "solve", assess, banner: solveBanner, clinicalPending: isPotentialClinicalContext(`${sourceText}\n${brief}`) });
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
      // Merge original-source readings rather than taking the first non-empty
      // channel. Partial OCR must not hide fields available in a document text layer;
      // disagreements remain visible to auditClinicalCalculations as conflicts.
      const authorityData = mergeExtractedClinicalData(ocrData, localSourceData);
      const primaryData = hiddenData || briefData || authorityData;
      const chosenOption = brief.options.find((o) => o.mark === "yes");
      const chosenOptionText = chosenOption ? `${chosenOption.letter}) ${chosenOption.why}` : "";
      const audit = auditClinicalCalculations({
        dataText: primaryData,
        secondaryDataText: [hiddenData ? briefData : "", hiddenData || briefData ? ocrData : "", localSourceData].filter(Boolean),
        authorityDataText: authorityData,
        sourceText: mergeOriginalSourceText(ocrText, sample()),
        modelDataText: hiddenData || briefData,
        requireAuthorityInputs: true,
        narrative: stripOptionReviewSection(`${cleanExplanation}\n${cleanTricks}`),
        answerText: extractCorrectAnswerSection(cleanExplanation),
        calcText: brief.calc || "",
        contextText: `${ocrText}\n${briefRaw}\n${cleanExplanation}\n${cleanTricks}`,
        optionText: chosenOptionText,
      });
      const clinicalContextForGate = isPotentialClinicalContext(`${ocrText}\n${sample()}\n${briefRaw}\n${cleanExplanation}\n${cleanTricks}`);
      const calculationSynthesisBlocked = !L && blocksClinicalSynthesisForCalculationConflict(audit, clinicalContextForGate);
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
        const blockingConflicts = audit.conflicts.filter(isBlockingConflict);
        const withheldConflicts = audit.conflicts.filter((c) => !isBlockingConflict(c));
        if (!assess && blockingConflicts.length) {
          assess = { tier: "LOW", answer: "", letters: [], runnerUp: null, perOption: [], perOptionAdvice: false, flags: [], concerns: [], reasons: [], issues: [], clinicalCalculationAudit: audit };
        } else if (assess) {
          assess.clinicalCalculationAudit = audit;
        }
        if (assess && blockingConflicts.length) {
          assess.tier = "LOW";
          assess.eligible = false;
          assess.answer = "";
          assess.letters = [];
          const calculationFlags = blockingConflicts.map((c) => ({ code: c.code, msg: c.message }));
          const calculationConcerns = blockingConflicts.map((c) => ({ code: c.code, en: c.message, ar: GENERIC_CALCULATION_CONFLICT_AR }));
          assess.flags = replaceAuditItemsByMessage(assess.flags || [], calculationFlags, (item) => item.msg);
          assess.concerns = replaceAuditItemsByMessage(assess.concerns || [], calculationConcerns, (item) => item.ar || item.en);
          assess.issues = [...new Set([...(assess.issues || []), ...blockingConflicts.map((c) => c.message)])];
        }
        // A withheld formula is a notice about THAT formula: it never clears the answer, never forces LOW and never becomes a flag.
        if (assess && withheldConflicts.length) {
          assess.concerns = replaceAuditItemsByMessage(assess.concerns || [], [{ code: "formula-inputs-unconfirmed", en: withheldConflicts[0].message, ar: FORMULA_WITHHELD_AR }], (item) => item.ar || item.en);
          assess.issues = [...new Set([...(assess.issues || []), ...withheldConflicts.map((c) => c.message)])];
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
      if (safetyAudit.conflicts.length || calculationSynthesisBlocked) {
        // A critical calculation contradiction in an integrated clinical case is a
        // synthesis gate, not merely a warning below otherwise-visible generated prose.
        // Suppress the whole generated explanation/tricks while retaining deterministic
        // arithmetic only when the input readings themselves agree.
        const ar = !has(chips, "en");
        const sections = [];
        if (safetySection) sections.push(safetySection);
        if (calculationSynthesisBlocked) sections.push(renderClinicalCalculationConflictForStudent(audit, ar ? "ar" : "en"));
        const heading = safetyAudit.conflicts.length
          ? (ar ? "لم يتم اعتماد الإجابة السريرية" : "Clinical answer not cleared")
          : (ar ? "تم إيقاف الشرح بسبب تعارض حسابي مؤثر" : "Clinical explanation withheld because of a material calculation conflict");
        const body = safetyAudit.conflicts.length
          ? (ar ? "تم حجب الشرح والتوصيات المولّدة لأن فحص السلامة وجد تعارضًا عالي الأهمية. لا تستخدم هذا الإخراج لاتخاذ قرار سريري." : "Generated explanation and recommendations are withheld because a high-impact safety conflict was detected. Do not use this output for clinical decisions.")
          : (ar ? "تم حجب الشرح الطبي والنصائح المولّدة لأن النموذج ذكر قيمة حسابية لا تتفق مع إعادة الحساب المستقلة. لن نعرض استدلالًا سريريًا مبنيًا على حساب غير متسق." : "Generated clinical reasoning and teaching text are withheld because the model reported a calculation that disagrees with the deterministic recalculation. No clinical synthesis based on an inconsistent calculation is displayed.");
        ex = `## ⚠️ ${heading}\n\n${body}\n\n${sections.filter(Boolean).join("\n\n")}`;
      } else if (safetySection && !/CLINICAL SAFETY REVIEW|مراجعة السلامة السريرية/.test(ex)) {
        ex = `${ex}\n\n## ⚠️ ${has(chips, "en") ? "Clinical safety review" : "مراجعة السلامة السريرية"}\n${safetySection}`;
      }
      const qualitySection = qualityAudit.advisories.length
        ? `## 🧭 ${has(chips, "en") ? "General healthcare quality checks" : "فحوص جودة الإجابة الصحية العامة"}\n${formatClinicalQualityAudit(qualityAudit, has(chips, "en") ? "en" : "ar")}`
        : "";
      if (qualitySection && !safetyAudit.conflicts.length && !calculationSynthesisBlocked) ex = `${ex}\n\n${qualitySection}`;
      /* v3.68 · reasoning-pattern advisories (confounded negative used to exclude, artifact asserted as fact, single-cause forcing, unsupported cut-off, invented counterfactual) */
      try {
        const srcAll = mergeOriginalSourceText(ocrText, sample());
        const anchorsTxt = selectAnchors(srcAll).map((a) => [...a.statements, ...(a.inference || [])].join(" ")).join(" ");
        const traps = auditReasoningTraps({ source: srcAll, answer: `${cleanExplanation}\n${cleanTricks}`, anchorsText: anchorsTxt, openCase: !L && !/^\s*[A-E][.)]\s/m.test(srcAll) });
        if (traps.length && !safetyAudit.conflicts.length && !calculationSynthesisBlocked) ex = `${ex}\n\n## 🔎 ${has(chips, "en") ? "Reasoning-pattern checks" : "فحوص أنماط الاستدلال"}\n${formatReasoningTraps(traps, has(chips, "en") ? "en" : "ar")}`;
      } catch (e) { /* advisory only: never break the answer */ }
      const sourceSection = medicalSearchAttempted
        ? (formatGroundingSources(groundingSources.links, groundingSources.queries)
          || (has(chips, "en")
            ? "## External evidence check\nLive medical search was attempted, but no usable source links were returned. Time-sensitive claims remain unverified."
            : "## التحقق من المصادر الخارجية\nتمت محاولة البحث الطبي المباشر، لكن لم تُرجع المحاولة روابط مصادر قابلة للاستخدام. لذلك تظل الادعاءات المتغيرة بمرور الوقت غير متحققة خارجيًا."))
        : "";
      if (sourceSection && !safetyAudit.conflicts.length && !calculationSynthesisBlocked) ex = `${ex}\n\n${sourceSection}`;
      const rt = cleanTricks && !safetyAudit.conflicts.length && !calculationSynthesisBlocked ? run(cleanTricks) : null;
      const gaps = [...rx.gaps, ...(rt ? rt.gaps : [])];
      addGaps(p, gaps);
      const all = rt ? [rx, rt] : [rx];
      const synthesisSuppressed = !!(safetyAudit.conflicts.length || calculationSynthesisBlocked);
      const finalBanner = assess ? makeBanner(assess, has(chips, "en") ? "en" : "ar") : null;
      // the withheld-synthesis body already lists the blocking findings once: the banner must not print them a second time
      if (finalBanner && synthesisSuppressed) finalBanner.why = [];
      emitTrust(filterTrustForBlockedClinicalSynthesis({
        phase: "final", profile: profileKey(p), assess, banner: finalBanner, lessonMismatch: mismatch,
        calculationAudit: audit.triggered ? { status: audit.status, results: audit.results, missingInputs: audit.missingInputs, conflicts: audit.conflicts } : null,
        clinicalSafetyAudit: safetyAudit.triggered ? safetyAudit : null,
        calculationSynthesisBlocked, clinicalSynthesisBlocked: synthesisSuppressed,
        clinicalQualityAudit: qualityAudit.triggered ? qualityAudit : null,
        medicalSearch: medicalSearchAttempted ? { performed: medicalSearchPerformed, sources: groundingSources.links.length, queries: groundingSources.queries } : null,
        stats: rt ? { ...rx.stats, unverified: rx.stats.unverified + rt.stats.unverified, corrected: rx.stats.corrected + rt.stats.corrected, verified: rx.stats.verified + rt.stats.verified, highRisk: rx.stats.highRisk + rt.stats.highRisk, unlabeledHighRisk: rx.stats.unlabeledHighRisk + rt.stats.unlabeledHighRisk, memorizable: rx.stats.memorizable + rt.stats.memorizable } : rx.stats,
        cards: rx.cards, conflicts: rx.conflicts, analogies: all.flatMap((r) => r.analogies.map((i) => i.sentence)), memoAids: all.flatMap((r) => r.memoAids.map((i) => i.sentence)), stripped: all.flatMap((r) => r.stripped.map((i) => ({ sentence: i.sentence, reason: i.reason }))),
        patches: all.flatMap((r) => r.patches), items: all.flatMap((r) => r.items.filter((i) => i.label !== "plain").map((i) => ({ id: i.id, kind: i.kind, label: i.label, note: i.note, sentence: i.before || i.sentence, text: i.text, memorize: !!i.memorize, source: i.sourceUrl || "", prov: i.prov || null, snippet: i.sourceSnippet || "" }))),
      }));
      return { ...data, explanation: ex, tricks: safetyAudit.conflicts.length || calculationSynthesisBlocked ? "" : (rt ? rt.text : cleanTricks) };
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
    const isAnswerStage = /^(?:solve:|lessonB|lessonM|lessonC)/i.test(task);
    const useMedicalSearch = !!(healthContext && isAnswerStage && !medicalSearchAttempted && cfg.search !== false);
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
        apiKey, task, proof: !/^lessonC/.test(task),
        /* v3.35: reading the question text off the screenshot and listing its words are easy jobs: the WEAKEST model first (Flash-Lite), the middle one next and the
           strong one only if nothing else can answer. (A lesson's "ocr" stage is a study summary, not a transcript: it keeps the old order.) */
        models: (() => { const base = orderForTask(apiKey, task, (cfg.tier === "auto" ? !isSmallKey(apiKey) : cfg.tier === "pro") || (task === "ocr" && !L) ? proFirst : (task === "words" || task === "route") ? weakFirst(fastFirst) : fastFirst); return cfg.avoidWeak ? [...base.filter((m) => tierOf(m) !== "weak"), ...base.filter((m) => tierOf(m) === "weak")] : base; })(),      // v3.33: when the strong models are nearly spent today, the word list goes to Flash-Lite (quota.js)
        system: system + ((L || task !== "ocr") && task !== "route" ? ARABIC_RULE : ""),   // the OCR transcript must stay exactly as written
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
    const preflightCalculationHandoff = !L ? sourceCalculationHandoff() : "";

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
      const handoff = /APPLICATION CALCULATION AUDIT/.test(String(brief || "")) ? "" : preflightCalculationHandoff;
      const prompt = L ? buildStudyLessonPrompt({ profile: prof(), history, extra, chips, words }) : buildLessonPrompt({ history, brief, extra, chips, words, calculationHandoff: handoff });
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
    const preflightCalculationHandoff = !L ? sourceCalculationHandoff() : "";
    const handoffForBrief = (brief) => /APPLICATION CALCULATION AUDIT/.test(String(brief || "")) ? "" : preflightCalculationHandoff;
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
    run("a", `lessonA:${mode.id}`, mode.writeA || mode.write, L ? buildStudyAPrompt({ profile: prof(), history, extra, chips, words: wordsCap.a }) : buildLessonAPrompt({ profile: prof(), history, extra, chips, words: wordsCap.a, calculationHandoff: preflightCalculationHandoff }));

    /* the two short parts that need the verified answer */
    const startBC = (brief) => {
      if (over || sig.aborted) return;
      if (!L && !brief) {
        /* no verified brief → ONE part B that solves by itself (the old way); the "traps" slot is filled by it */
        S.combined = true; S.tDone = true;
        const cfg = { ...mode.write, tier: mode.solve.tier, levels: mode.solve.levels, budget: mode.solve.budget,
          maxOut: mode.write.maxOut + mode.solve.maxOut, idleMs: mode.solve.idleMs, firstMs: mode.solve.firstMs };
        return run("m", `lessonBx:${mode.id}`, cfg, buildLessonBPrompt({ history, brief: null, extra, chips, words: wordsCap.b, calculationHandoff: preflightCalculationHandoff }));
      }
      const cfgM = { ...mode.write, maxOut: Math.min(mode.write.maxOut, 12000) };
      const cfgT = { ...mode.write, maxOut: 6000 };
      /* v3.33 · a SMALL key (every free key, until quota.js sees evidence of a big quota; a paid setup declares itself with VITE_PAID / a gateway): main and traps are written by ONE request instead of two. The prompt is the same one
         the app already uses for the whole of part B (no `part`), the verified brief is still in it, the sections and the total length are the same; only the
         number of requests changes (6 → 5 per question), which is the one thing a free key cannot afford: 20 strong-model requests a day, 5 a minute. */
      if (!L && !PAID && isSmallKey(apiKey)) {
        S.combined = true; S.tDone = true;
        return run("m", `lessonBm:${mode.id}`, cfgM, buildLessonBPrompt({ history, brief, extra, chips, words: wordsCap.b, calculationHandoff: handoffForBrief(brief) }));
      }
      if (L) {
        run("m", `lessonM:${mode.id}`, cfgM, buildStudyBPrompt({ profile: prof(), history, extra, chips, words: wordsCap.b, part: "main" }));
        run("t", `lessonT:${mode.id}`, cfgT, buildStudyBPrompt({ profile: prof(), history, extra, chips, words: wordsCap.b, part: "traps" }));
      } else {
        run("m", `lessonM:${mode.id}`, cfgM, buildLessonBPrompt({ history, brief, extra, chips, words: wordsCap.b, part: "main", calculationHandoff: handoffForBrief(brief) }));
        run("t", `lessonT:${mode.id}`, cfgT, buildLessonBPrompt({ history, brief, extra, chips, words: wordsCap.b, part: "traps", calculationHandoff: handoffForBrief(brief) }));
      }
    };

    if (L || mode.skipSolve) { S.t0s.solve = 0; startBC(null); }          // v3.70: an EASY question (mode "light") needs no silent solve: one writer solves by itself
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
    const preflightCalculationHandoff = !L ? sourceCalculationHandoff() : "";
    const handoffForBrief = (brief) => /APPLICATION CALCULATION AUDIT/.test(String(brief || "")) ? "" : preflightCalculationHandoff;

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

    stage(`lessonA:${mode.id}`, mode.writeA || mode.write, L ? buildStudyAPrompt({ profile: prof(), history, extra, chips, words: wordsCap.a }) : buildLessonAPrompt({ profile: prof(), history, extra, chips, words: wordsCap.a, calculationHandoff: preflightCalculationHandoff }), sig, (full, model) => {
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
      const bPrompt = L ? buildStudyBPrompt({ profile: prof(), history, extra, chips, words: wordsCap.b }) : buildLessonBPrompt({ history, brief, extra, chips, words: wordsCap.b, calculationHandoff: handoffForBrief(brief) });
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


  /* ── reason, TASK CONTRACT, ONE REQUEST (v3.69) ──
     The source prescribes its own numbered tasks (lib/taskcontract.js). Request budget on the happy path: ONE generative request.
       1. cache hit (same case, same contract version)                                       → 0 requests
       2. ONE request: the model thinks, then writes the item-addressed skeleton (`@@2.3@@ …`)
       3. code: parse → audit every item (present, long enough, fields named, word limit, list length) + reasoning-trap audit + citation audit
       4. defective items only → ONE batched repair request (never a second full answer); nothing defective → no request
       5. code: assemble headings/labels, mark unverified citations, add references + notices, cache, then the normal trustPass
     Everything in 1/3/5 is free. A free key has ≈ 20 Flash requests a day: the model is asked only for what code cannot do. */
  const docText = () => (doc ? itemsFromSaved(null, doc).map((x) => (x.t === "text" ? x.text : x.t === "pdf" ? x.ptext || "" : "")).join("\n").slice(0, 60000) : "");
  const fullSourceText = () => mergeOriginalSourceText(ocrText, docText());
  let _contract = { key: "", value: null };
  const contractNow = () => {
    if (L || !contractEnabled()) return null;
    const text = fullSourceText();
    const key = `${text.length}:${ocrText.length}`;
    if (_contract.key === key) return _contract.value;
    let value = null;
    try { const c = parseTaskContract(text); value = c.active ? c : null; } catch (e) { value = null; }
    _contract = { key, value };
    return value;
  };
  let bypassContractCache = false;

  function runReasonContract(contract) {
    live.reason?.abort();
    const ctrl = new AbortController();
    live.reason = ctrl;
    const sig = ctrl.signal;
    const t0 = performance.now();
    const since = () => performance.now() - t0;
    const sourceText = fullSourceText();
    const anchors = selectAnchors(sourceText);
    const anchorsBlock = formatAnchors(anchors);
    const anchorsText = anchors.map((a) => [...a.statements, ...(a.inference || [])].join(" ")).join(" ");
    const handoff = sourceCalculationHandoff();
    const lang = has(chips, "en") ? "en" : "ar";
    const wordsFor = (it) => targetWords(contract, it, CONTRACT.wordsBudget);
    const items = new Map();                 // key → text (the ONLY state of the answer)
    let model = "", over = false, requests = 0, raw = "", cached = false;
    const small = isSmallKey(apiKey);
    const fail = (err, partial) => { if (over || sig.aborted) return; over = true; ctrl.abort(); onError("reason", err, partial || null); };
    const merge = (text) => { for (const [k, v] of parseItemOutput(text, contract)) if (!items.has(k) || v.length >= (items.get(k) || "").length || k === "TRICKS") items.set(k, v); };
    const replaceItems = (text) => { for (const [k, v] of parseItemOutput(text, contract)) items.set(k, v); };

    /* flagged sentences → the items they live in (reasoning traps + unverified citations), so ONE repair request can fix them together with missing items */
    const flagged = () => {
      const out = new Map();
      for (const [k, v] of items) {
        if (k === "TRICKS") continue;
        const traps = auditReasoningTraps({ source: sourceText, answer: v, anchorsText, openCase: true }).filter((t) => t.code !== "empty-mnemonic-label");
        const cites = auditCitations(v, anchors).unverified;
        const why = [...traps.map((t) => `${t.code}: ${t.message}`), ...cites.map((c) => `citation not in the verified set: "${c.cite}" — replace it by a retrieved reference or label it (من الذاكرة — راجع المصدر)`)];
        if (why.length) out.set(k, why);
      }
      return out;
    };

    const conclude = (audit) => {
      if (over || sig.aborted) return;
      let explanation = assembleAnswer(contract, items);
      const cit = auditCitations(explanation, anchors);
      explanation = annotateCitations(explanation, cit, lang);
      const notes = [];
      const d = defects(audit);
      if (d.size) {
        const label = (k) => { const t = contract.tasks.find((x) => x.items.some((i) => i.key === k)); return t ? `Task ${t.number} (${k})` : k; };
        const miss = audit.missing.map(label), thin = audit.thin.map((x) => label(x.key)), lim = audit.limit.map((x) => `${label(x.key)} ${x.words}/${x.limit}`);
        const rows = [];
        if (miss.length) rows.push(lang === "en" ? `Not answered: ${miss.join("; ")}.` : `لم تُكتب إجابتها: ${miss.join("؛ ")}.`);
        if (thin.length) rows.push(lang === "en" ? `Too thin to rely on: ${thin.join("; ")}.` : `مختصرة أكثر من اللازم: ${thin.join("؛ ")}.`);
        if (lim.length) rows.push(lang === "en" ? `Over the stated word limit: ${lim.join("; ")}.` : `تجاوزت حد الكلمات: ${lim.join("؛ ")}.`);
        if (audit.count.length) rows.push(lang === "en" ? `List shorter than requested: ${audit.count.map((x) => `${label(x.key)} ${x.have}/${x.need}`).join("; ")}.` : `قائمة أقصر من المطلوب: ${audit.count.map((x) => `${label(x.key)} ${x.have}/${x.need}`).join("؛ ")}.`);
        if (audit.fields.length) rows.push(lang === "en" ? `Fields not addressed: ${audit.fields.map((x) => label(x.key)).join("; ")}.` : `حقول لم تُغطَّ: ${audit.fields.map((x) => label(x.key)).join("؛ ")}.`);
        notes.push(`${lang === "en" ? "## ⚠️ Completeness check (automatic)" : "## ⚠️ فحص اكتمال الإجابة (آلي)"}\n${rows.map((r) => `- ${r}`).join("\n")}\n${lang === "en" ? "The check is lexical: it shows a part is missing or thin, not that the content is correct." : "الفحص لفظي: يكشف الناقص أو المختصر، ولا يثبت صحة المحتوى."}`);
      }
      if (model && tierOf(model) === "weak") notes.push(lang === "en" ? "## ⚠️ Model-strength notice\nThis answer was written by the lightest model because the stronger ones were unavailable. Re-run later for a deeper answer before relying on it." : "## ⚠️ تنبيه قوة النموذج\nكُتبت هذه الإجابة بأخف نموذج لأن النماذج الأقوى لم تكن متاحة وقتها. أعد التشغيل لاحقًا للحصول على إجابة أعمق قبل الاعتماد عليها.");
      const refs = formatAnchorReferences(anchors, lang);
      if (refs) notes.push(refs);
      const full = [explanation, ...notes].filter(Boolean).join("\n\n");
      if (!d.size && CONTRACT.cache && !cached) putContractResult(contractKey(sourceText, CONTRACT.version), items, model);
      over = true;
      onUpdate("reason", { explanation: full, tricks: items.get("TRICKS") || "" }, { chars: full.length, model, final: true });
      onDone("reason", { ms: since(), chars: full.length, model, stages: { total: secs(since()) }, requests });
    };

    const finish = () => {
      if (over || sig.aborted) return;
      if (![...items.keys()].some((k) => k !== "TRICKS")) return fail(new Error("contract-empty"), null);
      let audit = auditItems(contract, items);
      const want = defects(audit);
      for (const [k, why] of flagged()) want.set(k, [...(want.get(k) || []), ...why]);
      const keys = [...want.keys()];
      if (!CONTRACT.repair || !CONTRACT.repairOnce || !keys.length) return conclude(audit);
      if (keys.length > CONTRACT.repairMaxItems) return conclude(audit);      // the model is not following the contract: say so, do not buy a second full answer
      const repairs = keys.map((key) => ({ key, reasons: want.get(key), existing: items.get(key) || "" }));
      const context = [];
      for (const t of contract.tasks) for (const it of t.items) { const v = items.get(it.key); if (v && !want.has(it.key) && context.length < 14) context.push(`${it.key}: ${v.split("\n")[0].slice(0, 170)}`); }
      const cfg = { ...CONTRACT.repair };
      requests++;
      stage(`lessonC:${mode.id}`, cfg, buildContractRepairPrompt({ contract, repairs, context, anchorsBlock, wordsFor, chips, extra, profile: prof() }), sig, () => {})
        .then((res) => { if (over || sig.aborted) return; const before = new Map(items); replaceItems(res.text); for (const [k, v] of before) if (!items.has(k)) items.set(k, v); model = model || res.model; conclude(auditItems(contract, items)); })
        .catch((err) => { if (isAbort(err) || sig.aborted) return; conclude(auditItems(contract, items)); });      // a failed repair keeps the first draft and reports what is wrong
    };

    /* 1 · cache */
    if (CONTRACT.cache && !bypassContractCache) {
      const hit = getContractResult(contractKey(sourceText, CONTRACT.version));
      if (hit && auditItems(contract, hit.items).complete) { for (const [k, v] of hit.items) items.set(k, v); model = hit.model; cached = true; return void setTimeout(finish, 0); }
    }
    bypassContractCache = false;

    /* 2 · the one request */
    const expertPaid = contract.complexity.level === "expert" && !small;
    const cfg = { ...CONTRACT.once, ...(expertPaid ? CONTRACT.onceExpertPaid : {}), search: false };
    requests++;
    stageWithSpecialized(`lessonC:${mode.id}`, cfg,
      buildContractOncePrompt({ contract, wordsFor, anchorsBlock, calculationHandoff: handoff, chips, extra, profile: prof() }),
      sig, (full, m) => { raw = full; model = m || model; },
      contract.tasks.map((t) => t.title).join("; "))
      .then((res) => { if (over || sig.aborted) return; raw = res.text; model = res.model || model; merge(raw); finish(); })
      .catch((err) => {
        if (isAbort(err) || sig.aborted) return;
        merge(raw);                                                           // tokens already paid for are never thrown away: parse what arrived, repair only the rest
        if ([...items.keys()].some((k) => k !== "TRICKS")) return finish();
        fail(err, null);
      });
  }

  /* ── adaptive routing (v3.70) ── */
  let bump = 0;                                       // "Retry" on an auto-routed answer goes ONE level deeper (the student is saying: not good enough)
  const dispatchReason = () => {
    if (sliced) runReasonSliced();
    else if (LESSON_MODE === "single") runReasonSingle();
    else if (LESSON_MODE === "split") runReasonSplit();
    else runReasonFast();
  };
  const applyMode = (id) => { mode = MODES[id] || MODES.balanced; wordsCap = L ? { a: Math.round(mode.write.words.a * 1.7), b: Math.round(mode.write.words.b * 1.4) } : mode.write.words; };

  async function decideRoute(sig) {
    const small = isSmallKey(apiKey);
    const text = fullSourceText();
    const rules = heuristicLevel(text);
    const noText = !text.trim();                       // an image / scanned PDF: the rules see nothing, so a failed model call must not read as "easy"
    const src0 = text || `${(dataUrl || "").length}:${(dataUrl || "").slice(0, 300)}`;
    const key = routeKey(src0, extra || "");
    const hit = getRoute(key);
    let verdict = hit ? { level: hit.level, reason: hit.reason || "" } : null, from = hit ? "cache" : "";
    if (!verdict) {
      const ctl = new AbortController();
      const link = () => ctl.abort();
      sig.addEventListener("abort", link, { once: true });
      const timer = setTimeout(() => ctl.abort(), ROUTE_BOX_MS);
      try {
        const r = await stage("route", { tier: "fast", levels: ["minimal", "low"], budget: 0, maxOut: 400, idleMs: 8000, firstMs: ROUTE_BOX_MS }, buildDifficultyPrompt(), ctl.signal, () => {});
        verdict = parseDifficulty(r && r.text);
        if (verdict) from = "model";
      } catch (e) { /* fail open to the rules: the router is never a reason for the answer not to start */ }
      finally { clearTimeout(timer); sig.removeEventListener("abort", link); }
    }
    let level, source, floored = false;
    if (verdict) { const c = combineLevels(verdict, rules); level = c.level; floored = c.floored; source = from === "cache" ? "cache" : "model"; }
    else { level = noText ? "medium" : rules.level; source = "rules"; }
    if (verdict && from === "model") putRoute(key, { level: verdict.level, reason: verdict.reason });
    const base = LEVELS.indexOf(level);
    const finalLevel = LEVELS[Math.min(LEVELS.length - 1, base + bump)];
    return { level: finalLevel, mode: modeForLevel(finalLevel, { small }), source, floored, bumped: bump > 0 && finalLevel !== level, reason: (verdict && verdict.reason) || rules.reasons.join("; "), rules: rules.level };
  }

  function runReason() {
    const contract = contractNow();
    if (contract) { if (modeId === "auto") onRoute({ level: "hard", mode: "contract", source: "contract", reason: `${contract.tasks.length} prescribed tasks` }); return runReasonContract(contract); }
    if (modeId !== "auto" || L) { if (modeId === "auto") applyMode("balanced"); return dispatchReason(); }
    live.reason?.abort();
    const ctrl = new AbortController();
    live.reason = ctrl;
    decideRoute(ctrl.signal).then((r) => {
      if (ctrl.signal.aborted) return;
      applyMode(r.mode);
      onRoute(r);
      dispatchReason();
    }).catch((err) => { if (ctrl.signal.aborted || isAbort(err)) return; applyMode("balanced"); dispatchReason(); });
  }

  function run(name) {
    reports = reports.filter((r) => stageOf(r.task) !== name);        // a new run of a stage starts a clean ledger
    if (name === "reason") runReason();
    else runSimple(name);
  }

  return {
    start() {
      if (!questionNeedsTranscript) { tasksFor(kind, withWords).forEach(run); return; }
      // For visual questions, run a separate vision-model transcription first so solver DATA can be compared
      // with a second reading pass. This is not independent OCR; high-risk values still need human confirmation.
      let launched = false;
      const launchRemaining = () => {
        if (launched) return;
        launched = true;
        run("reason");
        if (withWords) run("words");
      };
      const previousDone = onDone;
      const previousError = onError;
      onDone = (name, m) => { previousDone(name, m); if (name === "ocr") launchRemaining(); };
      onError = (name, e, last) => { previousError(name, e, last); if (name === "ocr") launchRemaining(); };
      run("ocr");
    },
    retry(name) { if (name === "reason") { bypassContractCache = true; bump = Math.min(2, bump + 1); } if (TASK_KEYS[name]) run(name); },
    stop(name) { live[name]?.abort(); },
    cancel() { Object.values(live).forEach((c) => c.abort()); files.cancel(); },
  };
}
