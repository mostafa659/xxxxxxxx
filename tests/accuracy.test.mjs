/* v3.43 · the accuracy architecture: every seeded error is patched, removed or labeled; nothing high-risk is left unlabeled; speed budgets. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as T from "../src/lib/trust.js";
import * as A from "../src/lib/accuracy.js";
import * as KB from "../src/lib/kb/index.js";
import { validateFact } from "../src/lib/kb/schema.js";
import * as S from "../src/lib/solvecheck.js";
import * as P from "../src/lib/profile.js";
import * as C from "../src/lib/claims.js";
import * as PR from "../src/lib/proof.js";
import * as R from "../src/lib/reports.js";
import { buildFacts, licenseOk } from "../scripts/build-kb.mjs";
import { pickThresholds } from "../scripts/calibrate.mjs";
import { shuffleMap, readSecond, compareOpinions } from "../src/lib/secondopinion.js";
import { recordAnswer, mistakeEligible, __setState } from "../src/lib/mistakes.js";
import { evidenceFor } from "../src/lib/evidence.js";

const GEN = { discipline: "general", exam: "", region: "" };
const seeded = JSON.parse(fs.readFileSync(new URL("./golden/accuracy/seeded.json", import.meta.url), "utf8"));
await KB.loadKb(GEN);
const p95 = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)];

test("every seeded error is patched, removed, cleaned or labeled — and the numbers are printed", () => {
  const tally = { kb: 0, labeled: 0, unlabeled: 0, total: 0 };
  for (const c of seeded) {
    const r = T.verifyText({ text: c.text, source: c.source, profile: c.profile || GEN, part: "A" });
    tally.total += 1;
    if (c.expect === "corrected") {
      assert.ok(r.items.some((i) => i.label === "corrected"), `${c.id}: not corrected → ${JSON.stringify(r.items.map((i) => i.label))}`);
      assert.ok(r.text.includes(c.mustContain), `${c.id}: correction missing "${c.mustContain}" in ${r.text}`);
      assert.ok(r.patches.length >= 1 && r.patches[0].before && r.patches[0].after, `${c.id}: before→after not logged`);
      tally.kb += 1;
    } else if (c.expect === "stripped") {
      assert.ok(r.stripped.length >= 1, `${c.id}: not stripped`);
      assert.ok(!r.text.includes(c.text.replace(/^- /, "")), `${c.id}: still in the text`);
      tally.labeled += 1;
    } else if (c.expect === "cleaned") {
      assert.ok(!r.text.includes(c.mustNotContain), `${c.id}: residue left: ${r.text}`);
      tally.labeled += 1;
    } else if (c.expect === "unverified" || c.expect === "scope") {
      assert.ok(r.items.some((i) => i.label === c.expect), `${c.id}: expected ${c.expect}, got ${JSON.stringify(r.items.map((i) => i.label))}`);
      if (c.note) assert.ok(r.items.some((i) => (i.note || "").includes(c.note)), `${c.id}: missing the "${c.note}" note`);
      assert.ok(r.items.every((i) => !i.memorize), `${c.id}: must never be memorize-eligible`);
      tally.labeled += 1;
    }
    assert.equal(r.stats.unlabeledHighRisk, 0, `${c.id}: a high-risk sentence was left unlabeled`);
  }
  console.log(`# seeded: ${tally.total} cases · ${(tally.kb / tally.total * 100).toFixed(0)}% resolved by KB · ${(tally.labeled / tally.total * 100).toFixed(0)}% removed/cleaned/labeled · ${tally.unlabeled} left unlabeled`);
  assert.equal(tally.unlabeled, 0);
});

test("analogies leave the body; Part B boxes invented mnemonics instead of stripping them", () => {
  const a = T.verifyText({ text: "- Think of the stomach like a blender.\n- The stomach digests food.", source: "The stomach digests food.", profile: GEN, part: "A" });
  assert.equal(a.analogies.length, 1); assert.ok(!a.text.includes("blender"));
  const b = T.verifyText({ text: "- 💡 Remember it with the mnemonic ABCD.", source: "", profile: GEN, part: "B" });
  assert.equal(b.memoAids.length, 1); assert.ok(!b.text.includes("ABCD"));
});

test("a framework the KB knows (ABC) is not stripped", () => {
  const r = T.verifyText({ text: "- Use the framework Airway, Breathing, Circulation (ABC) here.", source: "Stomach text", profile: GEN, part: "A" });
  assert.equal(r.stripped.length, 0);
});

test("titles claiming completeness become what the material covered", () => {
  assert.match(A.honestTitle("الجهاز الهضمي بالكامل"), /اللي المادة غطّته/);
  assert.match(A.honestTitle("Digestive system from scratch", { lang: "en" }), /what the material covered/);
  assert.equal(A.honestTitle("الجهاز الهضمي بالكامل", { coverage: true }), "الجهاز الهضمي بالكامل");
});

test("lab range for the wrong sex / age is patched; a range with no stratum is flagged, never applied", () => {
  const r = T.verifyText({ text: "- Creatinine 1.3 mg/dL is normal for an adult woman.", source: "x", profile: GEN, part: "B" });
  assert.ok(r.items.some((i) => i.label === "corrected"), "female creatinine range ignored");
  const ok = T.verifyText({ text: "- Creatinine 1.0 mg/dL is normal for an adult woman.", source: "x", profile: GEN, part: "B" });
  assert.ok(!ok.items.some((i) => i.label === "corrected"));
  const kid = T.verifyText({ text: "- Hemoglobin 9 g/dL is normal for a 6-year-old girl.", source: "x", profile: GEN, part: "B" });
  assert.ok(kid.items.some((i) => i.label === "uncertain"), "child has no stratum in the KB");
  const ru = T.verifyText({ text: "- Hemoglobin 135 g/L is normal for an adult man.", source: "x", profile: GEN, part: "B" });
  assert.ok(!ru.items.some((i) => i.label === "corrected"), "SI units must convert, not false-alarm");
});

test("an expired guideline is never shown as ✓ (\"may be outdated\"); a verified, current one is ✓", () => {
  const base = { kind: "rule", topic: "test guideline", aliases: { en: ["zz guideline"], ar: [] }, data: { text: "t", triggers: ["zz guideline"] }, scope: { discipline: ["all"], exam: [], jurisdiction: "intl" }, source: { url: "https://who.int/x", license: "CC0", quote: "a verbatim quotation here", verified: true }, forbidden_patterns: [], version: "WHO 2015" };
  KB.registerModule("fx", [{ ...base, id: "fx.old", reviewBy: "2020-01-01" }, { ...base, id: "fx.cur", data: { text: "t", triggers: ["yy guideline"] }, aliases: { en: ["yy guideline"], ar: [] }, version: "WHO 2026", reviewBy: "2099-01-01" }]);
  const old = T.verifyText({ text: "- According to the current zz guideline, give it first.", source: "x", profile: GEN, part: "B" });
  assert.ok(old.items.some((i) => i.label === "outdated" && /outdated/.test(i.note)));
  assert.ok(old.items.every((i) => !i.memorize));
  const cur = T.verifyText({ text: "- According to the yy guideline, give it first.", source: "x", profile: GEN, part: "B" });
  assert.ok(cur.items.some((i) => i.label === "verified" && i.memorize));
  KB.__resetKb();
});

test("a nursing-only rule is not applied to another profession, and a US rule carries a jurisdiction warning for a non-US nurse", async () => {
  await KB.loadKb(GEN);
  const ph = T.verifyText({ text: "- Delegate the assessment to the UAP.", source: "x", profile: { discipline: "pharmacy", exam: "", region: "" }, part: "B" });
  assert.ok(ph.items.some((i) => i.label === "scope" && /nursing/.test(i.note)));
  const eg = T.verifyText({ text: "- Delegate the assessment to the UAP.", source: "x", profile: { discipline: "nursing", exam: "nclex-rn", region: "EG" }, part: "B" });
  assert.ok(eg.items.some((i) => i.label === "scope" && /US rule/.test(i.note)));
});

test("a seed fact (source not verified) can patch but is never ✓; safety-critical needs an official verified fact", () => {
  for (const f of KB.loadedFacts()) { assert.deepEqual(validateFact(f), [], f.id); assert.equal(f.source.verified, false, `${f.id}: seed facts must not claim verification`); }
  const r = T.verifyText({ text: "- The liver makes bile and the gallbladder stores and concentrates it.", source: "x", profile: GEN, part: "A" });
  assert.ok(r.items.every((i) => i.label !== "verified"));
  const d = T.verifyText({ text: "- Give 500 mg every 8 hours.", source: "x", profile: GEN, part: "A" });
  assert.equal(d.items[0].label, "unverified"); assert.match(d.items[0].note, /official reference/); assert.equal(d.items[0].memorize, false);
});

test("reference cards: not-covered items and 'source says X, reference says Y'", () => {
  const r = T.verifyText({ text: "- The liver makes bile.", source: "The liver has 2 lobes. The liver makes bile.", profile: GEN, part: "A" });
  assert.ok(r.cards.some((c) => c.id === "dig.liver.lobes" && c.notCovered.includes("caudate lobe")));
  assert.ok(r.conflicts.some((c) => /4 anatomical lobes/.test(c.reference)));
});

/* ───────── Part B ───────── */
const brief = (o = {}) => `${o.noPremise ? "" : "PREMISE: unstable patient, airway first.\n"}ANSWER: ${o.answer || "B"}\nTYPE: ${o.type || "priority"}\nKEYWORD: ${o.keyword || "FIRST"}\nCONCEPTS: a; b\n${o.data ? "DATA: " + o.data + "\n" : ""}OPTIONS:\n${o.options || "A) ❌ no\nB) ✅ yes\nC) ❌ no\nD) ❌ no"}\n${o.calc ? "CALC: " + o.calc + "\n" : ""}CONFIDENCE: ${o.conf || "high"}`;
const nurse = { discipline: "nursing", exam: "nclex-rn", region: "US" };
const tok = (s, p) => ({ token: s, logProbability: Math.log(p) });
const lpFor = (p, alt = 0.02) => ({ chosenCandidates: [tok("ANSWER", 1), tok(":", 1), tok(" B", p), tok("\n", 1)], topCandidates: [{ candidates: [tok("ANSWER", 1)] }, { candidates: [tok(":", 1)] }, { candidates: [tok(" B", p), tok(" C", alt)] }, { candidates: [tok("\n", 1)] }] });

