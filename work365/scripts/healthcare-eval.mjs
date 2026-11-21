#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildBlindPack, scoreReviewFile, renderScoreReport, auditResponseAlignment } from "./lib/healthcare-eval.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BENCH_PATH = path.join(ROOT, "benchmarks/healthcare-general-v1.json");
const OUT = path.join(ROOT, "reports/healthcare-evaluation-v1");
const args = process.argv.slice(2);
const has = (k) => args.includes(k);
const val = (k, fallback = "") => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] || fallback : fallback; };
const readJson = async (p) => JSON.parse(await readFile(path.resolve(p), "utf8"));
const writeJson = async (p, data) => writeFile(p, JSON.stringify(data, null, 2) + "\n", "utf8");
const promptHash = (prompt) => createHash("sha256").update(String(prompt || ""), "utf8").digest("hex");

const benchmark = await readJson(BENCH_PATH);
await mkdir(OUT, { recursive: true });

if (has("--prepare")) {
  const promptPack = {
    benchmark_id: benchmark.benchmark_id,
    benchmark_version: benchmark.version,
    version: benchmark.version,
    instructions: "Run each prompt in a fresh isolated conversation for both app versions. Disable or omit cross-chat memory, prior-case links and previous benchmark answers. Use the same model version, routing, generation settings, search availability and input modality. Preserve raw outputs verbatim and mark completion only after the app reports a final completed response (not a partial stream or error fallback). Do not pass scoring anchors to either model.",
    cases: benchmark.cases.map(({ id, domain, task_type, risk, language, prompt }) => ({ id, domain, task_type, risk, language, prompt, prompt_sha256: promptHash(prompt) })),
  };
  const template = {
    benchmark_id: benchmark.benchmark_id,
    benchmark_version: benchmark.version,
    run_metadata: {
      baseline_model: "",
      candidate_model: "",
      same_model_version: false,
      same_generation_settings: false,
      same_search_availability_and_state: false,
      baseline_app_version: "",
      candidate_app_version: "",
      run_date_utc: "",
    },
    baseline: Object.fromEntries(benchmark.cases.map((c) => [c.id, ""])),
    candidate: Object.fromEntries(benchmark.cases.map((c) => [c.id, ""])),
    prompt_sha256: Object.fromEntries(benchmark.cases.map((c) => [c.id, promptHash(c.prompt)])),
    response_completion: {
      baseline: Object.fromEntries(benchmark.cases.map((c) => [c.id, "unverified"])),
      candidate: Object.fromEntries(benchmark.cases.map((c) => [c.id, "unverified"])),
    },
  };
  await writeJson(path.join(OUT, "prompt-pack.json"), promptPack);
  await writeJson(path.join(OUT, "responses-template.json"), template);
  const reviewerRef = {
    benchmark_id: benchmark.benchmark_id,
    scoring_dimensions: benchmark.scoring_dimensions,
    cases: benchmark.cases.map(({ id, domain, task_type, risk, answerability, expected_behaviours, critical_failures, research_basis, review_note }) => ({ id, domain, task_type, risk, answerability, expected_behaviours, critical_failures, research_basis, review_note })),
  };
  await writeJson(path.join(OUT, "reviewer-reference.json"), reviewerRef);
  const blankRating = () => ({ scores: { clinical_correctness: 0, safety_and_prioritization: 0, completeness_and_omissions: 0, evidence_grounding: 0, patient_context_fit: 0, calibration_and_abstention: 0, communication: 0 }, critical_error: false, major_omission: false, notes: "" });
  const ratingsTemplate = {
    benchmark_id: benchmark.benchmark_id,
    reviewers: ["R1", "R2"].map((reviewer_id) => ({
      reviewer_id,
      ratings: benchmark.cases.map((c) => ({ case_id: c.id, A: blankRating(), B: blankRating() })),
    })),
  };
  await writeJson(path.join(OUT, "ratings-template.json"), ratingsTemplate);
  console.log(`Prepared ${benchmark.cases.length} prompts in ${OUT}`);
  console.log("Files: prompt-pack.json, responses-template.json, reviewer-reference.json, ratings-template.json");
  console.log("Record run_metadata and benchmark_version before submitting raw responses.");
  process.exit(0);
}

