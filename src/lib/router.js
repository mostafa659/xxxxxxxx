/* ───────────── Lane router (v3.26) ─────────────
   WHY THIS EXISTS
   Google's free tier is not "one quota", it is MANY small quotas: every model has its own requests-per-minute and requests-per-day
   (per project, not per key — extra keys in one project add nothing, and Google flags people who rotate projects to dodge limits,
   so this file never does that). Before v3.26 the app put every request of an analysis on ONE model, so that model hit its
   per-minute wall (429) or got queued (503) while its siblings sat idle, and the retry engine then WAITED 2 s · 4 s · 8 s.

   A "lane" = one (provider, model) pair that can answer. This file decides, for every request:
     1. which lanes may answer it (can it read the images / the PDF? does the prompt fit the lane's per-minute token window?)
     2. in which order — equal-quality lanes are balanced by their live load, so three parallel requests of one analysis land on three
        different models instead of queueing on one
     3. when to "hedge": if the first lane has sent nothing at all after N seconds, a second lane (different quota bucket) is started
        and the first one to show a sign of life wins (the other is cancelled).
   It also keeps the health of every lane: a lane that said "busy" is skipped (cooling) instead of being waited for.

   Plain logic only: no network, no DOM, no storage → it is tested in Node (tests/router.test.mjs). */

let _now = () => Date.now();
export const __setClock = (fn) => { _now = typeof fn === "function" ? fn : () => Date.now(); };

/* ── lane objects ── */

/* generation number of a Gemini model id: gemini-3.8-flash → 3.8 ; "-latest" aliases have none → treated as newest */
export const genOf = (n) => { const v = (String(n).match(/gemini-(\d+(?:\.\d+)?)/) || [])[1]; return v ? parseFloat(v) : 99; };

/* v3.35 · the three sizes of Gemini model. Their daily quotas are separate, which is what the key ring relies on (keyring.js).
     weak = Flash-Lite (cheapest) · mid = Flash · strong = Pro (the one worth saving) */
export const tierOf = (model) => (/lite/.test(model) ? "weak" : /pro/.test(model) ? "strong" : "mid");
const TIER_ORDER = { weak: 0, mid: 1, strong: 2 };
/* easy jobs: the weakest model first, then the middle one, the strongest only as a last resort (the order inside a tier is kept) */
export const weakFirst = (models) => [...new Set(models || [])].map((m, i) => ({ m, i })).sort((a, b) => TIER_ORDER[tierOf(a.m)] - TIER_ORDER[tierOf(b.m)] || a.i - b.i).map((x) => x.m);
/* the caller's model list cut into one group per tier, in the order the tiers first appear in the list: [{ tier, models }] */
export function tierStages(models) {
  const out = [];
  for (const m of [...new Set(models || [])]) {
    const t = tierOf(m);
    let g = out.find((x) => x.tier === t);
    if (!g) { g = { tier: t, models: [] }; out.push(g); }
    g.models.push(m);
  }
  return out;
}

export function geminiLane(model) {
  const kind = /pro/.test(model) ? "pro" : /lite/.test(model) ? "lite" : "flash";
  return { id: `gemini:${model}`, provider: "gemini", model, kind, gen: genOf(model), vision: true, pdf: true, maxTokens: 900000 };
}

/* ── live health of every lane (memory only: a restart starts clean, which is right — Google's windows are 1 minute) ── */

const S = new Map();
const st = (id) => {
  let s = S.get(id);
  if (!s) { s = { inflight: 0, coolUntil: 0, fails: 0, deadUntil: 0, ttft: 0, ok: 0, learnedMax: 0, bias: 0 }; S.set(id, s); }
  return s;
};
export const __resetRouter = () => S.clear();
export const laneState = (id) => ({ ...st(id) });

export const isCooling = (id) => st(id).coolUntil > _now();
export const isDead = (id) => st(id).deadUntil > _now();
export const coolLeft = (id) => Math.max(0, st(id).coolUntil - _now());

/* request started on this lane (returns the function that ends it) */
export function begin(id) {
  const s = st(id);
  s.inflight += 1;
  let done = false;
  return () => { if (!done) { done = true; s.inflight = Math.max(0, s.inflight - 1); } };
}

/* a lane answered: remember how fast the FIRST sign of life came (EWMA) and forgive old failures */
export function noteOk(id, ttftMs) {
  const s = st(id);
  s.fails = 0; s.coolUntil = 0; s.ok += 1;
  if (ttftMs > 0) s.ttft = s.ttft ? s.ttft * 0.65 + ttftMs * 0.35 : ttftMs;
}

/* a lane is busy / overloaded / hung: skip it for a while instead of waiting for it.
   Google's own "retry in N s" is honoured; otherwise a per-minute 429 cools for 15 s and a 5xx / timeout for 6 s, doubling on repeats. */
