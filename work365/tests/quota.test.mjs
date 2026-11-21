import test from "node:test";
import assert from "node:assert/strict";
import * as Q from "../src/lib/quota.js";
import { nextResetMs } from "../src/lib/usage.js";

/* The error bodies below have the shape of REAL answers of the Gemini API free tier (taken from developer reports, 2026). */
const MSG = (limit, model, retry) => `You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://ai.google.dev/gemini-api/docs/rate-limits.\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: ${limit}, model: ${model}\nPlease retry in ${retry}.`;
const violation = (quotaId, value, model, metric = "generativelanguage.googleapis.com/generate_content_free_tier_requests") => ({ quotaMetric: metric, quotaId, quotaDimensions: { location: "global", model }, quotaValue: String(value) });
const body = (limit, model, retry, violations, retryDelay) => ({
  code: 429, status: "RESOURCE_EXHAUSTED", message: MSG(limit, model, retry),
  details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations }, { "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "Learn more", url: "https://ai.google.dev/gemini-api/docs/rate-limits" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }],
});
const DAILY = body(20, "gemini-3.8-flash", "20.22s", [violation("GenerateRequestsPerDayPerProjectPerModel-FreeTier", 20, "gemini-3.8-flash")], "20s");
const MINUTE = body(5, "gemini-3.8-flash", "41.9s", [violation("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", 5, "gemini-3.8-flash")], "41s");
const ZERO = body(0, "gemini-3.1-pro-preview", "10h17m5.723541104s", [violation("GenerateRequestsPerDayPerProjectPerModel-FreeTier", 0, "gemini-3.1-pro-preview")], "37025s");
const TOKENS = body(250000, "gemini-3.6-flash", "12s", [violation("GenerateContentInputTokensPerModelPerMinute-FreeTier", 250000, "gemini-3.6-flash", "generativelanguage.googleapis.com/generate_content_free_tier_input_token_count")], "12s");

let KEY = "AIzaQUOTA0", n = 0, T = 1_800_000_000_000;           // a fixed "now" (any moment works: the maths is relative)
const fresh = () => { KEY = `AIzaQUOTA${++n}`; window.localStorage.clear(); Q.__resetQuota(); Q.__setClock(() => T); };
test.beforeEach(() => { T = 1_800_000_000_000; fresh(); });

test("parseDuration reads every shape Google uses", () => {
  assert.equal(Q.parseDuration("42s"), 42000);
  assert.equal(Q.parseDuration("0.5s"), 500);
  assert.equal(Q.parseDuration("1m30s"), 90000);
  assert.equal(Q.parseDuration("10h17m5.7s"), 10 * 3600e3 + 17 * 60e3 + 5700);
  assert.equal(Q.parseDuration(""), 0);
  assert.equal(Q.parseDuration("soon"), 0);
  assert.equal(Q.parseDuration(null), 0);
});

test("parseQuota: a finished DAILY quota is recognised from quotaId even though the message says nothing about a day and suggests 'retry in 20s'", () => {
  const q = Q.parseQuota(DAILY, DAILY.message);
  assert.equal(q.kind, "day");
  assert.equal(q.limit, 20);
  assert.equal(q.model, "gemini-3.8-flash");
  assert.equal(q.retryMs, 20000);                                         // the misleading hint is still reported (the engine ignores it for kind 'day')
  assert.ok(!/per\s?day|daily/i.test(DAILY.message), "the real message has no 'per day' in it: the old regex could not see this");
});

test("parseQuota: per-minute, token window, and 'no quota at all'", () => {
  const m = Q.parseQuota(MINUTE, MINUTE.message);
  assert.deepEqual([m.kind, m.limit, m.retryMs], ["minute", 5, 41000]);
  const t = Q.parseQuota(TOKENS, TOKENS.message);
  assert.deepEqual([t.kind, t.limit, t.model], ["tokens", 250000, "gemini-3.6-flash"]);
  const z = Q.parseQuota(ZERO, ZERO.message);
  assert.equal(z.kind, "none");                                           // limit 0: this model is not part of the free tier at all
  assert.ok(z.retryMs > 10 * 3600e3);
});

test("parseQuota: several violations at once → the DAILY one wins; without details it falls back to the message like the old code", () => {
  const both = body(20, "gemini-3.8-flash", "9s", [violation("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", 5, "gemini-3.8-flash"), violation("GenerateRequestsPerDayPerProjectPerModel-FreeTier", 20, "gemini-3.8-flash")], "9s");
  assert.equal(Q.parseQuota(both, both.message).kind, "day");
  assert.equal(Q.parseQuota(null, "Quota exceeded for metric: x, limit: 0, model: gemini-3-pro").kind, "none");
  assert.equal(Q.parseQuota(null, "You exceeded your quota (per day). Please retry in 7s").kind, "day");
  assert.equal(Q.parseQuota(null, "Resource has been exhausted").kind, "unknown");
  assert.equal(Q.parseQuota(undefined, undefined).kind, "unknown");
  assert.equal(Q.parseQuota({ details: "not an array" }, "x").kind, "unknown");
});

