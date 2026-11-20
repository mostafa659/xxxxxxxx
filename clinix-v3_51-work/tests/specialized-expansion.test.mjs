import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildSpecialized } from "../scripts/build-kb.mjs";
import { entries } from "../src/lib/kb/modules/specialized-pharmacogenomics-expansion-2026.js";
import * as SP from "../src/lib/kb/specialized.js";

const readJson = (relative) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));
const profile = { discipline: "medicine", exam: "", region: "" };
const NOW = Date.parse("2026-11-20T12:00:00Z");
const ids = (rows) => rows.map((x) => x.entry.id);

test.beforeEach(() => SP.__resetSpecialized());

test("the 2026 pharmacogenomics expansion contains ten unique, valid, fully sourced draft entries", () => {
  assert.equal(entries.length, 10);
  assert.equal(new Set(entries.map((e) => e.id)).size, 10);
  assert.ok(entries.every((e) => e.approval?.status === "draft"));
  assert.ok(entries.every((e) => SP.validateSpecialized(e).length === 0));
  for (const e of entries) {
    assert.ok(e.evidence.length > 0, `${e.id}: evidence required`);
    assert.ok(e.evidence.every((v) => v.verified && v.sourceVerified && v.quoteVerified && /^https:\/\//.test(v.url)), `${e.id}: verified provenance required`);
    assert.ok(e.reviewBy && e.version && e.checkedAt, `${e.id}: currency metadata required`);
  }
});

test("the expansion builder independently reproduces ten accepted entries and rejects none", () => {
  const manifest = readJson("../knowledge/specialized/pharmacogenomics/expansion-2026-09-manifest.json");
  const candidates = readJson("../knowledge/specialized/pharmacogenomics/expansion-2026-09-candidates.json");
  const out = buildSpecialized(manifest, candidates, { today: "2026-11-20", general: { facts: [], rules: [] } });
  assert.equal(out.accepted.length, 10, JSON.stringify(out.rejected));
  assert.deepEqual(out.rejected, []);
  assert.deepEqual(out.accepted.map((e) => e.id), entries.map((e) => e.id));
  assert.ok(out.accepted.every((e) => e.evidence.every((v) => v.verified && v.sourceVerified && v.quoteVerified)));
});

test("all 80 shipped specialist entries load for review but remain unavailable to student retrieval while draft", async () => {
  await SP.loadSpecialized(profile);
  const all = SP.loadedSpecialized();
  assert.equal(all.length, 80);
  assert.ok(all.every((e) => SP.specializedStatus(e, NOW) === "unapproved"));
  assert.deepEqual(SP.lookupSpecialized("CYP2D6 propafenone CYP3A4 inhibitor", profile, { now: NOW }), []);
  assert.deepEqual(SP.specializedCandidatesForProfile(profile, { now: NOW }), []);
});

test("retrieval returns the precise relevant expansion entry only after an explicit approval fixture", async () => {
  await SP.loadSpecialized(profile);
  const original = entries.find((e) => e.id === "pgx.cyp2d6.propafenone-cyp3a4-triple-interaction");
  assert.ok(original, "the three-way drug-gene interaction is present");
  const reviewedFixture = {
    ...original,
    approval: {
      status: "approved",
      reviewer: "Automated test fixture — not a real clinical review",
      reviewedAt: "2026-11-20",
      checks: { claimSupport: true, clinicalAccuracy: true, scopeAndExceptions: true },
    },
  };
  SP.registerSpecialized("approval-fixture", [reviewedFixture]);
  const found = SP.lookupSpecialized("propafenone CYP2D6 CYP3A4", profile, { now: NOW, k: 5 });
  assert.deepEqual(ids(found), [original.id]);
  assert.deepEqual(SP.lookupSpecialized("vitamin C common cold", profile, { now: NOW }), []);
});