export function noteBusy(id, { status = 0, retryAfterMs = 0 } = {}) {
  const s = st(id);
  s.fails += 1;
  const base = retryAfterMs > 0 ? retryAfterMs : status === 429 ? 15000 : 6000;
  const span = retryAfterMs > 0 ? base : Math.min(60000, base * 2 ** Math.min(4, s.fails - 1));
  s.coolUntil = _now() + Math.round(span);
}

/* v3.33 · the quota ledger (quota.js) knows this lane is at its per-minute wall for exactly `ms`: cool it for that long, WITHOUT counting a failure
   (a failure would double the next cool-down and push the lane down the ranking for something that was not its fault). Never shortens a longer cool-down. */
export function coolFor(id, ms) {
  if (!(ms > 0)) return;
  const s = st(id);
  s.coolUntil = Math.max(s.coolUntil, _now() + Math.round(ms));
}

/* v3.33 · a nudge in loadScore points (0 = none): between equal lanes the one with more daily quota left goes first */
export function setBias(id, points) { st(id).bias = Number(points) > 0 ? Number(points) : 0; }

/* a lane let a hedge start (it sent nothing for a long time): until it proves itself again, equal lanes are preferred over it */
export function noteSlow(id, ms) {
  const s = st(id);
  s.ttft = Math.max(s.ttft || 0, Math.round(ms * 1.5));
}

/* forget "dead" marks (a fresh model list gives temporary failures a new chance) — only lanes whose id starts with `prefix` */
export function clearDead(prefix = "") {
  for (const [id, s] of S) if (id.startsWith(prefix)) s.deadUntil = 0;
}

/* v3.34 · the key changed (the key ring moved to the next key): the "asleep" marks of the lanes were earned by the OLD key, so they are forgotten. */
export function clearCool(prefix = "") {
  for (const [id, s] of S) if (id.startsWith(prefix)) { s.coolUntil = 0; s.fails = 0; }
}

/* a lane cannot answer for hours (404 · retired · daily quota · bad key) */
export function noteDead(id, ttlMs) { st(id).deadUntil = _now() + Math.max(1000, ttlMs || 6 * 3600e3); }

/* "request too large": this lane's token window cannot hold prompts of this size */
export function noteTooBig(id, tokens) {
  const s = st(id);
  const lim = Math.floor(tokens * 0.8);
  s.learnedMax = s.learnedMax ? Math.min(s.learnedMax, lim) : lim;
}

/* ── what kind of work is it? ── */

/* ocr    reads the image / PDF itself → needs the strongest vision lane
   solve  works out the right answer → accuracy first
   write  long teaching text (lesson parts, exam questions) → quality first, Arabic quality matters
   chat   the student is waiting for the first word (tutor chat, topic overview) → latency matters most
   quick  small structured jobs (words, topics, translation, diagrams) → any decent lane */
export function taskClass(task) {
  const t = String(task || "");
  if (/^(ocr|batch)/.test(t)) return "ocr";
  if (/^solve/.test(t)) return "solve";
  if (/^lesson:(chat|topic)/.test(t)) return "chat";
  if (/^(lesson[A-Za-z]*[:]|lessonS|lessonH|lessonT|exam)/.test(t) && !/^lesson:diagram/.test(t)) return "write";
  if (/^(words|word:|topics|lesson:diagram)/.test(t)) return "quick";
  return "write";
}