test("daily 429: the model is finished UNTIL THE RESET (not 20 s), its limit is learned, and the daily counter says 0 left", () => {
  Q.noteSend(KEY, "gemini-3.8-flash");
  const r = Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(DAILY, DAILY.message));
  assert.ok(r.deadMs > 5 * 60e3, "waiting 20 s would be a lie");
  assert.equal(r.deadMs, Math.max(5 * 60e3, nextResetMs(T) - T));
  assert.equal(Q.finishedToday(KEY, "gemini-3.8-flash"), true);
  assert.equal(Q.remaining(KEY, "gemini-3.8-flash"), 0);
  assert.equal(Q.finishedToday(KEY, "gemini-3.6-flash"), false);          // another model has its own quota
  /* after the reset the model is back, with a fresh daily counter and the limit remembered */
  T = nextResetMs(T) + 1000;
  assert.equal(Q.finishedToday(KEY, "gemini-3.8-flash"), false);
  assert.equal(Q.remaining(KEY, "gemini-3.8-flash"), 20);
});

test("per-minute 429: Google's retry hint is honoured and the limit is learned; pacing then keeps the model out of the wall", () => {
  const r = Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(MINUTE, MINUTE.message));
  assert.equal(r.coolMs, 41000);
  assert.equal(r.deadMs, 0);
  assert.equal(Q.finishedToday(KEY, "gemini-3.8-flash"), false);
  assert.equal(Q.paceMs(KEY, "gemini-3.8-flash"), 0);                     // nothing sent yet
  for (let i = 0; i < 4; i++) { Q.noteSend(KEY, "gemini-3.8-flash"); T += 1000; }
  assert.equal(Q.paceMs(KEY, "gemini-3.8-flash"), 0, "4 of 5: one slot is free");
  Q.noteSend(KEY, "gemini-3.8-flash");                                      // the 5th, 4 s after the first
  const wait = Q.paceMs(KEY, "gemini-3.8-flash");
  assert.ok(wait > 55000 && wait < 57000, `the first request leaves the window ~56 s from now, got ${wait}`);
  T += wait;
  assert.equal(Q.paceMs(KEY, "gemini-3.8-flash"), 0, "slot free again");
});

test("a request Google rejected without doing the work is refunded (not counted per minute or per day)", () => {
  Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(MINUTE, MINUTE.message));
  Q.noteQuotaError(KEY, "gemini-3.6-flash", Q.parseQuota({ ...DAILY, details: [{ violations: [violation("GenerateRequestsPerDayPerProjectPerModel-FreeTier", 20, "gemini-3.6-flash")] }] }, DAILY.message));
  const stamps = [];
  for (let i = 0; i < 5; i++) { stamps.push(Q.noteSend(KEY, "gemini-3.8-flash")); T += 10; }
  assert.ok(Q.paceMs(KEY, "gemini-3.8-flash") > 0);
  Q.refundSend(KEY, "gemini-3.8-flash", stamps[4]);
  assert.equal(Q.paceMs(KEY, "gemini-3.8-flash"), 0, "the refunded request frees its slot");
});

test("two names, one quota: a 429 that names gemini-3.8-flash while we called gemini-flash-latest finishes BOTH", () => {
  const r = Q.noteQuotaError(KEY, "gemini-flash-latest", Q.parseQuota(DAILY, DAILY.message));
  assert.ok(r.deadMs > 0);
  assert.equal(Q.finishedToday(KEY, "gemini-flash-latest"), true);
  assert.equal(Q.finishedToday(KEY, "gemini-3.8-flash"), true);
  assert.deepEqual(Q.sameAs(KEY, "gemini-flash-latest").sort(), ["gemini-3.8-flash", "gemini-flash-latest"]);
  assert.equal(Q.finishedToday(KEY, "gemini-3.6-flash"), false);
});

test("a model with NO quota on this key (Pro on a free key) is finished, is not announced as 'quota finished today', and does not count as pressure", () => {
  Q.noteQuotaError(KEY, "gemini-3.1-pro-preview", Q.parseQuota(ZERO, ZERO.message));
  assert.equal(Q.finishedToday(KEY, "gemini-3.1-pro-preview"), true);
  assert.equal(Q.quotaNote(KEY), "");
  assert.equal(Q.pressure(KEY), false);
});

