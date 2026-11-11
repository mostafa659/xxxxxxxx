/* v3.36 · the silent solve is time-boxed: a stuck solve request must not hold the whole lesson (measured on a fake Google that hangs). */
import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "./../src/lib/router.js";
import * as Q from "../src/lib/quota.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";
import { SOLVE_BOX, MODES } from "../src/lib/config.js";

installFetch();
let KEY = "AIzaSPEED000", seq = 0;
const G = (m) => `gemini:${m}`;
const fresh = () => {
  KEY = `AIzaSPEED${String(++seq).padStart(6, "0")}`;
  reset(); R.__resetRouter(); window.localStorage.clear(); Q.__resetQuota(); Q.__setClock(null);
  setExtKeys({}); setEnginePrefs({ mode: "auto" });
};
const BRIEF = "ANSWER: B\nKEY: BRIEFMARK-9921 the verified reasoning";

const analyse = () => new Promise((resolve) => {
  const done = {}; const t0 = Date.now();
  const a = createAnalysis({
    kind: "question", history: [], dataUrl: "data:image/png;base64,iVBORw0KGgo=", doc: null, extra: "", chips: [], apiKey: KEY, modeId: "balanced",
    onUpdate() {}, onDone: (n) => { done[n] = Date.now() - t0; if (done.ocr !== undefined && done.words !== undefined && done.reason !== undefined) resolve({ a, done }); },
    onError: (n, e) => resolve({ a, done, err: [n, e && e.message] }), onNotice() {},
  });
  a.start();
});

test("balanced solve has short silence limits (it writes a tiny brief) and a box shorter than the old 120 s first-byte wait", () => {
  assert.ok(MODES.balanced.solve.firstMs <= 30000 && MODES.balanced.solve.idleMs <= 30000);
  assert.ok(SOLVE_BOX.balanced <= 30000);
});

test("a solve that hangs is cancelled at the box and the lesson is written at once WITHOUT the brief (it used to wait for the hung request)", async () => {
  fresh();
  const was = SOLVE_BOX.balanced; SOLVE_BOX.balanced = 300;
  try {
    /* flash-latest takes: part A (fast) · the solve (hangs 8 s) · the writer (fast) */
    script(G("gemini-flash-latest"), { ok: "A text" }, { wait: 8000, ok: BRIEF }, { ok: "B text" });
    const t0 = Date.now();
    const r = await analyse();
    const ms = Date.now() - t0;
    assert.equal(r.err, undefined);
    assert.ok(ms < 4000, `finished in ${ms} ms (a hung solve used to hold the writers until it answered or timed out)`);
    const lane = log.filter((l) => l.lane === G("gemini-flash-latest"));
    assert.equal(lane.length, 3, "A · solve · writer");
    assert.ok(!JSON.stringify(lane[2].body).includes("BRIEFMARK-9921"), "the writer started without the brief");
  } finally { SOLVE_BOX.balanced = was; }
});

test("a solve that answers inside the box keeps the verified path: the brief reaches the writer", async () => {
  fresh();
  script(G("gemini-flash-latest"), { ok: BRIEF });
  const r = await analyse();
  assert.equal(r.err, undefined);
  assert.equal(log.filter((l) => l.lane !== "list" && JSON.stringify(l.body).includes("BRIEFMARK-9921")).length, 1);
});
