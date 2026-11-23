/* v3.68 · root-cause tests: guard/task-name contract, task contract, anchors, reasoning traps, end-to-end contract path (mocked model). */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { installFetch, script, reset } from "./mockfetch.mjs";
import * as Router from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";
import { PROSE_TASK, makeGuard } from "../src/lib/guard.js";
import { parseTaskContract, planGroups, auditContractCoverage, mergeTaskSections, formatCoverageNotice } from "../src/lib/taskcontract.js";
import { ANCHORS, selectAnchors, formatAnchors } from "../src/lib/clinical-anchors.js";
import { auditReasoningTraps } from "../src/lib/reasoning-traps.js";
import { buildContractOncePrompt } from "../src/lib/prompts.js";
import { targetWords } from "../src/lib/taskcontract.js";

installFetch();
const CASE = fs.readFileSync(new URL("./fixtures/consultant-case.md", import.meta.url), "utf8");

/* ── RC-A · the guard must cover every task name the pipeline really emits ── */
test("RC-A guard: every writer task name emitted by the pipeline is a guarded prose task", () => {
  const names = new Set();
  for (const f of ["analysis.js", "lessonflow.js"]) {
    const src = fs.readFileSync(new URL(`../src/lib/${f}`, import.meta.url), "utf8");
    for (const m of src.matchAll(/`(lesson[A-Za-z]*):\$\{mode\.id\}`/g)) names.add(`${m[1]}:balanced`);
    for (const m of src.matchAll(/"(lesson[A-Z][A-Za-z]*)"/g)) names.add(m[1]);
  }
  assert.ok(names.size >= 6, [...names].join(","));
  for (const n of names) assert.ok(PROSE_TASK.test(n), `${n} is not guarded`);
  for (const n of ["solve:balanced", "solve:contract", "ocr", "lesson:diagram", "lesson:chatplan"]) assert.ok(!PROSE_TASK.test(n), n);
});

test("RC-A guard: a leaked prompt line is stripped from a main-lesson writer's output", () => {
  const g = makeGuard({ task: "lessonA:balanced", system: "SECTIONS — exactly these headings\n- One bullet: the question type in English", parts: [{ text: "q" }] });
  assert.ok(g);
  const r = g.scrub("## 🎯 السؤال\nOne bullet: the question type in English is priority.\n- **Priority** — الأولوية", true);
  assert.ok(!/One bullet/i.test(r.text));
  assert.ok(r.leaks >= 1);
});

