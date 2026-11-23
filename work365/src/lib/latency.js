/* ───────────── Where did the time go? (v3.32) ─────────────
   Until now the app only showed how long each stage took. A stage that took 409 s looked the same whether Google kept the connection waiting,
   the model was thinking, or the answer was simply long, and each of those has a different cure. Every model call now leaves a TRACE, and this file
   turns traces into one honest sentence.

   One call (runTask in gemini.js) = one trace:
     t0         the moment the call started
     slept      time spent only waiting for lanes (models) to wake up from a 429 / 503
     attempts[] every lane that was tried: { lane, t0, aliveAt, textAt, endAt, outcome: ok | fail | lost | cancel, status, why, usage, tier }
   For the lane that finally answered the time is cut in four pieces that add up to the total:
     lost   everything BEFORE that lane started: lanes that failed or timed out, back-off sleeps
     wait   that lane started → its first sign of life (the server's queue; also thinking when no thought summary is streamed)
     think  first sign of life → first visible word (thought summaries streaming)
     write  first visible word → the last one
   When Google reports `thoughtsTokenCount` the hidden thinking inside `wait` is estimated from the writing speed and moved to `think`
   (marked "≈": it is an estimate, never presented as a measurement).

   Plain logic: no network, no DOM, no storage → it is tested in Node (tests/latency.test.mjs). */

const ms = (n) => Math.max(0, Math.round(Number(n) || 0));

/* a short label for one failed attempt: "503", "429", "timeout", "empty" … */
export function whyFailed(a) {
  if (!a) return "";
  if (a.why) return a.why;
  if (a.status) return String(a.status);
  return "net";
}

/* one trace → the four pieces + what went wrong on the way */
export function breakdown(trace) {
  if (!trace) return null;
  const end = trace.endAt || Date.now();
  const totalMs = ms(end - trace.t0);
  const atts = trace.attempts || [];
  const win = [...atts].reverse().find((a) => a.outcome === "ok") || null;
  const failed = atts.filter((a) => a.outcome === "fail");

  const out = {
    task: trace.task || "", ok: !!win, totalMs, lostMs: 0, waitMs: 0, thinkMs: 0, writeMs: 0, thinkEst: false,
    thoughtTokens: 0, outTokens: 0, promptTokens: 0, tps: 0,
    failed: failed.map(whyFailed), hedges: trace.hedges || 0, sleptMs: ms(trace.slept), attempts: atts.length,
    lane: win ? win.lane : "", tier: win ? win.tier || "" : "", gwMs: win ? ms(win.gwMs) : 0,
  };
  if (!win) { out.lostMs = totalMs; return out; }

  out.lostMs = ms(win.t0 - trace.t0);
  const alive = win.aliveAt || win.textAt || win.endAt;
  const text = win.textAt || win.endAt;
  out.waitMs = ms(alive - win.t0);
  out.thinkMs = ms(text - alive);
  out.writeMs = ms(end - text);                      // up to the moment the call returned: the few ms between the last word and the return belong to writing, so the four pieces ALWAYS add up to the total

  const u = win.usage || {};
  out.thoughtTokens = ms(u.thoughtsTokenCount);
  out.outTokens = ms(u.candidatesTokenCount);
  out.promptTokens = ms(u.promptTokenCount);
  /* writing speed from the visible part (needs a few hundred ms of writing, otherwise the figure is noise) */
  if (out.outTokens > 20 && out.writeMs > 400) out.tps = Math.round(out.outTokens / (out.writeMs / 1000));
  /* hidden thinking: it sits inside `wait` (no thought summaries) — estimate it from the speed and move it over */
  if (out.thoughtTokens > 0 && out.tps > 0 && out.thinkMs < out.waitMs * 0.2) {
    const est = Math.min(out.waitMs, ms((out.thoughtTokens / out.tps) * 1000));
    out.thinkMs += est; out.waitMs -= est; out.thinkEst = true;
  }
  return out;
}

/* "503×2 · timeout×1" */
export function tally(labels) {
  const m = new Map();
  for (const l of labels) m.set(l, (m.get(l) || 0) + 1);
  return [...m].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join(" · ");
}

/* many traces of one stage (a stage can be several parallel calls) → the one that decided the finish time + what went wrong anywhere */
export function summarize(traces) {
  const rows = (traces || []).map(breakdown).filter(Boolean);
  if (!rows.length) return null;
  const crit = rows.reduce((m, r) => (r.totalMs > m.totalMs ? r : m), rows[0]);
  const failed = rows.flatMap((r) => r.failed);
  return {
    ...crit,
    calls: rows.length,
    failedAll: failed,
    hedgesAll: rows.reduce((n, r) => n + r.hedges, 0),
    unfinished: rows.filter((r) => !r.ok).length,
  };
}

/* what the student / developer reads under the result */
const s1 = (n) => `${Math.round(n / 100) / 10}ث`;
const sK = (n) => (n >= 1000 ? `${(Math.round(n / 100) / 10).toString()}k` : String(n));

export function describe(sum) {
  if (!sum) return "";
  const parts = [];
  if (sum.lostMs >= 1500) {
    const why = tally(sum.failed);
    parts.push(`ضاع ${s1(sum.lostMs)} في محاولات فاشلة وانتظار${why ? ` (${why})` : ""}`);
  }
  if (sum.waitMs >= 800) parts.push(`انتظار أول رد ${s1(sum.waitMs)}`);
  if (sum.thinkMs >= 800) parts.push(`تفكير ${sum.thinkEst ? "≈" : ""}${s1(sum.thinkMs)}`);
  if (sum.writeMs >= 400) parts.push(`كتابة ${s1(sum.writeMs)}${sum.outTokens ? ` (${sK(sum.outTokens)} توكن${sum.tps ? ` · ${sum.tps}/ث` : ""})` : ""}`);
  const extra = [];
  if (sum.hedgesAll) extra.push(`تحوّط ×${sum.hedgesAll}`);
  if (sum.tier) extra.push(`مستوى ${sum.tier}`);
  if (sum.unfinished) extra.push(`${sum.unfinished} طلب ما خلصش`);
  if (!parts.length && !extra.length) return `${s1(sum.totalMs)}`;
  return `${s1(sum.totalMs)} = ${parts.join(" + ") || "—"}${extra.length ? ` · ${extra.join(" · ")}` : ""}`;
}

/* the biggest single cause of waiting, in one word, so a screen can colour it:  "queue" | "retries" | "thinking" | "writing" | "none" */
export function dominant(sum) {
  if (!sum || sum.totalMs < 4000) return "none";
  const parts = { retries: sum.lostMs, queue: sum.waitMs, thinking: sum.thinkMs, writing: sum.writeMs };
  const [k, v] = Object.entries(parts).sort((a, b) => b[1] - a[1])[0];
  return v >= sum.totalMs * 0.4 ? k : "none";
}

/* which stage does a task id belong to? ocr · words · reason (solve + every lesson part) */
export const stageOf = (task) => {
  const t = String(task || "");
  if (t === "ocr") return "ocr";
  if (t === "words") return "words";
  if (/^(solve|lesson[A-Z])/.test(t)) return "reason";      // lessonA · lessonB · lessonBx · lessonM · lessonT · lessonS · lessonH …  (NOT "lesson:chat" / "lesson:diagram": those are not part of an analysis)
  return "other";
};
