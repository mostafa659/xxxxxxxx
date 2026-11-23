/* v3.43.1 · the exam generator goes through the accuracy layer: every item is evaluated and tagged BEFORE it is shown; unverified items never reach "saved mistakes" on their own. */
import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { getModelLists } from "../src/lib/gemini.js";
import { makeExam, examCount } from "../src/lib/exam.js";
import { tagExamItem, tagExam, trustCounts, trustOf, mistakeEligible, memorizeEligible } from "../src/lib/examtrust.js";
import * as KB from "../src/lib/kb/index.js";
import { listGaps, clearReports } from "../src/lib/reports.js";
import { recordAnswer, __setState, shapeMistakes } from "../src/lib/mistakes.js";

const GEN = { discipline: "general", exam: "", region: "" };
await KB.loadKb(GEN);
const item = (o = {}) => ({ type: "single", stem: "Which organ makes bile?", options: ["Liver", "Gallbladder", "Pancreas", "Stomach"], correct: [0], rationale: "The liver makes bile and the gallbladder stores and concentrates it.", topic: "digestive", ...o });
const tag = (o, opts = {}) => tagExamItem(item(o), { profile: GEN, record: false, ...opts });

test("a key a KB fact agrees with: «reference» while the fact's source quote is unverified, «verified» only for a verified, current fact", () => {
  const p = tag();
  assert.equal(p.trust, "reference"); assert.equal(p.trustNote, "reference — source check pending");
  const base = { kind: "relation", topic: "zz", aliases: { en: ["zz"], ar: [] }, data: {}, scope: { discipline: ["all"], exam: [], jurisdiction: "intl" }, source: { url: "https://who.int/x", license: "CC0", quote: "a verbatim quotation here", verified: true }, forbidden_patterns: [], version: "v", reviewBy: "2099-01-01" };
  KB.registerModule("fx", [{ ...base, id: "fx.1", support: ["zebrafish are always striped"] }, { ...base, id: "fx.old", support: ["quokkas are marsupials"], reviewBy: "2020-01-01" }]);
  const v = tag({ stem: "Which statement is true?", options: ["Zebrafish are always striped.", "Zebrafish are never striped."], correct: [0], rationale: "Nothing else." });
  assert.equal(v.trust, "verified"); assert.equal(v.trustNote, "");
  const o = tag({ stem: "Which is a marsupial?", options: ["Quokkas are marsupials.", "Cats are marsupials."], correct: [0], rationale: "Nothing else." });
  assert.equal(o.trust, "ungrounded"); assert.ok(o.trustWhy.some((w) => /outdated/.test(w)), "an expired reference never makes an item look verified");
  KB.__resetKb();
});

