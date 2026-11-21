/* ───────────── The key ring (v3.34) ─────────────
   ONE list of API keys, any number of them, from any provider. The student pastes a key, the app recognises whose it is and uses it.

     Google (Gemini)   AIza… / AQ.…    Anthropic (Claude)  sk-ant-…        OpenAI (ChatGPT)  sk-… / sk-proj-…
     Groq              gsk_…          OpenRouter          sk-or-…         Mistral           (no prefix: recognised by asking Mistral, see gemini.js)

   The order is the order the keys were added (the student can move them). The engine uses the first key that is "live". When a key cannot work for a while
   (its daily quota is finished · it is refused · the provider is overloaded) it is put aside with a reason and a time, the next key takes over IN THE SAME REQUEST,
   and the first one comes back by itself when its time is up. Nothing is shown to the student unless EVERY key is unusable.

   This file imports nothing from the app (and nothing from Capacitor): it is plain logic + localStorage, tested in Node (tests/keyring.test.mjs). */

const LS = "clinix:keyring:v1";          // [{ id, key, provider, at }]  in the student's order
const LS_PEN = "clinix:keyring:pen:v1";  // { id: { until, why } }       a key put aside (kept apart so a build-time key can be put aside too)
const LS_OLD_X = "clinix:xkeys:v1";      // the three-box layout of v3.26–v3.33: { groq, mistral, openrouter }

/* a sentinel the app passes around as "the Gemini key" when the student has keys, but none of them is a Google one */
export const NO_GEMINI = "no-gemini-key";

const lsGet = (k) => { try { return JSON.parse(window.localStorage.getItem(k)); } catch (e) { return null; } };
const lsSet = (k, v) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

let _now = () => Date.now();
export const __setClock = (fn) => { _now = typeof fn === "function" ? fn : () => Date.now(); };

/* ── who does this key belong to? (by its shape; "unknown" = ask the provider, gemini.js) ── */
export function detectProvider(raw) {
  const k = String(raw || "").trim();
  if (/^AIza[0-9A-Za-z_\-]{20,}$/.test(k)) return "gemini";
  if (/^AQ\.[0-9A-Za-z_\-.]{20,}$/.test(k)) return "gemini";   // Google's newer key format (AQ.…), same Gemini API
  if (/^sk-ant-/i.test(k)) return "anthropic";
  if (/^sk-or-/i.test(k)) return "openrouter";
  if (/^gsk_/i.test(k)) return "groq";
  if (/^sk-[A-Za-z0-9_\-]{20,}$/.test(k)) return "openai";
  return "unknown";
}

/* a short stable id for a key (never the key itself) */
export function keyId(key) {
  const s = String(key || "");
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 + c, 2246822519) ^ (h2 >>> 13); }
  return ((h1 >>> 0).toString(36) + (h2 >>> 0).toString(36)).slice(0, 12);
}
export const mask = (key) => { const k = String(key || ""); return k.length <= 10 ? "••••" : `${k.slice(0, 4)}…${k.slice(-4)}`; };

/* ── the list ── */
let _seeded = false;
function read() {
  const raw = lsGet(LS);
  if (Array.isArray(raw)) return raw.filter((e) => e && typeof e.key === "string" && e.key && e.provider);
  /* first run after the update: the three boxes of the old layout become entries (once) */
  const out = [];
  const old = lsGet(LS_OLD_X);
  if (old && typeof old === "object") for (const p of ["groq", "mistral", "openrouter"]) { const k = String(old[p] || "").trim(); if (k) out.push({ id: keyId(k), key: k, provider: p, at: _now() }); }
  if (out.length) lsSet(LS, out);
  return out;
}
const write = (list) => lsSet(LS, list);

export const listKeys = () => read();
export const hasAnyKey = () => read().length > 0;
export const keysOf = (provider) => read().filter((e) => e.provider === provider).map((e) => e.key);

/* the Gemini key saved by v3.33 and before (it lived in the app's own store) becomes the first Gemini entry, once */
export function seedLegacyGemini(key) {
  const k = String(key || "").trim();
  if (!k || _seeded) return;
  _seeded = true;
  const list = read();
  if (list.some((e) => e.key === k)) return;
  if (list.some((e) => e.provider === "gemini")) return;      // the student already has a ring: an old copy must not come back
  write([{ id: keyId(k), key: k, provider: "gemini", at: _now() }, ...list]);
}
export const __resetKeyring = () => { _seeded = false; try { window.localStorage.removeItem(LS); window.localStorage.removeItem(LS_PEN); window.localStorage.removeItem(LS_OLD_X); } catch (e) { /* ignore */ } };

