/* ───────────── lib/examtrust.js · citation-first calibrated trust for every exam item (v3.44) ─────────────
   Every item the generator writes is evaluated — synchronously, zero network, zero tokens, before the student sees it — and gets ONE tag:

     verified    ✓  a verified, current KB reference agrees with the key
     grounded    📄  the key is anchored in the student's OWN source (typed text, PDF text layer, OCR transcript…): «From your PDF · p. 3», with the snippet
     reference   🔎  a KB rule agrees with the key (its source quote is not verified yet) — or the key is anchored only in the student's saved AI-written lessons
     conflict    ⚠  something contradicts: the reference, the student's source (a number or a negation differs), or the source itself contradicts the reference
     ungrounded  ؟  nothing anchors the key (it is the generator's own claim), or the item is defective, or a safety-critical statement is unresolved

   PRECEDENCE: conflict > defect (ungrounded) > verified > grounded > reference > ungrounded.
   WHAT THE TAG DOES ("act, then review"):
     saved mistakes   verified · grounded · reference save SMOOTHLY (carrying their badge, removable in one tap). conflict · ungrounded are held back with a one-tap «save anyway».
     memorize         verified; or grounded AND not safety-critical (it is the student's own material, but doses / contraindications need an official reference).
                      Never reference-only, conflict or ungrounded.
   Not here (by design): the F3 claims-in-the-proof-request check — exam items are final when shown. Unresolved high-risk statements go to the KB gap list.
   Legacy tags map: pending → reference, unverified → ungrounded. */
import { cleanResidue, splitText, classify, norm, HIGH_RISK, SAFETY_CRITICAL, anchorsOf, tokens } from "./accuracy.js";
import { checkItems } from "./kb/check.js";
import { patientOf } from "./kb/ranges.js";
import { kbReady } from "./kb/index.js";
import { inferProfile } from "./profile.js";
import { addGaps } from "./reports.js";
import { groundSentence, provLabel } from "./provenance.js";
import { normalizeTrust, mistakeEligible, memorizeEligible } from "./mistakes.js";

export const TIERS = ["verified", "grounded", "reference", "conflict", "ungrounded"];
export { normalizeTrust, mistakeEligible, memorizeEligible };
export const trustOf = (q) => normalizeTrust(q && q.trust) || "ungrounded";
export const TRUST_NOTE = { verified: "", grounded: "", reference: "reference — source check pending", conflict: "conflict", ungrounded: "not grounded" };

const NEG = /\b(?:EXCEPT|NOT|LEAST|further teaching|incorrect|false|unsafe)\b/;
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
const QWORDS = new Set(["which", "what", "following", "statement", "correct", "most", "likely", "best", "first", "next", "patient", "client", "nurse", "should", "would", "identify", "select", "choose", "true", "false", "answer", "question", "indicates", "appropriate", "priority", "action", "include", "includes", "apply"]);

/* one piece of text → its sentences labeled by the KB; ONLY patched sentences change, everything else is kept exactly as written (analogies included) */
function label(text, { profile, now, patient }) {
  const lines = splitText(text);
  const items = [];
  lines.forEach((L, li) => L.sentences.forEach((s) => items.push({ id: `e${items.length}`, line: li, sentence: s, kind: classify(s), origin: "added" })));
  const { patches, gaps } = checkItems(items, { profile, now, patient, all: true });
  const by = new Map();
  for (const it of items) { if (!by.has(it.line)) by.set(it.line, []); by.get(it.line).push(it); }
  const out = lines.map((L, li) => (by.has(li) ? L.prefix + by.get(li).map((it) => (it.text != null ? it.text : it.sentence)).join(" ") : L.raw)).join("\n");
  return { text: out, items, patches, gaps };
}

/* is the KEY anchored in the student's source? Evidence, in order: (1) rationale sentences about the key option, (2) the option itself when it is a full statement,
   (3) stem + option as one proposition. Each goes through groundSentence (anchors ≥ 75 %, numbers, polarity, acronyms). A contradiction anywhere wins. */