test("pressure: false for an unknown key, true once a free-tier-sized limit has been learned (daily or per-minute), false for a big limit", () => {
  assert.equal(Q.pressure(KEY), false);
  Q.noteQuotaError(KEY, "gemini-3.6-flash", Q.parseQuota(MINUTE, MINUTE.message));
  assert.equal(Q.pressure(KEY), true);
  fresh();
  Q.noteQuotaError(KEY, "gemini-3.6-flash", Q.parseQuota(body(1000, "gemini-3.6-flash", "5s", [violation("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", 1000, "gemini-3.6-flash")], "5s"), ""));
  assert.equal(Q.pressure(KEY), false, "a paid-size limit is not pressure");
  fresh();
  Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(DAILY, DAILY.message));
  assert.equal(Q.pressure(KEY), true);
});

test("a learned per-minute limit is forgotten after 12 h without a new 429 (the student may have upgraded)", () => {
  Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(MINUTE, MINUTE.message));
  for (let i = 0; i < 5; i++) Q.noteSend(KEY, "gemini-3.8-flash");
  assert.ok(Q.paceMs(KEY, "gemini-3.8-flash") > 0);
  T += 13 * 3600e3;
  for (let i = 0; i < 5; i++) Q.noteSend(KEY, "gemini-3.8-flash");
  assert.equal(Q.paceMs(KEY, "gemini-3.8-flash"), 0);
  assert.equal(Q.pressure(KEY), false);
});

test("isScarce / orderForTask: when the Flash models are nearly spent the word list moves to Flash-Lite; every other job keeps its order", () => {
  const models = ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
  assert.equal(Q.isScarce(KEY, models), false, "nothing known yet: assume plenty");
  Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(DAILY, DAILY.message));            // 3.8 finished; its alias with it
  assert.equal(Q.isScarce(KEY, models), false, "3.6 is still unknown: assume plenty");
  Q.noteQuotaError(KEY, "gemini-3.6-flash", Q.parseQuota(body(20, "gemini-3.6-flash", "5s", [violation("GenerateRequestsPerDayPerProjectPerModel-FreeTier", 20, "gemini-3.6-flash")], "5s"), ""));
  fresh();
  /* both Flash models known (limit 20), 3.8 has 8 left, 3.6 has 2 left = 10 ≤ 12 → scarce */
  for (const m of ["gemini-3.8-flash", "gemini-3.6-flash"]) Q.noteQuotaError(KEY, m, Q.parseQuota(body(20, m, "5s", [violation("GenerateRequestsPerDayPerProjectPerModel-FreeTier", 20, m)], "5s"), ""));
  T = nextResetMs(T) + 1000;                                                                  // a new day: both back with their limit, nothing used
  for (let i = 0; i < 12; i++) Q.noteSend(KEY, "gemini-3.8-flash");
  for (let i = 0; i < 18; i++) Q.noteSend(KEY, "gemini-3.6-flash");
  assert.equal(Q.remaining(KEY, "gemini-3.8-flash"), 8);
  assert.equal(Q.remaining(KEY, "gemini-3.6-flash"), 2);
  assert.equal(Q.isScarce(KEY, models), true);
  assert.deepEqual(Q.orderForTask(KEY, "words", models), ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-flash-latest", "gemini-3.8-flash", "gemini-3.6-flash"]);
  for (const task of ["ocr", "solve:balanced", "lessonA:balanced", "lesson:chat", "exam:part"]) assert.deepEqual(Q.orderForTask(KEY, task, models), models, task);
  assert.deepEqual(Q.orderForTask(KEY, "words", ["gemini-3.8-flash"]), ["gemini-3.8-flash"], "no Lite model to move to: unchanged");
});

test("budgetBias: no nudge while plenty is left or unknown; the nearer to empty, the later the model is chosen among equals", () => {
  assert.equal(Q.budgetBias(KEY, "gemini-3.8-flash"), 0);
  Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(DAILY, DAILY.message));
  T = nextResetMs(T) + 1000;
  assert.equal(Q.budgetBias(KEY, "gemini-3.8-flash"), 0);                                    // 20 left
  for (let i = 0; i < 14; i++) Q.noteSend(KEY, "gemini-3.8-flash");                          // 6 left
  const b6 = Q.budgetBias(KEY, "gemini-3.8-flash");
  for (let i = 0; i < 4; i++) Q.noteSend(KEY, "gemini-3.8-flash");                           // 2 left
  const b2 = Q.budgetBias(KEY, "gemini-3.8-flash");
  assert.ok(b6 > 0 && b2 > b6 && b2 <= 18);
});