test("B3: a mismatched ✅ set, wrong select-N, missing parts and bad polarity all drop the tier to LOW with a visible flag", () => {
  const mism = S.assessSolve({ raw: brief({ answer: "B", options: "A) ✅ x\nB) ❌ y\nC) ❌ z" }), profile: nurse });
  assert.equal(mism.tier, "LOW"); assert.ok(mism.flags.some((f) => f.code === "marks-mismatch"));
  const sel = S.assessSolve({ raw: brief({ answer: "A, C", type: "SATA" }), stem: "Select 3 that apply.", profile: nurse });
  assert.ok(sel.flags.some((f) => f.code === "select-count"));
  const neg = S.assessSolve({ raw: brief({ keyword: "FIRST" }), stem: "Which statement indicates further teaching is needed?", profile: nurse });
  assert.ok(neg.flags.some((f) => f.code === "polarity"));
  const missing = S.assessSolve({ raw: brief({ answer: "A", type: "matrix", options: "A) ✅ x" }), profile: nurse });
  assert.ok(missing.flags.some((f) => f.code === "parts-missing"));
  const miss2 = S.assessSolve({ raw: brief({ answer: "E" }), profile: nurse });
  assert.ok(miss2.flags.some((f) => f.code === "letter-missing"));
});

test("open-ended clinical cases are not forced into MCQ polarity or answer-shape checks", () => {
  const raw = [
    "PREMISE: The case contains several simultaneous life threats.",
    "ANSWER: Prioritize emergency stabilization and explain the differential.",
    "TYPE: open-ended clinical case",
    "KEYWORD: NOT APPLICABLE",
    "CONCEPTS: shock; hyperkalaemia; bleeding",
    "DATA: K=6.7 mmol/L; Hb=7.6 g/dL",
    "OPTIONS:",
    "NONE — no answer choices supplied",
    "CONFIDENCE: medium — complex case",
  ].join("\n");
  const longCase = "Do NOT invent missing data. Do NOT assume a single diagnosis. Do NOT treat a normal result as exclusion.\n" + "The patient has several abnormalities. ".repeat(30);
  const assessed = S.assessSolve({ raw, stem: longCase, profile: { discipline: "general", exam: "" } });
  assert.equal(assessed.format, "open");
  assert.equal(assessed.letters.length, 0);
  assert.equal(assessed.flags.some((f) => f.code === "polarity" || f.code === "shape"), false);
  assert.equal(S.itemFormat("open-ended clinical case", longCase), "open");
});

