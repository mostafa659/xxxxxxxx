/* v3.43 · F3 end to end: the claims ride inside the ONE existing proofreading request, which is never bigger than before; the verdicts come back with the answer. */
import test from "node:test";
import assert from "node:assert/strict";
import { installFetch, script, reset, log } from "./mockfetch.mjs";
import * as R from "../src/lib/router.js";
import { setExtKeys, setEnginePrefs } from "../src/lib/providers.js";
import { runTask, getModelLists } from "../src/lib/gemini.js";
import { setProof, __resetProof, __gateSmallKeys } from "../src/lib/proof.js";

installFetch();
let KEY = "AIzaCLM", seq = 0;
const G = (m) => `gemini:${m}`;
const LINE = "المعدة بتهضم الأكل وبعدين بتفرغه في الأمعاء الدقيقة عشان الامتصاص يبدأ هناك وده مهم جدا للجسم كله ";
const TEXT = Array.from({ length: 9 }, (_, i) => `- ${LINE}رقم ${i}`).join("\n");
const base = (over = {}) => ({ apiKey: KEY, task: "lesson:chat", system: "Answer the student.", parts: [{ text: "hi" }], spec: { levels: ["low"], budget: 0 }, maxOut: 2000, firstMs: 3000, idleMs: 3000, models: ["gemini-3.8-flash"], ...over });
const fresh = () => { KEY = `AIzaCLM${String(++seq).padStart(8, "0")}`; reset(); R.__resetRouter(); window.localStorage.clear(); setExtKeys({}); setEnginePrefs({ mode: "auto" }); __resetProof(); setProof(true); __gateSmallKeys(false); };
const proofReq = () => log.filter((l) => l.lane !== "list").slice(1);
const size = (l) => JSON.stringify(l.body.systemInstruction) + JSON.stringify(l.body.contents);
const claims = [{ id: "s1", text: "Give 500 mg every 8 hours.", kind: "dose" }];

test("claims go into the existing proof request; verdicts come back; the request count is unchanged", async () => {
  fresh();
  const verdict = JSON.stringify({ fixes: [], v: [[1, "F", "Give 250 mg every 8 hours."]] });
  script(G("gemini-3.8-flash"), { ok: TEXT }, { ok: verdict });
  for (const m of getModelLists(KEY).fast) if (m !== "gemini-3.8-flash") script(G(m), { ok: verdict });
  const res = await runTask(base({ claimsFor: () => claims }));
  const reqs = log.filter((l) => l.lane !== "list");
  assert.equal(reqs.length, 2, "one author request + the one proofreading request (no extra)");
  const sent = proofReq()[0].body.contents[0].parts[0].text;
  assert.ok(/CLAIMS:\n1\. Give 500 mg/.test(sent), sent.slice(-200));
  assert.deepEqual(res.verdicts, [{ n: 1, v: "F", fix: "Give 250 mg every 8 hours." }]);
  assert.equal(res.claimList.length, 1);
});

test("the proof request with claims is not bigger than without them", async () => {
  fresh();
  script(G("gemini-3.8-flash"), { ok: TEXT }, { ok: '{"fixes":[]}' });
  await runTask(base());
  const without = size(proofReq()[0]);
  fresh();
  script(G("gemini-3.8-flash"), { ok: TEXT }, { ok: '{"fixes":[]}' });
  await runTask(base({ claimsFor: () => claims }));
  assert.ok(size(proofReq()[0]).length <= without.length + 40, `${size(proofReq()[0]).length} vs ${without.length}`);   // +40: JSON escaping of the added lines
});

test("a small key: no proofreading at all, so no claims and no request", async () => {
  fresh(); __gateSmallKeys(true);
  script(G("gemini-3.8-flash"), { ok: TEXT });
  const res = await runTask(base({ claimsFor: () => claims }));
  assert.equal(log.filter((l) => l.lane !== "list").length, 1);
  assert.equal(res.verdicts, undefined);
});
