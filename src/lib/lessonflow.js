/* ───────────── "Explained from zero" for long material — written in parallel slices (v3.24) ─────────────
   Why it was slow: the whole basics section (≈1,100+ words, much more for a long chapter) was ONE answer written word after word, and
   the other parts waited behind it on the screen. The time of a lesson = the time of its longest single answer.

   Now, for long material, the lesson is cut into pieces that are written AT THE SAME MOMENT by tutors that all get the SAME instructions
   (same student profile, same teaching rules, same quality bar, same sections, same depth):

     head   plan (a list of topics) + the big idea + the English from the material      starts at t = 0
     slice  the explanation from zero + the must-memorize list for ITS topics only       starts the moment the plan is readable
     tail   how it appears on the exam + the memory sentences + the traps                starts at t = 0

   The plan is the first thing the head tutor writes, and it is read while the head is still streaming, so the slices start about 3 – 6 s in.
   The pieces are put back in the order of the normal lesson, and the screen shows them in order without ever jumping:
   a piece appears only when everything before it is complete (exactly the rule of the old three-part flow).

   Nothing here talks to Google directly: `stage` (analysis.js → gemini.js) does, with its retries, so this file is plain logic
   and can be tested with a fake `stage`.                                                                                       */

/* ── how big is the material? (in "pages") ── */
export function estimatePages(doc) {
  if (!doc) return 1;
  const items = doc.kind === "bundle" ? doc.items || [] : [doc];
  let pages = 0;
  for (const it of items) {
    const kind = it.t || it.kind;
    if (kind === "image") pages += 1;
    else if (kind === "pdf") {
      const bytes = it.size || Math.round(String(it.data || "").length * 0.75);
      pages += Math.max(1, bytes / 90000);
    } else {
      const chars = String(it.text || "").length || it.size || 0;
      pages += Math.max(0.5, chars / 2600);
    }
  }
  return pages;
}

export function shouldSlice({ doc, slices, minPages }) {
  return slices >= 2 && !!doc && estimatePages(doc) >= minPages;
}

/* ── marker sections:  ===NAME=== lines.  Works on any prefix of a stream (a half-written marker is hidden). ── */
const markerRe = (names) => new RegExp(`^[ \\t]*={2,}[ \\t]*(${names.join("|")})[ \\t]*={2,}[ \\t]*$`, "gim");

export function splitMarked(raw, names, final) {
  const text = String(raw || "").replace(/\r/g, "");
  const re = markerRe(names);
  const hits = [];
  let m;
  while ((m = re.exec(text))) hits.push({ name: m[1].toUpperCase(), start: m.index, end: m.index + m[0].length });
  const out = {};
  names.forEach((n) => { out[n] = { text: "", open: false, seen: false }; });
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    const to = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const body = text.slice(h.end, to);
    const slot = out[h.name];
    if (slot && !slot.seen) { slot.text = body.replace(/^\n/, ""); slot.seen = true; slot.open = i === hits.length - 1; }
  }
  /* a half-written marker at the very end ("===MU") must not flash on screen */
  if (!final && hits.length) {
    const last = hits[hits.length - 1];
    const slot = out[last.name];
    if (slot) slot.text = hideTail(slot.text);
  } else if (!final) {
    /* nothing recognised yet: nothing to show */
  }
  names.forEach((n) => { out[n].text = out[n].text.trim(); if (final) out[n].open = false; });
  return out;
}

function hideTail(s) {
  const nl = s.lastIndexOf("\n");
  const last = s.slice(nl + 1).trim();
  return last && /^=+[ \t]*[A-Z]*[ \t]*=*$/.test(last) ? s.slice(0, nl + 1) : s;
}

/* ── the plan ── */
const PLAN_START = /^[ \t]*={2,}[ \t]*PLAN[ \t]*={2,}[ \t]*$/im;
const PLAN_END = /^[ \t]*={2,}[ \t]*END[ \t]*={2,}[ \t]*$/im;

/* state: "pending" (not readable yet) · "ready" (topics found) · "none" (the tutor ignored the format: the plan will never come) */
export function parsePlan(raw, final) {
  const text = String(raw || "").replace(/\r/g, "");
  const s = PLAN_START.exec(text);
  const afterStart = s ? s.index + s[0].length : 0;
  const e = s ? PLAN_END.exec(text.slice(afterStart)) : null;
  if (!s || !e) {
    /* markers missing: still waiting, unless the tutor has clearly started writing the lesson itself, or the answer is over */
    const wrote = /^##\s/m.test(text) && !s;
    const endless = !!s && text.length - afterStart > 2500;       // a plan block that never closes
    if (final || wrote || endless || (!s && text.length > 700)) return { state: "none", topics: [], body: stripPlanLeft(endless || final ? text.slice(afterStart) : text) };
    return { state: "pending", topics: [], body: "" };
  }
  const block = text.slice(afterStart, afterStart + e.index);
  const body = text.slice(afterStart + e.index + e[0].length).replace(/^\n/, "");
  const topics = [];
  block.split("\n").forEach((line) => {
    const l = line.trim();
    if (!l) return;
    const parts = l.split("|").map((x) => x.trim());
    if (parts.length < 2) return;
    const n = parseInt(parts[0], 10);
    const title = parts[1].replace(/\*\*/g, "").trim();
    if (!title) return;
    const w = parseInt(parts[2], 10);
    topics.push({ n: Number.isFinite(n) ? n : topics.length + 1, title, weight: w >= 1 && w <= 3 ? w : 2, where: (parts[3] || "").replace(/\*\*/g, "").trim() });
  });
  if (!topics.length) return { state: "none", topics: [], body };
  topics.forEach((t, i) => { t.n = i + 1; });   // always 1..N, whatever the tutor numbered
  return { state: "ready", topics, body };
}
const stripPlanLeft = (text) => text.replace(PLAN_START, "").replace(PLAN_END, "").trim();