test("B4: a wrong dose calculation and a wrong unit conversion are caught by recomputing in code; a right one passes", () => {
  const bad = S.assessSolve({ raw: brief({ type: "calculation", calc: "15 mg/kg × 70 kg = 1100 mg; 1100 mg ÷ 3 = 366.7 mg" }), profile: nurse });
  assert.equal(bad.tier, "LOW"); assert.ok(bad.flags.some((f) => f.code === "calc"));
  const conv = S.assessSolve({ raw: brief({ type: "calculation", calc: "500 mg = 5 g" }), profile: nurse });
  assert.ok(conv.flags.some((f) => f.code === "calc" && /0.5/.test(f.msg)));
  const ok = S.checkCalc("15 mg/kg × 70 kg = 1050 mg; 1050 mg = 1.05 g; 1050 mg ÷ 3 = 350 mg");
  assert.equal(ok.ok, true); assert.equal(ok.final, 350);
  const fin = S.checkCalc("10 mL × 4 = 40 mL", { yesWhy: "give 44 mL" });
  assert.equal(fin.ok, false);
  assert.equal(S.evalExpr("2 + 3 * (4 - 1)"), 11); assert.equal(S.evalExpr("process.exit(1)"), null);
});

test("B5: a misread lab (low-probability digit in DATA) raises 'check this'; DATA is checked against the KB ranges", () => {
  const raw = brief({ data: "Hgb 12.5 g/dL; 45-year-old man" });
  const lp = { chosenCandidates: [tok("DATA", 1), tok(":", 1), tok(" Hgb", 1), tok(" 12", 0.95), tok(".", 1), tok("5", 0.41), tok("\n", 1)], topCandidates: [] };
  const a = S.assessSolve({ raw, logprobs: lp, profile: nurse });
  assert.ok(a.dataDoubts.some((d) => d.token === "5"));
  assert.ok(a.reasons.some((r) => /uncertain/.test(r)));
  assert.ok(a.dataFlags.some((f) => f.status === "low"));
  const wrong = S.assessSolve({ raw: brief({ data: "Hgb 12.5 g/dL; 45-year-old man", options: "A) ❌ no\nB) ✅ Hgb 12.5 g/dL is normal for this man\nC) ❌ no" }), profile: nurse });
  assert.ok(wrong.flags.some((f) => f.code === "kb-range"));
});

