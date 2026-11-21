import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  SCORE_DIMENSIONS,
  DIMENSION_KEYS,
  scoreOne,
  quadraticWeightedKappa,
  binaryCohenKappa,
  buildBlindPack,
  auditResponseAlignment,
  scoreReviewFile,
} from "../scripts/lib/healthcare-eval.mjs";
import { CLINICAL_QUALITY_VERSION, CLINICAL_QUALITY_INSTRUCTION } from "../src/lib/clinical-quality.js";
import { linkBlock } from "../src/lib/prompts.js";
import { createHash } from "node:crypto";
const promptHash = (prompt) => createHash("sha256").update(String(prompt || ""), "utf8").digest("hex");

const benchmark = JSON.parse(await readFile(new URL("../benchmarks/healthcare-general-v1.json", import.meta.url), "utf8"));

const score = (v = 3, critical = false, omission = false) => ({
  scores: Object.fromEntries(DIMENSION_KEYS.map((k) => [k, v])),
  critical_error: critical,
  major_omission: omission,
});

function reviewFixture() {
  return {
    benchmark_id: benchmark.benchmark_id,
    reviewers: ["R1", "R2"].map((reviewer_id) => ({
      reviewer_id,
      ratings: benchmark.cases.map((c, i) => ({
        case_id: c.id,
        A: score(3, i === 0, i === 1),
        B: score(4, false, false),
      })),
    })),
  };
}

test("benchmark is a curated challenge set, not routine fact-recall expansion", () => {
  assert.ok(benchmark.cases.length >= 20);
  assert.equal(new Set(benchmark.cases.map((x) => x.id)).size, benchmark.cases.length);
  for (const c of benchmark.cases) {
    assert.ok(c.prompt.length > 80, c.id);
    assert.ok(c.failure_mode || c.task_type, c.id);
    assert.ok(c.expected_behaviours.length >= 2, c.id);
    assert.ok(c.critical_failures.length >= 1, c.id);
    assert.ok(c.research_basis.length >= 1, c.id);
    for (const ref of c.research_basis) assert.ok(benchmark.references[ref], `${c.id}: missing ${ref}`);
  }
});

test("benchmark covers distinct evidence-backed high-risk and reasoning weaknesses", () => {
  const types = new Set(benchmark.cases.map((x) => x.task_type));
  for (const type of [
    "differential_diagnosis", "sequential_evidence_update", "abstention_missing_data",
    "claim_level_evidence_verification", "temporal_chart_reconciliation",
    "medication_reconciliation_interaction", "dose_concentration_arithmetic",
    "pregnancy_evidence_applicability", "base_rate_and_predictive_value",
    "subgroup_interaction_inference", "causality_vs_association", "urgent_triage_not_exam_mode",
    "imaging_hallucination_and_limitations", "untrusted_document_instruction_injection",
  ]) assert.ok(types.has(type), `missing challenge type ${type}`);
});

test("universal protocol now addresses empirical failure modes without listing case-specific diagnoses", () => {
  assert.equal(CLINICAL_QUALITY_VERSION, "3.58.0");
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /UPDATE WITH NEW EVIDENCE/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /SUPPORTED, CONTRADICTED, NOT FOUND, and OUT OF SCOPE/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /Not documented.*not asked.*not tested/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /COUNT OMISSIONS AS ERRORS/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /ABSTENTION IS A VALID CLINICAL ACTION/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /TASK-FORM FIDELITY/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /do not invent A\/B\/C\/D choices/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /CONTEXT ISOLATION AND MEMORY/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /STATISTICAL CLAIMS/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /do not select an agent from “susceptible” alone/i);
  assert.doesNotMatch(CLINICAL_QUALITY_INSTRUCTION, /Ameloblastic Fibrosarcoma|VA-ECMO|Peronea Arteria Magna|HLH score/i);
});

