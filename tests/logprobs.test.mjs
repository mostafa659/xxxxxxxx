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
let refuse = false, omit = false, delayMs = 0;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!/streamGenerateContent/.test(u)) return new Response(JSON.stringify({ models: [] }), { status: 200 });
  const body = JSON.parse(init.body);
  sent.push(body.generationConfig);
  if (refuse && body.generationConfig.responseLogprobs) return new Response(JSON.stringify({ error: { code: 400, message: "Logprobs is not enabled for this model." } }), { status: 400 });
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  /* logprobsResult only comes back when it was asked for; omit: Google answers 200 with the full reply and silently leaves it out anyway */
  const LPR = { chosenCandidates: [tok("ANSWER", 1), tok(":", 1), tok(" B", 0.97), tok("\n", 1)], topCandidates: [{ candidates: [tok("ANSWER", 1)] }, { candidates: [tok(":", 1)] }, { candidates: [tok(" B", 0.97), tok(" A", 0.02)] }, { candidates: [tok("\n", 1)] }] };
  const chunks = [
    sse({ candidates: [{ content: { parts: [{ text: "ANSWER: B\n" }] }, ...(omit || !body.generationConfig.responseLogprobs ? {} : { logprobsResult: LPR }) }] }),
    sse({ candidates: [{ content: { parts: [{ text: TEXT.slice("ANSWER: B\n".length) }] }, finishReason: "STOP" }] }),
  ];
  return new Response(new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } }), { status: 200 });
};
const args = (task) => ({ apiKey: "AIzaLPTEST0000001", task, system: "s", parts: [{ text: "q" }], spec: { levels: ["low"], budget: 0 }, maxOut: 2000, firstMs: 3000, idleMs: 3000, models: ["gemini-3.8-flash"] });
const fresh = () => { sent.length = 0; refuse = false; omit = false; delayMs = 0; R.__resetRouter(); window.localStorage.clear(); __resetLogprobMemo(MODEL); };
const MODEL = "gemini-3.8-flash";
const lpMemoOf = (m = MODEL) => window.localStorage.getItem(`clinix:lp:${m}`);
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

/* ── audit fix #2: ONE probe per model, small free keys included; every outcome is cached; nothing is invented ── */

test("SUPPORTED: a small free key probes once on the solve request itself (no extra request), caches it, and keeps getting logprobs", async () => {
  fresh();
  assert.equal(Q.isSmallKey("AIzaLPTEST0000001"), true);
  const r = await runTask(args("solve:deep"));
  assert.equal(sent.length, 1, "the probe IS the solve request: no extra request");
  assert.equal(sent[0].responseLogprobs, true);
  assert.ok(r.logprobs && r.logprobs.chosenCandidates.length === 4);
  assert.equal(lpMemoOf(), "1");
  sent.length = 0;
  await runTask(args("solve:deep"));
  assert.equal(sent.length, 1); assert.equal(sent[0].responseLogprobs, true, "known to work: still asked for");
});

test("UNSUPPORTED (HTTP 400): a small free key probes once, the same request repeats without logprobs, and the model is never probed again", async () => {
  fresh(); refuse = true;
  assert.equal(Q.isSmallKey("AIzaLPTEST0000001"), true);
  const r = await runTask(args("solve:deep"));
  assert.equal(sent.length, 2, "probe + the one repeat");
  assert.equal(sent[0].responseLogprobs, true); assert.equal(sent[1].responseLogprobs, undefined);
  assert.ok(r.text.includes("ANSWER: B")); assert.equal(r.logprobs, null);
  assert.equal(lpMemoOf(), "0");
  for (let i = 0; i < 3; i++) {
    sent.length = 0;
    await runTask(args("solve:deep"));
    assert.equal(sent.length, 1, "no repeated probe, no extra request"); assert.equal(sent[0].responseLogprobs, undefined);
  }
});

