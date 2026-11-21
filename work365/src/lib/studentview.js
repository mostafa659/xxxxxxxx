/* ───────────── lib/studentview.js · what a STUDENT sees of the verification layer (v3.45) ─────────────
   The accuracy layer (accuracy.js · kb/check.js · trust.js · examtrust.js) keeps full internal data: every label, every gap, every «source check pending», the audit counters.
   That data is for developers (the KB gap list, the benchmark, the tests). A student gets a calmer, truthful view derived from it:

     RULE 1  Not being able to check a statement is NOT a warning. Missing KB coverage, an unverified source quote, an unavailable probability, an outdated review date:
             all silent. Such statements pass naturally (no badge, no label, no count).
     RULE 2  A warning needs a CONCRETE, meaningful risk of wrong medical information:
               · a statement that differs from the student's OWN source (a number / a negation) and could not be fixed,
               · a second check that disagrees with a statement,
               · an exam item whose key contradicts the reference / the source, or whose structure is broken (missing option, duplicate option, wrong key count).
     RULE 3  A confirmed error is corrected in place (that already happens in kb/check.js). The student is told in ONE calm line («اتصحّح تلقائيًا»), never as a warning,
             and the before → after stays one tap away.
     RULE 4  Nothing here throws away data: everything the student does not see is still on the payload (`trust.items`, `trust.stats`, `item.trustWhy`, the gap list) and is shown
             to the developer when developer mode is on (localStorage clinix:dev = "1", or the Vite dev server). */
import { concernOf, normalizeTrust } from "./mistakes.js";

/* developer mode: the Vite dev server, or the flag in localStorage. Never on for a student's build by default. */
export function isDeveloper() {
  try { if (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.DEV) return true; } catch (e) { /* no Vite */ }
  try { return typeof window !== "undefined" && window.localStorage.getItem("clinix:dev") === "1"; } catch (e) { return false; }
}

/* ── lesson text (Part A / Part B) ── */
/* severity of ONE labeled item (the shape analysis.js puts on the trust payload):  "none" | "fixed" | "note" | "warn" */
export function itemSeverity(it) {
  if (!it) return "none";
  const patched = it.text != null && it.text !== "" && it.text !== it.sentence;
  switch (it.label) {
    case "corrected": return patched ? "fixed" : "none";
    case "conflict": return patched ? "fixed" : "warn";                   // the student's source disagrees with the sentence and nothing could be fixed: a concrete risk
    case "uncertain": return /^AI check disagrees/.test(String(it.note || "")) ? "warn" : "none";   // a missing reference range for an age is a coverage gap, not a risk
    case "scope": return "note";                                          // «a rule of another profession / country»: useful to know, never alarming
    default: return "none";                                               // verified · grounded · reference · outdated · unverified · plain: no coverage = no label
  }
}

const SCOPE_AR = "قاعدة بتختلف حسب التخصص أو البلد: راجع اللوائح عندك.";

/* trust payload → what to draw. `quiet` = there is nothing to say to the student at all. */
export function lessonView(trust) {
  if (!trust) return { quiet: true, banner: null, fixes: [], warnings: [], notes: [], conflicts: [], cards: [], analogies: [], memoAids: [], audit: null };
  if (trust.clinicalSynthesisBlocked) {
    return { quiet: false, banner: trust.banner || null, fixes: [], warnings: [], notes: [], conflicts: [], cards: [], analogies: [], memoAids: [], audit: trust.stats || null, clinicalSynthesisBlocked: true };
  }
  const items = trust.items || [];
  const patched = new Map((trust.patches || []).map((p) => [p.id, p]));
  const fixes = [], warnings = [], notes = [];
  for (const it of items) {
    const sev = itemSeverity(it);
    if (sev === "fixed") { const p = patched.get(it.id); fixes.push({ before: (p && p.before) || it.sentence, after: (p && p.after) || it.text, fromSource: it.label === "conflict" }); }
    else if (sev === "warn") warnings.push({ sentence: it.sentence, why: it.label === "uncertain" ? String(it.note || "").replace(/^AI check disagrees:?\s*/, "") : String(it.note || ""), kind: it.kind, id: it.id });
    else if (sev === "note") notes.push({ sentence: it.sentence, text: SCOPE_AR });
  }
  /* a patch that has no item on the payload (an exam-like caller) still counts as a fix, once */
  const seen = new Set(fixes.map((f) => f.before));
  for (const p of trust.patches || []) if (!seen.has(p.before)) fixes.push({ before: p.before, after: p.after, fromSource: false });
  const conflicts = (trust.conflicts || []).map((c) => ({ source: c.source, reference: c.reference }));
  const banner = trust.banner || null;
  const quiet = !banner && !fixes.length && !warnings.length && !notes.length && !conflicts.length;
  return {
    quiet, banner, fixes, warnings, notes, conflicts,
    cards: (trust.cards || []).map((c) => ({ id: c.id, title: c.title, lines: c.lines, note: c.note, notCovered: c.notCovered || [], source: c.source, version: c.version, verified: c.label === "verified" })),
    analogies: trust.analogies || [], memoAids: trust.memoAids || [],
    audit: trust.stats || null,                                           // developers only: the raw counters
  };
}


