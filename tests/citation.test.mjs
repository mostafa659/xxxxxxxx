/* v3.44 · Citation-First Calibrated Trust, end to end: typed text, PDF text layers, OCR transcripts, strict-mode fallbacks, hallucinated / unanchored inputs. */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractPdfText } from "../src/lib/pdftext.js";
import { buildSourceModel, groundSentence, provLabel } from "../src/lib/provenance.js";
import * as T from "../src/lib/trust.js";
import * as KB from "../src/lib/kb/index.js";
import { tagExamItem, trustCounts, mistakeEligible, memorizeEligible, normalizeTrust } from "../src/lib/examtrust.js";
import { recordAnswer, __setState, __getState } from "../src/lib/mistakes.js";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { getModelLists } from "../src/lib/gemini.js";
import { makeExam } from "../src/lib/exam.js";
import { readItem } from "../src/lib/docs.js";

globalThis.FileReader ??= class {
  async _go(f, mode) { const buf = Buffer.from(await f.arrayBuffer()); this.result = mode === "url" ? `data:${f.type || "application/octet-stream"};base64,${buf.toString("base64")}` : mode === "text" ? buf.toString("utf8") : buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length); this.onload && this.onload(); }
  readAsDataURL(f) { this._go(f, "url"); } readAsText(f) { this._go(f, "text"); } readAsArrayBuffer(f) { this._go(f, "buf"); }
};
const GEN = { discipline: "general", exam: "", region: "" };
await T.ensureKb(GEN);
const fx = (n) => new Uint8Array(fs.readFileSync(new URL(`./fixtures/${n}.pdf`, import.meta.url)));
const NOTES = "Lecture notes: the absorption of nutrients.\nVitamin B12 is absorbed in the terminal ileum together with intrinsic factor.\nThe duodenum absorbs iron and calcium.\nThe lecturer's rule: take 4 doses of the scheduled drug per day and the maximum is 8 doses.\nProfessor X says the large intestine has 7 parts.\nThe sinoatrial node fires 60 to 100 times per minute.";
const asText = () => buildSourceModel({ items: [{ t: "text", id: "a", name: "notes.txt", text: NOTES }] });
const asOcr = () => buildSourceModel({ items: [{ t: "image", name: "i.png" }], extractions: [{ sourceType: "image", text: NOTES, complete: true }] });
const asPdf = async () => { const ex = await extractPdfText(fx("text-helvetica")); return buildSourceModel({ items: [{ t: "pdf", id: "p", name: "notes.pdf", ptext: ex.text, ppages: ex.pages, prov: { extracted: true } }] }); };
const item = (o = {}) => ({ type: "single", stem: "Where is vitamin B12 absorbed?", options: ["Terminal ileum", "Duodenum", "Stomach", "Colon"], correct: [0], rationale: "Vitamin B12 is absorbed in the terminal ileum together with intrinsic factor.", topic: "absorption", ...o });
const tag = (o, model, prof = GEN) => tagExamItem(item(o), { profile: prof, sourceModel: model, record: false });

test("GROUNDING · sentences are anchored to a source sentence with page / block / source type, across typed text, a PDF text layer and an OCR transcript", async () => {
  const pdf = await asPdf();
  for (const [label, m] of [["text", asText()], ["ocr", asOcr()], ["pdf", pdf]]) {
    const g = groundSentence(m, "Vitamin B12 is absorbed in the terminal ileum together with intrinsic factor.");
    if (label === "pdf") continue;                                     // the PDF fixture has its own wording, checked below
    assert.equal(g.state, "grounded", label); assert.ok(g.prov && g.source, label);
  }
  const g = groundSentence(pdf, "Vitamin B12 is absorbed in the terminal ileum.");
  assert.equal(g.state, "grounded"); assert.equal(g.prov.sourceType, "pdf"); assert.equal(g.prov.page, 2);
  assert.equal(provLabel(g.prov, "en"), "your PDF · p. 2");
  assert.match(provLabel(g.prov, "ar"), /ص 2/);
});

