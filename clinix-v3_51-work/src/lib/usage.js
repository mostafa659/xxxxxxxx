/* ───────────── Local usage meter ─────────────
   Google does not tell an app how much of the daily quota is left, so the app counts what IT sends (every request
   to the Gemini API, hedged duplicates included — Google counts those too). The daily quota resets at midnight
   Pacific time. When Google answers "quota exceeded … limit: N" the real limit N is learned and remembered. */

const LS = "clinix:usage:v1";
const LS_LIMIT = "clinix:usage:limit";
export const DEFAULT_LIMIT = 250;
const TZ = "America/Los_Angeles";

export const ptDay = (ms) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(ms);

export function nextResetMs(now = Date.now()) {
  const day = ptDay(now);
  let t = now;
  while (ptDay(t) === day && t - now < 2 * 86400e3) t += 15 * 60e3;       // coarse: first 15-min step in the next PT day
  t -= 15 * 60e3;
  while (ptDay(t) === day) t += 60e3;                                         // fine: the exact minute
  return t;
}

const fresh = () => ({ day: ptDay(Date.now()), total: 0, byModel: {}, quota: null });

function load() {
  try {
    const u = JSON.parse(window.localStorage.getItem(LS));
    if (u && u.day === ptDay(Date.now())) return u;
  } catch (e) { /* ignore */ }
  return fresh();
}
function save(u) {
  try { window.localStorage.setItem(LS, JSON.stringify(u)); } catch (e) { /* ignore */ }
  try { window.dispatchEvent(new Event("clinix-usage")); } catch (e) { /* ignore */ }
}

export const readUsage = () => load();

/* ext = a request to an extra free engine (Groq · OpenRouter · Mistral): it has its own quota, so it is NOT part of Google's total */
export function trackRequest(model, ext = false) {
  const u = load();
  if (ext) u.ext = (u.ext || 0) + 1; else u.total += 1;
  u.byModel[model] = (u.byModel[model] || 0) + 1;
  save(u);
}

/* called for every 429 */
export function noteQuota(message, model) {
  const m = String(message || "");
  const daily = /per\s?day|daily|PerDay/i.test(m);
  const lim = (m.match(/limit:\s*(\d+)/i) || [])[1];
  if (daily && lim && +lim > 0) { try { window.localStorage.setItem(LS_LIMIT, JSON.stringify({ n: +lim, learned: true })); } catch (e) { /* ignore */ } }
  const u = load();
  if (daily) u.quota = { at: Date.now(), model: model || "" };
  save(u);
}

export function getLimit() {
  try { const l = JSON.parse(window.localStorage.getItem(LS_LIMIT)); if (l && l.n > 0) return { n: l.n, learned: !!l.learned }; } catch (e) { /* ignore */ }
  return { n: DEFAULT_LIMIT, learned: false };
}
export function setLimit(n) {
  try { window.localStorage.setItem(LS_LIMIT, JSON.stringify({ n: Math.max(1, Math.round(+n) || DEFAULT_LIMIT), learned: false })); } catch (e) { /* ignore */ }
  save(load());
}

/* Each API key has its own quota. When a DIFFERENT key becomes the active one, the old key's counter and the limit
   learned from it are deleted and counting starts again from 0 for the new key. Same key again → nothing changes. */
const LS_KEY = "clinix:usage:key";
const tagOf = (k) => { const t = String(k || "").trim(); return t ? `${t.length}:${t.slice(-10)}` : ""; };
export function syncUsageKey(apiKey) {
  const tag = tagOf(apiKey);
  if (!tag) return false;
  let old = null;
  try { old = window.localStorage.getItem(LS_KEY); } catch (e) { /* ignore */ }
  if (old === tag) return false;
  try {
    window.localStorage.setItem(LS_KEY, tag);
    if (old !== null) { window.localStorage.removeItem(LS); window.localStorage.removeItem(LS_LIMIT); }   // first run: keep what was counted so far
  } catch (e) { /* ignore */ }
  try { window.dispatchEvent(new Event("clinix-usage")); } catch (e) { /* ignore */ }
  return old !== null;
}
