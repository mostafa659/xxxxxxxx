import test from "node:test";
import assert from "node:assert/strict";
import { handle, rewriteUploadUrl } from "../gateway/core.js";

/* A fake Google. `onCall(url, init)` returns the Response; every call that reaches it is recorded. */
function fakeGoogle(onCall) {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return onCall(String(url), init, calls.length); };
  return { calls, deps: { fetchImpl, now: (() => { let t = 1000; return () => (t += 250); })() } };
}
const ENV = { GEMINI_API_KEY: "REAL-PAID-GOOGLE-KEY", ACCESS_CODES: "code-one, code-two" };
const gen = (path = "/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse", o = {}) =>
  new Request(`https://gw.test${path}`, { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": "code-one", ...(o.headers || {}) }, body: o.body ?? JSON.stringify({ contents: [{ role: "user", parts: [{ text: "hi" }] }] }) });
const ok = () => new Response("data: {}\n\n", { status: 200, headers: { "content-type": "text/event-stream" } });

test("health check answers without any code and says whether a key is configured", async () => {
  const g = fakeGoogle(ok);
  const r = await handle(new Request("https://gw.test/"), ENV, null, g.deps);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true); assert.equal(j.keyConfigured, true); assert.equal(j.codes, 2);
  assert.equal(g.calls.length, 0);
});

test("CORS preflight: allowed from any origin (file:// of the desktop app, the WebView), the upload URL header is exposed", async () => {
  const g = fakeGoogle(ok);
  const r = await handle(new Request("https://gw.test/v1beta/models/gemini-3.8-flash:streamGenerateContent", { method: "OPTIONS", headers: { "access-control-request-headers": "content-type,x-goog-api-key,x-goog-upload-command" } }), ENV, null, g.deps);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("access-control-allow-origin"), "*");
  assert.match(r.headers.get("access-control-allow-headers"), /x-goog-api-key/);
  assert.match(r.headers.get("access-control-expose-headers"), /x-goog-upload-url/);
  assert.equal(g.calls.length, 0);
});

test("no Google key configured → a clear 500, nothing is sent anywhere", async () => {
  const g = fakeGoogle(ok);
  const r = await handle(gen(), { ACCESS_CODES: "code-one" }, null, g.deps);
  assert.equal(r.status, 500);
  assert.equal(g.calls.length, 0);
});

test("a missing or wrong access code is refused (401) and Google is never called", async () => {
  const g = fakeGoogle(ok);
  for (const headers of [{ "x-goog-api-key": "" }, { "x-goog-api-key": "nope" }, { "x-goog-api-key": "code-on" }, { "x-goog-api-key": "code-onee" }]) {
    const r = await handle(gen(undefined, { headers }), ENV, null, g.deps);
    assert.equal(r.status, 401);
    assert.equal(r.headers.get("access-control-allow-origin"), "*");           // the app can still READ the error
  }
  assert.equal(g.calls.length, 0);
});

