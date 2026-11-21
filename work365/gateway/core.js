/* ───────────── ClinixStudy AI gateway · the logic (v3.32) ─────────────
   (worker.js is only the entry point Cloudflare calls; the logic lives here so the tests can import it)
   WHY THIS EXISTS
   A slow answer is rarely the app's fault: Google's FREE tier gives every request the lowest priority and tiny per-model quotas, so requests wait in a
   queue for a minute or more (429 / 503 / silence). The cure is a PAID Google project. But a paid key must NEVER be baked into an APK (an APK is a zip: anyone
   can read the key out of it). So the app talks to THIS gateway, and only the gateway knows the Google key.

     phone / PC app ──(access code)──►  gateway (Cloudflare Worker)  ──(paid Google key)──►  Gemini API
                    ◄──── the answer streams straight through, word by word ────

   It is a transparent proxy: the app's code is unchanged except for the address (VITE_GATEWAY_URL). What it adds:
     • the Google key stays on the server; the app holds only an ACCESS CODE (rotate it any time, hand out one per group)
     • only the Gemini calls the app really uses are allowed (not tuning, not cached contents, not other Google APIs): a leaked access code cannot be
       used to do anything else with your key
     • optional daily limit PER DEVICE (needs a KV namespace; the app sends a random device id): one heavy user cannot lock the others out, and a runaway
       app cannot burn the budget. The hard ceiling for money is Google's own monthly spend cap (AI Studio → billing): set it too.
     • Google's resumable-upload link is rewritten so it goes through here (that link can contain the Google key itself: it never reaches the phone)
     • `x-gw-upstream-ms` header = how long Google took to start answering. The app's latency report uses it to tell "Google was slow" from "the phone's network was slow"
   It never reads or stores the content of a request (no logging of questions, answers or images) and never parses the body: streaming passes through untouched.

   Secrets (wrangler secret put …, or the deploy workflow):  GEMINI_API_KEY (your PAID key) · ACCESS_CODES (comma separated)
   Variables (wrangler.toml):  DAILY_LIMIT (default 500 generation calls per device per day, needs the LIMITS KV) · ALLOWED_MODELS (regex, default ^gemini-)

   Plain Web-API code (Request / Response / fetch): it runs on Cloudflare Workers, and in Node 20+ for the tests (tests/gateway.test.mjs). */

const UPSTREAM = "https://generativelanguage.googleapis.com";
const VERSION = "3.32";
const MAX_BODY = 30 * 1024 * 1024;       // the app sends at most ~14 MB (a base64 PDF); anything much bigger is not from the app

const MODEL_PATH = /^\/v1beta\/models\/([A-Za-z0-9._\-]+):(generateContent|streamGenerateContent|countTokens)$/;
const LIST_PATH = /^\/v1beta\/models\/?$/;
const FILE_PATH = /^\/v1beta\/files\/[A-Za-z0-9._\-]+$/;
const UPLOAD_START = /^\/upload\/v1beta\/files\/?$/;
const UPLOAD_ID = /^[A-Za-z0-9_\-]{16,}$/;

/* request headers that are passed on to Google; the client's own x-goog-api-key (= the access code) is NEVER among them */
const PASS_REQ = /^(content-type|accept|x-goog-upload-[a-z\-]+|x-goog-api-client|user-agent)$/i;
/* response headers that must not be copied (the runtime re-encodes the body) */
const DROP_RES = /^(content-encoding|content-length|transfer-encoding|connection|keep-alive|set-cookie|alt-svc|server-timing)$/i;

const json = (status, message, extra = {}) => new Response(
  JSON.stringify({ error: { code: status, message, status: status === 429 ? "RESOURCE_EXHAUSTED" : status === 401 || status === 403 ? "PERMISSION_DENIED" : status >= 500 ? "UNAVAILABLE" : "INVALID_ARGUMENT" } }),
  { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra } },
);

function cors(req, h) {
  h.set("access-control-allow-origin", "*");
  h.set("access-control-allow-methods", "GET, POST, OPTIONS");
  h.set("access-control-allow-headers", req.headers.get("access-control-request-headers") || "*");
  h.set("access-control-expose-headers", "x-goog-upload-url, x-goog-upload-status, x-goog-upload-chunk-granularity, x-gemini-service-tier, x-gw-upstream-ms, retry-after");
  h.set("access-control-max-age", "86400");
  return h;
}
const withCors = (req, res) => { const h = new Headers(res.headers); cors(req, h); return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h }); };

