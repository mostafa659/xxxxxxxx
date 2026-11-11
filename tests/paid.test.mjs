/* The PAID profile (v3.32): the app talks to a gateway with an access code instead of holding a Google key.
   This file sets the build-time variables BEFORE the app's modules are loaded (a separate process: node --test runs every file on its own). */
globalThis.__CLINIX_ENV__ = { VITE_GATEWAY_URL: "https://gw.test/", VITE_GATEWAY_TOKEN: "code-one", VITE_SERVICE_TIER: "priority" };

import test from "node:test";
import assert from "node:assert/strict";
const C = await import("../src/lib/config.js");
const R = await import("../src/lib/router.js");
const G = await import("../src/lib/gemini.js");
const L = await import("../src/lib/latency.js");
const F = await import("../src/lib/gfiles.js");

/* a tiny fake gateway: records every request, answers with the next scripted step */
const calls = [];
let steps = [];
const sse = (text, { usage, headers = {} } = {}) => new Response(
  [`data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`,
   `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "" }] }, finishReason: "STOP" }], ...(usage ? { usageMetadata: usage } : {}) })}\n\n`].join(""),
  { status: 200, headers: { "content-type": "text/event-stream", ...headers } });
const err = (status, message) => new Response(JSON.stringify({ error: { code: status, message } }), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!/streamGenerateContent/.test(u)) return new Response(JSON.stringify({ models: [] }), { status: 200 });     // model list / warm-up
  calls.push({ url: u, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null });
  const step = steps.length > 1 ? steps.shift() : steps[0];
  return step();
};
const reset = (...s) => { calls.length = 0; steps = s.length ? s : [() => sse("ok")]; R.__resetRouter(); window.localStorage.clear(); };
const base = (over = {}) => ({ apiKey: G.ENV_KEY, task: "lessonA:balanced", system: "sys", parts: [{ text: "hi" }], models: ["gemini-3.8-flash", "gemini-3.6-flash"], spec: { levels: ["low"], budget: 0 }, maxOut: 2000, firstMs: 3000, idleMs: 3000, ...over });

test("gateway mode: the app's 'key' is the access code, every Google call (and the Files API) goes to the gateway, the trailing slash is dropped", () => {
  assert.equal(C.GATEWAY_URL, "https://gw.test");
  assert.equal(C.PAID, true);
  assert.equal(G.ENV_KEY, "code-one");
  assert.equal(G.API_BASE, "https://gw.test/v1beta/models");
  assert.equal(C.API_ORIGIN, "https://gw.test");
  assert.equal(C.SERVICE_TIER, "priority");
});

test("PAID profile: silent requests are cut early, hedges start earlier, waits are shorter, image models are not tried one after another for minutes", () => {
  assert.equal(C.cap(240000, "first"), 60000);
  assert.equal(C.cap(120000, "first"), 60000);
  assert.equal(C.cap(150000, "idle"), 60000);
  assert.equal(C.cap(30000, "first"), 30000);                       // a short timeout stays as it is
  assert.equal(C.NET.hedge, 0.5);
  assert.equal(C.NET.maxWait, 15000);
  assert.equal(C.NET.maxHint, 12000);
  assert.equal(C.NET.imageMs, 80000);
  assert.equal(C.NET.imageTimeouts, 2);
  R.__resetRouter();
  const free = R.hedgeDelayMs("write", null, 1), paid = R.hedgeDelayMs("write", null, C.NET.hedge);
  assert.equal(paid, free / 2);                                     // 13 s → 6.5 s
  assert.ok(R.hedgeDelayMs("chat", null, C.NET.hedge) >= 2000, "a hedge is a paid request: never under 2 s");
});

