/* The engine on a FREE key (v3.33): what it does when Google says "quota", measured on a fake Google that answers with the real shape of those errors. */
import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import * as Q from "../src/lib/quota.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { runTask } from "../src/lib/gemini.js";
import { createAnalysis } from "../src/lib/analysis.js";

installFetch();
let KEY = "AIzaFREE000", seq = 0;
const G = (m) => `gemini:${m}`;
const base = (over = {}) => ({ apiKey: KEY, task: "lesson:chat", system: "sys", parts: [{ text: "hi" }], spec: { levels: ["low"], budget: 0 }, maxOut: 2000, firstMs: 3000, idleMs: 3000, ...over });
const fresh = () => {
  KEY = `AIzaFREE${String(++seq).padStart(6, "0")}`;
  reset(); R.__resetRouter(); window.localStorage.clear(); Q.__resetQuota(); Q.__setClock(null);
  setExtKeys({}); setEnginePrefs({ mode: "auto" });
  R.HEDGE_MS.chat = { min: 120, max: 250 }; R.HEDGE_MS.write = { min: 120, max: 250 }; R.HEDGE_MS.quick = { min: 120, max: 250 };
};
const used = () => log.filter((l) => l.lane !== "list").map((l) => l.lane);
const count = (lane) => used().filter((l) => l === lane).length;

/* real-shaped Google errors */
const MSG = (limit, model) => `You exceeded your current quota, please check your plan and billing details.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ${limit}, model: ${model}\nPlease retry in 20.22s.`;
const quotaErr = (quotaId, limit, model, retry = "20s") => ({
  status: 429, msg: MSG(limit, model),
  details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaMetric: "generativelanguage.googleapis.com/generate_content_free_tier_requests", quotaId, quotaDimensions: { location: "global", model }, quotaValue: String(limit) }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: retry }],
});
const DAILY = (model, limit = 20) => quotaErr("GenerateRequestsPerDayPerProjectPerModel-FreeTier", limit, model);
const MINUTE = (model, limit = 5) => quotaErr("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", limit, model, "41s");

const FLASH = "gemini-3.8-flash", LITE = "gemini-3.5-flash-lite", FLASH2 = "gemini-3.6-flash";

test("DAILY quota finished: the model is set aside until the reset, the request is answered by the next model at once, and the finished model is never called again (not even after a restart that forgets the dead list)", async () => {
  fresh();
  script(G(FLASH), DAILY(FLASH));
  script(G(LITE), { ok: "lite answer" });
  const r1 = await runTask(base({ models: [FLASH, LITE] }));
  assert.equal(r1.text, "lite answer");
  assert.deepEqual(used(), [G(FLASH), G(LITE)]);
  assert.equal(Q.finishedToday(KEY, FLASH), true);
  /* the router put it away for the long haul, not for the "20 s" Google claimed */
  assert.ok(R.laneState(G(FLASH)).deadUntil - Date.now() > 5 * 60e3, "set aside for hours, not seconds");
  assert.equal(R.isCooling(G(FLASH)), false, "it is dead, not 'cooling for 20 s'");

  /* a restart + a model-list refresh forget the router and the app's dead list; the quota ledger remembers (it is what keeps the day's quota story) */
  const ledger = window.localStorage.getItem("clinix:quota:v1");
  window.localStorage.clear(); window.localStorage.setItem("clinix:quota:v1", ledger);
  R.__resetRouter(); log.length = 0;
  const r2 = await runTask(base({ models: [FLASH, LITE] }));
  assert.equal(r2.text, "lite answer");
  assert.equal(count(G(FLASH)), 0, "zero wasted attempts on the finished model");
  assert.equal(count(G(LITE)), 1);
});

test("the daily message that says 'retry in 20s' is NOT taken as 'busy for 20 s': three requests in a row cost one failed attempt in total, not three", async () => {
  fresh();
  script(G(FLASH), DAILY(FLASH));
  script(G(LITE), { ok: "ok" });
  for (let i = 0; i < 3; i++) await runTask(base({ models: [FLASH, LITE] }));
  assert.equal(count(G(FLASH)), 1);
  assert.equal(count(G(LITE)), 3);
});

