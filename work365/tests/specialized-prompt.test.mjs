import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as SP from "../src/lib/kb/specialized.js";
import { buildSpecialized } from "../scripts/build-kb.mjs";
import { prepareSpecializedPrompt, inferSpecializedContext } from "../src/lib/kb/specialized-prompt.js";
import { buildLessonBPrompt, buildLessonPrompt } from "../src/lib/prompts.js";

const NOW = Date.parse("2026-11-20T12:00:00Z");
const profile = { discipline: "medicine", exam: "", region: "" };
const manifest = { sources: [{
  id: "s-global", url: "https://example.invalid/research/zeta", license: "CC0", licenseVerified: true, type: "peer-reviewed",
  passages: [{ id: "p1", text: "The fictional zeta pathway changes receptor recycling through a scaffold-dependent interaction in the defined molecular assay." }],
}] };
const candidate = (over = {}) => ({
  id: "global-zeta", title: "Zeta scaffold-dependent receptor recycling", kind: "mechanism",
  statement: "The fictional zeta pathway changes receptor recycling through a scaffold-dependent interaction in the defined molecular assay.",
  aliases: { en: ["zeta pathway", "scaffold-dependent receptor recycling"], ar: [] },
  value: { category: "rare-mechanism", beyondGeneral: "This uncommon scaffold-dependent interaction is assay-specific and is often confused with direct receptor degradation in generic explanations.", generalAnswerRisk: "A generic answer would describe receptor degradation instead of the experimentally observed recycling change." },
  clinical: { scope: "Molecular interpretation of the fictional zeta receptor assay" },
  scope: { discipline: ["medicine"], exam: [], jurisdiction: "intl", specialty: "Molecular pathology" },
  applicability: { conditions: ["The case specifically concerns the defined zeta pathway molecular assay"] },
  exceptions: [{ when: "A different scaffold isoform is studied", effect: "Do not apply this interaction without isoform-specific evidence" }],
  evidence: [{ sourceId: "s-global", passageId: "p1", quote: manifest.sources[0].passages[0].text }],
  approval: { status: "approved", reviewer: "fixture reviewer", reviewedAt: "2026-10-01", checks: { claimSupport: true, clinicalAccuracy: true, scopeAndExceptions: true } },
  version: "1", reviewBy: "2028-01-01", ...over,
});
const built = (over = {}) => {
  const r = buildSpecialized(manifest, [candidate(over)], { today: "2026-11-20" });
  assert.equal(r.rejected.length, 0, JSON.stringify(r.rejected));
  return r.accepted[0];
};

test.beforeEach(() => SP.__resetSpecialized());

test("approved relevant expert knowledge reaches the actual prompt with applicability, exceptions and traceable source", async () => {
  SP.registerSpecialized("test-global", [built()]);
  const original = { system: "Solve the question accurately.", user: "Read the attached question." };
  const out = await prepareSpecializedPrompt(original, { query: "Explain the zeta pathway scaffold-dependent receptor recycling", profile, now: NOW });
  assert.equal(out.entries.length, 1);
  assert.match(out.prompt.user, /SPECIALIZED MEDICAL REFERENCES/);
  assert.match(out.prompt.user, /The fictional zeta pathway changes receptor recycling/);
  assert.match(out.prompt.user, /A different scaffold isoform is studied/);
  assert.match(out.prompt.user, /https:\/\/example.invalid\/research\/zeta/);
  assert.match(out.prompt.system, /EVERY applicability condition match/);
  assert.match(out.prompt.system, /Do not mention this internal library/);
  assert.ok(!out.prompt.user.includes("claimSupport"), "review bookkeeping stays internal");
});

test("unrelated, stale, unapproved and out-of-scope entries never reach the answer prompt", async () => {
  const items = [
    built(),
    built({ id: "stale", reviewBy: "2025-01-01" }),
    built({ id: "draft", approval: { status: "draft" } }),
    built({ id: "pharmacy-only", scope: { discipline: ["pharmacy"], exam: [], jurisdiction: "intl", specialty: "Clinical pharmacy" } }),
  ];
  SP.registerSpecialized("test-filter", items, { strict: false });
  const unrelated = await prepareSpecializedPrompt({ system: "S", user: "U" }, { query: "normal adult heart rate", profile, now: NOW });
  assert.equal(unrelated.entries.length, 0);
  const relevant = await prepareSpecializedPrompt({ system: "S", user: "U" }, { query: "zeta pathway scaffold-dependent receptor recycling", profile, now: NOW });
  assert.deepEqual(relevant.entries.map((x) => x.entry.id), ["global-zeta"]);
});

test("image-only prompt receives only a small profile-scoped candidate shelf, and context-specific entries fail closed when context is missing", async () => {
  const specialist = built();
  const pediatric = built({ id: "pediatric-only", scope: { discipline: ["medicine"], exam: [], jurisdiction: "intl", specialty: "Pediatric molecular medicine", population: ["pediatric"] } });
  SP.registerSpecialized("test-shelf", [specialist, pediatric], { strict: false });
  const out = await prepareSpecializedPrompt({ system: "S", user: "Read this image." }, { query: "", profile, now: NOW, limit: 4 });
  assert.deepEqual(out.entries.map((x) => x.entry.id), ["global-zeta"]);
  assert.deepEqual(inferSpecializedContext("A 4-year-old pediatric patient with a zeta pathway result"), { ageGroup: "pediatric", population: "pediatric" });
  assert.deepEqual(inferSpecializedContext("A 6-year-old cat with vomiting"), { species: "cat" }, "do not infer pediatric status from a bare age without species-aware age rules");
  assert.deepEqual(inferSpecializedContext("قطة حامل عمرها 4 سنوات"), { species: "cat", pregnancyStatus: "pregnant" });
  assert.deepEqual(inferSpecializedContext("طفل ذكر عمره 8 سنوات"), { ageGroup: "pediatric", sex: "male", population: "pediatric" });
});

test("analysis orchestration actually uses the same enrichment helper before solve and answer-writing requests", async () => {
  const src = await readFile(new URL("../src/lib/analysis.js", import.meta.url), "utf8");
  assert.match(src, /import \{ prepareSpecializedPrompt \} from "\.\/kb\/specialized-prompt\.js"/);
  assert.match(src, /const stageWithSpecialized =/);
  assert.match(src, /prepareSpecializedPrompt\(prompt, \{ query, profile: prof\(\), limit: 3 \}\)/);
  assert.match(src, /stageWithSpecialized\(`solve:/);
  assert.match(src, /stageWithSpecialized\(`lesson/);
});


test("lesson writers treat solve briefs as preliminary and re-check them against the original question", () => {
  const args = { profile, history: [], brief: "ANSWER: B\nThe patient has a potassium level of 2.1.", extra: "", chips: [], words: 300 };
  for (const prompt of [buildLessonBPrompt(args), buildLessonPrompt(args)]) {
    assert.match(prompt.system, /NOT as unquestionable ground truth/);
    assert.match(prompt.system, /verify that every stated datum is actually present/);
    assert.match(prompt.system, /Never invent missing case data/);
    assert.doesNotMatch(prompt.system, /never change it and never doubt it/i);
  }
});
