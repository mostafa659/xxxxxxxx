/*
 * ClinixStudy · Reasoning-trap advisories (v3.68)
 *
 * Deterministic, narrow, NOT a clinical authority. They flag the SHAPE of a reasoning error that recurs across specialties,
 * so a reviewer looks at the sentence. None of them blocks an answer; each says what to check.
 *
 *   confounded-negative-excludes   a test the source says was taken under a confounder (plasma, antibiotics, IVIG …) is used to "exclude" a disease
 *   artifact-asserted-as-fact      a measurement is called false/spurious/artifactual with no hedge and no arbiter
 *   single-cause-forcing           "solely / only due to" for a multi-factor picture
 *   unsupported-threshold          a percentage cut-off in the answer that appears neither in the source nor in the verified anchors
 *   hypothetical-in-open-case      "if the question changed …" variations on a case that has no options
 *   empty-mnemonic-label           a memory-aid label with nothing after it
 */

const EXCLUDES = /\b(?:rules?\s+out|ruled\s+out|excludes?|excluded|effectively\s+excluded|definitively\s+excluded|safely\s+excluded|exclusion\s+of)\b|يستبعد|استبعاد\s+(?:تام|قاطع)|ينفي/i;
const NEGATED = /\b(?:does\s+not|do\s+not|cannot|can't|can\s+not|not\s+(?:reliably|safely|be)|never|unable\s+to|fails?\s+to|neither|nor|without\s+(?:excluding|ruling)|doesn't|isn't|is\s+not|لا\s|لن\s|ليس|لايمكن|لا\s+يمكن)\b|لا يستبعد|لا ينفي|لا يمكن/i;
const HEDGE = /\b(?:may|might|could|possibly|possible|perhaps|likely|probably|suspected|suspect|hypothes\w+|if\s+confirmed|until|unless|needs?\s+(?:to\s+be\s+)?(?:confirmed|verified)|can\s+be|would)\b|يحتمل|ممكن|قد\s|محتمل|فرضية|يُشتبه|يشتبه/i;

/* a test and the circumstances that make a normal / negative / reassuring result unreliable */
const CONFOUNDED = [
  { test: /ADAMTS-?13/i, confounder: /\b(?:plasma|FFP|fresh frozen|plasma exchange|PLEX|TPE|cryosupernatant)\b|بلازما/i, name: "ADAMTS13 after plasma" },
  { test: /\b(?:culture|cultures|blood culture|urine culture)\b|مزرعة/i, confounder: /\b(?:antibiotic|cephalexin|ceftriaxone|antimicrobial|amoxicillin|ciprofloxacin)\w*\b|مضاد حيوي/i, name: "culture after antibiotics" },
  { test: /\b(?:antibod(?:y|ies)|serolog\w*|ANA|anti-?dsDNA|complement|C3|C4)\b/i, confounder: /\b(?:IVIG|immunoglobulin|plasma exchange|plasmapheresis|rituximab)\b/i, name: "serology after IVIG / plasma exchange / rituximab" },
  { test: /\b(?:INR|PT|aPTT|APTT|clotting)\b/i, confounder: /\b(?:lupus anticoagulant|antiphospholipid|heparin|DOAC|direct oral anticoagulant)\b/i, name: "clotting test under lupus anticoagulant / heparin" },
];

const sentences = (t) => String(t || "").replace(/\r/g, "").split(/(?<=[.!?؟])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
const snippet = (s) => (s.length > 170 ? `${s.slice(0, 167)}…` : s);

export function auditReasoningTraps({ source = "", answer = "", anchorsText = "", openCase = false } = {}) {
  const out = [];
  const push = (code, message, example) => { if (!out.some((x) => x.code === code)) out.push({ code, message, example: example ? snippet(example) : "" }); };
  const src = String(source || ""), ans = String(answer || "");
  if (!ans.trim()) return out;
  const sents = sentences(ans);

  for (const c of CONFOUNDED) {
    if (!c.test.test(src) || !c.confounder.test(src)) continue;
    const hit = sents.find((s) => c.test.test(s) && EXCLUDES.test(s) && !NEGATED.test(s));
    if (hit) push("confounded-negative-excludes", `The source shows a confounder for this test (${c.name}), yet a sentence uses a result to exclude a diagnosis. Check that the result is called indeterminate, with the direction of the distortion, the repair (stored pre-treatment sample, repeat, alternative assay) and what to do meanwhile.`, hit);
  }

  const art = sents.find((s) => /\b(?:falsely|spuriously|artifactually|erroneously)\s+(?:elevated|raised|high|prolonged|low|increased)\b|\b(?:is|are|was|were)\s+(?:a\s+)?(?:false|spurious|artifactual)\s+(?:reading|result|value|elevation)\b|\bfalse(?:ly)?\s+elevat\w+/i.test(s) && !HEDGE.test(s));
  if (art) push("artifact-asserted-as-fact", "A measurement is called false/spurious without a hedge. Check that the alternative (a real change) is weighed, that both can be true, and that an arbitrating test is named; an artifact is a hypothesis until it is shown.", art);

  const one = sents.find((s) => /\b(?:solely|exclusively|entirely|purely)\s+(?:due\s+to|caused\s+by|explained\s+by|because\s+of|attributable\s+to)\b|\bthe\s+(?:sole|only)\s+(?:cause|explanation|mechanism)\b/i.test(s) && !NEGATED.test(s));
  if (one) push("single-cause-forcing", "A multi-factor picture is attributed to a single cause. Check that coexisting processes and the evidence against a single mechanism are discussed.", one);

  const known = `${src}\n${anchorsText}`;
  const bad = [];
  for (const m of ans.matchAll(/(?:above|below|over|under|greater than|less than|more than|at least|at most|>|<|≥|≤)\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|percent|٪|في المئة)/gi)) {
    const n = m[1];
    if (!new RegExp(`(?:^|[^\\d.])${n.replace(".", "\\.")}(?:[^\\d]|$)`).test(known)) bad.push(m[0].trim());
  }
  if (bad.length) push("unsupported-threshold", `A percentage cut-off appears in the answer that is in neither the source nor the verified anchors (${[...new Set(bad)].slice(0, 3).join("; ")}). Check it against a guideline before relying on it; do not treat it as an established threshold.`);

  if (openCase) {
    const hyp = sents.find((s) => /\bif the (?:stem|question|case|patient|scenario)\b[^.\n]{0,60}\b(?:said|were|had|changed)\b|لو السؤال اتغير|لو (?:كان|كانت) (?:المريض|المريضة|السؤال)/i.test(s));
    if (hyp) push("hypothetical-in-open-case", "A changed-case statement appears in an open clinical case. A counterfactual that is not a verified clinical fact is a fabrication risk; check each one against the source.", hyp);
  }
  if (/(?:mnemonic|حيلة حفظ)\s*[:：]?\s*\*{0,2}\s*(?:\n|$)/i.test(ans)) push("empty-mnemonic-label", "A memory-aid label is present with no content. Remove it; do not invent an acronym.");
  return out;
}

export function formatReasoningTraps(list, lang = "ar") {
  if (!Array.isArray(list) || !list.length) return "";
  const head = lang === "en" ? "REASONING-PATTERN CHECKS (a reviewer should look at these sentences; not clinical authorization):" : "فحوص أنماط الاستدلال (تحتاج مراجعة هذه الجمل؛ ليست اعتمادًا سريريًا):";
  return [head, ...list.map((a) => `- ${a.message}${a.example ? ` «${a.example}»` : ""}`)].join("\n");
}
