/* ───────────── lib/kb/specialized.js · the SPECIALIZED KNOWLEDGE layer (v3.46) ─────────────
   Two separate layers live in the KB system:

     GENERAL (index.js · rules.js · check.js · ranges.js)   the SAFETY layer: broad textbook rules + contradiction patterns that PATCH or FLAG a clear error.
                                                            Untouched by this file. Nothing here registers into it, reads its registry state or changes what it matches.
     SPECIALIZED (this file)                                 a small, curated layer of high-incremental-value expert knowledge a general-purpose medical AI does NOT reliably retrieve or apply:
                                                            difficult mechanisms / relationships, specialist interpretation, non-obvious exceptions, precise context-dependent data, and local or changing rules.
                                                            It is retrieved to ENRICH an answer (with its conditions and exceptions), never to police a sentence.

   An entry earns its place only if it documents ALL of:
     value        what it adds beyond ordinary AI medical knowledge (a category from VALUE_CATEGORIES, WHY a general answer would miss it, and what that answer would say instead)
     clinical     the clinical scope: the situation it is about
     scope        discipline · exam · jurisdiction and optional institution / population / species / age / sex / pregnancy context; genuinely expert global knowledge may be worldwide when its specialty is explicit
     applicability  the conditions under which it applies
     exceptions   the important exceptions (or an explicit, reasoned «none known»)
     evidence     ≥ 1 traceable source: url · license · passage · verbatim quote · source type; builder checks provenance and quotation, NOT clinical truth
     approval     a named human reviewer and date, explicitly attesting to claim support, clinical accuracy, scope and exceptions; only «approved» is retrieved
     currency     version · reviewBy (required), optional effectiveFrom / supersededBy

   REJECTED by design: a generic textbook fact (no specificity anchor, a generic value category, boilerplate «well known» justification, textbook / wiki / AI-generated evidence, a near-duplicate of a general
   fact or rule), anything unsupported (no verified evidence, a number that no evidence quote contains), and anything that belongs to the safety layer (forbidden_patterns, support, rule fields).
   No LLM judges truth here: the builder verifies provenance (source/license + exact quotation), while the approval checklist separately records human clinical review. */
import { buildIndex, search } from "./bm25.js";
import { tokens, anchorsOf } from "../accuracy.js";
import { normTerm, padded } from "./rules.js";

export const SPECIALIZED_KINDS = [
  "mechanism", "relationship", "diagnostic-interpretation", "quantitative-reference", "species-specific",
  "protocol", "threshold", "exception", "local-practice", "exam-format", "recent-change", "scope-of-practice",
];
/* Include globally applicable expert knowledge, not only country / exam-specific material. */
export const VALUE_CATEGORIES = [
  "rare-mechanism", "complex-relationship", "specialized-diagnostic-interpretation", "technical-distinction",
  "context-sensitive-quantitative", "species-specific-knowledge", "non-obvious-exception",
  "jurisdiction-specific", "institution-protocol", "recent-guideline-change", "exam-specific", "scope-of-practice",
];
export const GLOBAL_EXPERT_CATEGORIES = new Set([
  "rare-mechanism", "complex-relationship", "specialized-diagnostic-interpretation", "technical-distinction",
  "context-sensitive-quantitative", "species-specific-knowledge", "non-obvious-exception",
]);
export const GENERIC_CATEGORIES = new Set(["general-knowledge", "textbook", "definition", "basic-science", "common-knowledge", "general"]);
export const EVIDENCE_TYPES = new Set(["guideline", "regulation", "institutional-protocol", "exam-blueprint", "regulator-notice", "peer-reviewed"]);
export const APPROVAL = ["draft", "approved", "retired"];
/* the safety layer owns these: a specialized entry must not smuggle contradiction patterns or rule fields in */
const SAFETY_LAYER_FIELDS = ["forbidden_patterns", "support", "truth", "wrong", "subj", "cue", "slot", "data"];
const GENERIC_JUSTIFICATION = /\b(well[- ]known|commonly known|common knowledge|widely known|general knowledge|standard textbook|any textbook|every textbook|basic (?:fact|science|knowledge|anatomy|physiology)|taught (?:in|to) (?:every|all|everyone)|as everyone knows)\b/i;
const NONSPECIFIC_JURISDICTION = new Set(["", "all", "intl", "international", "global", "any", "general"]);

