/* ───────────── Progress model ─────────────
   Turns "what has happened so far" into: percent + estimated seconds remaining.
   Expected durations start from sensible defaults and are LEARNED from the user's real runs
   (stored as an exponential moving average), so the countdown becomes accurate over time. */

export const DEFAULT_PERF = {
  ocr:                { ms: 2800,  chars: 520 },
  words:              { ms: 6500,  chars: 1100 },
  "reason2:balanced": { ms: 15000, chars: 3300 },
  "reason2:deep":     { ms: 38000, chars: 4300 },
};

// "reason2": the lesson is now a parallel pipeline, so numbers learned from the old single-stream version are ignored
export const perfKey = (task, modeId) => (task === "reason" ? `reason2:${modeId}` : task);

const fresh = (k, perf, now) => {
  const p = perf[k] || DEFAULT_PERF[k];
  return { start: now, end: null, chars: 0, expMs: p.ms, expChars: p.chars, state: "run" };
};

export function createTracker(modeId, perf = {}) {
  const now = Date.now();
  const mk = (task) => fresh(perfKey(task, modeId), perf, now);
  return { t0: now, modeId, tasks: { ocr: mk("ocr"), words: mk("words"), reason: mk("reason") }, shown: 0 };
}

export function restartTask(tracker, task, perf = {}) {
  tracker.tasks[task] = fresh(perfKey(task, tracker.modeId), perf, Date.now());
  tracker.shown = Math.min(tracker.shown, 98);
}

/* streamed characters so far (drives the bar faster than the clock when the model is quick) */
export function feed(tracker, task, chars) {
  const t = tracker.tasks[task];
  if (t) t.chars = chars;
}

/* state: "done" | "error" | "stopped" */
export function settle(tracker, task, state) {
  const t = tracker.tasks[task];
  if (t) { t.state = state; t.end = Date.now(); }
}

/* 0..1 for one running task: linear up to 85 %, then an asymptote towards 97 % so the bar never lies "done". */
function runningFrac(t, now) {
  const e = Math.max(0, now - t.start);
  const lin = 0.85 * t.expMs;
  const timeFrac = e <= lin ? e / t.expMs : 0.85 + 0.12 * (1 - Math.exp(-(e - lin) / (0.5 * t.expMs)));
  const charFrac = t.chars > 0 ? Math.min(0.97, t.chars / t.expChars) : 0;
  return Math.min(0.97, Math.max(timeFrac, charFrac));
}

export function snapshot(tracker, now = Date.now()) {
  const list = Object.values(tracker.tasks);
  let wSum = 0, fSum = 0, remaining = 0, running = 0;
  for (const t of list) {
    wSum += t.expMs;
    if (t.state === "run") {
      const f = runningFrac(t, now);
      fSum += t.expMs * f;
      remaining = Math.max(remaining, t.expMs * (1 - f));
      running += 1;
    } else {
      fSum += t.expMs;
    }
  }
  const raw = running ? (fSum / wSum) * 100 : 100;
  tracker.shown = Math.max(tracker.shown, Math.min(raw, running ? 99 : 100)); // monotonic, never goes backwards
  const done = running === 0;
  return {
    percent: Math.round(tracker.shown),
    remainingSec: done ? 0 : Math.max(1, Math.ceil(remaining / 1000)),
    almost: !done && remaining < 1500,
    done,
    elapsedSec: Math.max(0, ((done ? Math.max(...list.map((t) => t.end || now)) : now) - tracker.t0) / 1000),
  };
}

export function learn(perf, task, modeId, ms, chars) {
  const k = perfKey(task, modeId);
  const base = perf[k] || DEFAULT_PERF[k];
  const mix = (a, b) => Math.round(a * 0.55 + b * 0.45);
  return { ...perf, [k]: { ms: mix(base.ms, Math.max(800, ms)), chars: mix(base.chars, Math.max(60, chars)) } };
}

export const expectedMs = (perf, task, modeId) => (perf[perfKey(task, modeId)] || DEFAULT_PERF[perfKey(task, modeId)]).ms;

export const fmtRemaining = (s) => (s >= 90 ? `~${Math.ceil(s / 60)} د` : `~${s} ث`);