/* ── topics → slices: k contiguous groups whose heaviest group is as light as possible (small dynamic programme: ≤ 14 topics, ≤ 5 slices) ── */
export function groupTopics(topics, maxSlices, perSlice = 5) {
  const n = topics.length;
  if (!n) return [];
  const total = topics.reduce((s, t) => s + t.weight, 0);
  const k = Math.max(1, Math.min(maxSlices, n, Math.ceil(total / perSlice)));
  if (k === 1) return [topics];
  const pre = [0];
  topics.forEach((t) => pre.push(pre[pre.length - 1] + t.weight));
  const cost = Array.from({ length: k + 1 }, () => Array(n + 1).fill(Infinity));
  const cut = Array.from({ length: k + 1 }, () => Array(n + 1).fill(0));
  cost[0][0] = 0;
  for (let j = 1; j <= k; j++) {
    for (let i = j; i <= n; i++) {
      for (let p = j - 1; p < i; p++) {
        const c = Math.max(cost[j - 1][p], pre[i] - pre[p]);
        if (c < cost[j][i]) { cost[j][i] = c; cut[j][i] = p; }
      }
    }
  }
  const groups = [];
  let i = n;
  for (let j = k; j >= 1; j--) { const p = cut[j][i]; groups.unshift(topics.slice(p, i)); i = p; }
  return groups;
}

/* ───────────── the orchestrator ─────────────
   deps:
     stage(task, cfg, prompt, signal, onText) → Promise<{ text, model }>     (onText(fullText, model) while streaming)
     prompts: { head(words), slice({ topics, all, words, mustWords, single }), tail(words) }
     cfg: { head, slice, tail }          model settings for each kind of request
     headings: { big, basics, english, exam, must, memo }
     words: { head, basics, must, tail }  targets in words for the whole lesson
     maxSlices, onUpdate, onDone, onError
   returns { start(), abort() } */