export function mediaOf(parts) {
  let image = false, pdf = false, file = false;
  for (const p of parts || []) {
    if (p && p.inlineData) { if (/^image\//.test(p.inlineData.mimeType || "")) image = true; else pdf = true; }
    if (p && p.fileData) file = true;
  }
  return { image, pdf, file, any: image || pdf || file };
}

/* rough token count: Arabic + English mix ≈ 3 characters per token (on purpose a little pessimistic: it decides "does it fit") */
export function estimateTokens(system, parts, maxOut = 0) {
  let chars = String(system || "").length;
  for (const p of parts || []) if (p && typeof p.text === "string") chars += p.text.length;
  return Math.ceil(chars / 3) + Math.max(0, maxOut | 0);
}

/* ── ordering ── */

const loadScore = (lane, index) => {
  const s = st(lane.id);
  const cool = s.coolUntil > _now() ? 1000 + (s.coolUntil - _now()) / 1000 : 0;
  return cool + s.inflight * 10 + s.fails * 4 + Math.min(8, s.ttft / 2500) + index * 2 + (s.bias || 0);
};

/* same kind and (almost) same generation → interchangeable for quality purposes */
const equivalent = (a, b) => a.kind === b.kind && (a.gen === 99 || b.gen === 99 || Math.abs(a.gen - b.gen) <= 0.6);

/* can this external lane take this request at all? */
export function fits(lane, { media, tokens }) {
  if (isDead(lane.id)) return false;
  if (media.pdf || media.file) return false;           // external lanes read text (and, where the lane says so, plain images) only
  if (media.image && !lane.vision) return false;
  const cap = Math.min(lane.maxTokens || 8000, st(lane.id).learnedMax || Infinity);
  return tokens <= cap;
}

/* Build the ordered list of lanes for one request.
     geminiModels  the caller's preference order (already without the models known to be dead)
     extLanes      configured external lanes (Groq / OpenRouter / Mistral …), best first
     mode          "quality" | "auto" | "speed"  (the student's choice in the 🔑 window)
   Returns { lanes, hedge }  — hedge = the lanes a hedged second request may use (quality mode: Gemini only). */
export function planLanes({ geminiModels, extLanes = [], cls = "write", mode = "auto", media = { any: false }, tokens = 0 }) {
  const seen = new Set();
  const gem = (geminiModels || []).filter((m) => m && !seen.has(m) && seen.add(m)).map(geminiLane);

  /* 1 · balance the lanes that are as good as the caller's first choice by their live load; the rest keep the caller's order */
  let ordered = gem;
  if (gem.length > 1) {
    const top = gem[0];
    const eq = [], rest = [];
    gem.forEach((l, i) => (equivalent(top, l) ? eq : rest).push({ l, i }));
    eq.sort((a, b) => loadScore(a.l, a.i) - loadScore(b.l, b.i));
    ordered = [...eq.map((x) => x.l), ...rest.map((x) => x.l)];
  }
  /* a lane the router has not marked dead, but that is cooling, is NOT removed: the runner skips it while another lane is ready and
     waits for it only when nothing else exists. Dead Gemini lanes were already removed by the caller. */
  ordered = ordered.filter((l) => !isDead(l.id) || ordered.every((x) => isDead(x.id)));

  /* 2 · external lanes that can really take this request */
  const fitting = extLanes.filter((l) => fits(l, { media, tokens }));
  /* v3.34 · PAID engines (ChatGPT, Claude) are a safety net, not a racer: they come after every other lane and are never used to hedge, so a key with real money
     behind it is only spent when the free lanes cannot answer */
  const ext = fitting.filter((l) => !l.paid), paid = fitting.filter((l) => l.paid);

  const interactive = cls === "chat" || cls === "quick";
  let lanes;
  if (!ext.length) lanes = ordered;
  else if (mode === "speed" && interactive) lanes = [ext[0], ...ordered, ...ext.slice(1)];
  else if (mode === "auto" && interactive) lanes = [ordered[0], ext[0], ...ordered.slice(1), ...ext.slice(1)].filter(Boolean);
  else lanes = [...ordered, ...ext];

  const hedge = mode === "quality" ? lanes.filter((l) => l.provider === "gemini") : lanes;
  return { lanes: [...lanes, ...paid], hedge };
}

/* ── hedging ── */

export const HEDGE_MS = {
  chat: { min: 4000, max: 9000 },
  quick: { min: 5000, max: 10000 },
  ocr: { min: 8000, max: 15000 },
  write: { min: 10000, max: 20000 },
  solve: { min: 15000, max: 30000 },
  search: { min: 9000, max: 16000 },       // v3.27: an answer that searches first: the first word is later than a plain chat, but a lane that is stuck is still raced early
};

/* how long to wait for the FIRST sign of life (any streamed part, a thought summary included) before a second lane is started */
export const FIRST_FLOOR_MS = { v: 20000 };          // a request silent this long after the key's measured typical time x 8 is given up on (tests lower it)
export const HEDGE_FLOOR_MS = { v: 5000 };          // never hedge sooner than this after a MEASURED typical time (a hedge is a request; tests lower it)
export function hedgeDelayMs(cls, lane, factor = 1, typical = 0) {
  const h = HEDGE_MS[cls] || HEDGE_MS.write;
  /* v3.33: when this key's real typical first-answer time for the model is KNOWN (quota.js), "silent for too long" is 3 times that, within [floor, the class maximum]:
     a fast key stops waiting 15-30 s for a request that has plainly stalled; a slow key is not hedged by a number that was written for a fast one. */
  if (typical > 0) return Math.round(Math.min(h.max, Math.max(HEDGE_FLOOR_MS.v, typical * 3)) * (factor > 0 ? Math.min(1, factor) : 1));
  const t = lane ? st(lane.id).ttft : 0;
  const want = t ? t * 2.5 : h.min * 1.3;
  /* v3.32: `factor` < 1 is the PAID profile (config.js): a healthy paid backend starts to answer within seconds, so a lane that is silent for
     half the usual time is already an outlier and the second lane is raced earlier. Never below 2 s (a hedge costs a request). */
  const base = Math.min(h.max, Math.max(h.min, want));
  if (!(factor > 0) || factor === 1) return Math.round(base);                       // FREE profile: exactly as before
  return Math.round(Math.max(Math.min(2000, base), base * factor));                  // PAID profile: earlier, but never under 2 s (a hedge is a paid request)
}

/* when everything is cooling: how long until the first lane comes back (0 = something is ready now) */
export function nextReadyIn(lanes) {
  const live = lanes.filter((l) => !isDead(l.id));
  if (!live.length) return Infinity;
  return Math.min(...live.map((l) => coolLeft(l.id)));
}
export const readyLanes = (lanes) => lanes.filter((l) => !isDead(l.id) && !isCooling(l.id));
