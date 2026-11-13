/* v3.40.10 — two promises:
   1. a QUESTION never asks the model to write its own text back ("نص السؤال": it is already in the student's attachment) → one request and its output tokens less;
   2. translating a word / sentence and pronouncing it use GOOGLE ONLY: a Gemini request is never made for them, even when Google fails. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");

/* ── 1 · no question-text stage ── */
test("which stages run: a question has reason + words only, a lesson keeps its background summary (ocr)", async () => {
  const { tasksFor, sectionsFor } = await import("../src/lib/config.js");
  assert.deepEqual(tasksFor("question").sort(), ["reason", "words"]);
  assert.deepEqual(tasksFor("lesson").sort(), ["ocr", "reason", "words"]);
  assert.ok(!sectionsFor("question").some((s) => s.key === "original_question_text"), "no «نص السؤال» card");
});

test("the progress tracker only tracks the stages that run, so the bar can reach 100 % without an ocr stage", async () => {
  const P = await import("../src/lib/progress.js");
  const t = P.createTracker("balanced", {}, ["words", "reason"]);
  assert.deepEqual(Object.keys(t.tasks).sort(), ["reason", "words"]);
  P.settle(t, "words", "done"); P.settle(t, "reason", "done");
  assert.equal(P.snapshot(t).done, true);
  assert.deepEqual(Object.keys(P.createTracker("balanced", {}).tasks).sort(), ["ocr", "reason", "words"], "default (lesson) is unchanged");
});

test("a new question has no stored transcript, so its title and its one-line preview come from the explanation (free, already saved)", async () => {
  const { bodyLine, snippetOf } = await import("../src/lib/text.js");
  const explanation = "## 🎯 السؤال بيسأل عن إيه؟\n\n**المريض** بيسأل عن أول إجراء تمريضي مع الـ Heparin.\n\n## 📚 الأساس";
  assert.equal(bodyLine(explanation), "المريض بيسأل عن أول إجراء تمريضي مع الـ Heparin.");
  assert.equal(snippetOf({ explanation }), "المريض بيسأل عن أول إجراء تمريضي مع الـ Heparin.");
  assert.equal(snippetOf({ original_question_text: "A nurse is caring…", explanation }), "A nurse is caring…", "items saved by an older version keep their text");
  assert.equal(snippetOf({}), "—");
  assert.equal(bodyLine("## only a heading"), "");
});

test("the batch (many questions in one upload) no longer waits for an ocr part that will never come", () => {
  const b = src("lib/batch.js");
  assert.ok(b.includes('tasksFor("question")') && !/part:\s*\{\s*ocr/.test(b));
});

/* ── 2 · translation: Google only ── */
const realFetch = globalThis.fetch;
const hosts = [];
const mockFetch = (handler) => { globalThis.fetch = async (url) => { hosts.push(String(url)); return handler(String(url)); }; };
const ok = (data) => ({ ok: true, status: 200, json: async () => data });
const bad = () => ({ ok: false, status: 503, json: async () => ({}) });

test("a word is translated by Google (one request, zero Gemini)", async () => {
  hosts.length = 0;
  mockFetch((u) => (/translate\.googleapis\.com/.test(u) ? ok([[["مُضاعَفات", "complications"]]]) : bad()));
  const { translateWord } = await import("../src/lib/wordtr.js");
  const ar = await translateWord({ word: "complications-x1" });
  assert.match(ar, /[\u0600-\u06FF]/);
  assert.ok(hosts.length >= 1 && hosts.every((h) => !/generativelanguage|gemini/i.test(h)), hosts.join("\n"));
  globalThis.fetch = realFetch;
});

test("when EVERY free provider fails, the student gets the honest error: no Gemini request is made as a last resort", async () => {
  hosts.length = 0;
  mockFetch(() => bad());
  const { translateWord, translateSentence } = await import("../src/lib/wordtr.js");
  await assert.rejects(translateWord({ word: "exacerbation-x2" }), /الترجمة|اتصال/);
  await assert.rejects(translateSentence({ text: "The nurse should hold the dose and call the provider." }), /الترجمة|اتصال/);
  assert.ok(hosts.length >= 2);
  assert.ok(hosts.every((h) => !/generativelanguage|gemini|googleapis\.com\/v1beta/i.test(h)), "never Gemini: " + hosts.join("\n"));
  globalThis.fetch = realFetch;
});

/* ── 3 · pronunciation: Google only ── */
test("pronunciation has no Gemini voice any more (no engine switch, no key, no request to the Gemini host)", async () => {
  const sp = await import("../src/lib/speech.js");
  assert.equal(sp.setVoiceEngine, undefined);
  assert.equal(sp.setSpeechKey, undefined);
  assert.equal(sp.useVoiceEngine, undefined);
  assert.equal(sp.speakable("heparin (هيبارين) **dose**"), "heparin dose", "Arabic is never read by the American voice");
  assert.deepEqual(sp.splitForTts("a".repeat(10)), ["aaaaaaaaaa"]);
  const code = src("lib/speech.js");
  assert.ok(!/gemini\.js|generativelanguage|rawRequest|fetchGemini|API_BASE/.test(code.replace(/\/\*[\s\S]*?\*\//g, "")), "speech.js does not touch the Gemini API");
  const tr = src("lib/wordtr.js");
  assert.ok(!/gemini\.js|runTask|getModelLists/.test(tr), "wordtr.js does not touch the Gemini API");
  assert.ok(!/VoicePick|setVoiceEngine/.test(src("components/ui.jsx")), "the male-Gemini-voice button is gone from the settings");
  assert.ok(!/setSpeechKey|setTranslateKey/.test(src("App.jsx")));
});