/* add one key. → { ok, entry?, dup?, reason? } */
export function addKey(raw, provider) {
  const key = String(raw || "").trim();
  if (key.length < 16 || /\s/.test(key)) return { ok: false, reason: "shape" };
  const list = read();
  const dup = list.find((e) => e.key === key);
  if (dup) return { ok: false, dup: true, entry: dup, reason: "dup" };
  const p = provider || detectProvider(key);
  if (!p || p === "unknown") return { ok: false, reason: "unknown" };
  const entry = { id: keyId(key), key, provider: p, at: _now() };
  write([...list, entry]);
  return { ok: true, entry };
}
export function removeKey(id) {
  const list = read();
  const gone = list.find((e) => e.id === id);
  write(list.filter((e) => e.id !== id));
  if (gone) { const pen = lsGet(LS_PEN) || {}; for (const k of Object.keys(pen)) if (k === gone.id || k.startsWith(`${gone.id}:`)) delete pen[k]; lsSet(LS_PEN, pen); }
  return gone || null;
}
/* move a key one place up (dir -1) or down (dir 1) */
export function moveKey(id, dir) {
  const list = read();
  const i = list.findIndex((e) => e.id === id);
  const j = i + (dir < 0 ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return false;
  [list[i], list[j]] = [list[j], list[i]];
  write(list);
  return true;
}
/* replace every key of the given providers (the old "three boxes" API of providers.js keeps working on top of the ring) */
export function replaceProviderKeys(providers, obj) {
  const keep = read().filter((e) => !providers.includes(e.provider));
  const add = [];
  for (const p of providers) { const k = String((obj && obj[p]) || "").trim(); if (k) add.push({ id: keyId(k), key: k, provider: p, at: _now() }); }
  write([...keep, ...add]);
}

/* ── keys put aside ──
   A key can be put aside as a WHOLE (refused: a wrong / revoked key) or for ONE TIER of model only (v3.35). The tiers are the three sizes of Gemini model:
     weak = Flash-Lite · mid = Flash · strong = Pro
   Their daily quotas are separate, so when the weak model of key 1 is finished, key 1's strong model is still good: weak jobs go to key 2's weak model and the
   strong model of key 1 is kept for the jobs that need it. */
const pens = () => { const p = lsGet(LS_PEN) || {}; const t = _now(); const out = {}; for (const id of Object.keys(p)) if (p[id] && p[id].until > t) out[id] = p[id]; return out; };
const penId = (key, tier) => (tier ? `${keyId(key)}:${tier}` : keyId(key));

/* why: "day" (its daily quota is finished: until the reset) · "bad" (refused) · "busy" (a short break) ; tier "" = the whole key */
export function penalize(key, ms, why = "busy", tier = "") {
  const p = pens();
  p[penId(key, tier)] = { until: _now() + Math.max(1000, Math.round(ms || 60000)), why };
  lsSet(LS_PEN, p);
}
export function forgive(key) { const p = pens(); const id = keyId(key); for (const k of Object.keys(p)) if (k === id || k.startsWith(`${id}:`)) delete p[k]; lsSet(LS_PEN, p); }
export const forgiveAll = (provider) => { for (const e of read()) if (!provider || e.provider === provider) forgive(e.key); };
/* the reason a key cannot be used for this tier right now (a whole-key penalty wins over a tier one) */
export const penaltyOf = (key, tier = "") => { const p = pens(); return p[keyId(key)] || (tier ? p[penId(key, tier)] : null) || null; };
export const isLive = (key, tier = "") => !penaltyOf(key, tier);

/* The keys to try for one request, best first.
   `extra` = a key that lives outside the ring (a build-time key, or the one a caller passed): it goes last.
   Live keys come first; if NOTHING is live and nothing has been tried yet, the keys are still returned (the one that wakes up soonest first),
   so a ring whose every key is resting still produces the provider's real error instead of silence. */
export function candidates(provider, { tried = new Set(), extra = "", tier = "" } = {}) {
  const mine = keysOf(provider);
  const ex = String(extra || "").trim();
  const all = [...mine, ...(ex && ex !== NO_GEMINI && !mine.includes(ex) ? [ex] : [])].filter((k) => !tried.has(k));
  const live = all.filter((k) => isLive(k, tier));
  if (live.length) return live;
  if (tried.size) return [];
  return [...all].sort((a, b) => ((penaltyOf(a, tier) || {}).until || 0) - ((penaltyOf(b, tier) || {}).until || 0));
}

/* what the 🔑 window shows next to each key */
export function statusOf(entry) {
  const p = penaltyOf(entry.key);
  const id = keyId(entry.key), all = pens(), tiers = {};
  for (const t of ["weak", "mid", "strong"]) if (all[`${id}:${t}`]) tiers[t] = all[`${id}:${t}`];
  if (!p) return { state: "live", tiers };
  return { state: p.why === "bad" ? "bad" : p.why === "day" ? "day" : "busy", until: p.until, tiers };
}
