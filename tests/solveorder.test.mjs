/* v3.43.1 · reasoning BEFORE the answer: the solve brief writes a compact PREMISE first, then commits to ANSWER — inside the frozen v3.42 budget. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as P from "../src/lib/prompts.js";
import { cleanBrief } from "../src/lib/parse.js";
import * as S from "../src/lib/solvecheck.js";
import { estimateTokens } from "../src/lib/router.js";
import { MODES } from "../src/lib/config.js";
import { inferProfile } from "../src/lib/profile.js";
import { outputCaps, worstWords } from "../scripts/solve-output-caps.mjs";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as RT from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";

const base = JSON.parse(fs.readFileSync(new URL("./baseline/v3.42-budget.json", import.meta.url), "utf8"));
const NCLEX = inferProfile("nclex nurse"), GEN = { discipline: "general", exam: "", region: "" };
const tok = (p) => estimateTokens(p.system, [{ text: p.user }], 0);

test("the solve prompt orders the fields PREMISE → ANSWER → … and tells the model to reason before it commits", () => {
  for (const prof of [NCLEX, GEN]) {
    const sys = P.buildSolvePrompt(prof).system;
    const lines = sys.split("\n");
    const at = (k) => lines.findIndex((l) => l.startsWith(k));
    assert.ok(at("PREMISE:") > 0 && at("PREMISE:") < at("ANSWER:"), "PREMISE comes first");
    assert.equal(at("ANSWER:") - at("PREMISE:"), 1, "immediately before ANSWER");
    assert.ok(at("ANSWER:") < at("TYPE:") && at("TYPE:") < at("OPTIONS:") && at("OPTIONS:") < at("CONFIDENCE:"));
    assert.match(sys, /reasoning comes BEFORE the answer/); assert.match(sys, /PREMISE.*only THEN commit to ANSWER/s);
    assert.match(sys, /max 20 words/); assert.ok(!/^RATIONALE:/m.test(sys));
  }
});

test("the solver DATA field preserves explicit numeric inputs for the deterministic calculator without inflating lesson prompts", () => {
  const solve = P.buildSolvePrompt(GEN).system;
  assert.match(solve, /DATA: <all decisive numerical inputs relevant to calculations/);
  for (const prompt of [P.buildLessonPrompt({ profile: GEN, history: [], brief: "", extra: "", chips: [], words: 100 }), P.buildLessonBPrompt({ profile: GEN, history: [], brief: "", extra: "", chips: [], words: 100 })]) {
    assert.ok(!prompt.system.includes("===CLINICAL_DATA==="));
  }
});

test("BUDGET · prompt tokens ≤ the frozen v3.42 baseline (heaviest profile line included), thinking budget and output cap unchanged", () => {
  const was = base.prompts.solve.tokens;
  assert.ok(tok(P.buildSolvePrompt(NCLEX)) <= was, `${tok(P.buildSolvePrompt(NCLEX))} > ${was}`);
  assert.ok(tok(P.buildSolvePrompt(GEN)) <= was);
  console.log(`# solve prompt tokens: v3.42 ${was} → v3.43.1 ${tok(P.buildSolvePrompt(NCLEX))} (NCLEX) / ${tok(P.buildSolvePrompt(GEN))} (generic)`);
  for (const [id, m] of Object.entries(base.modes)) { assert.equal(MODES[id].solve.maxOut, m.solveMaxOut, id); assert.equal(MODES[id].solve.budget, m.solveBudget, id); }
});

test("BUDGET · the numerical-data handoff remains bounded for 5- and 6-option calculation items", () => {
  const caps = outputCaps(P.buildSolvePrompt(NCLEX).system);
  assert.deepEqual({ premise: caps.premise, data: caps.data, calc: caps.calc, option: caps.option, rationale: caps.rationale }, { premise: 20, data: 80, calc: 60, option: 15, rationale: 0 });
  const rows = [];
  for (const n of [5, 6]) for (const calc of [false, true]) {
    const now = worstWords(caps, n, calc);
    rows.push(`${n} options${calc ? "+CALC" : ""}: ${now} words`);
    assert.ok(now <= 300, `${n} options calc=${calc}: ${now} exceeds the bounded handoff budget`);
  }
  console.log("# worst-case output words: " + rows.join(" · "));
  assert.ok(caps.premise * 1.3 <= 30, "the premise stays within ≈ 25-30 tokens");
});

test("parser: PREMISE is read, cut at the hard limit, and its position relative to ANSWER is known; the lesson writers still get the whole brief", () => {
  const raw = (pre, post = "") => `${pre}ANSWER: B\nTYPE: priority\nKEYWORD: FIRST\nCONCEPTS: a; b\nDATA: BP 80/50\nOPTIONS:\nA) ❌ x\nB) ✅ y\nCONFIDENCE: high\n${post}`;
  const a = S.parseBrief(raw("PREMISE: unstable patient, airway threatened.\n"));
  assert.equal(a.premise, "unstable patient, airway threatened."); assert.equal(a.premiseFirst, true); assert.deepEqual(a.letters, ["B"]);
  assert.equal(a.answerRaw, "B", "the premise never leaks into ANSWER");
  const long = S.parseBrief(raw("PREMISE: " + "word ".repeat(40) + "\n"));
  assert.equal(long.premise.split(" ").length, S.PREMISE_MAX_WORDS); assert.equal(long.premiseLong, true);
  const late = S.parseBrief(raw("", "PREMISE: written after the answer.\n"));
  assert.equal(late.premiseFirst, false); assert.equal(late.answerRaw, "B");
  const none = S.parseBrief(raw(""));
  assert.equal(none.premise, ""); assert.equal(none.premiseFirst, false);
  assert.match(cleanBrief(raw("PREMISE: unstable patient.\n")), /^PREMISE: unstable patient\.\nANSWER: B/);
  assert.equal(cleanBrief("PREMISE: only a premise, no answer\nTYPE: x"), "", "without an ANSWER line the brief is still dropped");
});

const brief = (pre) => `${pre}ANSWER: B\nTYPE: priority\nKEYWORD: FIRST\nCONCEPTS: a; b\nOPTIONS:\nA) ❌ x\nB) ✅ y\nCONFIDENCE: high`;
const tk = (s, p) => ({ token: s, logProbability: Math.log(p) });
const stream = (pre, p) => {
  const chosen = [...pre.map((t) => tk(t, 0.9)), tk("ANSWER", 1), tk(":", 1), tk(" B", p), tk("\n", 1)];
  return { chosenCandidates: chosen, topCandidates: chosen.map((c, i) => ({ candidates: i === chosen.length - 2 ? [tk(" B", p), tk(" A", 1 - p - 0.001)] : [c] })) };
};

test("the solve stage refuses inconsistent numeric readings from the OCR and solver passes", () => {
  const raw = [
    "PREMISE: A measured osmolality gap requires the exact same-sample values.",
    "ANSWER: A", "TYPE: calculation", "KEYWORD: calculate", "CONCEPTS: osmolality; toxicology",
    "DATA: Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=300 mOsm/kg",
    "OPTIONS:", "A) ✅ OG = 10 mOsm/kg", "B) ❌ OG = 46 mOsm/kg", "CONFIDENCE: high",
  ].join("\n");
  const a = S.assessSolve({ raw, stem: "Osmolal gap", sourceDataText: "Na=140 mmol/L; Glucose=90 mg/dL; BUN=14 mg/dL; MeasuredOsm=336 mOsm/kg", profile: GEN });
  assert.equal(a.tier, "LOW");
  assert.ok(a.clinicalCalculationAudit.conflicts.some((x) => x.code === "extraction-measuredosm-mismatch"));
});

test("tiers: no premise (or one written after the answer) caps the tier at MEDIUM even for a calibrated profile; a premise-first brief can reach HIGH", async () => {
  const cal = await import("../src/lib/calibration.js");
  cal.CAL["pharmacy"] = { calibrated: true, n: 320, thresholds: { high: 0.93, margin: 0.6, medium: 0.7 }, highErr: 0.03 };
  const prof = { discipline: "pharmacy", exam: "", region: "" };
  const lp = stream(["PREMISE", ":", " unstable", " patient", ".", "\n"], 0.99);
  assert.equal(S.assessSolve({ raw: brief("PREMISE: unstable patient.\n"), logprobs: lp, profile: prof }).tier, "HIGH");
  const no = S.assessSolve({ raw: brief(""), logprobs: stream([], 0.99), profile: prof });
  assert.equal(no.tier, "MEDIUM"); assert.ok(no.reasons.includes("no clinical premise before the answer"));
  const late = S.assessSolve({ raw: brief("") + "\nPREMISE: after.", logprobs: stream([], 0.99), profile: prof });
  assert.equal(late.tier, "MEDIUM"); assert.ok(late.reasons.includes("the premise came after the answer"));
  assert.equal(S.assessSolve({ raw: brief("PREMISE: x y.\n"), logprobs: lp, profile: GEN }).tier, "MEDIUM", "uncalibrated: still capped");
  delete cal.CAL["pharmacy"];
});

test("logprobs: the ANSWER token is found after the premise line, a premise that says «the answer:» in its middle is not mistaken for it, DATA doubts still work", () => {
  const pre = ["PREMISE", ":", " the", " answer", ":", " is", " airway", ".", "\n"];
  const L = S.normLogprobs(stream(pre, 0.97));
  const pos = S.answerPositions(L);
  assert.equal(pos.length, 1); assert.equal(pos[0].letter, "B"); assert.equal(pos[0].i, pre.length + 2);
  const c = S.answerConfidence(L, ["A", "B", "C"]);
  assert.ok(c.p1 > 0.96);
  const withData = { chosenCandidates: [tk("PREMISE", 1), tk(":", 1), tk(" x", 1), tk("\n", 1), tk("ANSWER", 1), tk(":", 1), tk(" B", 0.9), tk("\n", 1), tk("DATA", 1), tk(":", 1), tk(" 12", 0.9), tk("5", 0.3), tk("\n", 1)], topCandidates: [] };
  assert.ok(S.dataDoubts(S.normLogprobs(withData)).some((d) => d.token === "5"));
});

/* the lesson writers receive the brief WITH the premise and its tier */
installFetch();
let KEY = "AIzaSOL", seq = 0;
const G = (m) => `gemini:${m}`;
const fresh = () => { KEY = `AIzaSOL${String(++seq).padStart(8, "0")}`; reset(); RT.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" }); };
test("end to end: the premise rides in the brief to the lesson writer, the solve stays ONE request, and the analysis still makes 4 requests on a small key", async () => {
  fresh();
  script(G("gemini-flash-latest"), { ok: "PREMISE: PREMMARK-5521 unstable patient.\nANSWER: B\nTYPE: priority\nKEYWORD: FIRST\nCONCEPTS: a; b\nOPTIONS:\nA) ❌ x\nB) ✅ y\nCONFIDENCE: high" });
  const done = {}, trust = [];
  await new Promise((resolve) => {
    const a = createAnalysis({ kind: "question", history: [], dataUrl: "data:image/png;base64,iVBORw0KGgo=", doc: null, extra: "", chips: [], apiKey: KEY, modeId: "balanced",
      onUpdate() {}, onDone: (n) => { done[n] = true; if (done.words && done.reason) resolve(a); }, onError: (n, e) => { done.err = [n, e && e.message]; resolve(a); }, onNotice() {}, onTrust: (t) => trust.push(t) });
    a.start();
  });
  assert.equal(done.err, undefined);
  const lanes = log.filter((l) => l.lane !== "list");
  assert.equal(lanes.length, 4, "the same 4 requests as v3.42");
  assert.equal(lanes.filter((l) => JSON.stringify(l.body).includes("PREMMARK-5521")).length, 1, "the brief (with its premise) reached the lesson request");
  assert.ok(lanes.some((l) => /TIER: (MEDIUM|LOW|HIGH)/.test(JSON.stringify(l.body))), "and its tier");
  const s = trust.find((t) => t.phase === "solve");
  assert.equal(s.assess.premise, "PREMMARK-5521 unstable patient."); assert.equal(s.assess.premiseFirst, true);
});