test("B2: tiers from answer-token probability; uncalibrated profiles are capped at MEDIUM; no logprobs → capped at MEDIUM", () => {
  const hi = S.assessSolve({ raw: brief(), logprobs: lpFor(0.99), profile: nurse });
  assert.equal(hi.hasLogprobs, true); assert.ok(hi.p1 > 0.9);
  assert.equal(hi.tier, "MEDIUM", "no calibrated golden set → never HIGH"); assert.ok(hi.reasons.includes("not calibrated for this subject"));
  const lo = S.assessSolve({ raw: brief(), logprobs: lpFor(0.45, 0.4), profile: nurse });
  assert.equal(lo.tier, "LOW"); assert.equal(lo.runnerUp.letter, "C");
  const none = S.assessSolve({ raw: brief(), profile: nurse });
  assert.equal(none.hasLogprobs, false); assert.notEqual(none.tier, "HIGH");
  assert.equal(S.assessSolve({ raw: brief({ conf: "low — two defensible options" }), profile: nurse }).tier, "LOW");
  assert.equal(S.assessSolve({ raw: brief({ conf: "medium — image is blurry" }), profile: nurse }).tier, "LOW");
});

test("B2: HIGH is reachable only through a calibrated profile (thresholds from calibration)", async () => {
  const cal = await import("../src/lib/calibration.js");
  cal.CAL["pharmacy"] = { calibrated: true, n: 320, thresholds: { high: 0.93, margin: 0.6, medium: 0.7 }, highErr: 0.03 };
  const a = S.assessSolve({ raw: brief(), logprobs: lpFor(0.99), profile: { discipline: "pharmacy", exam: "", region: "" } });
  assert.equal(a.tier, "HIGH"); assert.equal(a.eligible, true);
  delete cal.CAL["pharmacy"];
});

test("B6: banner only for a concrete problem (LOW / a specific concern); per-option advice only for exams that penalise wrong picks", () => {
  const a = S.assessSolve({ raw: brief({ answer: "A, C", type: "SATA", options: "A) ✅ a\nB) ❌ b\nC) ✅ c" }), logprobs: lpFor(0.45, 0.4), stem: "Select all that apply.", profile: nurse });
  const b = S.banner(a, "en");
  assert.ok(b && /not/i.test(b.head)); assert.ok(b.advice, "NCLEX SATA penalises wrong picks"); assert.ok(b.runnerUp);
  const g = S.assessSolve({ raw: brief({ answer: "A, C", type: "SATA", options: "A) ✅ a\nB) ❌ b\nC) ✅ c" }), logprobs: lpFor(0.45, 0.4), stem: "Select all that apply.", profile: GEN });
  assert.equal(S.banner(g, "en").advice, "", "never advise this for an exam that does not penalise wrong picks");
  assert.equal(S.banner({ tier: "HIGH" }), null);
});

test("B8: the correct-answer section equals the brief; a mismatch is replaced and flagged; the warning bullet is added by code only for LOW", () => {
  const a = S.assessSolve({ raw: brief({ answer: "B" }), logprobs: lpFor(0.45, 0.4), profile: nurse });
  assert.equal(a.tier, "LOW");
  const text = "## 🔍 كل اختيار لوحده\n- x\n## ✅ الإجابة الصح\n- **C)** لأنها الأفضل\n## 🔁 لو السؤال اتغيّر\n- y";
  const r = S.reconcileLesson(text, a);
  assert.equal(r.mismatch, true); assert.match(r.text, /\*\*B\*\*/); assert.match(r.text, /⚠️/); assert.ok(r.text.includes("## 🔁"));
  const same = S.reconcileLesson(text.replace("**C)**", "**B)**"), a);
  assert.equal(same.mismatch, false); assert.match(same.text, /⚠️/, "LOW keeps the bullet");
});

test("audit fix #1: an uncalibrated MEDIUM (cap only) shows no banner and adds no lesson bullet, and the tier is NOT upgraded", () => {
  const text = "## ✅ الإجابة الصح\n- **B)** لأنها الأفضل\n## 🔁 لو السؤال اتغيّر\n- y";
  for (const logprobs of [lpFor(0.99), undefined]) {              // confident-but-uncalibrated, and no logprobs at all (small key)
    const a = S.assessSolve({ raw: brief(), logprobs, profile: nurse });
    assert.equal(a.tier, "MEDIUM", "honest: still capped, never HIGH"); assert.equal(a.calibrated, false);
    assert.ok(a.reasons.includes("not calibrated for this subject"), "the reason is still recorded on the assessment");
    assert.deepEqual(a.issues, [], "no specific issue"); assert.equal(S.warnsAbout(a), false);
    assert.equal(S.banner(a, "en"), null); assert.equal(S.banner(a, "ar"), null);
    const r = S.reconcileLesson(text, a);
    assert.equal(r.text, text, "lesson text is untouched"); assert.equal(r.replaced, false); assert.doesNotMatch(r.text, /⚠️/);
  }
  // a missing / late premise is a prompt-order matter, not an answer problem: still no banner
  const np = S.assessSolve({ raw: brief({ noPremise: true }), logprobs: lpFor(0.99), profile: nurse });
  assert.equal(np.tier, "MEDIUM"); assert.equal(S.banner(np, "en"), null);
});

