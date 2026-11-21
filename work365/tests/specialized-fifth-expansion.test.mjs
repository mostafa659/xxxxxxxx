import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { entries } from "../src/lib/kb/modules/specialized-fifth-major-expansion-2026.js";
import { buildSpecialized } from "../scripts/build-kb.mjs";
import * as SP from "../src/lib/kb/specialized.js";
import { attachSpecializedKnowledge, inferSpecializedContext, isEvidenceAppraisalQuery, prepareSpecializedPrompt } from "../src/lib/kb/specialized-prompt.js";

const readJson = (relative) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));
const NOW = Date.parse("2026-11-20T12:00:00Z");
const human = { discipline: "medicine", exam: "", region: "" };
const swiss = { discipline: "medicine", exam: "", region: "Switzerland" };
const vet = { discipline: "veterinary", exam: "", region: "" };
const ids = (rows) => rows.map((x) => x.entry.id);
const approvedForTest = (e) => ({
  ...e,
  approval: {
    status: "approved",
    reviewer: "Automated test fixture — NOT a clinical approval",
    reviewedAt: "2026-11-20",
    checks: { claimSupport: true, clinicalAccuracy: true, scopeAndExceptions: true },
  },
});

test.beforeEach(() => SP.__resetSpecialized());

test("the fifth expansion contains 34 unique, schema-valid, source-backed draft records", () => {
  assert.equal(entries.length, 34);
  assert.equal(new Set(entries.map((e) => e.id)).size, 34);
  assert.ok(entries.every((e) => e.approval?.status === "draft"));
  assert.ok(entries.every((e) => SP.validateSpecialized(e).length === 0));
  for (const e of entries) {
    assert.ok(e.evidence.length > 0, `${e.id}: source evidence required`);
    assert.ok(e.evidence.every((v) => v.verified && v.sourceVerified && v.quoteVerified && /^https:\/\//.test(v.url)), `${e.id}: provenance flags and https source required`);
    assert.ok(e.applicability.conditions.length > 0, `${e.id}: applicability required`);
    assert.ok(e.exceptions.length > 0 || e.noExceptionsNote, `${e.id}: exceptions must be assessed`);
    assert.ok(e.value.beyondGeneral.length >= 60 && e.value.generalAnswerRisk.length >= 30, `${e.id}: incremental value required`);
    assert.ok(e.reviewBy && e.version && e.checkedAt, `${e.id}: currency metadata required`);
  }
});

test("the strict builder rebuilds all 34 candidates and rejects none", () => {
  const manifest = readJson("../knowledge/specialized/fifth-major-expansion-2026/manifest.json");
  const candidates = readJson("../knowledge/specialized/fifth-major-expansion-2026/candidates.json");
  assert.equal(manifest.sources.length, 7);
  assert.equal(candidates.length, 34);
  const out = buildSpecialized(manifest, candidates, { today: "2026-11-20", general: { facts: [], rules: [] } });
  assert.equal(out.accepted.length, 34, JSON.stringify(out.rejected));
  assert.deepEqual(out.rejected, []);
  assert.deepEqual(out.accepted.map((e) => e.id), entries.map((e) => e.id));
  assert.ok(out.accepted.every((e) => e.approval.status === "draft"));
  assert.ok(out.accepted.every((e) => e.evidence.every((v) => v.verified && v.sourceVerified && v.quoteVerified)));
});

test("all 80 shipped specialist records load for audit but drafts never enter student retrieval", async () => {
  await SP.loadSpecialized(human);
  assert.equal(SP.loadedSpecialized().length, 80);
  assert.ok(SP.loadedSpecialized().every((e) => e.approval.status === "draft"));
  assert.ok(SP.loadedSpecialized().every((e) => SP.specializedStatus(e, NOW) === "unapproved"));
  assert.deepEqual(SP.lookupSpecialized("diabetic foot osteomyelitis culture biopsy histopathology", human, { now: NOW }), []);
  assert.deepEqual(SP.specializedCandidatesForProfile(human, { now: NOW }), []);
});

test("Swiss neonatal EOS recommendations require both Switzerland and explicit neonatal context", async () => {
  await SP.loadSpecialized(swiss);
  const e = entries.find((x) => x.id === "fifth.eos.swiss-calculator-context");
  SP.registerSpecialized("fifth-eos-approved-fixture", [approvedForTest(e)]);
  const q = "Swiss neonatal early onset sepsis EOS calculator recommendation antibiotic exposure";
  const context = { ageGroup: "neonatal", population: "neonates" };
  assert.deepEqual(ids(SP.lookupSpecialized(q, swiss, { now: NOW, context })), [e.id]);
  assert.deepEqual(SP.lookupSpecialized(q, human, { now: NOW, context }), []);
  assert.deepEqual(SP.lookupSpecialized(q, swiss, { now: NOW, context: { ageGroup: "neonatal" } }), []);
  assert.deepEqual(SP.lookupSpecialized(q, swiss, { now: NOW, context: { ageGroup: "adult", population: "adult" } }), []);
});

test("neonatal context inference does not collapse neonates into the generic pediatric population", () => {
  assert.deepEqual(inferSpecializedContext("newborn neonatal EOS early onset sepsis"), { ageGroup: "neonatal", population: "neonates" });
  assert.deepEqual(inferSpecializedContext("pediatric child sepsis"), { ageGroup: "pediatric", population: "pediatric" });
});

test("diabetic-foot microbiology knowledge preserves geographic and resistance heterogeneity", async () => {
  await SP.loadSpecialized(human);
  const e = entries.find((x) => x.id === "fifth.dfi-microbiology-geographic-variation");
  assert.ok(e);
  SP.registerSpecialized("fifth-dfi-approved-fixture", [approvedForTest(e)]);
  const q = "diabetic foot infection DFI microbial profile geographic variation antimicrobial resistance demographics";
  assert.deepEqual(ids(SP.lookupSpecialized(q, human, { now: NOW })), [e.id]);
  assert.match(e.exceptions[0].effect, /do not assume|not universal|local/i);
});

test("bone culture and histopathology discordance retrieval does not imply either test is universally definitive", async () => {
  await SP.loadSpecialized(human);
  const e = entries.find((x) => x.id === "fifth.dfi-bone-histology-culture-discordance");
  SP.registerSpecialized("fifth-dfo-approved-fixture", [approvedForTest(e)]);
  const q = "adult diabetic foot osteomyelitis DFO bone biopsy histopathology microbiology concordance discordant results";
  assert.deepEqual(ids(SP.lookupSpecialized(q, human, { now: NOW, context: { population: "adult" } })), [e.id]);
  assert.match(e.statement, /43\.4%/);
  assert.match(e.exceptions[0].effect, /five studies|308 patients/i);
});

test("GRADE certainty by outcome and lowest critical outcome records retrieve for guideline appraisal", async () => {
  await SP.loadSpecialized(human);
  const e = entries.find((x) => x.id === "fifth.grade-lowest-critical-outcome-limits-overall");
  SP.registerSpecialized("fifth-grade-approved-fixture", [approvedForTest(e)]);
  const q = "GRADE overall certainty of evidence critical outcomes lowest certainty systematic review recommendation";
  assert.deepEqual(ids(SP.lookupSpecialized(q, human, { now: NOW })), [e.id]);
  assert.match(e.statement, /lowest certainty/i);
  assert.ok(e.evidence[0].url.includes("cdc.gov"));
});

test("the evidence-appraisal rules activate for literature questions even when no specialized entry matches", async () => {
  const q = "Compare the systematic review certainty of evidence, confidence intervals, and clinical significance.";
  assert.equal(isEvidenceAppraisalQuery(q), true);
  const result = await prepareSpecializedPrompt({ system: "Base rules", user: q }, { query: q, profile: human, now: NOW });
  assert.match(result.prompt.system, /CLINICAL EVIDENCE APPRAISAL RULES/);
  assert.match(result.prompt.system, /no evidence of an effect/);
  assert.match(result.prompt.system, /whole source/);
  assert.match(result.prompt.system, /lowest-certainty/);
  assert.match(result.prompt.system, /For ratio measures such as OR, RR, and HR/);
});

test("ordinary clinical questions do not receive the evidence-appraisal block", () => {
  const q = "What is the function of the gallbladder?";
  assert.equal(isEvidenceAppraisalQuery(q), false);
  const result = attachSpecializedKnowledge({ system: "Base rules", user: q }, []);
  assert.deepEqual(result, { system: "Base rules", user: q });
});

test("the specialized prompt continues to prohibit fabricated patient data and cross-species transfer", () => {
  const e = entries.find((x) => x.id === "fifth.dfi-microbiology-geographic-variation");
  const p = attachSpecializedKnowledge({ system: "Base rules", user: "DFI case" }, [{ entry: approvedForTest(e), score: 1, matched: "phrase" }]);
  assert.match(p.system, /Never invent or silently assume laboratory values/);
  assert.match(p.system, /Keep literature facts separate from patient observations/);
  assert.match(p.system, /Do not transfer numerical cut-offs.*across species/);
});
