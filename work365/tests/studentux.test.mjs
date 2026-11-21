/* v3.45 · student-friendly verification: uncovered statements pass naturally, only concrete risks warn, internal audit data stays intact. */
import test from "node:test";
import assert from "node:assert/strict";
import * as KB from "../src/lib/kb/index.js";
import { verifyText, ensureKb } from "../src/lib/trust.js";
import { buildSourceModel } from "../src/lib/provenance.js";
import { itemSeverity, lessonView, examView, isDeveloper, filterTrustForBlockedClinicalSynthesis } from "../src/lib/studentview.js";
import { tagExamItem } from "../src/lib/examtrust.js";
import { recordAnswer, mistakeEligible, concernOf, __setState } from "../src/lib/mistakes.js";
import { listGaps, clearReports } from "../src/lib/reports.js";
import * as S from "../src/lib/solvecheck.js";

const GEN = { discipline: "general", exam: "", region: "" };
await ensureKb(GEN);
const payload = (r) => ({ stats: r.stats, patches: r.patches, cards: r.cards, conflicts: r.conflicts, analogies: [], memoAids: [], items: r.items.filter((i) => i.label !== "plain").map((i) => ({ id: i.id, kind: i.kind, label: i.label, note: i.note, sentence: i.before || i.sentence, text: i.text })) });

test("critical clinical synthesis gate removes every supplementary generated claim from the TrustPanel payload", () => {
  const raw = {
    clinicalSynthesisBlocked: true,
    banner: { tier: "LOW", head: "Clinical answer not cleared", why: ["anion-gap mismatch"] },
    stats: { sentences: 8, analogies: 2 },
    cards: [{ title: "Clinical reference", lines: ["patient-specific treatment claim"] }],
    conflicts: [{ source: "x", reference: "y" }],
    analogies: ["Stop all medications immediately."],
    memoAids: ["Use this treatment shortcut."],
    patches: [{ before: "unsafe claim", after: "corrected claim" }],
    items: [{ id: "x", label: "conflict", sentence: "unsafe generated clinical claim" }],
    stripped: [{ sentence: "another generated claim", reason: "x" }],
  };
  const safe = filterTrustForBlockedClinicalSynthesis(raw);
  for (const field of ["cards", "conflicts", "analogies", "memoAids", "patches", "items", "stripped"]) assert.deepEqual(safe[field], [], `${field} must not bypass the synthesis gate`);
  assert.equal(safe.banner, raw.banner, "retain the safety banner");
  assert.equal(safe.stats, raw.stats, "retain aggregate diagnostic counters");
  const view = lessonView(safe);
  assert.equal(view.clinicalSynthesisBlocked, true);
  assert.equal(view.banner, raw.banner);
  for (const field of ["fixes", "warnings", "notes", "conflicts", "cards", "analogies", "memoAids"]) assert.deepEqual(view[field], [], `${field} must stay hidden in the student view`);
});