const isStr = (v, min = 1) => typeof v === "string" && v.trim().length >= min;
const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) && !Number.isNaN(Date.parse(v));
const numbersOf = (s) => (String(s || "").replace(/,/g, ".").match(/\d+(?:\.\d+)?/g) || []).map((n) => String(parseFloat(n)));
const contentTokens = (s) => [...new Set(anchorsOf(tokens(s)).filter((w) => !/^[0-9]/.test(w) && w.length >= 4))];

/* A specific setting OR an explicitly named expert specialty can justify a global entry. */
export function specificityAnchors(e) {
  const s = (e && e.scope) || {};
  const a = [];
  if (isStr(s.jurisdiction) && !NONSPECIFIC_JURISDICTION.has(String(s.jurisdiction).trim().toLowerCase())) a.push("jurisdiction");
  if (Array.isArray(s.exam) && s.exam.length) a.push("exam");
  if (isStr(s.institution)) a.push("institution");
  if (e && e.value && e.value.category === "recent-guideline-change" && isDate(e.effectiveFrom)) a.push("recent-change");
  if (!a.length && isStr(s.specialty, 4) && GLOBAL_EXPERT_CATEGORIES.has(e?.value?.category)) a.push("specialty");
  if (!a.length && Array.isArray(s.discipline) && s.discipline.length && !s.discipline.includes("all") && GLOBAL_EXPERT_CATEGORIES.has(e?.value?.category)) a.push("specialized-discipline");
  return a;
}

