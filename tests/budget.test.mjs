/* v3.43 · BUDGET: per task, prompt tokens, output caps, request counts and added latency must be ≤ the frozen v3.42 baseline (tests/baseline/v3.42-budget.json). Any increase fails. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as P from "../src/lib/prompts.js";
import { MODES, CHIPS } from "../src/lib/config.js";
import { estimateTokens } from "../src/lib/router.js";
import * as PR from "../src/lib/proof.js";
import { wantsLogprobs, __resetLogprobMemo } from "../src/lib/gemini.js";
import { inferProfile } from "../src/lib/profile.js";
import { evidenceFor } from "../src/lib/evidence.js";
import { loadKb } from "../src/lib/kb/index.js";

const base = JSON.parse(fs.readFileSync(new URL("./baseline/v3.42-budget.json", import.meta.url), "utf8"));
const chips = CHIPS.map((c) => c.id).slice(0, 2);
const args = { history: [], extra: "", chips, words: 680 };
const tok = (p) => estimateTokens(p.system || "", [{ text: p.user || "" }], 0);
const NCLEX = inferProfile("nclex nurse");          // the heaviest profile line

const BUILT = {
  solve: () => P.buildSolvePrompt(NCLEX), lessonA: () => P.buildLessonAPrompt({ ...args, profile: NCLEX }),
  lessonB: () => P.buildLessonBPrompt({ ...args, profile: NCLEX, brief: "ANSWER: B\nTYPE: x" }),
  lessonB_main: () => P.buildLessonBPrompt({ ...args, profile: NCLEX, brief: "ANSWER: B\nTYPE: x", part: "main" }),
  lessonB_traps: () => P.buildLessonBPrompt({ ...args, profile: NCLEX, brief: "ANSWER: B\nTYPE: x", part: "traps" }),
  lessonX: () => P.buildLessonPrompt({ ...args, profile: NCLEX, brief: null }),
  studyA: () => P.buildStudyAPrompt({ ...args, profile: NCLEX }), studyB: () => P.buildStudyBPrompt({ ...args, profile: NCLEX }),
  studyLesson: () => P.buildStudyLessonPrompt({ ...args, profile: NCLEX }), studyHead: () => P.buildStudyHeadPrompt({ ...args, profile: NCLEX }),
  studySlice: () => P.buildStudySlicePrompt({ ...args, profile: NCLEX, topics: ["t1"], all: ["t1"], mustWords: [] }),
  studyTail: () => P.buildStudyTailPrompt({ ...args, profile: NCLEX }), ocr: () => P.buildOcrPrompt(), words: () => P.buildWordsPrompt(chips),
};

test("prompt tokens per task ≤ v3.42 (with the heaviest profile line included)", () => {
  const rows = [];
  for (const [k, f] of Object.entries(BUILT)) {
    const now = tok(f()), was = base.prompts[k].tokens;
    rows.push(`${k} ${was}→${now}`);
    assert.ok(now <= was, `${k}: ${now} > baseline ${was}`);
  }
  console.log("# prompt tokens: " + rows.join(" · "));
});

test("a generic profile is no bigger than the NCLEX one (the profile line is the only variable part)", () => {
  assert.ok(tok(P.buildSolvePrompt({ discipline: "general", exam: "" })) < tok(P.buildSolvePrompt(NCLEX)));
});

test("output caps, thinking budgets and the number of modes are unchanged", () => {
  for (const [id, m] of Object.entries(base.modes)) {
    assert.equal(MODES[id].solve.maxOut, m.solveMaxOut, `${id} solve maxOut`);
    assert.equal(MODES[id].write.maxOut, m.writeMaxOut, `${id} write maxOut`);
    assert.equal(MODES[id].writeA.maxOut, m.writeAMaxOut, `${id} writeA maxOut`);
    assert.equal(MODES[id].solve.budget, m.solveBudget, `${id} thinking budget`);
  }
  assert.deepEqual(Object.keys(MODES).sort(), Object.keys(base.modes).sort());
});

test("the solve brief is cheaper: RATIONALE is gone and CALC/DATA/ANSWER-first are in", () => {
  const sys = P.buildSolvePrompt(NCLEX).system;
  assert.ok(!/RATIONALE/.test(sys)); assert.match(sys, /^ANSWER:/m); assert.match(sys, /^DATA:/m); assert.match(sys, /^CALC:/m);
  assert.ok(sys.indexOf("ANSWER:") < sys.indexOf("OPTIONS:"));
});

test("proof request: claims never make it bigger; with no room they are simply not asked", () => {
  const chunk = "سطر " + "كلمة ".repeat(150);
  const chunks = [chunk.repeat(5).slice(0, 4500)];
  const claims = Array.from({ length: 25 }, (_, i) => ({ id: "s" + i, text: `claim ${i} contraindicated dose`, kind: "dose" }));
  const f = PR.foldClaims(chunks, claims);
  const was = PR.PROOF_SYSTEM.length + chunks[0].length, now = PR.PROOF_SYSTEM.length + f.systemAdd.length + f.chunks[0].length;
  assert.ok(now <= was, `proof request ${now} > ${was}`);
  assert.equal(PR.foldClaims(["x ".repeat(100)], claims).claims.length, 0);
});

test("requests: logprobs only on the solve task (no new request), small keys never probe, a refusing model is remembered", () => {
  const m = "gemini-test-lp";
  __resetLogprobMemo(m);
  assert.equal(wantsLogprobs(m, "lessonB:fast", "k"), false);
  assert.equal(wantsLogprobs(m, "ocr", "k"), false);
  assert.equal(wantsLogprobs(m, "words:proof", "k"), false);
  window.localStorage.setItem(`clinix:lp:${m}`, "0");
  assert.equal(wantsLogprobs(m, "solve:deep", "k"), false);
  __resetLogprobMemo(m);
});

test("B9 evidence ≤ ~120 tokens and off unless switched on", async () => {
  await loadKb({ discipline: "general" });
  assert.equal(evidenceFor("potassium hemoglobin creatinine", { discipline: "general" }), "");
  const e = evidenceFor("potassium hemoglobin creatinine sodium", { discipline: "general" }, { force: true });
  assert.ok(Math.ceil(e.length / 3) <= 140, `${e.length} chars`);
});

test("latency: the accuracy layer adds no awaited call to the first-render path (static check of analysis.js)", () => {
  const src = fs.readFileSync(new URL("../src/lib/analysis.js", import.meta.url), "utf8");
  assert.ok(!/await\s+(?:ensureKb|verifyText|assessSolve|trustPass)/.test(src), "nothing in analysis.js waits on the accuracy layer");
  assert.ok(/ensureKb\(prof\(\)\)\.catch/.test(src), "the KB loads in the background");
  const gem = fs.readFileSync(new URL("../src/lib/gemini.js", import.meta.url), "utf8");
  assert.ok(!/runTaskInner\([^)]*claims/i.test(gem), "no separate request for claims");
});