test("clinical analysis applies the synthesis gate before emitting the TrustPanel payload", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../src/lib/analysis.js", import.meta.url), "utf8");
  assert.match(src, /const synthesisSuppressed = !!\(safetyAudit\.conflicts\.length \|\| calculationSynthesisBlocked\)/);
  assert.match(src, /clinicalSynthesisBlocked: synthesisSuppressed/);
  assert.match(src, /emitTrust\(filterTrustForBlockedClinicalSynthesis\(/);
});

test("an uncovered high-risk statement: internal label + gap stay, the student view is completely quiet (no warning, no count)", () => {
  clearReports();
  const r = verifyText({ text: "Give 7.5 mg of zorbitol every 6 hours. A client with a 3 kg gain should be reported.", profile: GEN, part: "B" });
  assert.ok(r.items.some((i) => i.label === "unverified"), "internal audit still records it");
  assert.ok(r.gaps.length > 0, "gap list data is kept for developers");
  const v = lessonView(payload(r));
  assert.equal(v.quiet, true); assert.deepEqual([v.fixes, v.warnings, v.notes], [[], [], []]);
  const { audit, ...studentSide } = v;
  assert.equal(JSON.stringify(studentSide).includes("unverified"), false, "no unverified wording leaks into the student view");
  assert.ok(v.audit && "unverified" in v.audit, "developers can still read the raw counters");
});

test("a confirmed KB error is corrected in place and shown as ONE calm fix, never as a warning", () => {
  const r = verifyText({ text: "- The gallbladder secretes bile into the duodenum.", source: "The liver makes bile and the gallbladder stores it.", profile: GEN, part: "A" });
  assert.ok(r.text.includes("liver makes bile"), "corrected in place");
  const v = lessonView(payload(r));
  assert.equal(v.warnings.length, 0, "a fix is not a warning"); assert.equal(v.quiet, false);
  assert.ok(v.fixes.length >= 1 && v.fixes[0].before && v.fixes[0].after, "before → after stays one tap away");
});

test("itemSeverity: only a concrete risk is a warning", () => {
  for (const label of ["verified", "grounded", "reference", "outdated", "unverified", "plain"]) assert.equal(itemSeverity({ label, sentence: "x", note: "reference — source check pending" }), "none", label);
  assert.equal(itemSeverity({ label: "uncertain", note: "no reference range for this age in the KB" }), "none", "a coverage gap");
  assert.equal(itemSeverity({ label: "uncertain", note: "AI check disagrees: 5 mg" }), "warn");
  assert.equal(itemSeverity({ label: "conflict", note: "differs from your source (number)", sentence: "Give 50 mg" }), "warn", "differs from the student's own source and could not be fixed");
  assert.equal(itemSeverity({ label: "scope", note: "x" }), "note");
});

test("solve banner: bookkeeping and unavailable confidence never reach the student", () => {
  assert.equal(S.banner({ tier: "MEDIUM", flags: [], reasons: ["answer probabilities were not available", "not calibrated for this subject"], issues: ["the model's probability for this answer is moderate, not high (70%)"], concerns: [] }, "ar"), null);
  const b = S.banner({ tier: "LOW", flags: [], reasons: [], issues: [], concerns: [{ code: "data-doubt", en: "a number in the image may have been misread: double-check it", ar: "في رقم في الصورة ممكن يكون اتقرا غلط: راجعه بنفسك" }], perOption: [] }, "ar");
  assert.ok(b && b.why.length === 1 && /رقم/.test(b.why[0]));
});

test("exam items: no coverage → no badge; grounded / verified → a positive pointer; concrete defect or contradiction → the only warning", () => {
  const q = (o = {}) => tagExamItem({ type: "single", stem: "A client with heart failure gains 3 kg in 2 days. What should the nurse do first?", options: ["Weigh again tomorrow", "Report it to the provider", "Increase fluids", "Encourage walking"], correct: [1], rationale: "Rapid gain means fluid overload.", topic: "cardiac", ...o }, { profile: GEN, record: false });
  const plain = q();
  assert.equal(plain.trust, "ungrounded", "internal tier unchanged");
  assert.equal(plain.trustConcern, false); assert.deepEqual(examView(plain), { level: "none", text: "", snippet: "", reasons: [] });
  const dup = q({ options: ["Report it", "report it!", "Increase fluids", "Walk"] });
  assert.equal(dup.trustConcern, true);
  const w = examView(dup); assert.equal(w.level, "warn"); assert.ok(w.reasons.some((x) => /نفس الشيء/.test(x)));
  const src = buildSourceModel({ items: [{ t: "text", name: "n", text: "A client with heart failure who gains 3 kg in 2 days must be reported to the provider." }] });
  const g = q({}) && tagExamItem({ type: "single", stem: "Which action is correct for rapid weight gain in heart failure?", options: ["Report it to the provider", "Ignore it"], correct: [0], rationale: "Rapid weight gain in heart failure must be reported to the provider.", topic: "cardiac" }, { profile: GEN, record: false, sourceModel: src });
  if (g.trust === "grounded") { const v = examView(g); assert.equal(v.level, "good"); assert.match(v.text, /من مصدرك/); }
  assert.equal(examView({ trust: "reference", trustFlags: [] }).level, "none");
  assert.equal(examView({ trust: "ungrounded", trustFlags: ["safety-unresolved", "kb-not-loaded"] }).level, "none", "unresolved dose / unloaded reference are internal");
  assert.equal(examView({ trust: "conflict", trustFlags: ["stem-contradiction"], trustPatches: [{ before: "a", after: "b" }] }).level, "fixed", "auto-fixed: calm note only");
});

test("saved mistakes: only a concrete concern holds an item back", () => {
  __setState([]);
  const mk = (stem, extra) => ({ stem, options: ["a", "b"], correct: [1], type: "single", rationale: "", topic: "x", ...extra });
  assert.equal(recordAnswer(mk("uncovered?", { trust: "ungrounded", trustFlags: [] }), [0]), "new");
  assert.equal(recordAnswer(mk("patched?", { trust: "conflict", trustFlags: ["rationale-contradiction"] }), [0]), "new", "already fixed in place");
  assert.equal(recordAnswer(mk("contradiction?", { trust: "conflict", trustFlags: ["key-contradicts-reference"] }), [0]), "skipped");
  assert.equal(concernOf({ trust: "conflict" }), true, "legacy tag without flags");
  assert.equal(mistakeEligible({ trust: "ungrounded" }), true);
  __setState([]);
});

test("developer mode is off by default and switched on by a flag; gaps are still recorded", () => {
  assert.equal(isDeveloper(), false);
  window.localStorage.setItem("clinix:dev", "1"); assert.equal(isDeveloper(), true);
  window.localStorage.removeItem("clinix:dev");
  clearReports();
  tagExamItem({ type: "single", stem: "A client takes zorbitol 7 mg every 6 hours daily. What is the maximum dose?", options: ["7 mg", "70 mg"], correct: [0], rationale: "The maximum dose is 7 mg every 6 hours.", topic: "pharm" }, { profile: GEN });
  assert.ok(Object.values(listGaps()).some((b) => Object.keys(b).length > 0), "internal gap list untouched");
});

test("source files: the student-facing components no longer print counts, «pending» or «not grounded»", async () => {
  const fs = await import("node:fs");
  const read = (p) => fs.readFileSync(new URL(`../src/components/${p}`, import.meta.url), "utf8");
  const tp = read("TrustPanel.jsx"), ec = read("ExamCard.jsx");
  assert.doesNotMatch(tp, /ده مش ضمان 100%/);
  assert.match(tp, /isDeveloper\(\)/); assert.match(tp, /data-audit="developer"/);
  assert.doesNotMatch(ec, /مش مبني على مصدر|الإجابة مش مبنية على مصدر|المصدر لسه بيتراجع/);
});
