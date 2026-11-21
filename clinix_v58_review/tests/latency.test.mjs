import test from "node:test";
import assert from "node:assert/strict";
import { breakdown, summarize, describe, dominant, tally, stageOf } from "../src/lib/latency.js";

/* a trace the way gemini.js records it (times are plain numbers: the maths does not care about the clock) */
const att = (o) => ({ lane: "gemini-3.8-flash", t0: 0, aliveAt: 0, textAt: 0, endAt: 0, outcome: "ok", ...o });

test("the four pieces add up to the total: lost + wait + think + write", () => {
  const t = { task: "lessonA:balanced", t0: 0, endAt: 100000, slept: 9000, hedges: 1, attempts: [
    att({ outcome: "fail", status: 503, t0: 0, endAt: 30000 }),
    att({ outcome: "fail", why: "timeout", t0: 39000, endAt: 79000 }),
    att({ t0: 79000, aliveAt: 85000, textAt: 90000, endAt: 100000, tier: "standard", usage: { candidatesTokenCount: 2000, promptTokenCount: 5000 } }),
  ] };
  const b = breakdown(t);
  assert.equal(b.totalMs, 100000);
  assert.equal(b.lostMs, 79000);               // everything before the winning lane even started
  assert.equal(b.waitMs, 6000);                // winner started → first sign of life
  assert.equal(b.thinkMs, 5000);               // first sign of life → first word (thought summaries streaming)
  assert.equal(b.writeMs, 10000);
  assert.equal(b.lostMs + b.waitMs + b.thinkMs + b.writeMs, b.totalMs);
  assert.deepEqual(b.failed, ["503", "timeout"]);
  assert.equal(b.tps, 200);                    // 2000 tokens in 10 s
  assert.equal(b.tier, "standard");
  assert.equal(b.ok, true);
});

test("hidden thinking (no thought summaries): Google's thoughtsTokenCount moves an ESTIMATE from 'wait' to 'think', clearly marked", () => {
  const t = { task: "solve:balanced", t0: 0, endAt: 60000, attempts: [
    att({ t0: 0, aliveAt: 40000, textAt: 40000, endAt: 60000, usage: { candidatesTokenCount: 4000, thoughtsTokenCount: 4000 } }),   // writes 200 tok/s → 4000 thought tokens ≈ 20 s
  ] };
  const b = breakdown(t);
  assert.equal(b.thinkEst, true);
  assert.equal(b.thinkMs, 20000);
  assert.equal(b.waitMs, 20000);
  assert.equal(b.waitMs + b.thinkMs + b.writeMs + b.lostMs, b.totalMs);
  assert.match(describe({ ...b, failedAll: [], hedgesAll: 0, unfinished: 0 }), /تفكير ≈20ث/);
});

test("no estimate when the speed is unknown or the thinking was already measured from summaries", () => {
  const noSpeed = breakdown({ t0: 0, endAt: 30000, attempts: [att({ aliveAt: 25000, textAt: 25000, endAt: 30000, usage: { thoughtsTokenCount: 5000 } })] });
  assert.equal(noSpeed.thinkEst, false);
  const measured = breakdown({ t0: 0, endAt: 50000, attempts: [att({ aliveAt: 2000, textAt: 30000, endAt: 50000, usage: { candidatesTokenCount: 4000, thoughtsTokenCount: 3000 } })] });
  assert.equal(measured.thinkEst, false);
  assert.equal(measured.thinkMs, 28000);
});

test("a call that never succeeded: all of its time is 'lost', and it says so", () => {
  const b = breakdown({ task: "solve:balanced", t0: 0, endAt: 240000, hedges: 2, attempts: [att({ outcome: "fail", status: 429, endAt: 3000 }), att({ outcome: "fail", why: "timeout", t0: 3000, endAt: 240000 })] });
  assert.equal(b.ok, false);
  assert.equal(b.lostMs, 240000);
  assert.deepEqual(b.failed, ["429", "timeout"]);
  assert.match(describe({ ...summarize([{ task: "solve:balanced", t0: 0, endAt: 240000, attempts: [att({ outcome: "fail", why: "timeout", endAt: 240000 })] }]) }), /ما خلصش/);
});

test("lanes that lost a hedge race or were cancelled are not counted as failures", () => {
  const b = breakdown({ t0: 0, endAt: 12000, hedges: 1, attempts: [att({ outcome: "lost", endAt: 6000 }), att({ t0: 5000, aliveAt: 6000, textAt: 6500, endAt: 12000 })] });
  assert.deepEqual(b.failed, []);
  assert.equal(b.hedges, 1);
  assert.equal(b.lostMs, 5000);
});