function groundKey(model, q, key) {
  if (!model || !model.segments || !model.segments.length) return { state: "none" };
  let best = { state: "none" };
  const take = (g) => { if (g.state === "contradiction") best = g; else if (g.state === "grounded" && best.state !== "contradiction" && (best.state === "none" || g.score > best.score)) best = g; };
  for (const i of key) {
    const opt = q.options[i] || "";
    const oanc = new Set(anchorsOf(tokens(opt)));
    for (const L of splitText(q.rationale || "")) for (const s of L.sentences) {
      const sa = anchorsOf(tokens(s));
      const share = [...oanc].filter((w) => sa.includes(w)).length;
      if (oanc.size && share >= Math.max(1, Math.ceil(oanc.size * 0.6))) take(groundSentence(model, s));
    }
    take(groundSentence(model, opt));
    take(groundSentence(model, `${q.stem.replace(/\?/g, ".")} ${opt}`.split(" ").filter((w) => !QWORDS.has(w.toLowerCase().replace(/\W/g, ""))).join(" ")));
  }
  return best;
}

/* q: { type, stem, options[], correct[], rationale, topic } → the same object, cleaned / patched, with trust fields. Idempotent. */
export function tagExamItem(q, { profile, now = Date.now(), record = true, sourceModel = null } = {}) {
  if (!q) return q;
  if (q.trust) { q.trust = normalizeTrust(q.trust) || q.trust; return q; }          // already evaluated (a legacy tag is only renamed)
  const prof = profile || inferProfile(`${q.stem} ${q.topic || ""}`);
  const defects = [], conflicts = [], why = [];
  const defect = (code, msg) => { defects.push(code); why.push(msg); };
  const conflict = (code, msg) => { conflicts.push(code); why.push(msg); };
  if (!kbReady(prof)) defect("kb-not-loaded", "the reference was not loaded yet");

  q.stem = cleanResidue(q.stem); q.options = (q.options || []).map((o) => cleanResidue(o)); q.rationale = cleanResidue(q.rationale || "");
  const patient = patientOf(q.stem);
  const patches = [], gaps = [];
  const support = [];                                        // KB evidence that AGREES with the key: "verified" | "reference" | "outdated"
  let safety = false;

  // ── B3 · structure and logic (defects: the item itself is not trustworthy) ──
  const n = q.options.length;
  if (n < 2) defect("options", "fewer than two options");
  const normed = q.options.map((o) => norm(o).replace(/[^a-z0-9\u0621-\u064A ]+/g, " ").replace(/\s+/g, " ").trim());
  if (new Set(normed).size !== normed.length) defect("duplicate-option", "two options say the same thing");
  const key = Array.isArray(q.correct) ? q.correct : [];
  if (!key.length || key.some((i) => !Number.isInteger(i) || i < 0 || i >= n)) defect("key", "the key points at a missing option");
  if (q.type === "multi" ? key.length < 2 : key.length !== 1) defect("key-count", `a ${q.type === "multi" ? "select-all" : "single-answer"} item with ${key.length} key(s)`);
  const sel = /\b(?:select|choose|pick)\s+(\d+|one|two|three|four|five|six)\b/i.exec(q.stem);
  if (sel) { const want = /^\d+$/.test(sel[1]) ? +sel[1] : NUM[sel[1].toLowerCase()]; if (want && want !== key.length) defect("select-count", `the stem says select ${want}, the key has ${key.length}`); }
  const negative = NEG.test(q.stem);

  // ── F2 on the stem and the rationale: patched IN PLACE, logged → the item CONTRADICTS the reference ──
  const st = label(q.stem, { profile: prof, now, patient });
  const ra = label(q.rationale, { profile: prof, now, patient });
  if (st.patches.length) { q.stemBefore = q.stem; q.stem = st.text; conflict("stem-contradiction", "the stem contradicted the reference (patched)"); }
  if (ra.patches.length) { q.rationaleBefore = q.rationale; q.rationale = ra.text; conflict("rationale-contradiction", "the rationale contradicted the reference (patched)"); }
  patches.push(...st.patches, ...ra.patches);
  gaps.push(...st.gaps, ...ra.gaps);
  for (const it of ra.items) if (["verified", "reference", "outdated"].includes(it.label)) support.push(it.label);
  for (const it of [...st.items, ...ra.items]) {
    if (it.label === "scope") defect("scope", it.note);
    if (SAFETY_CRITICAL.has(it.kind) && it.label === "unverified") safety = true;
  }

  // ── B4 · the options against the KB, read as «stem + option» so a bare "Vitamin K" is judged inside its question ──
  const stemFlat = q.stem.replace(/\?+/g, ".");
  q.options.forEach((o, i) => {
    const isKey = key.includes(i);
    const r = label(`${stemFlat} ${o}`, { profile: prof, now, patient });
    const hit = r.items.find((it) => it.label === "corrected" || it.label === "conflict");
    const agrees = r.items.find((it) => ["verified", "reference", "outdated"].includes(it.label));
    if (negative) {                                          // «which is NOT …»: the KEY is the false statement, so the evidence is inverted
      if (isKey && agrees) conflict("negative-key-supported", `the key ${String.fromCharCode(65 + i)} is supported by the reference but the stem asks for the exception`);
      if (isKey && hit) support.push("reference");
    } else {
      if (isKey && hit) conflict("key-contradicts-reference", `the correct option ${String.fromCharCode(65 + i)} contradicts the reference`);
      if (isKey && agrees) support.push(agrees.label);
      if (!isKey && agrees && q.type !== "multi") conflict("distractor-is-true", `option ${String.fromCharCode(65 + i)} is marked wrong but the reference supports it`);
    }
    if (isKey) for (const it of r.items) if (SAFETY_CRITICAL.has(it.kind) && it.label === "unverified") safety = true;
    gaps.push(...r.gaps);
  });

  // ── citation-first: is the key anchored in the student's own source? ──
  let g = { state: "none" };
  if (sourceModel && key.length && !defects.includes("key")) g = groundKey(sourceModel, q, key);
  if (g.state === "contradiction") conflict("source-contradiction", `differs from your source (${g.why}): «${g.source}»`);
  if (g.state === "grounded") {          // the source itself may be wrong: «source says X, reference says Y»
    const chk = label(g.source, { profile: prof, now, patient });
    const bad = chk.items.find((it) => it.label === "corrected" || it.label === "conflict");
    if (bad) conflict("source-vs-reference", `your source says «${bad.before || bad.sentence}», the reference says «${bad.text}»`);
  }
  if (safety) { if (g.state === "grounded" || support.includes("verified")) q.trustSafety = true; else defect("safety-unresolved", "a dose / contraindication / interaction statement that neither your source nor an official reference confirmed"); }

  // ── the tag ──
  let trust = "ungrounded";
  if (conflicts.length) trust = "conflict";
  else if (defects.length) trust = "ungrounded";
  else if (support.includes("verified")) trust = "verified";
  else if (g.state === "grounded" && g.prov && g.prov.sourceType !== "lesson") trust = "grounded";
  else if (g.state === "grounded" || support.includes("reference")) trust = "reference";
  else why.push(support.includes("outdated") ? "the only reference backing the key may be outdated" : "nothing anchors the key: it is the generator's own claim");
  q.trust = trust; q.trustNote = TRUST_NOTE[trust]; q.trustWhy = why; q.trustFlags = [...conflicts, ...defects];
  if (g.state === "grounded") q.trustProv = { ...g.prov, snippet: g.source, label: provLabel(g.prov, "en") };
  if (patches.length) q.trustPatches = patches.map((p) => ({ before: p.before, after: p.after, fact: p.fact }));
  if (record) addGaps(prof, gaps.filter((x) => HIGH_RISK.has(x.kind)));
  return q;
}

export const tagExam = (questions, opts) => (questions || []).map((q) => tagExamItem(q, opts));
export const trustCounts = (questions) => (questions || []).reduce((c, q) => { c[trustOf(q)] += 1; return c; }, { verified: 0, grounded: 0, reference: 0, conflict: 0, ungrounded: 0 });