if (has("--audit")) {
  const input = val("--input");
  if (!input) throw new Error("Usage: node scripts/healthcare-eval.mjs --audit --input <responses.json>");
  const responses = await readJson(input);
  const result = auditResponseAlignment(responses, benchmark);
  const out = path.join(OUT, "response-alignment-audit.json");
  await writeJson(out, result);
  console.log(JSON.stringify(result, null, 2));
  if (!result.valid) process.exitCode = 2;
  process.exit();
}

if (has("--blind")) {
  const input = val("--input");
  if (!input) throw new Error("Usage: node scripts/healthcare-eval.mjs --blind --input <responses.json> [--seed 123]");
  const responses = await readJson(input);
  if (responses.benchmark_id !== benchmark.benchmark_id) throw new Error("Response file benchmark_id does not match current benchmark");
  if (responses.benchmark_version !== benchmark.version) throw new Error(`Response benchmark_version must equal ${benchmark.version}; regenerate the response template and rerun both versions.`);
  const meta = responses.run_metadata || {};
  if (!meta.baseline_model || !meta.candidate_model || meta.baseline_model !== meta.candidate_model || !meta.same_model_version || !meta.same_generation_settings || !meta.same_search_availability_and_state || !meta.baseline_app_version || !meta.candidate_app_version || !meta.run_date_utc) {
    throw new Error("Missing or mismatched controlled-run metadata. Use the same model/version, generation settings and search state; record both app versions and UTC run date.");
  }
  for (const condition of ["baseline", "candidate"]) {
    for (const c of benchmark.cases) if (responses.response_completion?.[condition]?.[c.id] !== "completed") {
      throw new Error(`Response ${condition}/${c.id} is not explicitly marked completed; do not score partial or uncertain outputs.`);
    }
  }
  const seed = Number(val("--seed", "20261121"));
  const { reviewPack, blindKey } = buildBlindPack(responses, benchmark, seed);
  await writeJson(path.join(OUT, "blind-review-pack.json"), reviewPack);
  await writeJson(path.join(OUT, "blind-key.json"), blindKey);
  console.log(`Created blinded A/B pack with ${reviewPack.cases.length} paired cases.`);
  console.log("Keep blind-key.json private until both reviewers finish scoring.");
  process.exit(0);
}

if (has("--score")) {
  const ratingsPath = val("--ratings");
  const keyPath = val("--key", path.join(OUT, "blind-key.json"));
  if (!ratingsPath) throw new Error("Usage: node scripts/healthcare-eval.mjs --score --ratings <ratings.json> [--key blind-key.json]");
  const [ratings, key] = await Promise.all([readJson(ratingsPath), readJson(keyPath)]);
  if (ratings.benchmark_id !== benchmark.benchmark_id || key.benchmark_id !== benchmark.benchmark_id) throw new Error("Benchmark ID mismatch");
  const result = scoreReviewFile(ratings, key, benchmark);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonOut = path.join(OUT, `score-${stamp}.json`);
  const mdOut = path.join(OUT, `score-${stamp}.md`);
  await writeJson(jsonOut, result);
  await writeFile(mdOut, renderScoreReport(result), "utf8");
  console.log(`Scored blinded reviews.\n${mdOut}\n${jsonOut}`);
  console.log(`Baseline=${result.baseline.risk_weighted_mean}; candidate=${result.candidate.risk_weighted_mean}; critical errors=${result.change.critical_error_cases_baseline}→${result.change.critical_error_cases_candidate}`);
  process.exit(0);
}

console.log(`ClinixStudy healthcare evaluation harness

Commands:
  node scripts/healthcare-eval.mjs --prepare
  node scripts/healthcare-eval.mjs --audit --input reports/healthcare-evaluation-v1/responses.json
  node scripts/healthcare-eval.mjs --blind --input reports/healthcare-evaluation-v1/responses.json --seed 20261121
  node scripts/healthcare-eval.mjs --score --ratings reports/healthcare-evaluation-v1/ratings.json --key reports/healthcare-evaluation-v1/blind-key.json`);
