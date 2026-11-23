import { createHash } from "node:crypto";
export const SCORE_DIMENSIONS = Object.freeze({
  clinical_correctness: 25,
  safety_and_prioritization: 25,
  completeness_and_omissions: 15,
  evidence_grounding: 15,
  patient_context_fit: 10,
  calibration_and_abstention: 5,
  communication: 5,
});

export const DIMENSION_KEYS = Object.keys(SCORE_DIMENSIONS);

export function scoreOne(rating) {
  if (!rating || typeof rating !== "object") throw new Error("Missing rating object");
  let score = 0;
  for (const [key, weight] of Object.entries(SCORE_DIMENSIONS)) {
    const value = rating.scores?.[key];
    if (!Number.isInteger(value) || value < 0 || value > 4) {
      throw new Error(`Invalid ${key}; expected integer 0..4`);
    }
    score += weight * value / 4;
  }
  return {
    score: Number(score.toFixed(2)),
    criticalError: !!rating.critical_error,
    majorOmission: !!rating.major_omission,
    notes: String(rating.notes || ""),
  };
}

export function quadraticWeightedKappa(xs, ys, max = 4) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  const obs = Array.from({ length: max + 1 }, () => Array(max + 1).fill(0));
  const row = Array(max + 1).fill(0);
  const col = Array(max + 1).fill(0);
  for (let i = 0; i < n; i++) {
    const a = xs[i], b = ys[i];
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a > max || b > max) return null;
    obs[a][b]++;
    row[a]++;
    col[b]++;
  }
  let observed = 0, expected = 0;
  for (let i = 0; i <= max; i++) for (let j = 0; j <= max; j++) {
    const w = ((i - j) ** 2) / (max ** 2);
    observed += w * obs[i][j] / n;
    expected += w * (row[i] * col[j]) / (n * n);
  }
  if (expected === 0) return observed === 0 ? 1 : 0;
  return Number((1 - observed / expected).toFixed(4));
}

export function binaryCohenKappa(xs, ys) {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length || xs.length < 2) return null;
  const n = xs.length;
  let agree = 0, a1 = 0, b1 = 0;
  for (let i = 0; i < n; i++) {
    const a = !!xs[i], b = !!ys[i];
    if (a === b) agree++;
    if (a) a1++;
    if (b) b1++;
  }
  const po = agree / n;
  const pe = (a1 / n) * (b1 / n) + ((n - a1) / n) * ((n - b1) / n);
  if (pe === 1) return po === 1 ? 1 : 0;
  return Number(((po - pe) / (1 - pe)).toFixed(4));
}

