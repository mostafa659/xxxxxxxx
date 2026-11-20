import test from "node:test";
import assert from "node:assert/strict";
import { entries } from "../src/lib/kb/modules/specialized-pharmacogenomics-pilot.js";
import * as SP from "../src/lib/kb/specialized.js";
import { buildPilotPair, loadPilot, runPilotBenchmark } from "../scripts/specialized-pilot-benchmark.mjs";

const profile = { discipline: "medicine", exam: "", region: "" };
const ids = (rows) => rows.map((x) => x.entry.id);

test.beforeEach(() => SP.__resetSpecialized());

test("the first real specialist batch is compact, sourced, current and explicitly draft pending human clinical review", () => {
  assert.equal(entries.length, 7);
  assert.ok(entries.every((e) => e.approval.status === "draft"), "no entry is falsely represented as human-approved");
  assert.ok(entries.every((e) => e.evidence.length && e.evidence.every((s) => s.sourceVerified && s.quoteVerified && s.url.includes("fda.gov"))));
  assert.deepEqual(new Set(entries.map((e) => e.version)), new Set(["2026-09-10"]));
  assert.equal(new Set(entries.map((e) => e.id)).size, 7);
});

test("draft pilot knowledge loads for review but never reaches production retrieval or student prompts", async () => {
  await SP.loadSpecialized(profile);
  assert.equal(SP.loadedSpecialized().length, 80);
  for (const entry of entries) assert.equal(SP.specializedStatus(entry), "unapproved");
  assert.deepEqual(SP.lookupSpecialized("HLA-B*57:01 abacavir hypersensitivity", profile), []);
  assert.deepEqual(SP.specializedCandidatesForProfile(profile), []);
});

test("baseline and evaluation-only enriched prompts differ only by the selected specialist references", () => {
  const pilot = loadPilot();
  assert.equal(pilot.cases.length, 7);
  for (const item of pilot.cases) {
    const pair = buildPilotPair(item);
    assert.ok(!pair.baseline.user.includes("SPECIALIZED MEDICAL REFERENCES"));
    assert.ok(pair.specialized.user.includes("SPECIALIZED MEDICAL REFERENCES"));
    for (const id of item.entryIds) assert.ok(pair.specialized.user.includes(id));
    assert.match(pair.specialized.system, /Do not mention this internal library/);
  }
});

test("the paired benchmark uses the same model settings, alternates order, and writes blind A/B outputs plus a separate key", async () => {
  const calls = [];
  const fakeFetch = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, options, body });
    const hasLibrary = body.contents[0].parts[0].text.includes("SPECIALIZED MEDICAL REFERENCES");
    const answer = hasLibrary ? "Enriched answer with source nuance." : "Baseline answer.";
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ candidates: [{ content: { parts: [{ text: answer }] } }] }),
    };
  };
  const out = await runPilotBenchmark({ apiKey: "test-key", model: "gemini-flash-latest", fetchImpl: fakeFetch, now: "2026-11-20T00:00:00.000Z" });
  assert.equal(calls.length, 14);
  assert.equal(out.blindResults.pairs.length, 7);
  assert.equal(out.blindKey.conditions.length, 7);
  assert.ok(calls.every((c) => c.url.includes("/gemini-flash-latest:generateContent")));
  assert.ok(calls.every((c) => c.body.generationConfig.temperature === 0 && c.body.generationConfig.maxOutputTokens === 700));
  assert.deepEqual(out.blindKey.conditions[0], { caseId: "pgx-tier-semantics", A: "baseline", B: "specialized" });
  assert.deepEqual(out.blindKey.conditions[1], { caseId: "fda-table-testing-mandate", A: "specialized", B: "baseline" });
  assert.ok(out.blindResults.pairs.every((p) => p.A && p.B));
});

test("benchmark refuses to run without an explicit API key", async () => {
  await assert.rejects(() => runPilotBenchmark({ apiKey: "" }), /GEMINI_API_KEY is required/);
});