/* High-impact clinical synthesis gate: supplementary AI-authored material must not
   bypass the hidden main explanation through the TrustPanel (analogies, mnemonics,
   patches, reference cards, or developer-visible sentence items). Keep the safety
   banner and aggregate audit counters, but expose no generated clinical claims. */
export function filterTrustForBlockedClinicalSynthesis(trust) {
  if (!trust || !trust.clinicalSynthesisBlocked) return trust;
  return {
    ...trust,
    cards: [], conflicts: [], analogies: [], memoAids: [],
    patches: [], items: [], stripped: [],
  };
}

/* ── one exam item ── */
const FLAG_AR = {
  "key-contradicts-reference": "الإجابة الصح المكتوبة بتتعارض مع المرجع",
  "negative-key-supported": "الإجابة المحددة مدعومة بالمرجع بينما السؤال بيطلب الاستثناء",
  "distractor-is-true": "في اختيار معتبر غلط وهو في المرجع صح",
  "source-contradiction": "الإجابة بتختلف عن مصدرك",
  "source-vs-reference": "مصدرك والمرجع مش متفقين على المعلومة دي",
  "options": "السؤال ناقصه اختيارات", "duplicate-option": "اتنين من الاختيارات بيقولوا نفس الشيء",
  "key": "مفتاح الإجابة مش مظبوط", "key-count": "عدد الإجابات الصح مش مظبوط", "select-count": "عدد الاختيارات المطلوبة مش مطابق لمفتاح الإجابة",
};
const SRC_AR = { pdf: "الـ PDF", image: "الصورة", audio: "التسجيل", lesson: "درسك المحفوظ", text: "ملاحظاتك" };
export const provWhere = (p) => (p ? `${SRC_AR[p.sourceType] || "مصدرك"}${p.page ? " · ص " + p.page : p.block ? " · فقرة " + p.block : ""}` : "");

/* → { level: "none" | "good" | "fixed" | "note" | "warn", text, snippet, reasons[] }
   good = a positive, useful pointer (verified reference / «from your PDF · p. 3»). reference · ungrounded without a concrete risk → "none": the item is simply shown. */
export function examView(q) {
  const none = { level: "none", text: "", snippet: "", reasons: [] };
  if (!q || !q.trust) return none;
  const flags = Array.isArray(q.trustFlags) ? q.trustFlags : [];
  if (concernOf(q)) {
    const reasons = flags.filter((f) => FLAG_AR[f]).map((f) => FLAG_AR[f]);
    return { level: "warn", text: "راجع السؤال ده", snippet: "", reasons: reasons.length ? reasons : ["فيه تعارض مع مصدرك أو المرجع"] };
  }
  if (flags.includes("scope")) return { level: "note", text: SCOPE_AR, snippet: "", reasons: [] };
  if (Array.isArray(q.trustPatches) && q.trustPatches.length) return { level: "fixed", text: "اتصحّح تلقائيًا ليطابق المرجع", snippet: "", reasons: [] };
  const t = normalizeTrust(q.trust);
  if (t === "grounded" && q.trustProv) return { level: "good", text: `من مصدرك · ${provWhere(q.trustProv)}`, snippet: q.trustProv.snippet || "", reasons: [] };
  if (t === "verified") return { level: "good", text: "متحقق من مرجع", snippet: "", reasons: [] };
  return none;
}