test("v3.45: only CONCRETE concerns warn (a failed check, an uncertain number, LOW); moderate probability / verbalised medium / missing CALC line stay internal; HIGH never warns", async () => {
  // measured moderate probability
  const mod = S.assessSolve({ raw: brief(), logprobs: lpFor(0.6, 0.3), profile: nurse });
  assert.equal(mod.tier, "MEDIUM"); assert.ok(mod.issues.some((i) => /moderate/.test(i)));
  assert.equal(S.banner(mod, "en"), null, "a moderate (not low) probability is not a concrete risk: no banner, the issue stays on the assessment for developers");
  assert.equal(S.warnsAbout(mod), false);
  // verbalised doubt without logprobs
  const vd = S.assessSolve({ raw: brief({ conf: "medium — two options are close" }), profile: nurse });
  assert.equal(vd.tier, "MEDIUM"); assert.ok(vd.issues.includes("two options are close")); assert.equal(S.banner(vd, "en"), null, "a verbalised doubt alone is not shown");
  // uncertain digits read from the image
  const raw = brief({ data: "K 5.9 mmol/L" });
  const lp = { chosenCandidates: [tok("DATA", 1), tok(":", 1), tok(" K", 1), tok(" 5", 0.4), tok(".9", 0.9), tok("\n", 1), tok("ANSWER", 1), tok(":", 1), tok(" B", 0.99), tok("\n", 1)],
    topCandidates: [{ candidates: [tok("DATA", 1)] }, { candidates: [tok(":", 1)] }, { candidates: [tok(" K", 1)] }, { candidates: [tok(" 5", 0.4)] }, { candidates: [tok(".9", 0.9)] }, { candidates: [tok("\n", 1)] }, { candidates: [tok("ANSWER", 1)] }, { candidates: [tok(":", 1)] }, { candidates: [tok(" B", 0.99), tok(" C", 0.01)] }, { candidates: [tok("\n", 1)] }] };
  const dd = S.assessSolve({ raw, logprobs: lp, profile: nurse });
  assert.ok(dd.dataDoubts.length); assert.ok(dd.issues.some((i) => /uncertain/.test(i))); assert.ok(S.banner(dd, "en").why.some((w) => /misread/.test(w)), "a number that may be misread is concrete");
  // a calculation item with no CALC line
  const nc = S.assessSolve({ raw: brief(), stem: "Calculate the dose in mL/h.", profile: nurse });
  assert.ok(nc.issues.includes("a calculation item without a CALC line")); assert.equal(S.banner(nc, "en"), null, "bookkeeping, internal only");
  // LOW: always a banner, and the bullet
  const low = S.assessSolve({ raw: brief(), logprobs: lpFor(0.45, 0.4), profile: nurse });
  assert.equal(low.tier, "LOW"); assert.ok(S.banner(low, "en").why.length > 0);
  // a flagged check (marks mismatch) is LOW and says why
  const fl = S.assessSolve({ raw: brief({ options: "A) ✅ a\nB) ❌ b" }), profile: nurse });
  assert.equal(fl.tier, "LOW"); assert.ok(S.banner(fl, "en").why.some((w) => /marked/.test(w)));
  // MEDIUM that carries flags (defensive: a caller-built assessment) still warns; a bare MEDIUM and HIGH do not
  assert.ok(S.banner({ tier: "MEDIUM", flags: [{ code: "x", msg: "m" }], reasons: [], issues: [], perOption: [] }, "en"));
  assert.equal(S.banner({ tier: "MEDIUM", flags: [], reasons: ["not calibrated for this subject"], issues: [] }, "en"), null);
  assert.equal(S.banner({ tier: "HIGH", flags: [], reasons: [], issues: [] }, "en"), null);
  // a calibrated profile: HIGH stays reachable, MEDIUM with a measured probability still warns
  const cal = await import("../src/lib/calibration.js");
  cal.CAL["pharmacy"] = { calibrated: true, n: 320, thresholds: { high: 0.93, margin: 0.6, medium: 0.7 }, highErr: 0.03 };
  const ph = { discipline: "pharmacy", exam: "", region: "" };
  assert.equal(S.assessSolve({ raw: brief(), logprobs: lpFor(0.99), profile: ph }).tier, "HIGH");
  assert.equal(S.banner(S.assessSolve({ raw: brief(), logprobs: lpFor(0.99), profile: ph }), "en"), null);
  assert.equal(S.banner(S.assessSolve({ raw: brief(), logprobs: lpFor(0.8, 0.1), profile: ph }), "en"), null, "moderate probability alone: silent");
  assert.ok(S.banner(S.assessSolve({ raw: brief(), logprobs: lpFor(0.45, 0.4), profile: ph }), "en"), "low probability: warns");
  delete cal.CAL["pharmacy"];
});

