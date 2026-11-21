import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, reset, log, script } from "./mockfetch.mjs";
import * as Router from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { createAnalysis } from "../src/lib/analysis.js";

installFetch();
let seq = 0;
const G = (m) => `gemini:${m}`;

test("health answers receive one grounded search request and expose returned source metadata", async () => {
  const key = `AIzaHEALTH${String(++seq).padStart(8, "0")}`;
  reset(); Router.__resetRouter(); window.localStorage.clear();
  setExtKeys({}); setEnginePrefs({ mode: "auto" });
  script(G("gemini-flash-latest"), {
    ok: "## 🎯 What is being asked?\n## 🧠 Reasoning\n## ✅ Answer\nGeneral educational answer.",
    grounding: {
      webSearchQueries: ["current evidence for adult hypertension management"],
      groundingChunks: [{ web: { uri: "https://www.who.int/example", title: "WHO health guidance" } }],
    },
  });
  const trust = [];
  await new Promise((resolve, reject) => {
    let finished = false;
    const done = new Set();
    const timeout = setTimeout(() => reject(new Error("analysis did not finish")), 10000);
    const a = createAnalysis({
      kind: "question", history: [], dataUrl: null,
      doc: { kind: "text", name: "question.txt", text: "A patient asks about current evidence for hypertension treatment and cardiovascular risk." },
      extra: "", chips: [], apiKey: key, modeId: "balanced",
      onUpdate() {},
      onDone: (name) => { done.add(name); if (!finished && done.has("reason") && done.has("words")) { finished = true; clearTimeout(timeout); resolve(); } },
      onError: (name, err) => { clearTimeout(timeout); reject(new Error(`${name}: ${err?.message || err}`)); },
      onNotice() {}, onTrust: (t) => trust.push(t),
    });
    a.start();
  });
  const requests = log.filter((x) => x.lane !== "list");
  const groundedRequests = requests.filter((x) => Array.isArray(x.body?.tools) && x.body.tools.some((t) => t.google_search));
  assert.equal(groundedRequests.length, 1, "one evidence retrieval pass per health analysis");
  assert.ok(groundedRequests[0].body.systemInstruction.parts[0].text.includes("UNIVERSAL HEALTHCARE ANSWER QUALITY PROTOCOL"));
  const final = trust.find((x) => x.phase === "final");
  assert.ok(final?.medicalSearch?.performed);
  assert.equal(final.medicalSearch.sources, 1);
  assert.ok(final.clinicalQualityAudit?.triggered);
});