export function createSlicedLesson(deps) {
  const { stage, prompts, cfg, headings, words, maxSlices, onUpdate, onDone, onError } = deps;
  const ctrl = new AbortController();
  const sig = ctrl.signal;
  const t0 = performance.now();
  const since = () => performance.now() - t0;
  const secs = (ms) => Math.round(ms / 100) / 10;
  const isAbort = (err) => !err || err.name === "AbortError";

  const H = { text: "", done: false, fail: null, model: "" };
  const T = { text: "", done: false, fail: null, model: "" };
  let slices = [];            // [{ topics, text, done, fail, model }]
  let planned = false;        // slices have been started
  let over = false;
  const marks = { plan: 0, firstSlice: 0, head: 0, tail: 0 };

  /* ── reading the streams ── */
  const headParts = (final) => {
    const p = parsePlan(H.text, final || H.done || !!H.fail);
    const body = p.body;
    const m = /^##\s*🔤.*$/m.exec(body);
    const big = m ? body.slice(0, m.index) : body;
    const english = m ? body.slice(m.index) : "";
    return { plan: p, big: big.trim(), english: english.trim(), englishSeen: !!m };
  };
  /* a slice that broke off: keep what was written only if it is substantial, and only whole lines (never a half sentence) */
  const usable = (s) => {
    if (!s.fail || s.done) return s.text;
    const cut = s.text.slice(0, s.text.lastIndexOf("\n") + 1);
    return cut.length >= 400 ? cut : "";
  };
  const sliceParts = (s, final) => splitMarked(usable(s), ["BASICS", "MUST"], final || s.done || !!s.fail);
  const tailParts = (final) => splitMarked(T.text, ["EXAM", "MEMO", "TRICKS"], final || T.done || !!T.fail);
  const hDone = () => H.done || !!H.fail;
  const sDone = (s) => s.done || !!s.fail;
  const tDone = () => T.done || !!T.fail;

  /* ── segments of the explanation, in the order of the normal lesson ── */
  const segments = (final) => {
    const hp = headParts(final);
    const tp = tailParts(final);
    const seg = [];
    seg.push({ text: hp.big, done: hp.englishSeen || hDone() });
    if (planned) {
      slices.forEach((s, i) => {
        const sp = sliceParts(s, final);
        const body = sp.BASICS.text;
        seg.push({ text: body ? (i === 0 ? `${headings.basics}\n${body}` : body) : "", done: sDone(s) || sp.MUST.seen });
      });
    } else {
      seg.push({ text: "", done: false });             // the basics are still on their way: nothing after them may show yet
    }
    seg.push({ text: hp.english, done: hDone() });
    seg.push({ text: tp.EXAM.text, done: tp.MEMO.seen || tp.TRICKS.seen || tDone() });
    if (planned) {
      let heading = true;
      slices.forEach((s) => {
        const sp = sliceParts(s, final);
        const body = sp.MUST.text;
        seg.push({ text: body ? (heading ? `${headings.must}\n${body}` : body) : "", done: sDone(s) });
        if (body) heading = false;
      });
    }
    seg.push({ text: tp.MEMO.text, done: tp.TRICKS.seen || tDone() });
    return { seg, tricks: tp.TRICKS.text };
  };

  const compose = (final) => {
    const { seg, tricks } = segments(final);
    const out = [];
    for (const s of seg) {
      if (s.text) out.push(s.text);
      if (!final && !s.done) break;                      // never show anything beyond a piece that is still being written
    }
    const text = out.join("\n");
    return { explanation: text || (final ? "" : null), tricks };
  };

  const chars = () => H.text.length + T.text.length + slices.reduce((n, s) => n + s.text.length, 0);
  const emit = (final) => { if (!over && !sig.aborted) onUpdate("reason", compose(final), { chars: chars(), model: T.model || H.model, final }); };

  const fail = (err) => {
    if (over || sig.aborted) return;
    over = true;
    ctrl.abort();
    onError("reason", err, chars() ? compose(true) : null);
  };
  const settle = () => {
    if (over || sig.aborted) return;
    if (!hDone() || !tDone() || !planned || !slices.every(sDone)) return;
    const err = slices.map((s) => s.fail).find(Boolean) || T.fail || H.fail;
    if (err) return fail(err);
    over = true;
    onUpdate("reason", compose(true), { chars: chars(), model: T.model || H.model, final: true });
    onDone("reason", { ms: since(), chars: chars(), model: T.model || H.model, stages: { plan: secs(marks.plan), slices: slices.length, total: secs(since()) } });
  };

  /* ── starting a request ── */
  const run = (slot, task, c, prompt, after) => stage(task, c, prompt, sig, (full, model) => {
    slot.text = full; slot.model = model;
    if (slot === H) maybeStartSlices(false);
    emit(false);
  }).then(({ text, model }) => {
    slot.text = text; slot.model = model; slot.done = true;
    if (slot === H) { marks.head = since(); maybeStartSlices(true); }
    if (slot === T) marks.tail = since();
    if (after) after();
    emit(false); settle();
  }).catch((err) => {
    if (isAbort(err) || sig.aborted) return;
    if (err.fatal) return fail(err);
    slot.fail = err;
    if (slot === H) maybeStartSlices(true);
    emit(false); settle();
  });

  function startSlices(topicsOrNull) {
    if (planned || over || sig.aborted) return;
    planned = true;
    marks.plan = since();
    const all = topicsOrNull && topicsOrNull.length ? topicsOrNull : null;
    const groups = all ? groupTopics(all, maxSlices) : [[]];
    const total = all ? all.reduce((n, t) => n + t.weight, 0) : 1;
    slices = groups.map((g) => ({ topics: g, text: "", done: false, fail: null, model: "" }));
    slices.forEach((s) => {
      const share = all ? s.topics.reduce((n, t) => n + t.weight, 0) / total : 1;
      const prompt = prompts.slice({
        topics: s.topics, all: all || [], single: !all || groups.length === 1,
        words: Math.max(220, Math.round(words.basics * share)),
        mustWords: Math.max(110, Math.round(words.must * share)),
      });
      run(s, "lessonS", cfg.slice, prompt);   // one task name for all slices: they share what the retry engine learns about this model
    });
    marks.firstSlice = since();
    emit(false);
  }

  /* the plan is read while the head tutor is still writing */
  function maybeStartSlices(final) {
    if (planned) return;
    const p = parsePlan(H.text, final || hDone());
    if (p.state === "ready") startSlices(p.topics);
    else if (p.state === "none") startSlices(null);      // no plan: ONE slice for the whole material (still parallel with head and tail)
    else if (final) startSlices(null);
  }

  return {
    start() {
      run(H, "lessonH", cfg.head, prompts.head(words.head));
      run(T, "lessonT", cfg.tail, prompts.tail(words.tail));
    },
    abort() { ctrl.abort(); },
    /* test hooks */
    _state: () => ({ H, T, slices, planned }),
    _compose: compose,
  };
}