test("summarize: the slowest call decides, but failures anywhere are reported", () => {
  const fast = { task: "lessonM:balanced", t0: 0, endAt: 20000, attempts: [att({ aliveAt: 1000, textAt: 2000, endAt: 20000 })] };
  const slow = { task: "solve:balanced", t0: 0, endAt: 409000, attempts: [att({ outcome: "fail", status: 503, endAt: 20000 }), att({ outcome: "fail", status: 503, t0: 22000, endAt: 60000 }), att({ t0: 400000, aliveAt: 401000, textAt: 402000, endAt: 409000 })] };
  const other = { task: "lessonT:balanced", t0: 0, endAt: 30000, attempts: [att({ outcome: "fail", why: "timeout", endAt: 20000 }), att({ t0: 21000, aliveAt: 22000, textAt: 23000, endAt: 30000 })] };
  const s = summarize([fast, slow, other]);
  assert.equal(s.totalMs, 409000);
  assert.equal(s.task, "solve:balanced");
  assert.equal(s.calls, 3);
  assert.deepEqual([...s.failedAll].sort(), ["503", "503", "timeout"]);
  const text = describe(s);
  assert.match(text, /^409ث = ضاع 400ث في محاولات فاشلة وانتظار \(503×2\)/);
  assert.equal(dominant(s), "retries");
});

test("describe stays short and honest for a healthy run, and is empty for nothing", () => {
  assert.equal(describe(null), "");
  assert.equal(summarize([]), null);
  const healthy = summarize([{ task: "lessonA:balanced", t0: 0, endAt: 14000, attempts: [att({ aliveAt: 1500, textAt: 2500, endAt: 14000, usage: { candidatesTokenCount: 2300 } })] }]);
  const text = describe(healthy);
  assert.match(text, /^14ث = انتظار أول رد 1.5ث \+ تفكير 1ث \+ كتابة 11.5ث \(2.3k توكن · 200\/ث\)$/);
  assert.ok(!/ضاع/.test(text), "a healthy run must not claim lost time");
  assert.equal(dominant(healthy), "writing");
});

test("dominant: names the biggest cause only when it is at least 40 % of the time", () => {
  assert.equal(dominant({ totalMs: 3000, lostMs: 3000 }), "none");                                     // too short to matter
  assert.equal(dominant({ totalMs: 60000, lostMs: 5000, waitMs: 40000, thinkMs: 10000, writeMs: 5000 }), "queue");
  assert.equal(dominant({ totalMs: 60000, lostMs: 15000, waitMs: 15000, thinkMs: 15000, writeMs: 15000 }), "none");
  assert.equal(dominant({ totalMs: 80000, lostMs: 0, waitMs: 2000, thinkMs: 60000, writeMs: 18000 }), "thinking");
});

test("tally groups repeats and stageOf maps every task id of the analysis to its stage", () => {
  assert.equal(tally(["503", "timeout", "503", "503"]), "503×3 · timeout");
  for (const [task, stage] of [["ocr", "ocr"], ["words", "words"], ["solve:balanced", "reason"], ["lessonA:balanced", "reason"], ["lessonM:deep", "reason"], ["lessonBx:balanced", "reason"], ["lessonS:balanced", "reason"], ["lesson:chat", "other"], ["lesson:diagram", "other"]]) {
    assert.equal(stageOf(task), stage, task);
  }
});

test("FREE profile (the default build) keeps its patient timings and talks to Google directly: nothing changes unless a gateway / VITE_PAID is configured", async () => {
  const C = await import("../src/lib/config.js");
  assert.equal(C.PAID, false);
  assert.equal(C.GATEWAY_URL, "");
  assert.equal(C.API_BASE_URL, "https://generativelanguage.googleapis.com/v1beta/models");
  assert.equal(C.API_ORIGIN, "https://generativelanguage.googleapis.com");
  assert.equal(C.SERVICE_TIER, "");
  assert.equal(C.cap(240000, "first"), 240000);                       // a 4-minute first-byte allowance for a deep Pro lesson is untouched
  assert.equal(C.cap(150000, "idle"), 150000);
  assert.equal(C.NET.hedge, 1);
  assert.equal(C.NET.maxWait, 40000);
  assert.equal(C.NET.maxHint, 25000);
  assert.equal(C.NET.imageMs, 170000);
  assert.equal(C.NET.imageTimeouts, 3);
});
