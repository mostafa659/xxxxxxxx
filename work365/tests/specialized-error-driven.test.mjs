import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { entries } from "../src/lib/kb/modules/specialized-error-driven-2026.js";
import { buildSpecialized } from "../scripts/build-kb.mjs";
import * as SP from "../src/lib/kb/specialized.js";

const readJson = (relative) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));
const NOW = Date.parse("2026-11-20T12:00:00Z");
const human = { discipline: "medicine", exam: "", region: "" };
const vet = { discipline: "veterinary", exam: "", region: "" };
const ids = (rows) => rows.map((x) => x.entry.id);
const approvedForTest = (e) => ({
  ...e,
  approval: {
    status: "approved",
    reviewer: "Automated test fixture — not a clinical approval",
    reviewedAt: "2026-11-20",
    checks: { claimSupport: true, clinicalAccuracy: true, scopeAndExceptions: true },
  },
});

test.beforeEach(() => SP.__resetSpecialized());

test("the AI-error-driven batch has five unique, schema-valid, evidence-backed draft records", () => {
  assert.equal(entries.length, 5);
  assert.equal(new Set(entries.map((e) => e.id)).size, 5);
  assert.ok(entries.every((e) => e.approval.status === "draft"));
  assert.ok(entries.every((e) => SP.validateSpecialized(e).length === 0));
  for (const e of entries) {
    assert.ok(e.evidence.length > 0, `${e.id}: source evidence required`);
    assert.ok(e.evidence.every((v) => v.verified && v.sourceVerified && v.quoteVerified && /^https:\/\//.test(v.url)), `${e.id}: source and quote provenance required`);
    assert.ok(e.applicability.conditions.length > 0 && (e.exceptions.length > 0 || e.noExceptionsNote));
    assert.ok(e.value.beyondGeneral.length >= 60 && e.value.generalAnswerRisk.length >= 30);
  }
});

test("the strict builder independently rebuilds all five entries and accepts no unsupported candidate", () => {
  const manifest = readJson("../knowledge/specialized/error-driven/manifest.json");
  const candidates = readJson("../knowledge/specialized/error-driven/candidates.json");
  const built = buildSpecialized(manifest, candidates, { today: "2026-11-20", general: { facts: [], rules: [] } });
  assert.equal(built.accepted.length, 5, JSON.stringify(built.rejected));
  assert.deepEqual(built.rejected, []);
  assert.deepEqual(built.accepted.map((x) => x.id), entries.map((x) => x.id));
  assert.ok(built.accepted.every((x) => x.evidence.every((e) => e.license === "CC-BY-4.0" && e.sourceVerified && e.quoteVerified)));
});

test("all 80 entries load for review, but no draft from any batch reaches student retrieval", async () => {
  await SP.loadSpecialized(human);
  assert.equal(SP.loadedSpecialized().length, 80);
  assert.ok(SP.loadedSpecialized().every((e) => e.approval?.status === "draft"));
  for (const q of [
    "warfarin R-warfarin S-warfarin CYP2C9 CYP1A2",
    "IC50 Ki Kd Cheng Prusoff",
    "Knot of Henry flexor hallucis longus flexor digitorum longus",
  ]) assert.deepEqual(SP.lookupSpecialized(q, human, { now: NOW }), []);
  assert.deepEqual(SP.specializedCandidatesForProfile(human, { now: NOW }), []);
});

test("retrieval selects only the warfarin enantiomer pathway record for the matching pharmacology question", async () => {
  await SP.loadSpecialized(human);
  const e = entries.find((x) => x.id === "error.warfarin.stereoselective-cyp-pathways");
  SP.registerSpecialized("warfarin-approved-fixture", [approvedForTest(e)]);
  assert.deepEqual(ids(SP.lookupSpecialized("S-warfarin R-warfarin CYP2C9 CYP1A2 CYP3A4", human, { now: NOW })), [e.id]);
  assert.deepEqual(SP.lookupSpecialized("warfarin dose for a patient", human, { now: NOW }), []);
});

test("IC50/Ki/Kd retrieval preserves the assay distinction and does not leak into unrelated questions", async () => {
  await SP.loadSpecialized(human);
  const e = entries.find((x) => x.id === "error.assay.ic50-ki-kd-not-interchangeable");
  SP.registerSpecialized("assay-approved-fixture", [approvedForTest(e)]);
  assert.deepEqual(ids(SP.lookupSpecialized("IC50 Ki Kd Cheng Prusoff assay-dependent affinity", human, { now: NOW })), [e.id]);
  assert.deepEqual(SP.lookupSpecialized("standard adult heart rate", human, { now: NOW }), []);
});

test("feline aldosterone knowledge requires veterinary discipline and explicit cat context", async () => {
  await SP.loadSpecialized(vet);
  const e = entries.find((x) => x.id === "error.veterinary.feline-aldosterone-assay-scope");
  SP.registerSpecialized("feline-aldosterone-approved-fixture", [approvedForTest(e)]);
  const q = "cat feline aldosterone LC-MS/MS reference interval primary hyperaldosteronism adrenal mass";
  assert.deepEqual(SP.lookupSpecialized(q, vet, { now: NOW, context: { species: "cat" } }).map((x) => x.entry.id), [e.id]);
  assert.deepEqual(SP.lookupSpecialized(q, vet, { now: NOW, context: { species: "dog" } }), []);
  assert.deepEqual(SP.lookupSpecialized(q, vet, { now: NOW }), []);
  assert.deepEqual(SP.lookupSpecialized(q, human, { now: NOW, context: { species: "cat" } }), []);
});

test("feline ABCB1/ivermectin sensitivity is retrieved only in feline veterinary context", async () => {
  await SP.loadSpecialized(vet);
  const e = entries.find((x) => x.id === "error.veterinary.abcb1-ivermectin-cats-not-dog-only");
  SP.registerSpecialized("abcb1-approved-fixture", [approvedForTest(e)]);
  const q = "ABCB1 MDR1 ivermectin cat feline P-glycoprotein toxicity";
  assert.deepEqual(ids(SP.lookupSpecialized(q, vet, { now: NOW, context: { species: "cat" } })), [e.id]);
  assert.deepEqual(SP.lookupSpecialized(q, vet, { now: NOW, context: { species: "dog" } }), []);
});

test("Knot of Henry retrieval distinguishes the tendon decussation from the medial plantar nerve", async () => {
  await SP.loadSpecialized(human);
  const e = entries.find((x) => x.id === "error.anatomy.knot-of-henry-tendon-vs-nerve");
  SP.registerSpecialized("knot-henry-approved-fixture", [approvedForTest(e)]);
  assert.deepEqual(ids(SP.lookupSpecialized("Knot of Henry FHL FDL medial plantar nerve tendon crossing", human, { now: NOW })), [e.id]);
});

test("unlicensed source-dependent toluene material stays out of the retrievable KB and remains explicitly audited", async () => {
  const audit = readJson("../knowledge/specialized/error-driven/ai-error-regression-matrix.json");
  const toluene = audit.find((x) => x.id === "toluene-uosm-uag");
  assert.equal(toluene.handling, "verification-regression-only");
  assert.match(toluene.reason, /license/i);
  await SP.loadSpecialized(human);
  assert.ok(!SP.loadedSpecialized().some((e) => /toluene|hippurate|urine osmolal/i.test(`${e.title} ${e.statement}`)));
});