test("a name that is the same quota is finished too: Google names gemini-3.8-flash while the app called gemini-flash-latest", async () => {
  fresh();
  script(G("gemini-flash-latest"), DAILY(FLASH));
  script(G(FLASH), { ok: "must not be called" });
  script(G(LITE), { ok: "lite" });
  const r = await runTask(base({ models: ["gemini-flash-latest", FLASH, LITE] }));
  assert.equal(r.text, "lite");
  assert.equal(count(G(FLASH)), 0, "the alias's quota is the same quota: calling the other name would only fail again");
  assert.equal(Q.finishedToday(KEY, FLASH), true);
});

test("a model with no quota at all on this key (limit 0, e.g. Pro) is set aside and silently skipped afterwards", async () => {
  fresh();
  script(G("gemini-3.1-pro-preview"), { status: 429, msg: MSG(0, "gemini-3.1-pro-preview").replace("20.22s", "10h17m5.7s"), details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaDimensions: { model: "gemini-3.1-pro-preview" }, quotaValue: "0" }] }, { retryDelay: "37025s" }] });
  script(G(FLASH), { ok: "flash" });
  const r = await runTask(base({ models: ["gemini-3.1-pro-preview", FLASH] }));
  assert.equal(r.text, "flash");
  log.length = 0;
  await runTask(base({ models: ["gemini-3.1-pro-preview", FLASH] }));
  assert.equal(count(G("gemini-3.1-pro-preview")), 0);
});

test("PER-MINUTE wall: Google's own wait is honoured, the limit is learned, and from then on the model is not called while its minute is full", async () => {
  fresh();
  script(G(FLASH), MINUTE(FLASH, 5), { ok: "flash ok" });
  script(G(FLASH2), { ok: "second flash" });
  const r1 = await runTask(base({ models: [FLASH, FLASH2] }));
  assert.equal(r1.text, "second flash");                           // the 429 was answered by the other model at once
  assert.ok(R.coolLeft(G(FLASH)) > 30000, "Google said 41 s: the model sleeps for that, not for a guess");
  assert.equal(Q.pressure(KEY), true, "a limit of 5 a minute = a small key");

  /* the minute is full again (5 requests just went to it) although the router forgot: the ledger keeps it out of the wall */
  R.__resetRouter(); log.length = 0;
  for (let i = 0; i < 5; i++) Q.noteSend(KEY, FLASH);
  assert.ok(Q.paceMs(KEY, FLASH) > 0);
  const r2 = await runTask(base({ models: [FLASH, FLASH2] }));
  assert.equal(r2.text, "second flash");
  assert.equal(count(G(FLASH)), 0, "no request was sent into a wall it knows");
});

test("a request Google turned away (429) does not eat the minute: after a rejected try the model still has its free slots", async () => {
  fresh();
  script(G(FLASH), MINUTE(FLASH, 2), { ok: "a" }, { ok: "b" });
  script(G(FLASH2), { ok: "other" });
  await runTask(base({ models: [FLASH, FLASH2] }));                  // FLASH answers 429 (learns limit 2) → FLASH2 answers
  R.__resetRouter();
  assert.equal(Q.paceMs(KEY, FLASH), 0, "the rejected request was refunded: 0 of 2 used");
});

test("between equal models the one with more daily quota left goes first (the day's quota is used evenly)", async () => {
  fresh();
  /* both Flash models learned (limit 20) on a previous day; today FLASH has 15 sent and FLASH2 has 2 */
  Q.noteQuotaError(KEY, FLASH, Q.parseQuota({ details: DAILY(FLASH).details }, ""));
  Q.noteQuotaError(KEY, FLASH2, Q.parseQuota({ details: DAILY(FLASH2).details }, ""));
  const tomorrow = Date.now() + 36 * 3600e3;
  Q.__setClock(() => tomorrow);
  for (let i = 0; i < 15; i++) Q.noteSend(KEY, FLASH);
  for (let i = 0; i < 2; i++) Q.noteSend(KEY, FLASH2);
  script(G(FLASH), { ok: "from FLASH" });
  script(G(FLASH2), { ok: "from FLASH2" });
  const r = await runTask(base({ models: [FLASH, FLASH2] }));
  assert.equal(r.text, "from FLASH2", "FLASH has 5 left, FLASH2 has 18");
});