/* ── RC-B · task contract ── */
test("RC-B contract: the 10-task consultant case is recognised, ordered, with its limit and constraints", () => {
  const c = parseTaskContract(CASE);
  assert.equal(c.active, true);
  assert.deepEqual(c.tasks.map((t) => t.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(c.tasks[0].wordLimit, 100);
  assert.ok(c.constraints.some((x) => /Do not invent/i.test(x)));
  assert.equal(c.complexity.level, "expert");
  assert.deepEqual(planGroups(c).map((g) => g.length), [3, 3, 2, 2]);
  assert.equal(c.tasks.flatMap((x) => x.items).length, 38);
});

test("RC-B contract: ordinary exam items and step lists are NOT contracts (no over-trigger)", () => {
  assert.equal(parseTaskContract("A nurse is caring for a client.\nA) Heparin\nB) Warfarin\nC) Aspirin\nD) Insulin\n".repeat(6)).active, false);
  assert.equal(parseTaskContract("Step 1: wash hands.\nStep 2: don gloves.\n".repeat(12)).active, false);
  assert.equal(parseTaskContract("Explain the mechanism of action of metformin in detail. ".repeat(10)).active, false);
});

test("RC-B contract: other domains and Arabic labels use the same grammar", () => {
  const t = "حالة طفل عمره 3 سنوات يعاني من حمى وطفح جلدي لمدة خمسة أيام ويحتاج إلى تقييم شامل في قسم الطوارئ بالمستشفى الجامعي.\n\nالمهمة 1 - التشخيص\nحدد التشخيص الأرجح.\n- الدليل الداعم\n- الدليل المعارض\n\nالمهمة 2 - العلاج\nاشرح خطة العلاج.\n- الأدوية\n- المتابعة\n\nالمهمة 3 - المضاعفات\nاذكر المضاعفات المحتملة.\n- القلب\n- الكلى\n";
  const c = parseTaskContract(t);
  assert.equal(c.active, true);
  assert.equal(c.tasks.length, 3);
});

test("RC-B coverage audit (heading form): missing, thin and over-limit tasks are found", () => {
  const c = parseTaskContract(CASE);
  const a = auditContractCoverage(c, "## Task 1 — Diagnostic Synthesis\nshort\n## Task 2 — Advanced Differential Diagnosis\nx");
  assert.deepEqual(a.missingTasks, [3, 4, 5, 6, 7, 8, 9, 10]);
  assert.match(formatCoverageNotice(a, c, "ar"), /لم تُكتب إجابتها/);
});

test("RC-B merge: a repair replaces only its own task and keeps order", () => {
  const m = mergeTaskSections("## Task 1 — A\none\n\n## Task 2 — B\nthin\n\n## Task 3 — C\nthree", "## Task 2 — B\nrepaired in full");
  assert.ok(/Task 1[\s\S]*Task 2[\s\S]*Task 3/.test(m) && !/thin/.test(m));
});

/* ── RC-C · anchors ── */
test("RC-C anchors: every entry names a type and a source; retrieval fires only on matching sources", () => {
  for (const a of ANCHORS) {
    assert.ok(["guideline", "consensus", "classification", "study", "physiology", "label"].includes(a.level), a.id);
    assert.ok(a.sources.length && a.statements.length && a.checked, a.id);
    assert.ok(!/\b(?:mg\/kg|IU\/kg|twice daily|once daily|loading dose|bolus)\b/i.test(a.statements.join(" ")), `${a.id}: no dosing in anchors`);
  }
  const ids = selectAnchors(CASE, { limit: 12 }).map((a) => a.id);
  for (const want of ["ttp-sampling-and-threshold", "caps-criteria", "poc-inr-lupus-anticoagulant", "banff-amr", "fluconazole-tacrolimus-warfarin"]) assert.ok(ids.includes(want), want);
  assert.deepEqual(selectAnchors("A 60-year-old with chest pain, troponin elevated, aspirin given."), []);
  assert.match(formatAnchors(selectAnchors(CASE)), /Asherson/);
});

test("RC-C prompt: the one-pass prompt carries the skeleton keys, the limit and the list length, and no lesson template", () => {
  const c = parseTaskContract(CASE);
  const p = buildContractOncePrompt({ contract: c, wordsFor: (it) => targetWords(c, it), anchorsBlock: formatAnchors(selectAnchors(CASE)) });
  assert.match(p.user, /@@1\.1@@[^\n]*HARD LIMIT 100 words/);
  assert.match(p.user, /@@9\.1@@[^\n]*AT LEAST 10/);
  assert.match(p.user, /@@2\.1@@\s+SUBJECT:/);
  assert.match(p.system, /NOT AN EXAM LESSON/);
  assert.ok(!/Decode the English|## 🔁/.test(p.user));
});

/* ── RC-D · reasoning traps ── */
test("RC-D traps: confounded negative used to exclude, asserted artifact, single cause, invented threshold", () => {
  const bad = "ADAMTS13 activity above 64 percent effectively excludes TTP. The point-of-care INR is falsely elevated by lupus anticoagulant. The picture is solely due to tacrolimus.";
  const codes = auditReasoningTraps({ source: CASE, answer: bad, anchorsText: "" }).map((x) => x.code);
  for (const c of ["confounded-negative-excludes", "artifact-asserted-as-fact", "single-cause-forcing", "unsupported-threshold"]) assert.ok(codes.includes(c), c);
  const good = "ADAMTS13 17% after FFP is indeterminate and does not exclude TTP. The POC INR may be raised by lupus anticoagulant, but the venous rise could be real. Several processes can coexist.";
  assert.deepEqual(auditReasoningTraps({ source: CASE, answer: good, anchorsText: "<10 %" }), []);
  assert.ok(auditReasoningTraps({ source: CASE, answer: "If the question changed to a normal platelet count, it would be AMR.", openCase: true }).some((x) => x.code === "hypothetical-in-open-case"));
});