test("a call goes to the gateway with the access code + a device id, asks for Priority, and leaves a trace with the tier, the token counts and the gateway's timing", async () => {
  reset(() => sse("hello", { usage: { promptTokenCount: 900, candidatesTokenCount: 450, thoughtsTokenCount: 0 }, headers: { "x-gemini-service-tier": "priority", "x-gw-upstream-ms": "420" } }));
  let trace = null;
  const r = await G.runTask(base({ onReport: (t) => { trace = t; } }));
  assert.equal(r.text, "hello");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://gw.test/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
  assert.equal(calls[0].headers["x-goog-api-key"], "code-one");
  assert.match(calls[0].headers["x-clinix-device"], /^[A-Za-z0-9_\-]{8,64}$/);          // exactly what the gateway accepts
  assert.equal(window.localStorage.getItem("clinix:device"), calls[0].headers["x-clinix-device"]);   // the same id next time
  assert.equal(calls[0].body.service_tier, "priority");
  const b = L.breakdown(trace);
  assert.equal(b.ok, true);
  assert.equal(b.tier, "priority");
  assert.equal(b.gwMs, 420);
  assert.equal(b.outTokens, 450);
  assert.equal(b.promptTokens, 900);
  assert.equal(trace.attempts.length, 1);
});

test("a gateway that cannot reach Google (502) is a transient error: the next model answers at once, and the trace says what was lost", async () => {
  reset(() => err(502, "gateway: upstream unreachable"), () => sse("second model"));
  let trace = null;
  const r = await G.runTask(base({ onReport: (t) => { trace = t; } }));
  assert.equal(r.text, "second model");
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /gemini-3\.8-flash/);
  assert.match(calls[1].url, /gemini-3\.6-flash/);
  const b = L.breakdown(trace);
  assert.deepEqual(b.failed, ["502"]);
  assert.equal(b.ok, true);
});

test("a wrong access code (401) stops at once with a message for the student, no retry storm", async () => {
  reset(() => err(401, "رمز الدخول مش مقبول"));
  await assert.rejects(G.runTask(base()), (e) => {
    assert.equal(e.fatal, true);
    assert.match(e.message, /رمز الدخول/);
    assert.ok(!/مفتاح الـ API/.test(e.message), "behind a gateway the student has no API key to fix");
    return true;
  });
  assert.equal(calls.length, 1);
});

test("the gateway's per-device 'daily limit' 429 is recognised as a DAILY limit: it stops with a clear message instead of trying every model", async () => {
  reset(() => err(429, "daily limit reached for this device (الحد اليومي للاستخدام على الجهاز ده خلص، جرّب بكرة)."));
  await assert.rejects(G.runTask(base()), (e) => {
    assert.match(e.message, /اليومي للاستخدام/);
    return true;
  });
  assert.ok(calls.length <= 2, `at most one try per model, got ${calls.length}`);
});

test("Priority tier refused by Google (the project is not Tier 2): the field is dropped, the request repeats once WITHOUT it, and it is never sent again", async () => {
  reset(() => err(400, 'Invalid JSON payload received. Unknown name "service_tier": Cannot find field.'), () => sse("answered without priority"));
  const r = await G.runTask(base());
  assert.equal(r.text, "answered without priority");
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.service_tier, "priority");
  assert.equal(calls[1].body.service_tier, undefined);
  /* the next request of the session does not even try */
  reset(() => sse("later"));
  await G.runTask(base());
  assert.equal(calls[0].body.service_tier, undefined);
});

test("the Files API start call goes through the gateway too (its upload link is rewritten there)", async () => {
  const seen = [];
  await F.uploadToGoogle({
    apiKey: "code-one", mimeType: "application/pdf", data: "AAAA", name: "m",
    fetchImpl: async (url, init) => {
      seen.push(String(url));
      if (/upload\/v1beta\/files$/.test(String(url))) return new Response("{}", { status: 200, headers: { "x-goog-upload-url": "https://gw.test/upload/v1beta/files?upload_id=ABCDEFGHIJKLMNOP1234&upload_protocol=resumable" } });
      return new Response(JSON.stringify({ file: { uri: "https://x/files/abc", name: "files/abc", state: "ACTIVE", mimeType: "application/pdf" } }), { status: 200 });
    },
  });
  assert.equal(seen[0], "https://gw.test/upload/v1beta/files");
  assert.match(seen[1], /^https:\/\/gw\.test\/upload\/v1beta\/files\?upload_id=/);
});
