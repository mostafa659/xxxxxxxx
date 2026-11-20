import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { entries } from "../src/lib/kb/modules/specialized-major-expansion-2026.js";
import { buildSpecialized } from "../scripts/build-kb.mjs";
import * as SP from "../src/lib/kb/specialized.js";
import { attachSpecializedKnowledge } from "../src/lib/kb/specialized-prompt.js";

const readJson = (relative) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));
const NOW = Date.parse("2026-11-20T12:00:00Z");
const profiles = {
  dentistry: { discipline: "dentistry", exam: "", region: "" },
  oncology: { discipline: "oncology", exam: "", region: "" },
  veterinary: { discipline: "veterinary", exam: "", region: "" },
  pharmacy: { discipline: "pharmacy", exam: "", region: "" },
};
const ids = (rows) => rows.map((x) => x.entry.id);
const approvedFixture = (entry) => ({
  ...entry,
  approval: {
    status: "approved",
    reviewer: "Automated test fixture — NOT a clinical approval",
    reviewedAt: "2026-11-20",
    checks: { claimSupport: true, clinicalAccuracy: true, scopeAndExceptions: true },
  },
});

test.beforeEach(() => SP.__resetSpecialized());

test("the major expansion contains 24 unique, valid, evidence-backed draft entries", () => {
  assert.equal(entries.length, 24);
  assert.equal(new Set(entries.map((e) => e.id)).size, 24);
  assert.ok(entries.every((e) => e.approval?.status === "draft"));
  assert.ok(entries.every((e) => SP.validateSpecialized(e).length === 0));
  for (const e of entries) {
    assert.ok(e.evidence.length > 0, `${e.id}: evidence required`);
    assert.ok(e.evidence.every((v) => v.verified && v.sourceVerified && v.quoteVerified && v.license === "CC-BY-4.0" && /^https:\/\//.test(v.url)), `${e.id}: CC-BY source and exact-quote provenance required`);
    assert.ok(e.applicability.conditions.length > 0, `${e.id}: applicability required`);
    assert.ok(e.exceptions.length > 0 || e.noExceptionsNote, `${e.id}: exception analysis required`);
    assert.ok(e.value.beyondGeneral.length >= 60 && e.value.generalAnswerRisk.length >= 30, `${e.id}: incremental value required`);
    assert.ok(e.reviewBy && e.version && e.checkedAt, `${e.id}: currency metadata required`);
  }
});

test("the strict builder independently rebuilds all 24 records with no unsupported candidate", () => {
  const manifest = readJson("../knowledge/specialized/major-expansion-2026/manifest.json");
  const candidates = readJson("../knowledge/specialized/major-expansion-2026/candidates.json");
  assert.equal(manifest.sources.length, 4, "the batch is grounded in four named peer-reviewed sources");
  const out = buildSpecialized(manifest, candidates, { today: "2026-11-20", general: { facts: [], rules: [] } });
  assert.equal(out.accepted.length, 24, JSON.stringify(out.rejected));
  assert.deepEqual(out.rejected, []);
  assert.deepEqual(out.accepted.map((e) => e.id), entries.map((e) => e.id));
  assert.ok(out.accepted.every((e) => e.evidence.every((v) => v.verified && v.sourceVerified && v.quoteVerified && v.license === "CC-BY-4.0")));
});

test("all 80 specialist entries load for internal review, but all draft entries remain excluded from student retrieval", async () => {
  await SP.loadSpecialized(profiles.dentistry);
  const all = SP.loadedSpecialized();
  assert.equal(all.length, 80);
  assert.ok(all.every((e) => SP.specializedStatus(e, NOW) === "unapproved"));
  assert.deepEqual(SP.lookupSpecialized("combined amide local anaesthetic fractional dose rule", profiles.dentistry, { now: NOW }), []);
  assert.deepEqual(SP.lookupSpecialized("FH-deficient renal carcinoma fumarate HIF", profiles.oncology, { now: NOW }), []);
  assert.deepEqual(SP.specializedCandidatesForProfile(profiles.dentistry, { now: NOW }), []);
});

test("dental fractional dosing retrieves only in dentistry context and preserves the heuristic limitation", async () => {
  await SP.loadSpecialized(profiles.dentistry);
  const e = entries.find((x) => x.id === "major.dental.fractional-dose-rule");
  SP.registerSpecialized("major-dental-approval-fixture", [approvedFixture(e)]);
  const query = "Loewe fractional dose rule combine lidocaine articaine bupivacaine MRD";
  const found = SP.lookupSpecialized(query, profiles.dentistry, { now: NOW });
  assert.deepEqual(ids(found), [e.id]);
  assert.ok(e.exceptions.some((x) => /pharmacokinetic limitations/i.test(x.effect)));
  assert.deepEqual(SP.lookupSpecialized(query, profiles.veterinary, { now: NOW }), []);
});

test("FH/HLRCC retrieval distinguishes hereditary syndrome from the broader tumour term", async () => {
  await SP.loadSpecialized(profiles.oncology);
  const hereditary = entries.find((x) => x.id === "major.oncology.hlrcc-not-synonymous-with-all-fhdrrc");
  SP.registerSpecialized("major-fh-approval-fixture", [approvedFixture(hereditary)]);
  const query = "HLRCC hereditary leiomyomatosis FH-deficient renal carcinoma sporadic";
  assert.deepEqual(ids(SP.lookupSpecialized(query, profiles.oncology, { now: NOW })), [hereditary.id]);
  assert.deepEqual(SP.lookupSpecialized(query, profiles.veterinary, { now: NOW }), []);
});

test("feline MDR1 sample frequency requires cat context and never leaks to dog or unspecified species", async () => {
  await SP.loadSpecialized(profiles.veterinary);
  const e = entries.find((x) => x.id === "major.vet.feline-mdr1-frequency-sample-boundary");
  SP.registerSpecialized("major-feline-frequency-approval-fixture", [approvedFixture(e)]);
  const query = "feline cat ABCB1 MDR1 allele frequency 800 cats Germany";
  assert.deepEqual(ids(SP.lookupSpecialized(query, profiles.veterinary, { now: NOW, context: { species: "cat" } })), [e.id]);
  assert.deepEqual(SP.lookupSpecialized(query, profiles.veterinary, { now: NOW, context: { species: "dog" } }), []);
  assert.deepEqual(SP.lookupSpecialized(query, profiles.veterinary, { now: NOW }), []);
});

test("warfarin interaction knowledge does not become a fixed dose-change rule", async () => {
  await SP.loadSpecialized(profiles.pharmacy);
  const e = entries.find((x) => x.id === "major.pharm.warfarin-interaction-effect-not-fixed");
  SP.registerSpecialized("major-warfarin-approval-fixture", [approvedFixture(e)]);
  const query = "warfarin amiodarone interaction dose reduction CYP genetic variants INR";
  assert.deepEqual(ids(SP.lookupSpecialized(query, profiles.pharmacy, { now: NOW })), [e.id]);
  assert.ok(e.exceptions.some((x) => /not a substitute for a patient-specific adjustment/i.test(x.effect)));
  assert.ok(e.exceptions.some((x) => /numeric dose change/i.test(x.effect)));
});

test("the specialized prompt prevents fabricated case data and invalid conversion of laboratory or in-vitro evidence", () => {
  const source = entries.find((x) => x.id === "major.vet.mdr1-in-vitro-ic50-not-clinical-threshold");
  const p = attachSpecializedKnowledge({ system: "Solve carefully.", user: "Case: cat received ivermectin." }, [
    { entry: approvedFixture(source), score: 1, matched: "phrase" },
  ]);
  assert.match(p.system, /Never invent or silently assume laboratory values/);
  assert.match(p.system, /Keep literature facts separate from patient observations/);
  assert.match(p.system, /Do not convert in-vitro potency\/transport values/);
  assert.match(p.system, /Do not transfer numerical cut-offs.*across species/);
  assert.match(p.user, /MDR1 in-vitro/);
});