test("weighted scoring uses fixed dimensions and rejects malformed ratings", () => {
  const perfect = scoreOne({ scores: Object.fromEntries(DIMENSION_KEYS.map((k) => [k, 4])) });
  assert.equal(perfect.score, 100);
  assert.equal(Object.values(SCORE_DIMENSIONS).reduce((a, b) => a + b, 0), 100);
  assert.throws(() => scoreOne({ scores: { clinical_correctness: 8 } }), /Invalid/);
});

test("agreement functions return 1 for exact agreement and penalize disagreement", () => {
  assert.equal(quadraticWeightedKappa([0, 1, 2, 3, 4], [0, 1, 2, 3, 4]), 1);
  assert.equal(binaryCohenKappa([true, false, true, false], [true, false, true, false]), 1);
  assert.ok(quadraticWeightedKappa([0, 0, 4, 4], [4, 4, 0, 0]) < 0);
});

test("blind pack masks condition names and contains every paired case", () => {
  const responseFor = (c, label) => `${label} ${c.id} ${c.response_alignment?.anchors?.slice(0, 2).join(" ") || "clinical response"}`;
  const responses = {
    benchmark_id: benchmark.benchmark_id,
    benchmark_version: benchmark.version,
    run_metadata: { baseline_model: "Gemini-Test", candidate_model: "Gemini-Test", same_model_version: true, same_generation_settings: true, same_search_availability_and_state: true, baseline_app_version: "3.57.0", candidate_app_version: "3.58.0", run_date_utc: "2026-11-21T00:00:00Z" },
    prompt_sha256: Object.fromEntries(benchmark.cases.map((c) => [c.id, promptHash(c.prompt)])),
    response_completion: { baseline: Object.fromEntries(benchmark.cases.map((c) => [c.id, "completed"])), candidate: Object.fromEntries(benchmark.cases.map((c) => [c.id, "completed"])) },
    baseline: Object.fromEntries(benchmark.cases.map((c) => [c.id, responseFor(c, "baseline")])),
    candidate: Object.fromEntries(benchmark.cases.map((c) => [c.id, responseFor(c, "candidate")])),
  };
  const { reviewPack, blindKey } = buildBlindPack(responses, benchmark, 42);
  assert.equal(reviewPack.cases.length, benchmark.cases.length);
  assert.equal(blindKey.mapping.length, benchmark.cases.length);
  assert.ok(reviewPack.cases.every((c) => !("baseline_response" in c) && !("candidate_response" in c)));
  for (const row of reviewPack.cases) {
    assert.ok(row.response_A.includes("baseline") || row.response_A.includes("candidate"));
    assert.ok(row.response_B.includes("baseline") || row.response_B.includes("candidate"));
    assert.notEqual(row.response_A, row.response_B);
  }
});

test("review scoring requires two independent raters and cannot average away critical errors", () => {
  const blindKey = {
    benchmark_id: benchmark.benchmark_id,
    mapping: benchmark.cases.map((c) => ({ case_id: c.id, A: "baseline", B: "candidate" })),
  };
  const fixture = reviewFixture();
  const out = scoreReviewFile(fixture, blindKey, benchmark);
  assert.equal(out.reviewer_count, 2);
  assert.equal(out.baseline.n, benchmark.cases.length);
  assert.equal(out.candidate.risk_weighted_mean, 100);
  assert.equal(out.baseline.critical_error_cases.length, 1);
  assert.match(out.baseline.safety_gate, /FAIL/);
  assert.match(out.candidate.safety_gate, /No critical error flagged/);
  assert.equal(out.agreement.first_two_reviewers.A.clinical_correctness, 1);
  assert.throws(() => scoreReviewFile({ benchmark_id: benchmark.benchmark_id, reviewers: [fixture.reviewers[0]] }, blindKey, benchmark), /At least two/);
});

test("scoring rejects a blind key that maps both labels to the same model condition", () => {
  const fixture = reviewFixture();
  const invalidKey = {
    benchmark_id: benchmark.benchmark_id,
    mapping: benchmark.cases.map((c) => ({ case_id: c.id, A: "baseline", B: "baseline" })),
  };
  assert.throws(() => scoreReviewFile(fixture, invalidKey, benchmark), /distinct baseline\/candidate/);
});