test("GROUNDING GUARDS · a number, a negation or an acronym that differs is never «grounded»", async () => {
  const m = asText();
  assert.equal(groundSentence(m, "The sinoatrial node fires 70 to 120 times per minute.").state, "contradiction");
  assert.equal(groundSentence(m, "The sinoatrial node fires 70 to 120 times per minute.").why, "number");
  assert.equal(groundSentence(m, "The duodenum does not absorb iron and calcium.").why, "polarity");
  assert.equal(groundSentence(m, "The duodenum absorbs XQZ iron and calcium.").state, "none", "an invented acronym");
  assert.equal(groundSentence(m, "The pancreas secretes enormous quantities of amylase nightly.").state, "none", "hallucinated: nothing anchors it");
  assert.equal(groundSentence(m, "Short claim.").state, "none");
});

test("MODEL-WRITTEN TEXT IS NEVER A SOURCE · a partial extraction (map, solve brief) cannot ground a claim; a complete OCR transcript can", () => {
  const partial = buildSourceModel({ items: [{ t: "image", name: "i" }], extractions: [{ sourceType: "image", text: NOTES, complete: false }] });
  assert.equal(partial.strict, true);
  assert.equal(groundSentence(partial, "The duodenum absorbs iron and calcium.").state, "none");
  assert.equal(groundSentence(asOcr(), "The duodenum absorbs iron and calcium.").state, "grounded");
  const scanned = buildSourceModel({ items: [{ t: "pdf", name: "s.pdf", prov: { extracted: false, reason: "no-text-layer" } }] });
  assert.equal(groundSentence(scanned, "The duodenum absorbs iron and calcium.").state, "none");
});

const LESSON = `- The duodenum absorbs iron and calcium.
- The large intestine has 7 parts.
- The sinoatrial node fires 70 to 120 times per minute.
- The pancreas secretes enormous quantities of amylase nightly.
- Take 4 doses of the scheduled drug per day and the maximum is 8 doses.`;
const run = (m) => T.verifyText({ text: LESSON, sourceModel: m, profile: GEN, part: "A" });
const by = (r, re) => r.items.find((i) => re.test(i.sentence));

test("LESSON LABELS · from typed text, a PDF layer and an OCR transcript: 📄 grounded (with location), ⚠ conflict with the source, ⚠ source-vs-reference, ؟ for the hallucination", async () => {
  for (const [label, m] of [["text", asText()], ["ocr", asOcr()], ["pdf-like", buildSourceModel({ items: [{ t: "pdf", name: "n.pdf", ptext: NOTES, ppages: [{ index: 1, text: NOTES }], prov: { extracted: true } }] })]]) {
    const r = run(m);
    const g = by(r, /duodenum/), seven = by(r, /7 parts/), node = by(r, /sinoatrial/), hall = by(r, /pancreas/), dose = by(r, /doses/);
    assert.equal(g.label, "grounded", label); assert.ok(g.prov && g.prov.sourceType, label); assert.equal(g.memorize, true, "the student's own material may be memorized");
    assert.equal(seven.label, "conflict", `${label}: the SOURCE says 7 parts, the reference says 4`); assert.match(seven.text, /4 parts/); assert.equal(seven.memorize, false);
    assert.equal(node.label, "conflict", `${label}: differs from the student's notes`); assert.match(node.note, /number/);
    assert.equal(hall.label, "unverified", `${label}: no anchor`); assert.equal(hall.memorize, false);
    assert.equal(dose.label, "grounded", label); assert.match(dose.note, /official reference/); assert.equal(dose.memorize, false, "a dose is grounded but never memorize-eligible without a reference");
    assert.equal(r.stats.unlabeledHighRisk, 0);
    assert.ok(r.stats.grounded >= 2 && r.stats.conflict >= 2);
  }
});

test("STRICT MODE · scanned PDF / unread image / hallucinated lesson: nothing is promoted to 📄, ever", () => {
  for (const m of [buildSourceModel({ items: [{ t: "pdf", name: "s.pdf", prov: { extracted: false, reason: "no-text-layer" } }] }), buildSourceModel({ items: [{ t: "image", name: "i" }] }), buildSourceModel({ items: [] })]) {
    const r = run(m);
    assert.ok(r.items.every((i) => i.label !== "grounded"), "no source text → no grounding");
    assert.ok(r.items.every((i) => i.origin !== "source"));
    assert.ok(r.items.every((i) => !i.memorize));
    assert.equal(r.stats.unlabeledHighRisk, 0);
  }
});

