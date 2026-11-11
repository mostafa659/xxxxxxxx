/* ───────────── Free-tier quota intelligence (v3.33) ─────────────
   WHY THIS EXISTS
   A free Gemini key is not "slow"; it is SMALL, and small in a way the app did not understand. Google's free tier gives every model its own quota
   (per project): today roughly  5 requests/minute and 20 requests/DAY for the Flash models, 10/minute and 500/day for Flash-Lite
   (Google no longer publishes the numbers, they are visible only in AI Studio, so this file LEARNS them from the key itself).

   What went wrong before:
   • Google's answer to "your daily quota is gone" looks like this:   "…Quota exceeded for metric: …_free_tier_requests, limit: 20, model: gemini-3.8-flash
     Please retry in 20s"   The message does NOT say "per day" and it even suggests a retry in seconds. Only  details[].violations[].quotaId  says the truth
     ("GenerateRequestsPerDayPerProjectPerModel-FreeTier"). The app guessed from the message text, so it treated "finished for today" as "busy for 20 seconds":
     it cooled the model, retried it, got 429 again, waited, retried… for every request of every feature, all day, instead of using the models that still had quota.
   • A question analysis sent ~6 requests, so three analyses emptied the day's Flash quota, and every burst of 4 parallel requests hit the 5-per-minute wall.

   What this file does (no prompt, no model and no answer is changed by it):
   1. parseQuota()   reads the structured error: which quota (day / minute / tokens / none), its real limit, the model it belongs to, Google's retry hint.
   2. a ledger, remembered per key across restarts (localStorage): requests sent today and in the last minute per model, learned limits, "finished until the
      daily reset" (midnight Pacific time, 10:00 in Cairo) and which model names are really the same quota (gemini-flash-latest = gemini-3.8-flash).
   3. paceMs()       a model that has just used its per-minute quota is not called again until a slot is free: a known 8 s wait instead of a 429 and a 15-60 s penalty.
   4. pressure() / isScarce()  evidence that this key is small → the analysis asks for fewer requests (analysis.js) and keeps the strong model for the lesson itself.
   5. quotaNote()    one honest sentence for the screen: which model finished its quota and when it comes back.

   Plain logic + localStorage only → tested in Node (tests/quota.test.mjs). */

import { nextResetMs, ptDay } from "./usage.js";

const LS = "clinix:quota:v1";
const MIN = 60000;
const SCARCE_AT = 12;                 // Flash requests left today (all Flash models together) at or below which the strong model is kept for the lesson itself
const PRESSURE_RPM = 15, PRESSURE_RPD = 150;      // learned limits this small = a free-tier-like key
const RPM_TTL = 12 * 3600e3;          // a learned per-minute limit is forgotten after this long without a new 429 (the student may have upgraded)

let _now = () => Date.now();
export const __setClock = (fn) => { _now = typeof fn === "function" ? fn : () => Date.now(); };
let _mem = null;
export const __resetQuota = () => { _mem = null; _raw = null; try { window.localStorage.removeItem(LS); } catch (e) { /* ignore */ } };

const tagOf = (k) => { const t = String(k || "").trim(); return t ? `${t.length}:${t.slice(-10)}` : "anon"; };
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));

/* ── 1 · reading Google's error ── */