test("a valid code is forwarded with the SERVER's key; the code itself and any key= parameter never reach Google", async () => {
  const g = fakeGoogle(ok);
  const body = JSON.stringify({ contents: [{ role: "user", parts: [{ text: "سؤال" }] }], generationConfig: { maxOutputTokens: 100 } });
  const r = await handle(gen("/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse&key=code-two", { body }), ENV, null, g.deps);
  assert.equal(r.status, 200);
  assert.equal(g.calls.length, 1);
  const c = g.calls[0];
  assert.equal(c.url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:streamGenerateContent?alt=sse");
  assert.equal(c.init.method, "POST");
  assert.equal(c.init.headers.get("x-goog-api-key"), "REAL-PAID-GOOGLE-KEY");
  assert.equal(c.init.headers.get("content-type"), "application/json");
  assert.equal(await new Response(c.init.body).text(), body);                    // the body is passed through byte for byte
  const everything = JSON.stringify([...c.init.headers]) + c.url;
  assert.ok(!/code-one|code-two/.test(everything), "the access code must not travel to Google");
});

test("only the Gemini calls the app uses are allowed: everything else is a 404 and costs nothing", async () => {
  const g = fakeGoogle(ok);
  const bad = [
    ["POST", "/v1beta/tunedModels"], ["POST", "/v1beta/cachedContents"], ["GET", "/v1beta/tunedModels"], ["POST", "/v1/models/gemini-3.8-flash:generateContent"],
    ["POST", "/v1beta/models/gemini-3.8-flash:embedContent"], ["GET", "/v1beta/models/gemini-3.8-flash:generateContent"], ["POST", "/v1beta/models"],
    ["DELETE", "/v1beta/files/abc"], ["GET", "/v1beta/files/abc/def"], ["GET", "/v1beta/files/"], ["POST", "/upload/v1beta/files?upload_id=short"], ["POST", "/admin"],
  ];
  for (const [method, path] of bad) {
    const r = await handle(new Request(`https://gw.test${path}`, { method, headers: { "x-goog-api-key": "code-one" }, body: method === "POST" ? "{}" : undefined }), ENV, null, g.deps);
    assert.equal(r.status, 404, `${method} ${path} should be refused`);
  }
  assert.equal(g.calls.length, 0);
});

test("path tricks cannot escape the allow-list: the URL is normalised first, so '..' / '%2e%2e' can only land on an allowed path", async () => {
  const g = fakeGoogle(() => new Response("{}", { status: 200 }));
  const h = { "x-goog-api-key": "code-one" };
  /* normalised to /v1beta/models (the model list: allowed, and forwarded as THAT path, never as the raw one) */
  assert.equal((await handle(new Request("https://gw.test/v1beta/files/../models", { headers: h }), ENV, null, g.deps)).status, 200);
  assert.equal((await handle(new Request("https://gw.test/v1beta/files/%2e%2e/models", { headers: h }), ENV, null, g.deps)).status, 200);
  assert.deepEqual(g.calls.map((c) => c.url), ["https://generativelanguage.googleapis.com/v1beta/models", "https://generativelanguage.googleapis.com/v1beta/models"]);
  /* normalised to a path that is NOT allowed → refused */
  assert.equal((await handle(new Request("https://gw.test/v1beta/models/../tunedModels", { headers: h }), ENV, null, g.deps)).status, 404);
  assert.equal((await handle(new Request("https://gw.test/v1beta/files/%2e%2e/%2e%2e/v1/projects", { headers: h }), ENV, null, g.deps)).status, 404);
  assert.equal(g.calls.length, 2);
});

test("the model list, the file status and countTokens work with a code", async () => {
  const g = fakeGoogle(() => new Response("{}", { status: 200 }));
  const h = { "x-goog-api-key": "code-one" };
  assert.equal((await handle(new Request("https://gw.test/v1beta/models?pageSize=200", { headers: h }), ENV, null, g.deps)).status, 200);
  assert.equal((await handle(new Request("https://gw.test/v1beta/files/abc-123", { headers: h }), ENV, null, g.deps)).status, 200);
  assert.equal((await handle(gen("/v1beta/models/gemini-3.8-flash:countTokens"), ENV, null, g.deps)).status, 200);
  assert.deepEqual(g.calls.map((c) => c.url), [
    "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
    "https://generativelanguage.googleapis.com/v1beta/files/abc-123",
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens",
  ]);
});

test("a model outside ALLOWED_MODELS is refused (403)", async () => {
  const g = fakeGoogle(ok);
  const r = await handle(gen("/v1beta/models/gpt-9:generateContent"), ENV, null, g.deps);
  assert.equal(r.status, 403);
  const r2 = await handle(gen("/v1beta/models/gemini-3.1-pro-preview:generateContent"), { ...ENV, ALLOWED_MODELS: "flash" }, null, g.deps);
  assert.equal(r2.status, 403);                                                   // custom rule: only flash models
  const r3 = await handle(gen("/v1beta/models/gemini-3.8-flash:generateContent"), { ...ENV, ALLOWED_MODELS: "flash" }, null, g.deps);
  assert.equal(r3.status, 200);
  assert.equal(g.calls.length, 1);
});

test("STREAMING: the first words reach the app while Google is still writing (nothing is buffered)", async () => {
  const enc = new TextEncoder();
  let release; const gate = new Promise((r) => { release = r; });
  let secondSent = false;
  const g = fakeGoogle(() => new Response(new ReadableStream({
    async start(c) { c.enqueue(enc.encode("data: first\n\n")); await gate; secondSent = true; c.enqueue(enc.encode("data: second\n\n")); c.close(); },
  }), { status: 200, headers: { "content-type": "text/event-stream" } }));
  const r = await handle(gen(), ENV, null, g.deps);
  const reader = r.body.getReader();
  const first = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), "data: first\n\n");
  assert.equal(secondSent, false, "the first chunk must arrive BEFORE Google has sent the second one");
  release();
  const second = await reader.read();
  assert.equal(new TextDecoder().decode(second.value), "data: second\n\n");
  assert.equal((await reader.read()).done, true);
  assert.match(r.headers.get("cache-control"), /no-transform/);
});