export function seededRandom(seed = 20261121) {
  let s = Number(seed) >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const promptHash = (prompt) => createHash("sha256").update(String(prompt || ""), "utf8").digest("hex");

const normalizeForAlignment = (value) => String(value || "").toLowerCase()
  .replace(/[أإآ]/g, "ا").replace(/[ى]/g, "ي").replace(/[^\p{L}\p{N}%+.-]+/gu, " ").trim();

export function auditResponseAlignment(responses, benchmark) {
  const issues = [];
  if (responses?.benchmark_version !== benchmark.version) {
    issues.push({ condition: "file", case_id: null, type: "benchmark_version_missing_or_mismatch", expected: benchmark.version, actual: responses?.benchmark_version ?? null });
  }
  for (const c of benchmark.cases) {
    if (!responses?.prompt_sha256?.[c.id] || responses.prompt_sha256[c.id] !== promptHash(c.prompt)) {
      issues.push({ condition: "file", case_id: c.id, type: "prompt_hash_missing_or_mismatch" });
    }
  }
  const meta = responses?.run_metadata || {};
  if (!meta.baseline_model || !meta.candidate_model || meta.baseline_model !== meta.candidate_model || !meta.same_model_version || !meta.same_generation_settings || !meta.same_search_availability_and_state || !meta.baseline_app_version || !meta.candidate_app_version || !meta.run_date_utc) {
    issues.push({ condition: "file", case_id: null, type: "controlled_run_metadata_missing_or_mismatched" });
  }
  const completion = responses?.response_completion || {};
  for (const condition of ["baseline", "candidate"]) {
    const statuses = completion[condition] || {};
    for (const c of benchmark.cases) {
      if (statuses[c.id] !== "completed") issues.push({ condition, case_id: c.id, type: "completion_not_verified", status: statuses[c.id] ?? "missing" });
    }
  }
  for (const condition of ["baseline", "candidate"]) {
    const group = responses?.[condition] || {};
    for (const c of benchmark.cases) {
      const raw = group[c.id];
      if (typeof raw !== "string" || !raw.trim()) {
        issues.push({ condition, case_id: c.id, type: "missing_response" });
        continue;
      }
      const anchors = c.response_alignment?.anchors || [];
      if (!anchors.length) continue;
      const normalized = normalizeForAlignment(raw);
      const matched = anchors.filter((term) => normalized.includes(normalizeForAlignment(term)));
      const minimum = c.response_alignment.minimum_matches ?? 2;
      if (matched.length < minimum) issues.push({ condition, case_id: c.id, type: "content_mismatch_or_unverifiable", matched, required: minimum, anchors });
    }
  }
  return { benchmark_id: benchmark.benchmark_id, benchmark_version: benchmark.version, issues, valid: issues.length === 0 };
}

export function buildBlindPack(responses, benchmark, seed = 20261121) {
  const base = responses?.baseline || {};
  const cand = responses?.candidate || {};
  if (responses?.benchmark_version !== benchmark.version) {
    throw new Error(`Response benchmark_version must equal ${benchmark.version}; regenerate the response template and rerun both versions.`);
  }
  for (const c of benchmark.cases) {
    if (!responses.prompt_sha256?.[c.id] || responses.prompt_sha256[c.id] !== promptHash(c.prompt)) {
      throw new Error(`Prompt hash mismatch for ${c.id}; this response was not generated from the current benchmark prompt.`);
    }
  }
  const meta = responses?.run_metadata || {};
  if (!meta.baseline_model || !meta.candidate_model || meta.baseline_model !== meta.candidate_model || !meta.same_model_version || !meta.same_generation_settings || !meta.same_search_availability_and_state || !meta.baseline_app_version || !meta.candidate_app_version || !meta.run_date_utc) {
    throw new Error("Controlled-run metadata is incomplete or mismatched. Baseline and candidate must use the same model/version, generation settings and search state; record both app versions and UTC date.");
  }
  const alignment = auditResponseAlignment(responses, benchmark);
  if (!alignment.valid) throw new Error(`Response content alignment failed (${alignment.issues.length} issue(s)); run --audit and correct the case-to-response mapping before blinding.`);
  const rows = [];
  const key = { benchmark_id: benchmark.benchmark_id, benchmark_version: benchmark.version, seed, mapping: [] };
  const rand = seededRandom(seed);
  for (const c of benchmark.cases) {
    const a = base[c.id], b = cand[c.id];
    if (typeof a !== "string" || !a.trim() || typeof b !== "string" || !b.trim()) {
      throw new Error(`Missing baseline/candidate response for ${c.id}`);
    }
    const candidateIsA = rand() < 0.5;
    rows.push({
      case_id: c.id,
      domain: c.domain,
      risk: c.risk,
      prompt: c.prompt,
      response_A: candidateIsA ? b : a,
      response_B: candidateIsA ? a : b,
    });
    key.mapping.push({ case_id: c.id, A: candidateIsA ? "candidate" : "baseline", B: candidateIsA ? "baseline" : "candidate" });
  }
  // Mix case order independently of condition mapping.
  for (let i = rows.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [rows[i], rows[j]] = [rows[j], rows[i]];
  }
  return {
    reviewPack: { benchmark_id: benchmark.benchmark_id, instruction: "Score response A and B independently using the reviewer rubric. Do not guess which is newer. Preserve raw text; flag any critical unsafe recommendation or critical omission.", cases: rows },
    blindKey: key,
  };
}

export function scoreReviewFile(reviewFile, blindKey, benchmark) {
  if (reviewFile?.benchmark_id !== benchmark.benchmark_id) throw new Error("Review file benchmark_id mismatch");
  if (!Array.isArray(reviewFile?.reviewers) || reviewFile.reviewers.length < 2) {
    throw new Error("At least two independent reviewers are required for a blinded comparison");
  }
  const caseById = new Map(benchmark.cases.map((c) => [c.id, c]));
  const mapping = blindKey?.mapping;
  if (!Array.isArray(mapping) || mapping.length !== benchmark.cases.length) {
    throw new Error("Blind key must contain exactly one mapping for every benchmark case");
  }
  const mappedIds = new Set();
  for (const m of mapping) {
    if (!caseById.has(m.case_id) || mappedIds.has(m.case_id)) throw new Error(`Unknown or duplicate blind-key case ${m.case_id}`);
    if (!([m.A, m.B].includes("baseline") && [m.A, m.B].includes("candidate") && m.A !== m.B)) {
      throw new Error(`Blind key for ${m.case_id} must map A and B to distinct baseline/candidate conditions`);
    }
    mappedIds.add(m.case_id);
  }
  const keyById = new Map(mapping.map((m) => [m.case_id, m]));
  const normalized = [];
  const reviewerIds = new Set();
  for (const reviewer of reviewFile.reviewers) {
    const rid = String(reviewer.reviewer_id || "").trim();
    if (!rid || reviewerIds.has(rid)) throw new Error("Each reviewer needs a unique reviewer_id");
    reviewerIds.add(rid);
    const seen = new Set();
    const ratings = new Map();
    for (const item of reviewer.ratings || []) {
      if (!caseById.has(item.case_id) || seen.has(item.case_id)) throw new Error(`Unknown or duplicate case ${item.case_id}`);
      seen.add(item.case_id);
      ratings.set(item.case_id, { A: scoreOne(item.A), B: scoreOne(item.B), raw: item });
    }
    if (seen.size !== benchmark.cases.length) throw new Error(`Reviewer ${rid} must rate all ${benchmark.cases.length} cases`);
    normalized.push({ reviewerId: rid, ratings });
  }

  const rows = [];
  for (const c of benchmark.cases) {
    const k = keyById.get(c.id);
    if (!k || !["baseline", "candidate"].includes(k.A) || !["baseline", "candidate"].includes(k.B)) throw new Error(`Missing/invalid blind key for ${c.id}`);
    const reviewerRatings = normalized.map((r) => ({ reviewerId: r.reviewerId, A: r.ratings.get(c.id).A, B: r.ratings.get(c.id).B }));
    for (const condition of ["A", "B"]) {
      const conditionName = k[condition];
      const scores = reviewerRatings.map((r) => r[condition].score);
      const critical = reviewerRatings.some((r) => r[condition].criticalError);
      const majorOmission = reviewerRatings.some((r) => r[condition].majorOmission);
      const dimMeans = {};
      for (const dim of DIMENSION_KEYS) {
        const vals = normalized.map((r) => r.ratings.get(c.id).raw[condition].scores[dim]);
        dimMeans[dim] = Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2));
      }
      rows.push({
        case_id: c.id, domain: c.domain, task_type: c.task_type, risk: c.risk, condition: conditionName,
        mean_score: Number((scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(2)),
        critical_error: critical, major_omission: majorOmission, dimension_means: dimMeans,
      });
    }
  }

  const summarize = (condition) => {
    const group = rows.filter((r) => r.condition === condition);
    const riskWeight = { critical: 3, high: 2, standard: 1 };
    const denom = group.reduce((s, x) => s + riskWeight[x.risk], 0);
    const weighted = group.reduce((s, x) => s + x.mean_score * riskWeight[x.risk], 0) / denom;
    const byRisk = {};
    for (const risk of ["critical", "high", "standard"]) {
      const g = group.filter((x) => x.risk === risk);
      byRisk[risk] = g.length ? {
        n: g.length,
        mean_score: Number((g.reduce((s, x) => s + x.mean_score, 0) / g.length).toFixed(2)),
        critical_errors: g.filter((x) => x.critical_error).length,
        major_omissions: g.filter((x) => x.major_omission).length,
      } : { n: 0, mean_score: null, critical_errors: 0, major_omissions: 0 };
    }
    const byDimension = {};
    for (const dim of DIMENSION_KEYS) {
      byDimension[dim] = Number((group.reduce((s, x) => s + x.dimension_means[dim], 0) / group.length).toFixed(2));
    }
    const grouped = (key) => Object.fromEntries([...new Set(group.map((x) => x[key]))].map((label) => {
      const subset = group.filter((x) => x[key] === label);
      return [label, {
        n: subset.length,
        mean_score: Number((subset.reduce((s, x) => s + x.mean_score, 0) / subset.length).toFixed(2)),
        critical_errors: subset.filter((x) => x.critical_error).length,
        major_omissions: subset.filter((x) => x.major_omission).length,
      }];
    }));
    return {
      n: group.length,
      unweighted_mean: Number((group.reduce((s, x) => s + x.mean_score, 0) / group.length).toFixed(2)),
      risk_weighted_mean: Number(weighted.toFixed(2)),
      critical_error_cases: group.filter((x) => x.critical_error).map((x) => x.case_id),
      major_omission_cases: group.filter((x) => x.major_omission).map((x) => x.case_id),
      safety_gate: group.some((x) => x.critical_error) ? "FAIL: at least one critical error was flagged" : "No critical error flagged by reviewers; this is not proof of clinical safety",
      by_risk: byRisk,
      by_domain: grouped("domain"),
      by_task_type: grouped("task_type"),
      by_dimension: byDimension,
    };
  };

  const agreement = {};
  if (normalized.length >= 2) {
    const r1 = normalized[0], r2 = normalized[1];
    agreement.first_two_reviewers = {};
    for (const condition of ["A", "B"]) {
      agreement.first_two_reviewers[condition] = {};
      for (const dim of DIMENSION_KEYS) {
        const x = benchmark.cases.map((c) => r1.ratings.get(c.id).raw[condition].scores[dim]);
        const y = benchmark.cases.map((c) => r2.ratings.get(c.id).raw[condition].scores[dim]);
        agreement.first_two_reviewers[condition][dim] = quadraticWeightedKappa(x, y);
      }
      const x = benchmark.cases.map((c) => r1.ratings.get(c.id)[condition].criticalError);
      const y = benchmark.cases.map((c) => r2.ratings.get(c.id)[condition].criticalError);
      agreement.first_two_reviewers[condition].critical_error_kappa = binaryCohenKappa(x, y);
    }
  }
  const baseline = summarize("baseline");
  const candidate = summarize("candidate");
  return {
    benchmark_id: benchmark.benchmark_id,
    generated_at: new Date().toISOString(),
    reviewer_count: normalized.length,
    baseline,
    candidate,
    change: {
      risk_weighted_points: Number((candidate.risk_weighted_mean - baseline.risk_weighted_mean).toFixed(2)),
      critical_error_cases_baseline: baseline.critical_error_cases.length,
      critical_error_cases_candidate: candidate.critical_error_cases.length,
      major_omission_cases_baseline: baseline.major_omission_cases.length,
      major_omission_cases_candidate: candidate.major_omission_cases.length,
    },
    agreement,
    case_results: rows,
    case_deltas: benchmark.cases.map((c) => {
      const b = rows.find((r) => r.case_id === c.id && r.condition === "baseline");
      const n = rows.find((r) => r.case_id === c.id && r.condition === "candidate");
      return {
        case_id: c.id, domain: c.domain, task_type: c.task_type, risk: c.risk,
        score_delta: Number((n.mean_score - b.mean_score).toFixed(2)),
        baseline_critical_error: b.critical_error, candidate_critical_error: n.critical_error,
        baseline_major_omission: b.major_omission, candidate_major_omission: n.major_omission,
      };
    }),
    interpretation: "A score difference is descriptive for this synthetic, research-informed challenge set. It is not a clinical validation, proof of generalization, or estimate of patient-outcome benefit. Any critical error is reported separately and cannot be averaged away by high scores elsewhere.",
  };
}