/* "42s" · "0.5s" · "1m30s" · "10h17m5.7s" → milliseconds */
export function parseDuration(v) {
  const m = String(v == null ? "" : v).trim().match(/^(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?$/);
  if (!m || (!m[1] && !m[2] && !m[3])) return 0;
  return Math.round((+(m[1] || 0)) * 3600e3 + (+(m[2] || 0)) * 60e3 + (parseFloat(m[3] || "0") || 0) * 1000);
}

/* errObj = the `error` object of the response (with `details`), message = its text.
   → { kind: "day" | "minute" | "tokens" | "none" | "unknown", limit, model, retryMs, ids }
     day     the DAILY request quota of that model is gone (the "retry in 20s" Google adds is NOT true for this one)
     minute  the per-minute request quota: Google's retry hint is accurate
     tokens  the per-minute input-token window
     none    limit 0: this model has no quota at all on this key (e.g. Pro on a free key)                                                        */
export function parseQuota(errObj, message) {
  const msg = String(message != null ? message : (errObj && errObj.message) || "");
  const details = Array.isArray(errObj && errObj.details) ? errObj.details : [];
  const viol = [];
  let retryMs = 0;
  for (const d of details) {
    if (!d || typeof d !== "object") continue;
    if (Array.isArray(d.violations)) for (const v of d.violations) if (v && typeof v === "object") viol.push(v);
    if (d.retryDelay != null) retryMs = parseDuration(d.retryDelay) || retryMs;
  }
  const ids = viol.map((v) => String(v.quotaId || "")).filter(Boolean);
  const idOf = (v) => String(v.quotaId || v.quotaMetric || "");
  let hit = viol.find((v) => /PerDay/i.test(idOf(v)));
  let kind = hit ? "day" : "unknown";
  if (!hit) { hit = viol.find((v) => /RequestsPerMinute/i.test(idOf(v))); if (hit) kind = "minute"; }
  if (!hit) { hit = viol.find((v) => /PerMinute/i.test(idOf(v)) || /input_token|token_count/i.test(String(v.quotaMetric || ""))); if (hit) kind = "tokens"; }

  let limit = hit && hit.quotaValue != null ? parseInt(hit.quotaValue, 10) : NaN;
  const lm = msg.match(/limit:\s*(\d+)/i);
  if (!Number.isFinite(limit) && lm) limit = parseInt(lm[1], 10);
  if (!Number.isFinite(limit)) limit = -1;

  let model = String(((hit || viol[0] || {}).quotaDimensions || {}).model || "");
  if (!model) { const mm = msg.match(/model:\s*([A-Za-z0-9._\-]+)/); if (mm) model = mm[1]; }
  if (!retryMs) { const rm = msg.match(/retry in\s+((?:\d+h)?(?:\d+m)?[\d.]+s)/i); if (rm) retryMs = parseDuration(rm[1]); }

  /* no structured details (another API surface, an old format): fall back to the message, as the app always did */
  if (kind === "unknown") {
    if (limit === 0) kind = "none";
    else if (/per\s?day|daily|perday/i.test(msg) || retryMs >= 30 * 60e3) kind = "day";     // "retry in 10h17m" is the daily reset
  }
  if (limit === 0) kind = "none";
  return { kind, limit, model, retryMs, ids };
}

/* ── 2 · the ledger ── */

let _raw = null;
function state(apiKey) {
  const k = tagOf(apiKey);
  let raw = null;
  try { raw = window.localStorage.getItem(LS); } catch (e) { /* no storage: memory only */ }
  if (_mem && _mem.k === k && raw === _raw) return _mem;                      // storage unchanged since we wrote it: the cache is valid (another tab / a clear() invalidates it)
  let st = { k, lanes: {}, same: {} };
  try { const j = raw ? JSON.parse(raw) : null; if (j && j.k === k && j.lanes) st = { k, lanes: j.lanes, same: j.same || {} }; } catch (e) { /* ignore */ }
  _mem = st; _raw = raw;
  return st;
}
const save = (st) => {
  const raw = JSON.stringify(st);
  try { window.localStorage.setItem(LS, raw); _raw = raw; } catch (e) { _raw = null; }
};
const canon = (st, name) => st.same[name] || name;

function lane(st, name) {
  const key = canon(st, name);
  const m = st.lanes[key] || (st.lanes[key] = { d: "", used: 0, rpd: 0, rpm: 0, rpmAt: 0, dead: 0, none: false, sent: [] });
  const now = _now();
  const today = ptDay(now);
  if (m.d !== today) { m.d = today; m.used = 0; }                          // the daily counter restarts at midnight Pacific; the learned limits stay
  if (m.dead && m.dead <= now) { m.dead = 0; }
  if (m.sent.length && m.sent[0] <= now - MIN) m.sent = m.sent.filter((t) => t > now - MIN);
  return m;
}

/* a request is about to be sent to this model → returns the stamp that refund() needs */
export function noteSend(apiKey, model) {
  const st = state(apiKey), m = lane(st, model), t = _now();
  m.sent.push(t);
  if (m.sent.length > 120) m.sent.shift();
  m.used += 1;
  save(st);
  return t;
}

/* Google answered 429 / 5xx without doing the work: that request was not counted on its side, so it is not counted here either */
export function refundSend(apiKey, model, stamp) {
  const st = state(apiKey), m = lane(st, model);
  const i = m.sent.indexOf(stamp);
  if (i >= 0) m.sent.splice(i, 1);
  m.used = Math.max(0, m.used - 1);
  save(st);
}

/* a 429 with its parsed quota. Returns what the engine must do: { deadMs } the model is finished until the daily reset, { coolMs } wait this long. */
export function noteQuotaError(apiKey, model, q) {
  const out = { deadMs: 0, coolMs: 0 };
  if (!q || q.kind === "unknown") return out;
  const st = state(apiKey), now = _now();
  /* Google names the model the quota belongs to: if it is not the name we called, both names are ONE quota from now on */
  if (q.model && q.model !== model && !st.same[q.model]) st.same[model] = q.model;
  const m = lane(st, model);
  if (q.kind === "day" || q.kind === "none") {
    m.dead = Math.max(m.dead, nextResetMs(now));
    if (q.kind === "none") m.none = true;
    else if (q.limit > 0) { m.rpd = q.limit; m.used = Math.max(m.used, q.limit); }
    out.deadMs = Math.max(5 * MIN, m.dead - now);
  } else {
    if (q.kind === "minute" && q.limit > 0) { m.rpm = q.limit; m.rpmAt = now; }
    out.coolMs = clamp(q.retryMs || 15000, 1000, 65000);
  }
  save(st);
  return out;
}

/* every name that is the same quota as `model` (gemini-flash-latest ↔ gemini-3.8-flash), the model itself included */
export function sameAs(apiKey, model) {
  const st = state(apiKey), c = canon(st, model);
  const all = new Set([model, c]);
  for (const [a, b] of Object.entries(st.same)) if (b === c || a === c) { all.add(a); all.add(b); }
  return [...all];
}

/* true while this model is finished for today (daily quota gone, or no quota at all on this key) */
export function finishedToday(apiKey, model) {
  return lane(state(apiKey), model).dead > _now();
}

/* How long this model usually takes to show its first sign of life (its first word or thought) for this key. Remembered across restarts: the median of the last
   12 answers. It tells the engine what "silent for too long" means HERE, instead of a fixed number written for somebody else's key. 0 until 5 answers are known. */
const TTFT_KEEP = 12, TTFT_MIN_SAMPLES = 5, TTFT_MAX_SAMPLE = 90000;
/* `cls` = the kind of job (chat · write · solve · ocr · quick): a model that thinks before a "solve" answers later than one that only writes, so each kind has its own measure */
export function noteTtft(apiKey, model, ms, cls = "_") {
  if (!(ms > 0) || ms > TTFT_MAX_SAMPLE) return;                        // a request that sat in a queue for minutes is the exception we guard against, not the normal
  const st = state(apiKey), m = lane(st, model);
  if (!m.tt || Array.isArray(m.tt)) m.tt = {};
  for (const key of new Set([cls, "_"])) {                              // the kind of job AND the model as a whole (which fills up 3x faster: the fallback while a kind has few answers)
    const a = (m.tt[key] = m.tt[key] || []);
    a.push(Math.round(ms));
    if (a.length > TTFT_KEEP) a.shift();
  }
  save(st);
}
export function typicalTtft(apiKey, model, cls = "_") {
  const m = lane(state(apiKey), model);
  const med = (key) => { const a = ((m.tt && !Array.isArray(m.tt) && m.tt[key]) || []).slice().sort((x, y) => x - y); return a.length >= TTFT_MIN_SAMPLES ? a[Math.floor(a.length / 2)] : 0; };
  return med(cls) || med("_");
}

/* how many ms this model is still finished for (0 = available) */
export function deadLeftMs(apiKey, model) {
  const m = lane(state(apiKey), model), now = _now();
  return m.dead > now ? m.dead - now : 0;
}

/* how long to wait before this model may be called without hitting its per-minute wall (0 = now) */
export function paceMs(apiKey, model) {
  const st = state(apiKey), m = lane(st, model), now = _now();
  const rpm = m.rpm > 0 && now - m.rpmAt < RPM_TTL ? m.rpm : 0;
  if (!rpm || m.sent.length < rpm) return 0;
  const wait = m.sent[m.sent.length - rpm] + MIN - now;
  return wait > 0 ? wait + 250 : 0;
}

/* requests this model still has today; Infinity while its daily limit is unknown (never block on a guess) */
export function remaining(apiKey, model) {
  const m = lane(state(apiKey), model);
  if (m.dead > _now()) return 0;
  return m.rpd > 0 ? Math.max(0, m.rpd - m.used) : Infinity;
}

/* a small nudge for the router: between equal models, the one with the most daily quota left goes first, so the day's quota is used evenly and ends later */
export function budgetBias(apiKey, model) {
  const rem = remaining(apiKey, model);
  return Number.isFinite(rem) && rem < SCARCE_AT ? clamp((SCARCE_AT - rem) * 1.5, 0, 18) : 0;
}

/* ── 3 · what the analysis does with it ── */

/* evidence that this key is small (a learned limit of a free-tier size, or a model finished today) → ask for fewer requests */
export function pressure(apiKey) {
  const st = state(apiKey), now = _now();
  for (const name of Object.keys(st.lanes)) {
    const m = lane(st, name);
    if (/pro/.test(name) || m.none) continue;
    if (m.dead > now) return true;
    if (m.rpd > 0 && m.rpd <= PRESSURE_RPD) return true;
    if (m.rpm > 0 && m.rpm <= PRESSURE_RPM && now - m.rpmAt < RPM_TTL) return true;
  }
  return false;
}

/* Is this key SMALL until proven otherwise? Every free key is (that is the app's audience), and nothing tells a free key from a paid one before the first 429.
   So the app starts small and goes back to the big, fully parallel design only on EVIDENCE of a big quota: a learned limit of a paid size, or more requests
   accepted by one Flash model in a day than the free tier can ever allow (its daily limit is 20). */
export function isSmallKey(apiKey) {
  const st = state(apiKey), now = _now();
  for (const name of Object.keys(st.lanes)) {
    const m = lane(st, name);
    if (m.rpd > PRESSURE_RPD || (m.rpm > PRESSURE_RPM && now - m.rpmAt < RPM_TTL)) return false;
    if (!/lite|pro/.test(name) && m.used > 25) return false;
  }
  return true;
}

/* the strong (Flash) models together have almost nothing left today → utility jobs go to Flash-Lite so the rest is kept for the lesson */
export function isScarce(apiKey, models) {
  const st = state(apiKey), now = _now();
  const flash = [...new Set((models || []).filter((n) => !/lite|pro/.test(n)))];
  let known = false, sum = 0;
  for (const n of flash) {
    const m = lane(st, n);
    if (m.dead > now) { known = true; continue; }
    if (m.rpd > 0) { known = true; sum += Math.max(0, m.rpd - m.used); }
    else if (!/latest$/.test(n) && !st.same[n]) return false;                  // a Flash model whose quota is unknown: assume plenty
  }
  return known && sum <= SCARCE_AT;
}

const UTILITY = /^words/;
/* the caller's model order, adjusted for the quota budget: utility jobs (the word list) prefer Flash-Lite when Flash is scarce. Everything else is untouched. */
export function orderForTask(apiKey, task, models) {
  if (!UTILITY.test(String(task || "")) || !isScarce(apiKey, models)) return models;
  const lite = models.filter((n) => /lite/.test(n)), rest = models.filter((n) => !/lite/.test(n));
  return lite.length ? [...lite, ...rest] : models;
}

/* one honest sentence about what finished today (nothing when everything is fine) */
export function quotaNote(apiKey) {
  const st = state(apiKey), now = _now();
  const dead = Object.keys(st.lanes).filter((n) => { const m = lane(st, n); return m.dead > now && !m.none && !/latest$/.test(n); });
  if (!dead.length) return "";
  const at = Math.max(...dead.map((n) => lane(st, n).dead));
  let when = "";
  try { when = new Date(at).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" }); } catch (e) { /* ignore */ }
  const names = dead.map((n) => n.replace(/^gemini-/, "")).join(" · ");
  return `الحصة اليومية المجانية خلصت على: ${names}${when ? ` (بتتجدد ${when})` : ""}. التطبيق بيكمّل على الموديلات اللي لسه فيها حصة.`;
}

/* the sentence for the student when EVERY model has finished its daily quota (nothing can be answered until the reset): the true reason and the true time */
export function finishedMessage(apiKey) {
  const st = state(apiKey), now = _now();
  const names = Object.keys(st.lanes).filter((n) => { const m = lane(st, n); return m.dead > now && !m.none; });
  if (!names.length) return "";
  const at = Math.max(...names.map((n) => lane(st, n).dead));
  let when = "";
  try { when = new Date(at).toLocaleTimeString("ar-EG", { hour: "numeric", minute: "2-digit" }); } catch (e) { /* ignore */ }
  return `الحصة اليومية المجانية على مفتاحك خلصت على كل الموديلات المتاحة${when ? ` وبتتجدد الساعة ${when}` : ""}. استنى لحد وقتها، أو استخدم مفتاح من حساب Google تاني.`;
}