test("quotaNote: one honest sentence when something finished today, empty otherwise; the 'latest' alias is not listed twice", () => {
  assert.equal(Q.quotaNote(KEY), "");
  Q.noteQuotaError(KEY, "gemini-flash-latest", Q.parseQuota(DAILY, DAILY.message));
  const note = Q.quotaNote(KEY);
  assert.match(note, /الحصة اليومية المجانية خلصت على: 3\.8-flash/);
  assert.ok(!/latest/.test(note));
  assert.match(note, /بتتجدد/);
});

test("the ledger survives an app restart and belongs to ONE key: a different key starts clean", () => {
  Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(DAILY, DAILY.message));
  assert.equal(Q.finishedToday(KEY, "gemini-3.8-flash"), true);
  const saved = window.localStorage.getItem("clinix:quota:v1");
  Q.__resetQuota();                                                      // "restart": memory gone…
  window.localStorage.setItem("clinix:quota:v1", saved);                 // …storage stays
  assert.equal(Q.finishedToday(KEY, "gemini-3.8-flash"), true);
  assert.equal(Q.finishedToday("AIzaANOTHERKEY", "gemini-3.8-flash"), false);
});

test("storage that is cleared behind our back is noticed (no stale memory)", () => {
  Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(DAILY, DAILY.message));
  assert.equal(Q.finishedToday(KEY, "gemini-3.8-flash"), true);
  window.localStorage.clear();
  assert.equal(Q.finishedToday(KEY, "gemini-3.8-flash"), false);
});

test("isSmallKey: every key is small until there is evidence of a big quota (a paid-size limit, or more Flash requests in a day than the free tier ever allows)", () => {
  assert.equal(Q.isSmallKey(KEY), true, "nothing known = a free key");
  Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(MINUTE, MINUTE.message));
  assert.equal(Q.isSmallKey(KEY), true, "a limit of 5 a minute is a small key");
  fresh();
  Q.noteQuotaError(KEY, "gemini-3.8-flash", Q.parseQuota(body(1000, "gemini-3.8-flash", "5s", [violation("GenerateRequestsPerMinutePerProjectPerModel-FreeTier", 1000, "gemini-3.8-flash")], "5s"), ""));
  assert.equal(Q.isSmallKey(KEY), false, "a paid-size limit");
  fresh();
  for (let i = 0; i < 26; i++) Q.noteSend(KEY, "gemini-3.8-flash");
  assert.equal(Q.isSmallKey(KEY), false, "26 Flash requests accepted in one day: the free tier allows 20");
  fresh();
  for (let i = 0; i < 100; i++) Q.noteSend(KEY, "gemini-3.5-flash-lite");
  assert.equal(Q.isSmallKey(KEY), true, "Flash-Lite legitimately takes hundreds a day on a free key");
});

test("typical first-answer time: unknown until 5 answers, then the median of the last 12; queue-sized outliers (> 90 s) are not part of 'normal'; remembered across a restart", () => {
  assert.equal(Q.typicalTtft(KEY, "gemini-3.8-flash"), 0);
  for (const ms of [3000, 3500, 2800, 3200]) Q.noteTtft(KEY, "gemini-3.8-flash", ms);
  assert.equal(Q.typicalTtft(KEY, "gemini-3.8-flash"), 0, "4 answers are not enough to call anything normal");
  Q.noteTtft(KEY, "gemini-3.8-flash", 120000);                                     // a 2-minute queue: ignored
  assert.equal(Q.typicalTtft(KEY, "gemini-3.8-flash"), 0);
  Q.noteTtft(KEY, "gemini-3.8-flash", 3100);
  assert.equal(Q.typicalTtft(KEY, "gemini-3.8-flash"), 3100);                      // median of 2800 3000 3100 3200 3500
  Q.noteTtft(KEY, "gemini-3.8-flash", 0); Q.noteTtft(KEY, "gemini-3.8-flash", -5); Q.noteTtft(KEY, "gemini-3.8-flash", NaN);
  assert.equal(Q.typicalTtft(KEY, "gemini-3.8-flash"), 3100, "garbage is ignored");
  for (let i = 0; i < 12; i++) Q.noteTtft(KEY, "gemini-3.8-flash", 9000);          // the key got slower: only the last 12 count
  assert.equal(Q.typicalTtft(KEY, "gemini-3.8-flash"), 9000);
  const saved = window.localStorage.getItem("clinix:quota:v1");
  Q.__resetQuota(); window.localStorage.setItem("clinix:quota:v1", saved);
  assert.equal(Q.typicalTtft(KEY, "gemini-3.8-flash"), 9000);
  assert.equal(Q.typicalTtft(KEY, "gemini-3.6-flash"), 0, "each model has its own");
});