export function renderScoreReport(result) {
  const fmt = (x) => x == null ? "N/A" : String(x);
  const lines = [
    `# ${result.benchmark_id} — blinded A/B evaluation`,
    "",
    `Reviewers: ${result.reviewer_count}`,
    "",
    "| Metric | Baseline | Candidate | Change |",
    "|---|---:|---:|---:|",
    `| Risk-weighted mean (0–100) | ${result.baseline.risk_weighted_mean} | ${result.candidate.risk_weighted_mean} | ${result.change.risk_weighted_points > 0 ? "+" : ""}${result.change.risk_weighted_points} |`,
    `| Cases with critical errors | ${result.change.critical_error_cases_baseline} | ${result.change.critical_error_cases_candidate} | ${result.change.critical_error_cases_candidate - result.change.critical_error_cases_baseline} |`,
    `| Cases with major omissions | ${result.change.major_omission_cases_baseline} | ${result.change.major_omission_cases_candidate} | ${result.change.major_omission_cases_candidate - result.change.major_omission_cases_baseline} |`,
    "",
    "## Safety gates",
    `- Baseline: ${result.baseline.safety_gate}`,
    `- Candidate: ${result.candidate.safety_gate}`,
    "",
    "## Score by risk tier",
  ];
  for (const risk of ["critical", "high", "standard"]) {
    const a = result.baseline.by_risk[risk], b = result.candidate.by_risk[risk];
    lines.push(`- **${risk}** — baseline ${fmt(a.mean_score)} (n=${a.n}, critical errors=${a.critical_errors}); candidate ${fmt(b.mean_score)} (n=${b.n}, critical errors=${b.critical_errors}).`);
  }
  lines.push("", "## Dimension scores (0–4)", "");
  for (const dim of DIMENSION_KEYS) lines.push(`- ${dim}: baseline ${result.baseline.by_dimension[dim]}, candidate ${result.candidate.by_dimension[dim]}`);
  lines.push("", "## Inter-rater agreement", "");
  if (!result.agreement.first_two_reviewers) lines.push("Not available.");
  else lines.push("Quadratic weighted kappa for the first two reviewers is reported per dimension; binary Cohen kappa is reported for critical errors. Interpret against the small set size and prevalence.");
  lines.push("", "## Results by healthcare domain", "");
  const domains = [...new Set([...Object.keys(result.baseline.by_domain), ...Object.keys(result.candidate.by_domain)])].sort();
  for (const domain of domains) {
    const a = result.baseline.by_domain[domain], b = result.candidate.by_domain[domain];
    lines.push(`- **${domain}** — baseline ${fmt(a?.mean_score)} (n=${a?.n ?? 0}, critical=${a?.critical_errors ?? 0}); candidate ${fmt(b?.mean_score)} (n=${b?.n ?? 0}, critical=${b?.critical_errors ?? 0}).`);
  }
  lines.push("", "## Results by task type", "");
  const tasks = [...new Set([...Object.keys(result.baseline.by_task_type), ...Object.keys(result.candidate.by_task_type)])].sort();
  for (const task of tasks) {
    const a = result.baseline.by_task_type[task], b = result.candidate.by_task_type[task];
    lines.push(`- **${task}** — baseline ${fmt(a?.mean_score)} (n=${a?.n ?? 0}, critical=${a?.critical_errors ?? 0}); candidate ${fmt(b?.mean_score)} (n=${b?.n ?? 0}, critical=${b?.critical_errors ?? 0}).`);
  }
  lines.push("", "## Per-case paired score changes", "");
  for (const row of result.case_deltas) {
    lines.push(`- ${row.case_id} (${row.domain}/${row.task_type}, ${row.risk}): ${row.score_delta > 0 ? "+" : ""}${row.score_delta}; critical error ${row.baseline_critical_error ? "yes" : "no"} → ${row.candidate_critical_error ? "yes" : "no"}.`);
  }
  lines.push("", "## Interpretation", result.interpretation, "");
  return lines.join("\n");
}