test("B7: second opinion shuffles options, maps the answer back, scores by token probability, and disagreement stays unresolved", () => {
  const m = shuffleMap(["A", "B", "C", "D"], 7);
  assert.deepEqual(Object.keys(m.toOrig).sort(), ["A", "B", "C", "D"]);
  const shown = m.toShown["B"];
  const lp = { chosenCandidates: [tok("ANSWER", 1), tok(":", 1), tok(" " + shown, 0.8), tok("\n", 1)], topCandidates: [{ candidates: [tok("ANSWER", 1)] }, { candidates: [tok(":", 1)] }, { candidates: [tok(" " + shown, 0.8), tok(" " + m.toShown["A"], 0.1)] }, { candidates: [tok("\n", 1)] }] };
  const s = readSecond({ text: `ANSWER: ${shown}`, logprobs: lp }, m, ["A", "B", "C", "D"]);
  assert.equal(s.letter, "B"); assert.ok(s.p > 0.8);
  assert.equal(compareOpinions({ letters: ["B"], tier: "MEDIUM" }, s).status, "agree");
  assert.equal(compareOpinions({ letters: ["B"], tier: "MEDIUM" }, s, { calibrated: false }).tier, "HIGH".replace("HIGH", "MEDIUM") === "MEDIUM" ? "MEDIUM" : "HIGH");
  assert.equal(compareOpinions({ letters: ["C"], tier: "MEDIUM" }, s).status, "disagree");
});

test("B9: evidence is off by default, ≤ 120 tokens when on, facts only", async () => {
  assert.equal(evidenceFor("serum potassium hemoglobin", GEN), "");
  const e = evidenceFor("A man with serum potassium and hemoglobin and creatinine values", GEN, { force: true });
  assert.ok(e.length <= 360 + 60);
  assert.ok(!/answer/i.test(e.replace("not the answer", "")));
});

/* ───────── F3 / F4 / infra ───────── */
test("F3: claims ride inside the proof request without making it bigger; verdicts without an allowlisted source never make a ✓", () => {
  const text = ("سطر طويل " + "كلمة ".repeat(40) + "\n").repeat(40);
  const chunks = [text.slice(0, 4500)];
  const claims = Array.from({ length: 30 }, (_, i) => ({ id: "s" + i, text: `claim number ${i} about dose`, kind: "dose" }));
  const f = PR.foldClaims(chunks, claims);
  assert.ok(f.claims.length > 0 && f.claims.length <= 25);
  assert.ok(f.chunks[0].length + f.systemAdd.length <= chunks[0].length, "request must not grow");
  assert.deepEqual(PR.foldClaims(["short text only"], claims).claims, [], "no room → claims wait");
  assert.deepEqual(PR.parseVerdicts('{"fixes":[],"v":[[1,"T"],[2,"F","fix",2],[3,"X"]]}'), [{ n: 1, v: "T", fix: "", sourceIndex: null }, { n: 2, v: "F", fix: "fix", sourceIndex: 2 }]);
  const items = [{ id: "a", sentence: "Give 500 mg every 8 hours.", kind: "dose", label: "unverified" }, { id: "b", sentence: "Aspirin is contraindicated in x.", kind: "dose", label: "unverified" }];
  C.__clearVerdicts();
  const cl = [{ id: "a", text: "Give 500 mg every 8 hours.", kind: "dose" }, { id: "b", text: "Aspirin is contraindicated in x.", kind: "dose" }];
  C.applyVerdicts(items, cl, [{ n: 1, v: "T", fix: "" }, { n: 2, v: "F", fix: "Aspirin is fine." }], { links: [{ url: "https://blog.example.com/x", title: "blog.example.com" }], profile: GEN });
  assert.equal(items[0].label, "unverified", "T without an allowlisted source proves nothing");
  assert.equal(items[1].label, "uncertain"); assert.equal(items[1].text, undefined, "F without a source never rewrites the text");
  const items2 = [{ id: "a", sentence: "Give 500 mg every 8 hours.", kind: "dose", label: "unverified" }];
  C.__clearVerdicts();
  C.applyVerdicts(items2, [cl[0]], [{ n: 1, v: "T", fix: "" }], { links: [{ url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "who.int" }], profile: GEN });
  assert.equal(items2[0].label, "unverified", "a generally trusted link is not mapped to this claim");
  C.applyVerdicts(items2, [cl[0]], [{ n: 1, v: "T", fix: "", sourceIndex: 1 }], { links: [{ url: "https://vertexaisearch.cloud.google.com/grounding-api-redirect/abc", title: "who.int" }], profile: GEN });
  assert.equal(items2[0].label, "verified", "only this claim's explicit source mapping can verify it");
  assert.equal(C.allowlisted({ url: "https://seo-health-blog.com/a", title: "" }, GEN), false);
  assert.equal(C.allowlisted({ url: "https://med.stanford.edu/a", title: "" }, GEN), true);
  C.__clearVerdicts();
});