/* constant-time comparison of two strings (an access code must not leak through response timing) */
function same(a, b) {
  const x = String(a), y = String(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return d === 0;
}
const codesOf = (env) => String((env && env.ACCESS_CODES) || "").split(",").map((s) => s.trim()).filter(Boolean);
const matchCode = (env, token) => { let hit = ""; for (const c of codesOf(env)) if (same(c, token)) hit = c; return hit; };

async function shortHash(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf).slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* Google's resumable-upload URL → the same upload, but through this gateway, and WITHOUT the key= parameter (it can carry the Google key) */
export function rewriteUploadUrl(value, selfOrigin) {
  try {
    const u = new URL(value);
    u.searchParams.delete("key");
    return `${selfOrigin}${u.pathname}${u.search}`;
  } catch (e) { return ""; }
}

/* one request counts when it asks a model to GENERATE (not a model list, a file status or an upload) */
const counts = (path, method) => method === "POST" && /:(generateContent|streamGenerateContent)$/.test(path);

/* who is calling: the random id the app generated for this install (x-clinix-device); without it, the caller's IP; without that, one shared bucket */
const deviceOf = (req) => {
  const d = (req.headers.get("x-clinix-device") || "").trim();
  if (/^[A-Za-z0-9_\-]{8,64}$/.test(d)) return d;
  return req.headers.get("cf-connecting-ip") || "anon";
};

/* The message says "daily limit" in English on purpose: the app recognises that phrase and stops at once with a clear message
   (instead of treating it as a short-lived 429 and trying every model again). */
async function overLimit(env, ctx, code, device) {
  const kv = env && env.LIMITS;
  if (!kv) return false;                                      // no KV bound → no limit (documented)
  const limit = Math.max(1, parseInt((env && env.DAILY_LIMIT) || "500", 10) || 500);
  const day = new Date().toISOString().slice(0, 10);
  const key = `rl:${await shortHash(code)}:${await shortHash(device)}:${day}`;
  let n = 0;
  try { n = parseInt((await kv.get(key)) || "0", 10) || 0; } catch (e) { return false; }   // KV trouble must never block a student
  if (n >= limit) return true;
  const write = kv.put(key, String(n + 1), { expirationTtl: 172800 }).catch(() => {});
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(write);
  return false;
}

/* the whole gateway. `deps` exists for the tests (a fake Google); in production it is the real fetch. */
export async function handle(req, env = {}, ctx = null, deps = {}) {
  const fetchImpl = deps.fetchImpl || ((...a) => fetch(...a));
  const now = deps.now || Date.now;
  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method.toUpperCase();

  if (method === "OPTIONS") return withCors(req, new Response(null, { status: 204 }));
  if (method === "GET" && (path === "/" || path === "/health")) {
    return withCors(req, new Response(JSON.stringify({ ok: true, service: "clinix-gateway", v: VERSION, keyConfigured: !!(env && env.GEMINI_API_KEY), codes: codesOf(env).length }), { headers: { "content-type": "application/json", "cache-control": "no-store" } }));
  }

  if (!env || !env.GEMINI_API_KEY) return withCors(req, json(500, "الـ gateway مش متظبط: ناقص GEMINI_API_KEY."));

  /* 1 · which Google call is this? Anything the app does not use is refused (the key must not become a general-purpose Google proxy) */
  let kind = "";
  let model = "";
  const mm = path.match(MODEL_PATH);
  if (mm && method === "POST") { kind = "model"; model = mm[1]; }
  else if (LIST_PATH.test(path) && method === "GET") kind = "list";
  else if (FILE_PATH.test(path) && method === "GET") kind = "file";
  else if (UPLOAD_START.test(path) && method === "POST" && !url.searchParams.get("upload_id")) kind = "upload-start";
  else if (path.startsWith("/upload/") && method === "POST" && UPLOAD_ID.test(url.searchParams.get("upload_id") || "")) kind = "upload-data";
  else return withCors(req, json(404, "المسار ده مش مسموح في الـ gateway."));

  /* 2 · who is asking? (the data step of an upload carries no code: its upload_id was issued to an authenticated start, and Google checks it) */
  let code = "";
  if (kind !== "upload-data") {
    const token = req.headers.get("x-goog-api-key") || url.searchParams.get("key") || "";
    code = matchCode(env, token);
    if (!code) return withCors(req, json(401, "رمز الدخول مش مقبول. اتأكد من رمز الـ gateway في التطبيق."));
  }

  if (kind === "model") {
    const allowed = new RegExp((env && env.ALLOWED_MODELS) || "^gemini-");
    if (!allowed.test(model)) return withCors(req, json(403, "الموديل ده مش مسموح في الـ gateway."));
    if (counts(path, method) && await overLimit(env, ctx, code, deviceOf(req))) {
      return withCors(req, json(429, "daily limit reached for this device (الحد اليومي للاستخدام على الجهاز ده خلص، جرّب بكرة).", { "retry-after": "3600" }));
    }
  }
  const declared = parseInt(req.headers.get("content-length") || "0", 10) || 0;
  if (declared > MAX_BODY) return withCors(req, json(413, "الطلب أكبر من المسموح."));

  /* 3 · forward: same path, the server's key, the body untouched (a stream: nothing is read or buffered here) */
  const target = new URL(String((env && env.UPSTREAM_URL) || UPSTREAM).replace(/\/+$/, "") + path);          // UPSTREAM_URL: only for a staging copy / local tests; empty = Google
  for (const [k, v] of url.searchParams) if (k !== "key") target.searchParams.append(k, v);
  const headers = new Headers();
  for (const [k, v] of req.headers) if (PASS_REQ.test(k)) headers.set(k, v);
  headers.set("x-goog-api-key", env.GEMINI_API_KEY);
  const init = { method, headers, redirect: "manual" };
  if (method !== "GET" && method !== "HEAD") { init.body = req.body; init.duplex = "half"; }

  const t0 = now();
  let up;
  try { up = await fetchImpl(target.toString(), init); }
  catch (e) { return withCors(req, json(502, "الـ gateway مقدرش يوصل لسيرفرات Google. جرّب تاني.")); }
  const upstreamMs = now() - t0;

  /* 4 · answer: status and body exactly as Google sent them (a 429 / 503 stays a 429 / 503: the app's own retry logic reads it) */
  const rh = new Headers();
  for (const [k, v] of up.headers) if (!DROP_RES.test(k)) rh.set(k, v);
  const upl = rh.get("x-goog-upload-url");
  if (upl) rh.set("x-goog-upload-url", rewriteUploadUrl(upl, url.origin));
  rh.set("x-gw-upstream-ms", String(Math.max(0, upstreamMs)));
  rh.set("cache-control", "no-store, no-transform");            // no-transform: nothing in between may compress / buffer a live stream
  rh.set("x-accel-buffering", "no");
  cors(req, rh);
  return new Response(up.body, { status: up.status, statusText: up.statusText, headers: rh });
}