/* structure + genericity + evidence checks on a BUILT entry (evidence resolved by the builder). → string[] of problems; [] = acceptable */
export function validateSpecialized(e) {
  const errs = [];
  const need = (c, m) => { if (!c) errs.push(m); };
  if (!e || typeof e !== "object") return ["entry is not an object"];
  need(isStr(e.id) && /^[a-z0-9][a-z0-9._-]*$/i.test(e.id), "id");
  need(isStr(e.title, 6), "title");
  need(SPECIALIZED_KINDS.includes(e.kind), `kind (one of ${SPECIALIZED_KINDS.join(", ")})`);
  need(isStr(e.statement, 40) && e.statement.length <= 600, "statement (40–600 chars: one focused piece of knowledge)");
  need(e.aliases && Array.isArray(e.aliases.en) && e.aliases.en.some((a) => isStr(a, 3)), "aliases.en (retrieval terms)");
  for (const f of SAFETY_LAYER_FIELDS) if (f in e) errs.push(`${f}: belongs to the general safety layer, not the specialized library`);

  /* value beyond ordinary AI knowledge */
  const v = e.value || {};
  if (GENERIC_CATEGORIES.has(v.category)) errs.push(`value.category "${v.category}": generic textbook knowledge is not accepted here`);
  else need(VALUE_CATEGORIES.includes(v.category), `value.category (one of ${VALUE_CATEGORIES.join(", ")})`);
  need(isStr(v.beyondGeneral, 60), "value.beyondGeneral (≥ 60 chars: why a general AI would miss or mis-apply this)");
  if (isStr(v.beyondGeneral) && GENERIC_JUSTIFICATION.test(v.beyondGeneral)) errs.push("value.beyondGeneral: a «well known / textbook» justification means the entry is generic");
  need(isStr(v.generalAnswerRisk, 30), "value.generalAnswerRisk (≥ 30 chars: what an ordinary answer would say instead)");

  /* clinical scope + applicability + exceptions */
  need(e.clinical && isStr(e.clinical.scope, 20), "clinical.scope (≥ 20 chars)");
  const s = e.scope || {};
  need(Array.isArray(s.discipline) && s.discipline.length > 0, "scope.discipline");
  need(Array.isArray(s.exam), "scope.exam (array, may be empty)");
  need(isStr(s.jurisdiction), "scope.jurisdiction (use intl for genuinely global knowledge)");
  if (!specificityAnchors(e).length) errs.push("no specificity anchor (a specific jurisdiction, exam, institution, or an explicit expert specialty / discipline for globally applicable expert knowledge)");
  if (s.institution != null) need(isStr(s.institution, 3), "scope.institution must be a meaningful institution name");
  if (s.specialty != null) need(isStr(s.specialty, 4), "scope.specialty must identify a meaningful specialty or subfield");
  for (const key of ["population", "species", "ageGroup", "sex", "pregnancyStatus"]) {
    if (s[key] != null) need(Array.isArray(s[key]) && s[key].length > 0 && s[key].every((x) => isStr(x, 2)), `scope.${key} must be a non-empty string array when specified`);
  }
  const cond = e.applicability && e.applicability.conditions;
  need(Array.isArray(cond) && cond.length > 0 && cond.every((c) => isStr(c, 10)), "applicability.conditions (non-empty, each ≥ 10 chars)");
  if (!Array.isArray(e.exceptions)) errs.push("exceptions (array; document them, or leave it empty and give noExceptionsNote)");
  else {
    for (const x of e.exceptions) if (!(x && isStr(x.when, 8) && isStr(x.effect, 8))) { errs.push("exceptions[].when / effect (each ≥ 8 chars)"); break; }
    if (!e.exceptions.length) need(isStr(e.noExceptionsNote, 20), "noExceptionsNote (≥ 20 chars, required when there are no exceptions)");
  }

  /* traceable evidence */
  const ev = Array.isArray(e.evidence) ? e.evidence : [];
  need(ev.length > 0, "evidence (at least one traceable source)");
  for (const x of ev) {
    need(isStr(x.url), "evidence.url"); need(isStr(x.license), "evidence.license"); need(isStr(x.passageId), "evidence.passageId");
    need(isStr(x.quote, 12), "evidence.quote (≥ 12 chars, verbatim)");
    /* These flags mean source/license and verbatim-quote provenance was checked. They do NOT mean the passage semantically proves the medical claim. */
    need(x.verified === true && x.sourceVerified === true && x.quoteVerified === true, "evidence provenance must be builder-verified (sourceVerified + quoteVerified)");
    need(EVIDENCE_TYPES.has(x.type), `evidence.type (one of ${[...EVIDENCE_TYPES].join(", ")}; textbooks, wikis and AI text are not evidence)`);
  }
  if (ev.length && isStr(e.statement)) {
    const quotes = ev.map((x) => x.quote || "").join(" ");
    const qn = new Set(numbersOf(quotes));
    const missing = numbersOf(e.statement).filter((n) => !qn.has(n));
    if (missing.length) errs.push(`statement contains number(s) ${[...new Set(missing)].join(", ")} that no evidence quote contains`);
    const qt = new Set(contentTokens(quotes));
    if (contentTokens(e.statement).filter((w) => qt.has(w)).length < 2) errs.push("statement shares fewer than 2 content words with the evidence quotes: the evidence does not support it");
  }

  /* approval + currency */
  const a = e.approval || {};
  need(APPROVAL.includes(a.status), `approval.status (one of ${APPROVAL.join(", ")})`);
  if (a.status === "approved") {
    need(isStr(a.reviewer), "approval.reviewer");
    need(isDate(a.reviewedAt), "approval.reviewedAt");
    need(a.checks && a.checks.claimSupport === true, "approval.checks.claimSupport (human review that cited evidence supports the exact claim)");
    need(a.checks && a.checks.clinicalAccuracy === true, "approval.checks.clinicalAccuracy (human clinical accuracy review)");
    need(a.checks && a.checks.scopeAndExceptions === true, "approval.checks.scopeAndExceptions (human review of applicability and exceptions)");
  }
  need(isStr(e.version), "version"); need(isDate(e.reviewBy), "reviewBy (ISO date)");
  if (e.effectiveFrom != null) need(isDate(e.effectiveFrom), "effectiveFrom (ISO date)");
  return errs;
}