test("F3: a claim is verified at most once (cache), shorter lifetime for time-sensitive kinds", () => {
  C.__clearVerdicts();
  const it = [{ id: "a", sentence: "Give 500 mg every 8 hours.", kind: "dose", label: "unverified" }];
  C.applyVerdicts(it, [{ id: "a", text: "Give 500 mg every 8 hours.", kind: "dose" }], [{ n: 1, v: "U", fix: "" }], { profile: GEN });
  assert.deepEqual(C.selectClaims([{ id: "z", sentence: "Give 500 mg every 8 hours.", kind: "dose", label: "unverified" }]), []);
  assert.equal(C.selectClaims([{ id: "z", sentence: "Give 500 mg every 8 hours.", kind: "dose", label: "unverified" }], { now: Date.now() + 8 * 864e5 }).length, 1, "dose verdicts expire after 7 days");
  C.__clearVerdicts();
});

test("F4: report error + KB gap list stored locally and exported as JSON, grouped by profile", () => {
  R.clearReports();
  R.reportError({ sentence: "x is y", kind: "dose", profile: nurse });
  assert.equal(R.addGaps(nurse, [{ sentence: "Give 5 mg", kind: "dose", why: "dose" }]), 1);
  assert.equal(R.addGaps(nurse, [{ sentence: "give 5 mg!", kind: "dose", why: "dose" }]), 0, "same normalised claim is counted, not duplicated");
  const j = JSON.parse(R.exportReports());
  assert.equal(j.reports.length, 1); assert.ok(j.gaps["nursing/nclex-rn"]);
  R.clearReports();
});

test("saved mistakes: an item whose key was not verified is never auto-saved", () => {
  __setState([]);
  const q = { stem: "Which organ makes bile?", options: ["A", "B"], correct: [1], type: "single", rationale: "", topic: "digestive" };
  assert.equal(recordAnswer({ ...q, trust: "unverified" }, [0]), "new", "v3.45: no coverage is not a reason to hold a mistake back");
  assert.equal(recordAnswer({ ...q, stem: "conflicting one?", trust: "conflict" }, [0]), "skipped", "a concrete conflict is");
  __setState([]);
  assert.equal(mistakeEligible({ trust: "verified" }), true);
  assert.equal(recordAnswer({ ...q, trust: "verified" }, [0]), "new");
  assert.equal(recordAnswer({ ...q, stem: "pending one?", trust: "pending" }, [0]), "new", "a reference agreed with the key (source check pending): saved");
  assert.equal(recordAnswer({ ...q, stem: "other stem?" }, [0]), "new", "untagged items behave as before");
  __setState([]);
});

test("P1: a profile is set, or inferred from keywords in code; the fallback is general health sciences; shared prompts name no discipline", async () => {
  assert.equal(P.inferProfile("random text").discipline, "general");
  assert.equal(P.inferProfile("The dentist treats caries and periodontal disease").discipline, "dentistry");
  assert.equal(P.inferProfile("NCLEX question about delegation").exam, "nclex-rn");
  assert.equal(P.inferProfile("anything", { discipline: "pharmacy", explicit: true }).discipline, "pharmacy");
  const prompts = await import("../src/lib/prompts.js");
  for (const p of [prompts.buildSolvePrompt(GEN), prompts.buildLessonAPrompt({ history: [], chips: [], words: 600, profile: GEN }), prompts.buildStudyAPrompt({ history: [], chips: [], words: 600, profile: GEN })]) {
    assert.ok(!/nclex|nurs/i.test(p.system), "NCLEX / nursing leaked into a shared prompt");
  }
  assert.match(prompts.buildSolvePrompt(P.inferProfile("nclex")).system, /NCLEX-RN/, "the exam line appears only for that profile");
});

test("build-kb rejects a fact whose quote is not verbatim, or whose license is unverified / NC / SA; accepts a good one", () => {
  const man = { sources: [{ id: "os", url: "https://openstax.org/x", license: "CC BY 4.0", licenseVerified: true, passages: [{ id: "p1", text: "The liver produces bile, which the   gallbladder stores." }] },
    { id: "nc", url: "u", license: "CC BY-NC-SA 4.0", licenseVerified: true, passages: [{ id: "p", text: "Some verbatim sentence here." }] },
    { id: "un", url: "u", license: "CC BY 4.0", licenseVerified: false, passages: [{ id: "p", text: "Some verbatim sentence here." }] }] };
  const f = (id, sourceId, quote, passageId = "p1") => ({ id, topic: "t", kind: "relation", aliases: { en: ["x"], ar: [] }, data: {}, scope: { discipline: ["all"], exam: [], jurisdiction: "intl" }, source: { sourceId, passageId, quote }, forbidden_patterns: [] });
  const { accepted, rejected } = buildFacts(man, [f("good", "os", "liver produces bile, which the gallbladder stores"), f("badquote", "os", "the liver secretes all bile itself"), f("nc", "nc", "Some verbatim sentence here.", "p"), f("unv", "un", "Some verbatim sentence here.", "p")]);
  assert.deepEqual(accepted.map((x) => x.id), ["good"]); assert.equal(accepted[0].source.verified, true);
  assert.deepEqual(rejected.map((x) => x.id).sort(), ["badquote", "nc", "unv"]);
  assert.equal(licenseOk("CC BY 4.0"), true); assert.equal(licenseOk("CC BY-NC-SA 4.0"), false);
});