test("an item nothing resolved is UNVERIFIED and says why; its unresolved high-risk claims go to the KB gap list", async () => {
  await KB.loadKb(GEN);                       // the previous test removed its fixture module with __resetKb
  clearReports();
  const q = tagExamItem(item({ stem: "A client with heart failure gains 3 kg in 2 days. What should the nurse do first?", options: ["Weigh the client again tomorrow", "Report it to the provider", "Increase fluids", "Encourage walking"], correct: [1], rationale: "Rapid weight gain always means fluid overload, so the provider must be told immediately." }), { profile: GEN });
  assert.equal(q.trust, "ungrounded"); assert.ok(q.trustWhy.some((w) => /generator's own claim/.test(w)));
  assert.ok(Object.values(listGaps()).some((b) => Object.keys(b).length > 0), "recorded for the offline KB");
  clearReports();
});

test("a KB contradiction in the rationale or stem is PATCHED in place (before → after kept) and the item is unverified", async () => {
  await KB.loadKb(GEN);
  const q = tag({ rationale: "The gallbladder secretes bile into the duodenum." });
  assert.match(q.rationale, /The liver makes bile; the gallbladder stores and concentrates it/);
  assert.equal(q.rationaleBefore, "The gallbladder secretes bile into the duodenum.");
  assert.deepEqual(q.trustPatches.map((p) => p.fact), ["dig.bile"]);
  assert.equal(q.trust, "conflict"); assert.ok(q.trustFlags.includes("rationale-contradiction"));
  const s = tag({ stem: "The large intestine has 7 parts. Which is the first part?", options: ["Cecum", "Sigmoid"], correct: [0], rationale: "x" });
  assert.ok(s.stem.includes("4 parts") && s.stemBefore.includes("7 parts")); assert.equal(s.trust, "conflict");
});

test("the KEY against the KB: a correct option that contradicts a reference makes the item unverified; a «wrong» option the reference supports is flagged", () => {
  const k = tag({ stem: "Which statement about bile is correct?", options: ["The gallbladder secretes bile.", "The pancreas stores bile."], correct: [0], rationale: "Because." });
  assert.ok(k.trustFlags.includes("key-contradicts-reference")); assert.equal(k.trust, "conflict");
  const d = tag({ stem: "Which statement about bile is correct?", options: ["The liver makes bile.", "The gallbladder makes bile."], correct: [1], rationale: "Because." });
  assert.ok(d.trustFlags.includes("distractor-is-true") || d.trustFlags.includes("key-contradicts-reference")); assert.equal(d.trust, "conflict");
});

test("structure and logic: duplicate options, a key pointing nowhere, a select-all with one key, a wrong «select N» — all unverified with the code that caught it", () => {
  assert.ok(tag({ options: ["Liver", "liver!", "Pancreas"] }).trustFlags.includes("duplicate-option"));
  assert.ok(tag({ correct: [7] }).trustFlags.includes("key"));
  assert.ok(tag({ type: "multi", correct: [0] }).trustFlags.includes("key-count"));
  assert.ok(tag({ type: "multi", stem: "Select 3 organs that make digestive juices.", correct: [0, 2] }).trustFlags.includes("select-count"));
  assert.equal(tag({ correct: [] }).trust, "ungrounded");
});

test("safety-critical statements (doses, contraindications) that no official reference confirmed → unverified; a lab range for the wrong sex is patched", () => {
  const d = tag({ stem: "Which dose is correct for the adult?", options: ["500 mg every 8 hours", "5 mg every 8 hours"], correct: [0], rationale: "Give 500 mg every 8 hours. Aspirin is contraindicated in this client." });
  assert.ok(d.trustFlags.includes("safety-unresolved")); assert.equal(d.trust, "ungrounded");
  const l = tag({ stem: "A woman has creatinine 1.3 mg/dL.", options: ["Report it", "Ignore it"], correct: [0], rationale: "Creatinine 1.3 mg/dL is normal for an adult woman." });
  assert.match(l.rationale, /reference range/); assert.equal(l.trust, "conflict");
});

test("other-profession / other-country rules are flagged; residue is cleaned; analogies in a rationale are kept (only patched sentences change)", () => {
  const sc = tagExamItem(item({ stem: "Which task can the pharmacist delegate?", rationale: "Delegate the assessment to the UAP." }), { profile: { discipline: "pharmacy", exam: "", region: "" }, record: false });
  assert.ok(sc.trustFlags.includes("scope")); assert.equal(sc.trust, "ungrounded");
  const c = tag({ stem: "1× Which organ makes bile?", rationale: "Think of the stomach like a blender. The liver makes bile." });
  assert.ok(!c.stem.includes("1×")); assert.ok(c.rationale.includes("like a blender"), "the teaching analogy is untouched");
});

test("the reference not being loaded never produces a ✓ (conservative), and tagging is idempotent", () => {
  KB.__resetKb();
  const q = tag();
  assert.equal(q.trust, "ungrounded"); assert.ok(q.trustFlags.includes("kb-not-loaded"));
  assert.equal(tagExamItem(q, { profile: GEN }), q, "an already tagged item is returned as is");
  assert.equal(trustOf({}), "ungrounded");
});

test("saved mistakes: an «ungrounded» (no coverage) item is saved like the others, and the student can still save one by choice", async () => {
  await KB.loadKb(GEN);
  __setState([]);
  const un = tag({ stem: "Unresolved question number one?", rationale: "Because." });
  const pe = tag();
  assert.equal(un.trust, "ungrounded"); assert.equal(pe.trust, "reference");
  assert.equal(mistakeEligible(un), true, "v3.45: no coverage is not a concern"); assert.equal(mistakeEligible(pe), true);
  assert.equal(recordAnswer(un, [1]), "new");
  __setState([]);
  assert.equal(recordAnswer(pe, [1]), "new");
  assert.equal(shapeMistakes(JSON.parse(JSON.stringify({ list: [] }))).length, 0);
  assert.equal(recordAnswer(un, [1], { force: true }), "new", "the student's own decision");
  __setState([]);
});

/* ───── makeExam end to end ───── */
installFetch();
let KEY = "AIzaEXM", seq = 0;
const G = (m) => `gemini:${m}`;
const fresh = () => { KEY = `AIzaEXM${String(++seq).padStart(8, "0")}`; reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" }); };
const EXAM_JSON = JSON.stringify({ title: "امتحان الجهاز الهضمي", intro: "يلا", questions: [
  { type: "single", stem: "Which organ makes bile?", options: ["Liver", "Gallbladder", "Pancreas", "Stomach"], correct: [0], rationale: "The liver makes bile and the gallbladder stores and concentrates it.", topic: "digestive" },
  { type: "single", stem: "A client with heart failure gains 3 kg in 2 days. What first?", options: ["Wait", "Report to provider", "Add fluids", "Walk"], correct: [1], rationale: "Report rapid weight gain.", topic: "heart" },
  { type: "single", stem: "Which statement about bile is true?", options: ["The gallbladder secretes bile.", "The liver stores all bile for a week.", "Bile is made by the heart", "None"], correct: [0], rationale: "The gallbladder secretes bile.", topic: "digestive" },
] });

test("makeExam: every item is tagged before the student sees it, the item never changes afterwards, and the request count is exactly the planned batches", async () => {
  fresh();
  for (const m of [...getModelLists(KEY).fast, ...getModelLists(KEY).pro]) script(G(m), { ok: EXAM_JSON });
  assert.equal(examCount("make an exam of 3 questions on digestion"), 3);
  const seen = [];
  const { exam, requested } = await makeExam({ apiKey: KEY, request: "make an exam of 3 questions on digestion", questions: [], topics: [], profile: GEN,
    onProgress: (p) => { for (const q of p.questions) seen.push({ stem: q.stem, trust: q.trust, rationale: q.rationale }); } });
  assert.equal(requested, 3);
  assert.equal(log.filter((l) => l.lane !== "list").length, 1, "one batch = one request: tagging adds none");
  assert.ok(seen.length >= 3 && seen.every((s) => s.trust), "no item was ever shown untagged");
  assert.ok(exam.questions.every((q) => ["verified", "grounded", "reference", "conflict", "ungrounded"].includes(q.trust)));
  const by = Object.fromEntries(exam.questions.map((q) => [q.stem.slice(0, 18), q]));
  assert.equal(by["Which organ makes "].trust, "reference");
  assert.equal(by["A client with hear"].trust, "ungrounded");
  const bad = exam.questions.find((q) => /statement about bile/.test(q.stem));
  assert.equal(bad.trust, "conflict"); assert.match(bad.rationale, /liver makes bile/, "the wrong fact in the rationale was patched before display");
  assert.deepEqual(exam.questions.map((q) => q.trust).filter(Boolean).length, 3);
  assert.deepEqual(trustCounts(exam.questions), { verified: 0, grounded: 0, reference: 1, conflict: 1, ungrounded: 1 });
  /* an item that was shown is never rewritten later */
  for (const s of seen) { const q = exam.questions.find((x) => x.stem === s.stem); assert.equal(q && q.rationale, s.rationale); }
});

test("makeExam with 10 items: 4 parallel batches as in v3.42 (tagging adds no request, no top-up when all items are valid)", async () => {
  fresh();
  const mk = (n) => JSON.stringify({ title: "t", intro: "i", questions: Array.from({ length: n }, (_, i) => ({ type: "single", stem: `Question number ${i} about topic ${Math.random().toString(36).slice(2)} and more words here`, options: ["a1", "b2", "c3", "d4"], correct: [i % 4], rationale: "Because of reasons.", topic: "x" })) });
  for (const m of [...getModelLists(KEY).fast, ...getModelLists(KEY).pro]) script(G(m), { ok: (body) => mk(3) });
  const { exam } = await makeExam({ apiKey: KEY, request: "make an exam of 10 questions on digestion", questions: [], topics: [], profile: GEN });
  assert.ok(log.filter((l) => l.lane !== "list").length <= 5, "4 batches (+ at most the one existing top-up)");
  assert.ok(exam.questions.every((q) => q.trust));
});