test("QUESTION ANALYSIS: 5 requests on a small (free) key, 6 on a key that has proven to be big; the verified brief reaches every writer in both", async () => {
  const BRIEF = "ANSWER: B\nKEY: BRIEFMARK-7731 the verified reasoning";             // what the silent solve returns: cleanBrief accepts it, so the verified path runs
  const run = async () => {
    script(G("gemini-flash-latest"), { ok: BRIEF });
    const done = {};
    await new Promise((resolve) => {
      const a = createAnalysis({
        kind: "question", history: [], dataUrl: "data:image/png;base64,iVBORw0KGgo=", doc: null, extra: "", chips: [], apiKey: KEY, modeId: "balanced",
        onUpdate() {}, onDone: (name, m) => { done[name] = m; if (done.ocr && done.words && done.reason) resolve(a); }, onError: (n, e) => { done.err = [n, e && e.message]; resolve(a); }, onNotice() {},
      });
      a.start();
    });
    assert.equal(done.err, undefined);
    const withBrief = log.filter((l) => l.lane !== "list" && JSON.stringify(l.body).includes("BRIEFMARK-7731")).length;
    return { total: used().length, withBrief };
  };
  fresh();
  const small = await run();
  assert.deepEqual(small, { total: 5, withBrief: 1 }, "a key nothing is known about is treated as a free key: main + traps are ONE request, the verified brief is in it");

  fresh();
  /* evidence of a big quota (a learned per-minute limit of a paid size) → the fully parallel design of old: 6 requests, brief in both writers */
  Q.noteQuotaError(KEY, "gemini-flash-latest", Q.parseQuota({ details: quotaErr("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", 1000, "gemini-flash-latest", "5s").details }, ""));
  assert.equal(Q.isSmallKey(KEY), false);
  const big = await run();
  assert.deepEqual(big, { total: 6, withBrief: 2 }, "big key: ocr · words · solve · A · B-main · B-traps, exactly as before");
});

test("QUESTION ANALYSIS: when the strong models are nearly spent today, the word list goes to Flash-Lite and the strong model is kept for the rest", async () => {
  fresh();
  /* flash-latest: limit 20 learned on an earlier day; 10 requests already sent today → 10 left (≤ 12) = scarce */
  Q.noteQuotaError(KEY, "gemini-flash-latest", Q.parseQuota({ details: DAILY("gemini-flash-latest").details }, ""));
  const nextDay = Date.now() + 36 * 3600e3;
  Q.__setClock(() => nextDay);
  for (let i = 0; i < 10; i++) Q.noteSend(KEY, "gemini-flash-latest");
  assert.equal(Q.isScarce(KEY, ["gemini-flash-latest", "gemini-flash-lite-latest"]), true);
  await new Promise((resolve) => {
    const done = {};
    const a = createAnalysis({
      kind: "question", history: [], dataUrl: "data:image/png;base64,iVBORw0KGgo=", doc: null, extra: "", chips: [], apiKey: KEY, modeId: "balanced",
      onUpdate() {}, onDone: (name) => { done[name] = true; if (done.ocr && done.words && done.reason) resolve(a); }, onError: () => resolve(a), onNotice() {},
    });
    a.start();
  });
  const lanes = used();
  /* v3.35: the question text and the word list are EASY jobs: Flash-Lite first, always (not only when the quota is scarce) */
  assert.equal(lanes.filter((l) => l === G("gemini-flash-lite-latest")).length, 2, "the question text and the word list went to Flash-Lite");
  assert.ok(lanes.filter((l) => l === G("gemini-flash-latest")).length >= 2, "solve + the lesson parts stayed on the stronger model");
});

test("EVERY model has finished its daily quota: the student gets the true answer at once (no 40 s of waiting), and the next request does not even try", async () => {
  fresh();
  script(G(FLASH), DAILY(FLASH));
  script(G(LITE), DAILY(LITE, 500));
  const t0 = Date.now();
  await assert.rejects(runTask(base({ models: [FLASH, LITE] })), (e) => {
    assert.match(e.message, /الحصة اليومية المجانية على مفتاحك خلصت/, "the message says what is true: the daily quota is finished");
    assert.ok(!/استنى دقيقة/.test(e.message), "not the generic 'busy, wait a minute'");
    return true;
  });
  assert.ok(Date.now() - t0 < 3000, `answered in ${Date.now() - t0} ms (it used to cool, wait and retry for up to 40 s)`);
  assert.ok(Q.quotaNote(KEY).includes("خلصت"), "and the screen can say which models finished and when they come back");
  log.length = 0;
  const t1 = Date.now();
  await assert.rejects(runTask(base({ models: [FLASH, LITE] })));
  assert.ok(Date.now() - t1 < 3000);
  assert.equal(used().length, 0, "nothing was sent to a model that is known to be finished");
});

