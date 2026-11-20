/* Adds a small, curated set of approved specialist references to a question-answering prompt.
   This is prompt enrichment only: the specialized library never changes the general safety KB. */
import { loadSpecialized, lookupSpecialized, specializedCandidatesForProfile } from "./specialized.js";

const clean = (value) => String(value == null ? "" : value).trim();

export function inferSpecializedContext(text = "") {
  const t = clean(text).toLowerCase();
  const context = {};
  if (/\b(neonate|neonatal|newborn)\b|حديث الولادة|حديثي الولادة/.test(t)) context.ageGroup = "neonatal";
  else if (/\b(infant|infancy)\b|رضيع|رضّع/.test(t)) context.ageGroup = "infant";
  else if (/\b(child|children|pediatric|paediatric)\b|طفل|أطفال|اطفال/.test(t)) context.ageGroup = "pediatric";
  else if (/\b(adult|adults)\b|بالغ|بالغين/.test(t)) context.ageGroup = "adult";
  if (/\b(cat|cats|feline|kitten)\b|قطة|قطط|قط/.test(t)) context.species = "cat";
  else if (/\b(dog|dogs|canine|puppy)\b|كلب|كلاب/.test(t)) context.species = "dog";
  else if (/\b(horse|equine)\b|حصان|خيول|خيل/.test(t)) context.species = "horse";
  else if (/\b(cattle|bovine|cow|calf)\b|أبقار|ابقار|بقرة|عجل/.test(t)) context.species = "cattle";
  if (/\b(pregnant|pregnancy)\b|حامل|الحمل/.test(t)) context.pregnancyStatus = "pregnant";
  if (/\b(nonpregnant|not pregnant)\b|غير حامل/.test(t)) context.pregnancyStatus = "not-pregnant";
  if (/\b(female|woman|women)\b|أنثى|انثى|امرأة|امرأه/.test(t)) context.sex = "female";
  else if (/\b(male|man|men)\b|ذكر|رجل/.test(t)) context.sex = "male";
  if (/\b(neonate|neonatal|newborn)\b|حديث الولادة|حديثي الولادة/.test(t)) context.population = "neonates";
  else if (/\b(geriatric|elderly|older adult)\b|كبير\s+السن|مسن|مسنة/.test(t)) context.population = "geriatric";
  else if (/\b(pediatric|paediatric|child|children|infant)\b|طفل|أطفال|اطفال|رضيع/.test(t)) context.population = "pediatric";
  else if (/\b(adult|adults)\b|بالغ|بالغين/.test(t)) context.population = "adult";
  return context;
}

export function formatSpecializedEntries(entries = []) {
  if (!entries.length) return "";
  const blocks = entries.map(({ entry }) => {
    const e = entry;
    const conditions = (e.applicability?.conditions || []).map((x) => `- ${x}`).join("\n") || "- No additional condition recorded.";
    const exceptions = (e.exceptions || []).map((x) => `- When ${x.when}: ${x.effect}`).join("\n") || `- ${e.noExceptionsNote || "No exceptions were recorded."}`;
    const sources = (e.evidence || []).map((x) => `- ${x.type}: ${x.url}\n  Source passage: “${x.quote}”`).join("\n");
    return [
      `REFERENCE: ${e.title} [${e.id}]`,
      `Specialized fact: ${e.statement}`,
      `Clinical scope: ${e.clinical.scope}`,
      `Applicability:\n${conditions}`,
      `Exceptions:\n${exceptions}`,
      `Evidence (for internal grounding):\n${sources}`,
    ].join("\n");
  });
  return `\n\nSPECIALIZED MEDICAL REFERENCES — use selectively\n${blocks.join("\n\n---\n\n")}`;
}

export function isEvidenceAppraisalQuery(text = "") {
  const t = clean(text).toLowerCase();
  return /\b(systematic review|meta-analysis|meta analysis|guideline|guidelines|evidence quality|certainty of evidence|grade evidence|risk of bias|confidence interval|odds ratio|relative risk|hazard ratio|p[- ]?value|effect size|effect estimate|clinical significance|evidence synthesis|critical appraisal|evidence-based|no evidence|evidence of no effect|absence of evidence|study results|research findings)\b|مراجعة منهجية|تحليل تلوي|إرشادات سريرية|جودة الدليل|يقين الدليل|قوة الدليل|خطر التحيز|فترة الثقة|نسبة الأرجحية|نسبة المخاطر|قيمة p|حجم التأثير|الدلالة الإحصائية|الأهمية السريرية|الأدلة البحثية|لا يوجد دليل|غياب الدليل|تقييم نقدي/.test(t);
}

