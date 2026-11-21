#!/usr/bin/env node
/* Paired Gemini benchmark: same question/model/settings, without vs with the draft specialist entries.
   Draft records are injected ONLY into this evaluation harness. Production retrieval continues to require human-approved entries. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { attachSpecializedKnowledge } from "../src/lib/kb/specialized-prompt.js";
import { entries as pilotEntries } from "../src/lib/kb/modules/specialized-pharmacogenomics-pilot.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, "..");
const DATA_PATH = path.join(PROJECT, "tests/fixtures/specialized-pharmacogenomics-pilot.json");
const BASE_SYSTEM = [
  "You are a precise medical-science educator answering an exam-style pharmacogenomics question.",
  "Answer the exact question in clear concise English. Distinguish what the source says from what it does not establish.",
  "Do not invent patient facts, genotypes, test results, dosing values, or regulatory recommendations.",
  "This is educational interpretation, not patient-specific prescribing advice.",
].join(" ");

export const loadPilot = () => JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));

export function buildPilotPair(item, entries = pilotEntries) {
  const selected = entries.filter((e) => item.entryIds.includes(e.id));
  if (selected.length !== item.entryIds.length) {
    const missing = item.entryIds.filter((id) => !selected.some((e) => e.id === id));
    throw new Error(`${item.id}: missing pilot entries: ${missing.join(", ")}`);
  }
  const base = { system: BASE_SYSTEM, user: `${item.question}\n\nGive the direct answer and a brief explanation.` };
  const enriched = attachSpecializedKnowledge(base, selected.map((entry) => ({ entry, score: 1, matched: "pilot-evaluation" })));
  return { baseline: base, specialized: enriched };
}

async function callGemini(prompt, { apiKey, model, apiBase, fetchImpl }) {
  const url = `${apiBase.replace(/\/+$/, "")}/${encodeURIComponent(model)}:generateContent`;
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: prompt.system || BASE_SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: prompt.user || "" }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 700 },
    }),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); } catch { data = null; }
  if (!response.ok) {
    const detail = data?.error?.message || raw.slice(0, 500) || `HTTP ${response.status}`;
    throw new Error(`Gemini ${model} request failed (${response.status}): ${detail}`);
  }
  const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error(`Gemini ${model} returned no answer text`);
  return text;
}

export async function runPilotBenchmark({
  apiKey,
  model = "gemini-flash-latest",
  apiBase = "https://generativelanguage.googleapis.com/v1beta/models",
  fetchImpl = globalThis.fetch,
  cases = loadPilot().cases,
  now = new Date().toISOString(),
} = {}) {
  if (!apiKey) throw new Error("GEMINI_API_KEY is required; no API key is read from or written to project files.");
  if (typeof fetchImpl !== "function") throw new Error("A fetch implementation is required.");
  const blind = [];
  const key = [];
  for (let i = 0; i < cases.length; i++) {
    const item = cases[i];
    const pair = buildPilotPair(item);
    /* Alternate call order to reduce systematic first/second-call effects. */
    const order = i % 2 === 0 ? ["baseline", "specialized"] : ["specialized", "baseline"];
    const generated = {};
    for (const condition of order) {
      generated[condition] = await callGemini(pair[condition], { apiKey, model, apiBase, fetchImpl });
    }
    const aCondition = i % 2 === 0 ? "baseline" : "specialized";
    const bCondition = aCondition === "baseline" ? "specialized" : "baseline";
    blind.push({
      caseId: item.id,
      question: item.question,
      A: generated[aCondition],
      B: generated[bCondition],
    });
    key.push({ caseId: item.id, A: aCondition, B: bCondition });
  }
  return {
    blindResults: { createdAt: now, model, source: loadPilot().source, pairs: blind },
    blindKey: { createdAt: now, model, conditions: key },
  };
}

function prepareOnly(outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const pilot = loadPilot();
  const prompts = pilot.cases.map((item) => {
    const pair = buildPilotPair(item);
    return {
      caseId: item.id,
      question: item.question,
      baseline: pair.baseline,
      withSpecializedKnowledge: pair.specialized,
      expectedCriteria: item.rubric,
      prohibitedClaims: item.mustNotClaim,
    };
  });
  const outfile = path.join(outDir, "specialized-pilot-prompts.json");
  fs.writeFileSync(outfile, JSON.stringify({ pilotId: pilot.id, prompts }, null, 2));
  return outfile;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--prepare-only")) {
    const outDir = path.resolve(args[args.indexOf("--prepare-only") + 1] || path.join(PROJECT, "reports"));
    const out = prepareOnly(outDir);
    console.log(`Prepared ${loadPilot().cases.length} baseline/enriched prompt pairs: ${out}`);
    console.log("No Gemini API calls were made.");
    return;
  }
  const apiKey = process.env.GEMINI_API_KEY || "";
  if (!apiKey) {
    console.error("GEMINI_API_KEY is not set. No model calls were made. Run with --prepare-only or set GEMINI_API_KEY to measure actual Gemini output.");
    process.exitCode = 2;
    return;
  }
  const model = process.env.GEMINI_MODEL || process.env.VITE_GEMINI_MODEL || "gemini-flash-latest";
  const result = await runPilotBenchmark({ apiKey, model });
  const outDir = path.resolve(process.env.PILOT_RESULTS_DIR || path.join(PROJECT, "reports"));
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const blindPath = path.join(outDir, `specialized-pilot-blind-${stamp}.json`);
  const keyPath = path.join(outDir, `specialized-pilot-key-${stamp}.json`);
  fs.writeFileSync(blindPath, JSON.stringify(result.blindResults, null, 2));
  fs.writeFileSync(keyPath, JSON.stringify(result.blindKey, null, 2));
  console.log(`Completed ${result.blindResults.pairs.length} paired comparisons (${result.blindResults.pairs.length * 2} Gemini calls).`);
  console.log(`Blind answers: ${blindPath}`);
  console.log(`Condition key: ${keyPath}`);
  console.log("Score the blinded answers with docs/knowledge/specialized-pilot-evaluation.md before opening the condition key.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message || error); process.exitCode = 1; });
}