/* is the entry duplicating something the GENERAL layer already says? general = [{ id, text }] surrogates. → the id of the overlapping general item, or null */
export function generalSurrogates({ facts = [], rules = [] } = {}) {
  return [
    ...facts.map((f) => ({ id: `fact:${f.id}`, text: [f.topic, ...((f.aliases && f.aliases.en) || []), ...((f.aliases && f.aliases.ar) || []), JSON.stringify(f.data || ""), ...(f.support || [])].join(" ") })),
    ...rules.map((r) => ({ id: `rule:${r.id}`, text: [(r.subj || []).join(" "), (r.cue || []).join(" "), (Array.isArray(r.truth) ? r.truth : []).join(" "), (r.noun || []).join(" "), r.value != null ? String(r.value) : "", r.fix || ""].join(" ") })),
  ];
}
export function duplicatesGeneral(e, general, threshold = 0.75) {
  const mine = contentTokens(`${e.title} ${e.statement}`);
  if (mine.length < 5) return null;
  for (const g of general || []) {
    const gt = new Set(contentTokens(g.text));
    if (!gt.size) continue;
    const share = mine.filter((w) => gt.has(w)).length / mine.length;
    if (share >= threshold) return g.id;
  }
  return null;
}

/* the status an entry has TODAY */
export function specializedStatus(e, now = Date.now()) {
  const a = (e && e.approval) || {};
  if (a.status === "retired") return "retired";
  if (a.status !== "approved") return "unapproved";
  if (e.supersededBy) return "superseded";
  if (!(e.evidence && e.evidence.length && e.evidence.every((x) => x.verified === true && x.sourceVerified === true && x.quoteVerified === true))) return "unverified";
  if (e.effectiveFrom && Date.parse(e.effectiveFrom) > now) return "not-yet-effective";
  if (e.reviewBy && Date.parse(e.reviewBy) < now) return "outdated";
  return "current";
}

/* why an entry is out of scope for this profile / context, or null when it applies. Strict: an unknown region cannot satisfy a specific jurisdiction. */
export function scopeMismatch(e, profile = {}, context = {}) {
  const s = e.scope || {};
  if (!Array.isArray(s.discipline) || !(s.discipline.includes("all") || (profile.discipline && s.discipline.includes(profile.discipline)))) return "discipline";
  if (Array.isArray(s.exam) && s.exam.length && (!profile.exam || !s.exam.includes(profile.exam))) return "exam";
  const j = String(s.jurisdiction || "").trim();
  if (!NONSPECIFIC_JURISDICTION.has(j.toLowerCase()) && (!profile.region || j !== profile.region)) return "jurisdiction";
  if (s.institution && s.institution !== context.institution) return "institution";
  /* Any declared context dimension is REQUIRED: missing context is not treated as a match. */
  const dimensions = ["population", "species", "ageGroup", "sex", "pregnancyStatus"];
  for (const key of dimensions) {
    if (!Array.isArray(s[key]) || !s[key].length) continue;
    const actual = context[key];
    if (!actual || !s[key].includes(actual)) return key;
  }
  return null;
}