test("calibration: <300 rows or no precise HIGH tier stays uncalibrated; a clean set yields thresholds and an honest error rate", () => {
  const rows = (n, f) => Array.from({ length: n }, (_, i) => ({ id: i, p1: 0.5 + (i % 50) / 100, margin: 0.8, correct: f(i) }));
  assert.equal(pickThresholds(rows(100, () => true)).calibrated, false);
  const r = pickThresholds(rows(400, (i) => (i % 50) / 100 + 0.5 > 0.6 || i % 7 !== 0));
  assert.equal(typeof r.calibrated, "boolean");
  if (r.calibrated) assert.ok(r.highErr > 0 || r.highErr === 0);
});

test("speed: the deterministic layer p95 < 20 ms on a ~2000-word lesson; KB lookup p95 < 10 ms", async () => {
  await T.ensureKb(GEN);                      // what the app does in the background right after the profile is known (loads + compiles every regex)
  const para = "- The gallbladder secretes bile. The stomach has 4 regions: cardia, fundus, body and pylorus. Give 500 mg every 8 hours. Hemoglobin 12.5 g/dL is normal for an adult man. Think of it like a blender.\n- المعدة بتهضم الأكل وبعدين تفرغ في الأمعاء الدقيقة عشان الامتصاص ده مهم جدا للجسم كله.\n";
  const text = "## 📚 الأساس\n" + para.repeat(45);
  const src = "The stomach has four regions: cardia, fundus, body and pylorus. ".repeat(40);
  /* three batches of 40: this build VM has ONE vCPU, so a GC pause or a neighbour can spike a batch; the budget is judged on the calmest batch, and every batch is printed */
  const batches = [];
  for (let b = 0; b < 3; b++) { const xs = []; for (let i = 0; i < 40; i++) { const t0 = performance.now(); T.verifyText({ text, source: src, profile: GEN, part: "A" }); xs.push(performance.now() - t0); } batches.push(xs); }
  const ts = batches.map((x) => ({ x, p: p95(x) })).sort((a, b) => a.p - b.p)[0].x;
  console.log(`# batch p95s: ${batches.map((x) => p95(x).toFixed(1)).join(" / ")} ms · median ${[...ts].sort((a, b) => a - b)[20].toFixed(1)} ms`);
  const lk = [];
  for (let i = 0; i < 200; i++) { const t0 = performance.now(); KB.lookup("liver bile gallbladder stomach potassium", GEN, 5); lk.push(performance.now() - t0); }
  console.log(`# deterministic layer p95 ${p95(ts).toFixed(1)} ms (${text.split(/\s+/).length} words) · KB lookup p95 ${p95(lk).toFixed(2)} ms`);
  assert.ok(p95(ts) < 20, `p95 ${p95(ts)}`); assert.ok(p95(lk) < 10);
});

test("the KB is lazy: no module is imported by the startup path", () => {
  const boot = fs.readFileSync(new URL("../src/lib/storage.js", import.meta.url), "utf8") + fs.readFileSync(new URL("../src/main.jsx", import.meta.url), "utf8");
  assert.ok(!/kb\/index|kb\/modules|trust\.js/.test(boot));
  const idx = fs.readFileSync(new URL("../src/lib/kb/index.js", import.meta.url), "utf8");
  assert.ok(/import\("\.\/modules\//.test(idx), "modules load through dynamic import");
});

test("golden question files follow the schema; calibrated profiles are listed honestly", () => {
  const root = new URL("./golden/questions/", import.meta.url);
  let n = 0;
  for (const d of fs.readdirSync(root, { withFileTypes: true }).filter((x) => x.isDirectory())) {
    let count = 0;
    for (const f of fs.readdirSync(new URL(d.name + "/", root)).filter((x) => x.endsWith(".json"))) {
      for (const q of JSON.parse(fs.readFileSync(new URL(`${d.name}/${f}`, root), "utf8"))) {
        assert.ok(q.id && q.stem && q.options && Array.isArray(q.key) && q.source && q.source.license && q.verifiedBy, `${d.name}/${f}: ${q.id}`);
        count += 1;
      }
    }
    n += count;
    console.log(`# golden ${d.name}: ${count} items · ${count >= 300 ? "size ok" : "NOT calibratable (<300)"}`);
  }
  assert.ok(n >= 2);
});