test("Google's 429 / 503 pass through unchanged (status, retry hint, body): the app's own retry logic reads them", async () => {
  const body = JSON.stringify({ error: { code: 429, message: "Quota exceeded. Please retry in 31.5s", details: [{ retryDelay: "31s" }] } });
  const g = fakeGoogle(() => new Response(body, { status: 429, headers: { "content-type": "application/json", "retry-after": "31", "content-encoding": "gzip", "content-length": "999" } }));
  const r = await handle(gen(), ENV, null, g.deps);
  assert.equal(r.status, 429);
  assert.equal(r.headers.get("retry-after"), "31");
  assert.equal(r.headers.get("content-encoding"), null);                         // the runtime re-encodes: a stale header would corrupt the body
  assert.equal(r.headers.get("content-length"), null);
  assert.equal(await r.text(), body);
  const g2 = fakeGoogle(() => new Response("{\"error\":{\"code\":503}}", { status: 503 }));
  assert.equal((await handle(gen(), ENV, null, g2.deps)).status, 503);
});

test("x-gw-upstream-ms tells how long Google took to START answering (the app uses it to separate Google from the phone's network)", async () => {
  const g = fakeGoogle(ok);
  const r = await handle(gen(), ENV, null, g.deps);
  assert.equal(r.headers.get("x-gw-upstream-ms"), "250");
});

test("UPLOAD: Google's resumable link (which can contain the Google key) is rewritten through the gateway and the key is stripped", async () => {
  const google = "https://generativelanguage.googleapis.com/upload/v1beta/files?key=REAL-PAID-GOOGLE-KEY&upload_id=ABCDEFGHIJKLMNOP1234&upload_protocol=resumable";
  const g = fakeGoogle(() => new Response("{}", { status: 200, headers: { "x-goog-upload-url": google, "x-goog-upload-status": "active" } }));
  const r = await handle(new Request("https://gw.test/upload/v1beta/files", {
    method: "POST", headers: { "x-goog-api-key": "code-one", "content-type": "application/json", "x-goog-upload-protocol": "resumable", "x-goog-upload-command": "start", "x-goog-upload-header-content-length": "1234", "x-goog-upload-header-content-type": "application/pdf" },
    body: JSON.stringify({ file: { display_name: "m" } }),
  }), ENV, null, g.deps);
  assert.equal(r.status, 200);
  const link = r.headers.get("x-goog-upload-url");
  assert.equal(link, "https://gw.test/upload/v1beta/files?upload_id=ABCDEFGHIJKLMNOP1234&upload_protocol=resumable");
  assert.ok(!JSON.stringify([...r.headers]).includes("REAL-PAID-GOOGLE-KEY"), "the Google key must never reach the phone");
  /* the upload protocol headers were passed on to Google */
  const sent = g.calls[0].init.headers;
  assert.equal(sent.get("x-goog-upload-command"), "start");
  assert.equal(sent.get("x-goog-upload-header-content-length"), "1234");
});

test("UPLOAD: the data step needs no code (its upload_id was issued to an authenticated start) and is sent with the server's key", async () => {
  const g = fakeGoogle(() => new Response(JSON.stringify({ file: { uri: "https://x/files/abc", name: "files/abc", state: "ACTIVE" } }), { status: 200 }));
  const r = await handle(new Request("https://gw.test/upload/v1beta/files?upload_id=ABCDEFGHIJKLMNOP1234&upload_protocol=resumable", {
    method: "POST", headers: { "x-goog-upload-offset": "0", "x-goog-upload-command": "upload, finalize" }, body: new Uint8Array([1, 2, 3, 4]),
  }), ENV, null, g.deps);
  assert.equal(r.status, 200);
  assert.equal(g.calls[0].url, "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=ABCDEFGHIJKLMNOP1234&upload_protocol=resumable");
  assert.equal(g.calls[0].init.headers.get("x-goog-api-key"), "REAL-PAID-GOOGLE-KEY");
  assert.equal(g.calls[0].init.headers.get("x-goog-upload-command"), "upload, finalize");
  /* but STARTING an upload without a code is refused */
  const r2 = await handle(new Request("https://gw.test/upload/v1beta/files", { method: "POST", body: "{}" }), ENV, null, g.deps);
  assert.equal(r2.status, 401);
});