/* ───────────── exam items ───────────── */
test("EXAM TAGS · the same item gets 📄 grounded from typed text, an OCR transcript and a PDF layer — with page for the PDF — and ؟ ungrounded without a source", async () => {
  const pdf = await asPdf();
  const tx = tag({}, asText()), oc = tag({}, asOcr()), pf = tag({}, pdf);
  for (const q of [tx, oc]) { assert.equal(q.trust, "grounded"); assert.ok(q.trustProv.snippet.includes("terminal ileum")); }
  assert.equal(pf.trust, "grounded"); assert.equal(pf.trustProv.sourceType, "pdf"); assert.equal(pf.trustProv.page, 2); assert.equal(pf.trustProv.label, "your PDF · p. 2");
  assert.equal(tag({}, null).trust, "ungrounded", "no source, and the KB has nothing on B12 absorption sites: the generator's own claim");
  assert.equal(tag({}, buildSourceModel({ items: [{ t: "pdf", name: "s.pdf", prov: { extracted: false } }] })).trust, "ungrounded", "scanned PDF: strict");
});

test("EXAM TAGS · hallucinated keys, notes contradicted by the item, and a wrong source", () => {
  const hall = tag({ stem: "What does the pancreas secrete at night?", options: ["Amylase", "Bile", "Pepsin", "Gastrin"], correct: [0], rationale: "The pancreas secretes enormous quantities of amylase nightly." }, asText());
  assert.equal(hall.trust, "ungrounded"); assert.ok(hall.trustWhy.some((w) => /generator's own claim/.test(w)));
  const num = tag({ stem: "How fast does the sinoatrial node fire?", options: ["70 to 120 per minute", "20 to 40", "40 to 60", "10"], correct: [0], rationale: "The sinoatrial node fires 70 to 120 times per minute." }, asText());
  assert.equal(num.trust, "conflict"); assert.ok(num.trustFlags.includes("source-contradiction")); assert.ok(num.trustWhy.some((w) => /differs from your source/.test(w)));
  const wrongSrc = tag({ stem: "How many parts does the large intestine have?", options: ["7", "4", "3", "9"], correct: [0], rationale: "Professor X says the large intestine has 7 parts." }, asText());
  assert.equal(wrongSrc.trust, "conflict"); assert.ok(wrongSrc.trustFlags.some((f) => /source-vs-reference|rationale-contradiction/.test(f)));
  assert.match(wrongSrc.rationaleBefore || wrongSrc.trustWhy.join(" "), /7 parts|reference says/);
});

test("EXAM TAGS · a KB reference alone → 🔎 reference; both agree → 📄 (the student's source outranks a pending reference); saved lessons only → 🔎", () => {
  const ref = tag({ stem: "Which organ makes bile?", options: ["Liver", "Gallbladder", "Pancreas", "Stomach"], correct: [0], rationale: "The liver makes bile and the gallbladder stores and concentrates it." }, null);
  assert.equal(ref.trust, "reference"); assert.equal(ref.trustNote, "reference — source check pending");
  const m = buildSourceModel({ items: [{ t: "text", name: "n", text: "The liver makes bile and the gallbladder stores and concentrates it for later use." }] });
  assert.equal(tag({ stem: "Which organ makes bile?", options: ["Liver", "Gallbladder", "Pancreas", "Stomach"], correct: [0], rationale: "The liver makes bile and the gallbladder stores and concentrates it." }, m).trust, "grounded");
  const lesson = buildSourceModel({ items: [{ t: "text", name: "saved", text: NOTES, lesson: true }] });
  const q = tag({}, lesson);
  assert.equal(q.trust, "reference", "AI-written saved lessons are weaker evidence than the student's own file");
  assert.equal(q.trustProv.sourceType, "lesson");
});

test("EXAM TAGS · KB contradictions (conflict), defects and unresolved safety-critical statements (ungrounded); grounded safety statements are allowed but not memorizable", () => {
  const kb = tag({ stem: "Which statement about bile is correct?", options: ["The gallbladder secretes bile.", "The pancreas stores bile.", "Bile is made by the heart", "None"], correct: [0], rationale: "The gallbladder secretes bile." }, asText());
  assert.equal(kb.trust, "conflict");
  assert.equal(tag({ options: ["Liver", "liver!", "Pancreas"] }, asText()).trust, "ungrounded");
  const doseOnly = tag({ stem: "Which dose is correct?", options: ["500 mg every 8 hours", "5 mg every 8 hours"], correct: [0], rationale: "Give 500 mg every 8 hours." }, null);
  assert.equal(doseOnly.trust, "ungrounded"); assert.ok(doseOnly.trustFlags.includes("safety-unresolved"));
  const m = buildSourceModel({ items: [{ t: "text", name: "n", text: "Give 500 mg every 8 hours for adults with this infection and review after three days." }] });
  const g = tag({ stem: "Which dose is correct?", options: ["500 mg every 8 hours", "5 mg every 8 hours"], correct: [0], rationale: "Give 500 mg every 8 hours for adults with this infection." }, m);
  assert.equal(g.trust, "grounded"); assert.equal(g.trustSafety, true);
  assert.equal(memorizeEligible(g), false, "safety-critical → needs an official reference to memorize");
  assert.equal(mistakeEligible(g), true);
});

test("NEGATIVE STEMS · «which is NOT …»: the key is the false statement, so KB support for the key is a conflict", () => {
  const q = tag({ stem: "Which of the following is NOT a beta blocker?", options: ["Metoprolol is a beta blocker.", "Lisinopril is a beta blocker.", "Atenolol is a beta blocker.", "Propranolol is a beta blocker."], correct: [1], rationale: "Lisinopril is an ACE inhibitor." }, null);
  assert.notEqual(q.trust, "conflict", "the key (lisinopril) is rightly the false statement");
  const bad = tag({ stem: "Which of the following is NOT a beta blocker?", options: ["Metoprolol is a beta blocker.", "Lisinopril is a beta blocker.", "Atenolol is a beta blocker.", "Propranolol is a beta blocker."], correct: [0], rationale: "Metoprolol is not one." }, null);
  assert.equal(bad.trust, "conflict");
});

test("ACT, THEN REVIEW · verified / grounded / reference save smoothly with their badge; conflict / ungrounded are held back with «save anyway»; memorize rule", async () => {
  __setState([]);
  const mk = (stem, trust, extra = {}) => ({ stem, options: ["a", "b"], correct: [1], type: "single", rationale: "", topic: "x", trust, ...extra });
  assert.equal(recordAnswer(mk("Q verified?", "verified"), [0]), "new");
  assert.equal(recordAnswer(mk("Q grounded?", "grounded", { trustProv: { sourceType: "pdf", page: 2, name: "n.pdf" } }), [0]), "new");
  assert.equal(recordAnswer(mk("Q reference?", "reference"), [0]), "new");
  assert.equal(recordAnswer(mk("Q legacy pending?", "pending"), [0]), "new", "legacy tag maps to reference");
  assert.equal(recordAnswer(mk("Q conflict?", "conflict"), [0]), "skipped");
  assert.equal(recordAnswer(mk("Q ungrounded?", "ungrounded"), [0]), "skipped");
  assert.equal(recordAnswer(mk("Q legacy unverified?", "unverified"), [0]), "skipped");
  assert.equal(recordAnswer(mk("Q conflict forced?", "conflict"), [0], { force: true }), "new");
  const saved = __getState().list;
  const g = saved.find((m) => /Q grounded/.test(m.stem));
  assert.equal(g.trust, "grounded"); assert.equal(g.prov.page, 2);
  assert.equal(saved.find((m) => /legacy pending/.test(m.stem)).trust, "reference");
  assert.equal(memorizeEligible({ trust: "verified" }), true);
  assert.equal(memorizeEligible({ trust: "grounded" }), true);
  assert.equal(memorizeEligible({ trust: "grounded", trustSafety: true }), false);
  for (const t of ["reference", "conflict", "ungrounded", "pending", "unverified", ""]) assert.equal(memorizeEligible({ trust: t }), false, t);
  assert.deepEqual(["pending", "unverified", "verified", "bogus"].map(normalizeTrust), ["reference", "ungrounded", "verified", ""]);
  __setState([]);
});

/* ───────────── makeExam from a real attached PDF ───────────── */
installFetch();
let KEY = "AIzaCIT", seq = 0;
const G = (m) => `gemini:${m}`;
const fresh = () => { KEY = `AIzaCIT${String(++seq).padStart(8, "0")}`; reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" }); };
const EXAM = JSON.stringify({ title: "t", intro: "i", questions: [
  { type: "single", stem: "Where is vitamin B12 absorbed?", options: ["Terminal ileum", "Duodenum", "Stomach", "Colon"], correct: [0], rationale: "Vitamin B12 is absorbed in the terminal ileum.", topic: "absorption" },
  { type: "single", stem: "Which nutrient does the duodenum absorb?", options: ["Iron and calcium", "Vitamin B12", "Bile salts", "Water only"], correct: [0], rationale: "The duodenum absorbs iron and calcium.", topic: "absorption" },
  { type: "single", stem: "What does the pancreas secrete at night?", options: ["Amylase", "Bile", "Pepsin", "Gastrin"], correct: [0], rationale: "The pancreas secretes enormous quantities of amylase nightly.", topic: "x" },
  { type: "single", stem: "How many parts does the large intestine have in these notes?", options: ["Five", "Seven", "Three", "Nine"], correct: [1], rationale: "The large intestine has 7 parts.", topic: "x" },
] });
test("END TO END · makeExam with an attached REAL PDF: items from its text layer come back 📄 grounded with the page; the hallucinated one is ؟; no extra request; nothing waits for the source model", async () => {
  fresh();
  for (const m of [...getModelLists(KEY).fast, ...getModelLists(KEY).pro]) script(G(m), { ok: EXAM });
  const pdf = await readItem(new File([fx("text-helvetica")], "notes.pdf", { type: "application/pdf" }));
  assert.equal(pdf.prov.extracted, true);
  const seen = [];
  const { exam } = await makeExam({ apiKey: KEY, request: "make an exam of 4 questions on absorption", questions: [], topics: [], attach: [pdf], profile: GEN, onProgress: (p) => { for (const q of p.questions) seen.push(q.trust); } });
  assert.equal(log.filter((l) => l.lane !== "list").length, 2, "exactly the 2 requests v3.42 makes for an exam with an attached file (measured on the v3.42 code): tagging and grounding add none");
  assert.ok(seen.length >= 4 && seen.every(Boolean), "every item tagged before it was shown");
  const q = (re) => exam.questions.find((x) => re.test(x.stem));
  assert.equal(q(/vitamin B12/).trust, "grounded"); assert.equal(q(/vitamin B12/).trustProv.page, 2);
  assert.equal(q(/duodenum absorb/).trust, "grounded"); assert.equal(q(/duodenum absorb/).trustProv.page, 2);
  assert.equal(q(/pancreas secrete/).trust, "ungrounded");
  assert.notEqual(q(/large intestine/).trust, "grounded");
  console.log("# makeExam from a PDF: " + JSON.stringify(trustCounts(exam.questions)));
});

test("END TO END · a SCANNED PDF attached: nothing can be grounded, every item is ungrounded or reference-only", async () => {
  fresh();
  for (const m of [...getModelLists(KEY).fast, ...getModelLists(KEY).pro]) script(G(m), { ok: EXAM });
  const scan = await readItem(new File([fx("scanned")], "scan.pdf", { type: "application/pdf" }));
  const { exam } = await makeExam({ apiKey: KEY, request: "make an exam of 4 questions on absorption", questions: [], topics: [], attach: [scan], profile: GEN });
  assert.ok(exam.questions.every((q) => q.trust !== "grounded" && q.trust !== "verified"), JSON.stringify(exam.questions.map((q) => q.trust)));
});

test("SPEED · grounding + tagging ten exam items against a 40-page PDF-sized source", async () => {
  const para = (i) => `Section ${i} discusses topic number ${i} in detail. The enzyme ${"abcdefghij"[i % 10]}ase number ${i} breaks down substrate ${i} in the small intestine. Fact ${i} is repeated here for the lecture.`;
  const pages = Array.from({ length: 40 }, (_, p) => ({ index: p + 1, text: Array.from({ length: 12 }, (_, k) => para(p * 12 + k)).join(" ") }));
  const m = buildSourceModel({ items: [{ t: "pdf", name: "big.pdf", ptext: "x", ppages: pages, prov: { extracted: true } }] });
  const ts = [];
  for (let rep = 0; rep < 12; rep++) {
    const t0 = performance.now();
    for (let i = 0; i < 10; i++) tagExamItem({ ...item({ stem: `What does enzyme number ${i * 7} do?`, options: [`It breaks down substrate ${i * 7}`, "Nothing", "Makes bile", "Stores iron"], rationale: `The enzyme ase number ${i * 7} breaks down substrate ${i * 7} in the small intestine.` }), trust: undefined }, { profile: GEN, sourceModel: m, record: false });
    ts.push((performance.now() - t0) / 10);
  }
  ts.sort((a, b) => a - b);
  console.log(`# tag one exam item against a 40-page source: median ${ts[6].toFixed(2)} ms, worst ${ts[11].toFixed(2)} ms`);
  assert.ok(ts[6] < 20, `${ts[6]} ms per item`);
});