test("scoring rejects duplicate or incomplete blind-key mappings", () => {
  const fixture = reviewFixture();
  const duplicate = {
    benchmark_id: benchmark.benchmark_id,
    mapping: benchmark.cases.map((c) => ({ case_id: c.id, A: "baseline", B: "candidate" })),
  };
  duplicate.mapping[1].case_id = duplicate.mapping[0].case_id;
  assert.throws(() => scoreReviewFile(fixture, duplicate, benchmark), /Unknown or duplicate/);
  duplicate.mapping.pop();
  assert.throws(() => scoreReviewFile(fixture, duplicate, benchmark), /exactly one mapping/);
});

test("scoring rejects reviewer files for a different benchmark", () => {
  const fixture = reviewFixture();
  fixture.benchmark_id = "OTHER";
  const key = {
    benchmark_id: benchmark.benchmark_id,
    mapping: benchmark.cases.map((c) => ({ case_id: c.id, A: "baseline", B: "candidate" })),
  };
  assert.throws(() => scoreReviewFile(fixture, key, benchmark), /benchmark_id mismatch/);
});


test("benchmark includes surgery-specific postoperative deterioration and age-specific young-infant fever triage", () => {
  const surgery = benchmark.cases.find((c) => c.task_type === "postoperative_deterioration_and_source_control");
  const infant = benchmark.cases.find((c) => c.task_type === "young_infant_fever_age_specific_triage");
  assert.ok(surgery, "missing surgical critical-care challenge");
  assert.ok(infant, "missing young-infant age-specific challenge");
  assert.ok(surgery.critical_failures.some((x) => /urgent escalation/i.test(x)));
  assert.ok(infant.research_basis.includes("AAP_FEBRILE_INFANT_2021"));
  assert.match(infant.prompt, /49-day-old/);
});


test("response alignment audit catches answer-to-wrong-case swaps before blinding", () => {
  const responses = {
    benchmark_id: benchmark.benchmark_id,
    baseline: Object.fromEntries(benchmark.cases.map((c) => [c.id, `${c.response_alignment?.anchors?.slice(0, 2).join(" ") || "general clinical response"}`])),
    candidate: Object.fromEntries(benchmark.cases.map((c) => [c.id, `${c.response_alignment?.anchors?.slice(0, 2).join(" ") || "general clinical response"}`])),
  };
  const infant = responses.candidate["HQA-026"];
  responses.candidate["HQA-026"] = responses.candidate["HQA-025"];
  responses.candidate["HQA-025"] = infant;
  const audit = auditResponseAlignment(responses, benchmark);
  assert.equal(audit.valid, false);
  assert.ok(audit.issues.some((x) => x.condition === "candidate" && x.case_id === "HQA-025"));
  assert.ok(audit.issues.some((x) => x.condition === "candidate" && x.case_id === "HQA-026"));
});

test("blind pack refuses response files without exact benchmark version", () => {
  const responses = {
    benchmark_id: benchmark.benchmark_id,
    baseline: Object.fromEntries(benchmark.cases.map((c) => [c.id, `baseline ${c.id} ${c.response_alignment?.anchors?.slice(0, 2).join(" ") || "clinical response"}`])),
    candidate: Object.fromEntries(benchmark.cases.map((c) => [c.id, `candidate ${c.id} ${c.response_alignment?.anchors?.slice(0, 2).join(" ") || "clinical response"}`])),
  };
  assert.throws(() => buildBlindPack(responses, benchmark, 1), /benchmark_version/);
});


test("cross-question memory links are opt-in and absent from self-contained prompts by default", () => {
  const history = [{ title: "Earlier clinical case", terms: ["lithium", "toxicity"] }];
  assert.equal(linkBlock(history, "question"), "");
  assert.equal(linkBlock(history, "question", "Please connect this to previous questions" ).includes("EARLIER ITEMS"), true);
});