test("SILENTLY OMITTED: a 200 reply without logprobsResult is cached as unsupported after ONE probe, on a small and on a big key", async () => {
  for (const big of [false, true]) {
    fresh(); omit = true;
    if (big) makeBig("AIzaLPTEST0000001", MODEL);
    const r = await runTask(args("solve:deep"));
    assert.equal(sent.length, 1, "silent omission costs no extra request");
    assert.equal(sent[0].responseLogprobs, true, "the first request was the probe");
    assert.ok(r.text.includes("ANSWER: B")); assert.equal(r.logprobs, null);
    assert.equal(lpMemoOf(), "0", `cached as unsupported (big=${big})`);
    sent.length = 0;
    await runTask(args("solve:deep")); await runTask(args("solve:deep"));
    assert.equal(sent.length, 2);
    assert.ok(sent.every((g) => g.responseLogprobs === undefined && g.logprobs === undefined), "never asked again");
  }
});

test("nothing is fabricated when logprobs are unavailable: no probabilities, capped at MEDIUM, the reason says so", async () => {
  fresh(); omit = true;
  const r = await runTask(args("solve:deep"));
  const a = assessSolve({ raw: r.text, logprobs: r.logprobs, profile: { discipline: "general", exam: "" } });
  assert.equal(a.hasLogprobs, false);
  assert.equal(a.p1, null); assert.equal(a.margin, null); assert.equal(a.runnerUp, null);
  assert.notEqual(a.tier, "HIGH");
  assert.ok(a.reasons.some((x) => /probabilit/i.test(x)));
  assert.deepEqual(a.perOption, [], "no per-option probabilities invented");
});

test("concurrent solves of one unknown model: only ONE carries the probe; the others go without logprobs", async () => {
  fresh(); delayMs = 40;
  await Promise.all([runTask(args("solve:deep")), runTask(args("solve:deep")), runTask(args("solve:deep"))]);
  assert.equal(sent.length, 3);
  assert.equal(sent.filter((g) => g.responseLogprobs === true).length, 1, "a single probe");
  assert.equal(lpMemoOf(), "1");
  delayMs = 0; sent.length = 0;
  await runTask(args("solve:deep"));
  assert.equal(sent[0].responseLogprobs, true, "once learned, later requests ask normally");
});

test("a failed probe that learned nothing is not cached; a later request probes again", async () => {
  fresh();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (/streamGenerateContent/.test(String(url))) sent.push(JSON.parse(init.body).generationConfig);
    return new Response(JSON.stringify({ error: { code: 400, message: "Request contains an invalid argument." } }), { status: 400 });   // a 400 that does NOT name logprobs
  };
  await runTask(args("solve:deep")).catch(() => {});
  globalThis.fetch = realFetch;
  assert.equal(lpMemoOf(), null, "nothing learned, nothing cached");
  sent.length = 0;
  await runTask(args("solve:deep"));
  assert.equal(sent[0].responseLogprobs, true, "probed again");
  assert.equal(lpMemoOf(), "1");
});

test("a model already known to support logprobs is not flipped to unsupported by one reply that happens to lack them", async () => {
  fresh(); window.localStorage.setItem(`clinix:lp:${MODEL}`, "1"); omit = true;
  await runTask(args("solve:deep"));
  assert.equal(lpMemoOf(), "1");
});

test("when localStorage throws, the verdict is still cached for the session (no probe on every request)", async () => {
  fresh(); omit = true;
  const ls = window.localStorage, orig = { get: ls.getItem, set: ls.setItem };
  ls.getItem = () => { throw new Error("blocked"); }; ls.setItem = () => { throw new Error("blocked"); };
  try {
    await runTask(args("solve:deep"));
    sent.length = 0;
    await runTask(args("solve:deep"));
    assert.equal(sent[0].responseLogprobs, undefined, "remembered in memory");
  } finally { ls.getItem = orig.get; ls.setItem = orig.set; __resetLogprobMemo(MODEL); }
});