export function attachSpecializedKnowledge(prompt, entries = [], { evidenceAppraisal = false } = {}) {
  if (!prompt) return prompt;
  const context = formatSpecializedEntries(entries);
  if (!context && !evidenceAppraisal) return prompt;
  return {
    ...prompt,
    system: `${prompt.system || ""}${evidenceAppraisal ? `\n\nCLINICAL EVIDENCE APPRAISAL RULES:
- Distinguish “no evidence of an effect” from “evidence that there is no clinically important effect.” An underpowered, imprecise, sparse, or absent evidence base does not establish no effect. Use confidence intervals and prespecified clinical thresholds to determine what effects can reasonably be ruled out.
- Read and synthesize the whole source relevant to the question: population, methods, outcomes, results, certainty/risk of bias, limitations, and authors’ conclusion. Do not anchor on one sentence or a single favorable result.
- Preserve the source’s certainty level for each outcome. Do not upgrade low/very-low certainty, downgrade without a stated reason, average outcome ratings, or infer a GRADE assessment when none is reported. When a guideline specifies an overall certainty based on critical outcomes, apply its stated rule (the ACIP GRADE handbook typically uses the lowest-certainty critical outcome); do not generalize that rule to other frameworks without checking.
- For ratio measures such as OR, RR, and HR, the conventional null is 1; for differences it is 0. Interpret the confidence interval using the correct measure, model, confidence level, prespecified analysis, and multiplicity context. Do not declare significance from an unrelated interval or test.
- Separate effect estimate, effect magnitude, precision, statistical evidence, and clinical importance. A p-value alone does not establish benefit, harm, or clinical relevance.
- Do not infer unreported outcomes, subgroup effects, causality, or recommendations from a result that only supports association.
` : ""}\n\nSPECIALIZED REFERENCE RULES:\n- Read the actual question and patient/case context before using any reference below.\n- Use a reference only when its clinical scope and EVERY applicability condition match the case. Check every listed exception.\n- Never infer a missing patient characteristic, species, age group, jurisdiction, institution, or exam context. If a reference requires context that is not established, do not apply it.\n- These references supplement medical reasoning; they do not automatically determine the answer or override contradictory case facts. Reconcile any conflict before answering.\n- Treat the original question/case as the sole source of patient-specific findings. Never invent or silently assume laboratory values, blood-gas values, electrolytes, hormones, renal measurements, vital signs, imaging findings, histology, symptoms, diagnoses, medications, or history that the stem does not state.\n- Keep literature facts separate from patient observations: a cohort result, reference interval, in-vitro experiment, case report, or molecular mechanism is not a finding in the current patient.\n- For calculations, use only supplied inputs, show the applicable equation and units, and state that a result cannot be calculated when a required input is missing. Never silently substitute or estimate a missing value.\n- A biologically plausible mechanism, association, imaging feature, or single abnormal test is not by itself proof of a diagnosis, causation, germline variant, or disease subtype.\n- Do not convert in-vitro potency/transport values, healthy-population reference intervals, cohort allele frequencies, or mechanistic interactions into clinical doses, toxicity thresholds, prevalence estimates, or treatment instructions unless the source explicitly validates that use.\n- Do not transfer numerical cut-offs, mutation nomenclature, or drug-safety conclusions across species, assays, populations, or jurisdictions without direct supporting evidence.\n- Do not repeat unsupported details. Do not mention this internal library, retrieval process, reviewer metadata, or internal confidence to the student.\n- Do not cite internal IDs. Use source details only to ground the medical explanation.`,
    user: `${prompt.user || ""}${context}`,
  };
}

/* `query` is the OCR/brief/text when available. For image-only questions, pass a tiny profile-scoped shelf;
   the model matches it to the image's actual stem and must ignore anything that does not fit. */
export async function prepareSpecializedPrompt(prompt, { query = "", profile = {}, context = {}, now = Date.now(), limit = 3 } = {}) {
  try {
    await loadSpecialized(profile);
    const q = clean(query);
    const inferredContext = { ...inferSpecializedContext(q), ...(context || {}) };
    const entries = q
      ? lookupSpecialized(q, profile, { k: limit, now, context: inferredContext })
      : specializedCandidatesForProfile(profile, { k: limit, now, context: inferredContext });
    return { prompt: attachSpecializedKnowledge(prompt, entries, { evidenceAppraisal: isEvidenceAppraisalQuery(q) }), entries };
  } catch {
    return { prompt, entries: [] };
  }
}