test("rewriteUploadUrl: keeps the upload id, drops key=, survives garbage", () => {
  assert.equal(rewriteUploadUrl("https://x.googleapis.com/upload/v1beta/files?upload_id=Z&key=K&upload_protocol=resumable", "https://gw.test"), "https://gw.test/upload/v1beta/files?upload_id=Z&upload_protocol=resumable");
  assert.equal(rewriteUploadUrl("not a url", "https://gw.test"), "");
});

test("daily limit PER DEVICE (KV): generation calls count, the 3rd of 2 is a 429 that says 'daily limit'; other devices are not affected", async () => {
  const store = new Map();
  const kv = { get: async (k) => store.get(k) ?? null, put: async (k, v) => { store.set(k, v); } };
  const env = { ...ENV, LIMITS: kv, DAILY_LIMIT: "2" };
  const g = fakeGoogle(ok);
  const dev = (id) => ({ headers: { "x-clinix-device": id } });
  assert.equal((await handle(gen(undefined, dev("device-AAAA1111")), env, null, g.deps)).status, 200);
  assert.equal((await handle(gen("/v1beta/models/gemini-3.8-flash:generateContent", dev("device-AAAA1111")), env, null, g.deps)).status, 200);
  const blocked = await handle(gen(undefined, dev("device-AAAA1111")), env, null, g.deps);
  assert.equal(blocked.status, 429);
  assert.match(blocked.headers.get("retry-after"), /\d+/);
  const body = await blocked.json();
  assert.equal(body.error.status, "RESOURCE_EXHAUSTED");
  assert.match(body.error.message, /daily limit/i);                              // the app's classifier keys on this phrase
  assert.equal(g.calls.length, 2);                                                // the blocked one never reached Google
  /* housekeeping calls are free */
  const h = { "x-goog-api-key": "code-one", "x-clinix-device": "device-AAAA1111" };
  assert.equal((await handle(new Request("https://gw.test/v1beta/models?pageSize=1", { headers: h }), env, null, g.deps)).status, 200);
  assert.equal((await handle(gen("/v1beta/models/gemini-3.8-flash:countTokens", dev("device-AAAA1111")), env, null, g.deps)).status, 200);
  /* ANOTHER DEVICE with the same access code is not locked out by the first one */
  assert.equal((await handle(gen(undefined, dev("device-BBBB2222")), env, null, g.deps)).status, 200);
  /* a device id that is garbage falls back to the caller's IP; no header at all → one shared 'anon' bucket (still limited, never crashes) */
  assert.equal((await handle(gen(undefined, { headers: { "x-clinix-device": "<script>" , "cf-connecting-ip": "10.0.0.7" } }), env, null, g.deps)).status, 200);
  assert.equal((await handle(gen(), env, null, g.deps)).status, 200);
  /* neither the access code nor the device id is written to KV in clear text */
  assert.ok([...store.keys()].every((k) => !/code-one|code-two|device-AAAA1111|device-BBBB2222|10\.0\.0\.7/.test(k)));
});

test("a broken KV must never lock students out", async () => {
  const kv = { get: async () => { throw new Error("kv down"); }, put: async () => { throw new Error("kv down"); } };
  const g = fakeGoogle(ok);
  assert.equal((await handle(gen(), { ...ENV, LIMITS: kv, DAILY_LIMIT: "1" }, null, g.deps)).status, 200);
  assert.equal((await handle(gen(), { ...ENV, LIMITS: kv, DAILY_LIMIT: "1" }, null, g.deps)).status, 200);
});

test("Google unreachable → a 502 in Gemini's error shape (the app treats it as a transient server error and fails over)", async () => {
  const g = fakeGoogle(() => { throw new Error("network down"); });
  const r = await handle(gen(), ENV, null, g.deps);
  assert.equal(r.status, 502);
  const j = await r.json();
  assert.equal(j.error.code, 502);
  assert.equal(j.error.status, "UNAVAILABLE");
});

test("an absurdly large body is refused before it is forwarded", async () => {
  const g = fakeGoogle(ok);
  const r = await handle(gen(undefined, { headers: { "content-length": String(60 * 1024 * 1024) } }), ENV, null, g.deps);
  assert.equal(r.status, 413);
  assert.equal(g.calls.length, 0);
});