test("ADAPTIVE HEDGE: once this key's typical answer time is known, a request that has plainly stalled is given up on after 3x that, not after a fixed 10-30 s", async () => {
  fresh();
  R.HEDGE_MS.write = { min: 5000, max: 20000 };               // the fixed numbers of old: a stalled request would be waited on for at least 5 s
  try {
    R.HEDGE_FLOOR_MS.v = 100;
    for (let i = 0; i < 5; i++) { Q.noteTtft(KEY, FLASH, 40, "write"); Q.noteTtft(KEY, FLASH2, 40, "write"); }      // this key answers 'write' jobs in ~40 ms (the fake is instant)
    script(G(FLASH), { wait: 4000, ok: "stalled" });
    script(G(FLASH2), { ok: "fast second" });
    const t0 = Date.now();
    const r = await runTask(base({ task: "lessonA:balanced", models: [FLASH, FLASH2] }));
    assert.equal(r.text, "fast second");
    assert.ok(Date.now() - t0 < 1500, `hedged after ~120 ms instead of 5 s (took ${Date.now() - t0} ms)`);
  } finally { R.HEDGE_FLOOR_MS.v = 5000; }
});

test("ADAPTIVE TIMEOUT: a model that has stalled is given up on after 8x this key's typical time (never under the floor), not after the 60-240 s written for a slow day", async () => {
  fresh();
  try {
    R.FIRST_FLOOR_MS.v = 300; R.HEDGE_FLOOR_MS.v = 60000;      // hedging out of the way: only the first-byte timeout can rescue the request
    R.HEDGE_MS.write = { min: 60000, max: 60000 };
    for (let i = 0; i < 5; i++) Q.noteTtft(KEY, FLASH, 20, "write");        // typical 20 ms → silent for 8 x 20 = 160 ms → floor 300 ms
    script(G(FLASH), { wait: 20000, ok: "never arrives in time" });
    script(G(FLASH2), { ok: "second" });
    const t0 = Date.now();
    const r = await runTask(base({ task: "lessonA:balanced", models: [FLASH, FLASH2], firstMs: 60000, idleMs: 60000 }));
    assert.equal(r.text, "second");
    assert.ok(Date.now() - t0 < 3000, `given up on after ~300 ms instead of 60 s (took ${Date.now() - t0} ms)`);
  } finally { R.FIRST_FLOOR_MS.v = 20000; R.HEDGE_FLOOR_MS.v = 5000; }
});

test("ADAPTIVE TIMEOUT: nothing measured yet → the caller's own timeout is used, exactly as before", async () => {
  fresh();
  script(G(FLASH), { wait: 600, ok: "a bit slow but fine" });
  const r = await runTask(base({ task: "lessonA:balanced", models: [FLASH], firstMs: 3000, idleMs: 3000 }));
  assert.equal(r.text, "a bit slow but fine");
});

test("ADAPTIVE HEDGE: without any measurement the old fixed delays are untouched", () => {
  R.__resetRouter();
  R.HEDGE_MS.write = { min: 10000, max: 20000 };                 // the production numbers
  R.HEDGE_FLOOR_MS.v = 5000;
  const h = R.HEDGE_MS.write;
  const a = R.hedgeDelayMs("write", null, 1, 0);
  assert.ok(a >= h.min && a <= h.max);
  assert.equal(R.hedgeDelayMs("write", null, 1, 3000), Math.min(h.max, Math.max(R.HEDGE_FLOOR_MS.v, 9000)));
  assert.equal(R.hedgeDelayMs("write", null, 1, 100), R.HEDGE_FLOOR_MS.v, "never below the floor");
  assert.equal(R.hedgeDelayMs("write", null, 1, 60000), h.max, "never above the class maximum");
});