/* ── registry (separate from the general KB's) ── */
const store = new Map();                       // module id → entries[]
/* lazy per-domain chunks, like the general layer's loaders. EMPTY by design: the library is curated, never bulk-filled (see scripts/build-kb.mjs --specialized). */
const SPECIALIZED_LOADERS = {
  /* Curated entries are added here as small reviewed domain chunks. */
  "specialized-core": () => import("./modules/specialized-core.js"),
  /* Draft entries are loaded for review but cannot be retrieved until a human clinician approves them. */
  "specialized-pharmacogenomics-pilot": () => import("./modules/specialized-pharmacogenomics-pilot.js"),
  "specialized-pharmacogenomics-expansion-2026": () => import("./modules/specialized-pharmacogenomics-expansion-2026.js"),
  "specialized-error-driven-2026": () => import("./modules/specialized-error-driven-2026.js"),
  "specialized-major-expansion-2026": () => import("./modules/specialized-major-expansion-2026.js"),
  "specialized-fifth-major-expansion-2026": () => import("./modules/specialized-fifth-major-expansion-2026.js"),
};
export function registerSpecializedLoader(id, loader) {
  if (!isStr(id) || typeof loader !== "function") throw new TypeError("specialized loader requires an id and function");
  SPECIALIZED_LOADERS[id] = loader;
}
export function registerSpecialized(id, entries, { strict = true } = {}) {
  if (strict) for (const e of entries) { const errs = validateSpecialized(e); if (errs.length) throw new Error(`Specialized entry ${e && e.id}: ${errs.join("; ")}`); }
  store.set(id, entries);
}
export const __resetSpecialized = () => store.clear();
export const loadedSpecialized = () => [...store.values()].flat();
export async function loadSpecialized(_profile) {
  await Promise.all(Object.keys(SPECIALIZED_LOADERS).filter((m) => !store.has(m)).map(async (m) => {
    try { const mod = await SPECIALIZED_LOADERS[m](); store.set(m, mod.entries || []); } catch (e) { /* a missing module only means less coverage */ }
  }));
  return loadedSpecialized();
}

/* ── retrieval: approved ∧ current ∧ in-scope ∧ relevant. Nothing else is ever returned. ── */
export function lookupSpecialized(query, profile = {}, { k = 3, now = Date.now(), context = {} } = {}) {
  const pool = loadedSpecialized().filter((e) => specializedStatus(e, now) === "current" && validateSpecialized(e).length === 0 && !scopeMismatch(e, profile, context));
  if (!pool.length || !isStr(query)) return [];
  const idx = buildIndex(pool.map((e) => ({
    topic: `${e.title} ${e.clinical.scope} ${e.applicability.conditions.join(" ")}`,
    aliases: e.aliases, _e: e,
  })));
  const qTok = new Set(tokens(query));
  const padQ = padded(query);
  const out = [];
  for (const r of search(idx, query, pool.length)) {
    const e = r.fact._e;
    /* relevance gate: an alias / title phrase is in the question, or at least 2 distinct anchor words are shared. A single common word never retrieves an entry. */
    const phrases = [e.title, ...(e.aliases.en || []), ...(e.aliases.ar || [])].filter(Boolean);
    const phraseHit = phrases.some((p) => { const n = normTerm(p); return n.length >= 4 && padQ.includes(` ${n} `); });
    const anchorTok = new Set(phrases.flatMap((p) => anchorsOf(tokens(p))));
    const shared = [...anchorTok].filter((w) => qTok.has(w));
    if (!phraseHit && shared.length < 2) continue;
    out.push({ entry: e, score: r.score, matched: phraseHit ? "phrase" : shared });
  }
  return out.slice(0, k);
}


/* Small prefiltered shelf for image-only questions whose text is not available before generation.
   The model must still match each candidate against the actual stem before using it. */
export function specializedCandidatesForProfile(profile = {}, { k = 4, now = Date.now(), context = {} } = {}) {
  const pool = loadedSpecialized().filter((e) => specializedStatus(e, now) === "current" && validateSpecialized(e).length === 0 && !scopeMismatch(e, profile, context));
  return pool.slice(0, Math.max(0, Math.min(8, k))).map((entry) => ({ entry, score: 0, matched: "profile-candidate" }));
}
