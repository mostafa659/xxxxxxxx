/* v3.43 · B2 plumbing: the solve request asks for logprobs and the stream's logprobsResult comes back; a model that refuses them costs no extra student-visible request. */
import test from "node:test";
import assert from "node:assert/strict";
import * as R from "../src/lib/router.js";
import { runTask, __resetLogprobMemo } from "../src/lib/gemini.js";
import { assessSolve } from "../src/lib/solvecheck.js";

const enc = new TextEncoder();
const tok = (s, p) => ({ token: s, logProbability: Math.log(p) });
const sse = (obj) => `data: ${JSON.stringify(obj)}\n\n`;
const TEXT = "ANSWER: B\nTYPE: priority\nKEYWORD: FIRST\nCONCEPTS: a; b\nOPTIONS:\nA) ❌ x\nB) ✅ y\nCONFIDENCE: high";
const sent = [];
let refuse = false;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!/streamGenerateContent/.test(u)) return new Response(JSON.stringify({ models: [] }), { status: 200 });
  const body = JSON.parse(init.body);
  sent.push(body.generationConfig);
  if (refuse && body.generationConfig.responseLogprobs) return new Response(JSON.stringify({ error: { code: 400, message: "Logprobs is not enabled for this model." } }), { status: 400 });
  const chunks = [
    sse({ candidates: [{ content: { parts: [{ text: "ANSWER: B\n" }] }, logprobsResult: { chosenCandidates: [tok("ANSWER", 1), tok(":", 1), tok(" B", 0.97), tok("\n", 1)], topCandidates: [{ candidates: [tok("ANSWER", 1)] }, { candidates: [tok(":", 1)] }, { candidates: [tok(" B", 0.97), tok(" A", 0.02)] }, { candidates: [tok("\n", 1)] }] } }] }),
    sse({ candidates: [{ content: { parts: [{ text: TEXT.slice("ANSWER: B\n".length) }] }, finishReason: "STOP" }] }),
  ];
  return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } }), { status: 200 });
};
const args = (task) => ({ apiKey: "AIzaLPTEST0000001", task, system: "s", parts: [{ text: "q" }], spec: { levels: ["low"], budget: 0 }, maxOut: 2000, firstMs: 3000, idleMs: 3000, models: ["gemini-3.8-flash"] });
const fresh = () => { sent.length = 0; refuse = false; R.__resetRouter(); window.localStorage.clear(); };
import * as Q from "../src/lib/quota.js";
/* evidence of a BIG quota (more requests accepted by one Flash model than the free tier allows) → the key is no longer "small" */
const makeBig = (key, model) => { for (let i = 0; i < 30; i++) Q.noteSend(key, model); assert.equal(Q.isSmallKey(key), false); };

test("solve asks for logprobs, they come back through the stream, and feed the assessment", async () => {
  fresh(); makeBig("AIzaLPTEST0000001", "gemini-3.8-flash");
  const r = await runTask(args("solve:deep"));
  assert.equal(sent.length, 1, "one request");
  assert.equal(sent[0].responseLogprobs, true); assert.equal(sent[0].logprobs, 5);
  assert.ok(r.logprobs && r.logprobs.chosenCandidates.length === 4);
  const a = assessSolve({ raw: r.text, logprobs: r.logprobs, profile: { discipline: "general", exam: "" } });
  assert.equal(a.hasLogprobs, true); assert.ok(a.p1 > 0.9);
});

test("other tasks never ask for logprobs", async () => {
  fresh();
  await runTask(args("lessonM:fast"));
  assert.equal(sent[0].responseLogprobs, undefined);
});

test("a model that refuses logprobs: the same request repeats without them once, and it is never asked again", async () => {
  fresh(); refuse = true; makeBig("AIzaLPTEST0000001", "gemini-3.8-flash");
  const r = await runTask(args("solve:deep"));
  assert.equal(sent.length, 2); assert.equal(sent[1].responseLogprobs, undefined);
  assert.ok(r.text.includes("ANSWER: B"));
  sent.length = 0;
  await runTask(args("solve:deep"));
  assert.equal(sent.length, 1); assert.equal(sent[0].responseLogprobs, undefined, "remembered");
  __resetLogprobMemo("gemini-3.8-flash");
});

test("a small free key never probes for logprobs on an unknown model", async () => {
  fresh();
  assert.equal(Q.isSmallKey("AIzaLPTEST0000001"), true);
  await runTask(args("solve:deep"));
  assert.equal(sent[0].responseLogprobs, undefined);
});
