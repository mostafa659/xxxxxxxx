import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import * as U from "../src/lib/reuse.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";

installFetch();
const KEY = "AIzaREUSE000000000000000001";
const fresh = (prefs = {}) => { reset(); R.__resetRouter(); window.localStorage.clear(); U.__resetReuse(); U.__setReuseClock(); setExtKeys({}); setEnginePrefs({ mode: "auto", slice: true, search: false, reuse: true, ...prefs }); };
const calls = () => log.filter((l) => l.lane !== "list");
const ask = async (text, o = {}) => { const { askChat } = await import("../src/lib/chat.js"); return askChat({ apiKey: KEY, history: [{ role: "user", text }], ctx: o.ctx || { kind: "global" }, level: o.level, attach: o.attach, onText: o.onText || (() => {}) }); };

test("reuse.words / similarity: spelling variants and noise words do not matter, a different question does", () => {
  assert.ok(U.similarity("ايه معنى NPO؟", "معنى npo ايه") >= 0.9);
  assert.ok(U.similarity("What does NPO mean?", "what does npo mean") >= 0.9);
  assert.ok(U.similarity("ما هي الاصابة", "ما هي الإصابة؟") >= 0.9, "alef / ta marbuta variants");
  assert.ok(U.similarity("what does NPO mean", "what does PRN mean") < 0.9);
  assert.ok(U.similarity("define edema", "define ascites") < 0.9);
  assert.equal(U.similarity("", "x y"), 0);
});

test("reuse · the same easy question asked again is answered from the saved answer: zero requests", async () => {
  fresh();
  const a = await ask("what does NPO mean?");
  assert.equal(calls().length, 1); assert.ok(!a.cached);
  log.length = 0;
  let painted = "";
  const b = await ask("What does NPO mean", { onText: (t) => { painted = t; } });
  assert.equal(calls().length, 0, "no request at all");
  assert.equal(b.cached, true); assert.equal(b.text, a.text); assert.equal(painted, a.text, "painted on the screen like any answer"); assert.equal(b.model, "saved");
});

test("reuse · NEVER for a merely similar question, a different place, a long conversation, an attachment, a non-easy question, or when switched off", async () => {
  fresh(); await ask("what does NPO mean?");
  log.length = 0;
  await ask("what does PRN mean?");                                           assert.equal(calls().length, 1, "similar is not the same");
  log.length = 0;
  await ask("what does NPO mean?", { ctx: { kind: "question", title: "Q1", question: "some question" } }); assert.equal(calls().length, 1, "another place (a question's own chat)");
  log.length = 0;
  const { askChat } = await import("../src/lib/chat.js");
  await askChat({ apiKey: KEY, history: [{ role: "user", text: "hi" }, { role: "ai", text: "hello" }, { role: "user", text: "what does NPO mean?" }], ctx: { kind: "global" }, onText() {} });
  assert.equal(calls().length, 1, "not the first message: it may depend on what was said before");
  log.length = 0;
  await ask("what does NPO mean?", { attach: [{ name: "a.png", mime: "image/png", data: "AAAA" }] }); assert.equal(calls().length, 1, "an attachment makes it a different question");
  log.length = 0;
  await ask("what does NPO mean?", { level: "deep" });                         assert.equal(calls().length, 1, "a level the student chose is always answered fresh");
  fresh({ reuse: false }); await ask("what does NPO mean?"); log.length = 0;
  await ask("what does NPO mean?");                                           assert.equal(calls().length, 1, "switched off in the engine window");
  /* a question that is not easy is never saved nor reused */
  fresh(); await ask("why is the answer B in this question?"); log.length = 0;
  await ask("why is the answer B in this question?");                         assert.equal(calls().length, 1);
});

test("reuse · an answer that came from a web search expires sooner (facts move); the list is capped; one entry per question", async () => {
  fresh();
  let t = 1_000_000_000_000; U.__setReuseClock(() => t);
  U.saveAnswer({ text: "what does NPO mean", place: "global", answer: "x".repeat(30), searched: true });
  U.saveAnswer({ text: "define edema please", place: "global", answer: "y".repeat(30), searched: false });
  assert.ok(U.findSaved({ text: "what does NPO mean", place: "global" }));
  t += 15 * 864e5;
  assert.equal(U.findSaved({ text: "what does NPO mean", place: "global" }), null, "searched answer: 14 days");
  assert.ok(U.findSaved({ text: "define edema", place: "global" }), "plain answer: 60 days");
  U.saveAnswer({ text: "define edema", place: "global", answer: "z".repeat(30) });
  assert.equal(JSON.parse(window.localStorage.getItem("clinix:reuse:v1")).length, 1, "the same question is stored once (the newest answer wins)");
  for (let i = 0; i < 200; i++) U.saveAnswer({ text: `define term${i}word extra${i}`, place: "global", answer: "w".repeat(30) });
  assert.ok(JSON.parse(window.localStorage.getItem("clinix:reuse:v1")).length <= 150);
  assert.equal(U.findSaved({ text: "what does it mean", place: "global" }), null, "a question made only of noise words matches nothing");
  U.saveAnswer({ text: "what does NPO mean?", place: "global", answer: "v".repeat(30) });
  assert.equal(U.findSaved({ text: "NPO after midnight", place: "global" }), null, "NPO is not NPO after midnight");
  assert.ok(U.findSaved({ text: "ايه معنى npo؟", place: "global" }), "the same one-word question in another phrasing");
  U.__setReuseClock();
});
