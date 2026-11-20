#!/usr/bin/env node
/* ───────────── OFFLINE KB builder (v3.43 · F2) ─────────────
   usage:  node scripts/build-kb.mjs <manifest.json> <candidates.json> <out-module.js> [module-id]
   manifest   { sources:[{ id, url, license, licenseVerified:true|false, attribution, passages:[{ id, text }] }] }
   candidates facts extracted OFFLINE by a strong model; each carries  source:{ sourceId, passageId, quote }  and the schema fields of kb/schema.js.
   Rules (no LLM judge decides truth):
     • the quote must exist VERBATIM (whitespace-normalised, exact characters) in the cited passage, else the fact is dropped
     • the source's license must be verified AND open (CC BY, CC BY-SA excluded for bundling unless legally cleared → rejected here, CC0, public domain, US-government work);
       NC / SA / unknown → rejected. Conflicting listings (e.g. CC BY vs CC BY-NC-SA) must be settled by a human BEFORE licenseVerified is set true.
     • schema + regex validation (time-sensitive kinds need version, reviewBy, jurisdiction; ranges need strata, SI unit, varies-by-lab flag)
   Prints accepted / rejected with reasons. Exit code 1 when anything was rejected and --strict is passed.

   v3.46 · SPECIALIZED layer:  node scripts/build-kb.mjs --specialized <manifest.json> <candidates.json> <out-module.js> [module-id] [--strict]
   A separate path (buildSpecialized) accepts both local/current rules AND globally applicable expert knowledge (rare mechanisms, complex relationships, specialist interpretation,
   technical distinctions, context-sensitive values and non-obvious exceptions). It checks source/license provenance and verbatim quotations mechanically; a separate human approval
   checklist must attest that the evidence supports the exact claim, the clinical claim is accurate, and its scope/exceptions are correct. Lexical overlap is only a preflight, not a truth verdict.
   Entries also need applicability, exceptions, currency, unique ids and no near-duplicate of the general KB. Rejected entries never reach the output. */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { validateFact } from "../src/lib/kb/schema.js";
import { validateSpecialized, duplicatesGeneral, generalSurrogates, EVIDENCE_TYPES } from "../src/lib/kb/specialized.js";

const OPEN = [/^CC0/i, /^CC[- ]BY[- ]4\.0$/i, /^CC[- ]BY[- ]3\.0$/i, /^public domain/i, /^US[- ]government/i];
const BLOCK = /\bNC\b|NonCommercial|\bSA\b|ShareAlike|\bND\b/i;
export const licenseOk = (l) => !!l && !BLOCK.test(l) && OPEN.some((r) => r.test(String(l).trim()));
const squash = (s) => String(s || "").replace(/\s+/g, " ").trim();

/* shared by both layers: resolve one {sourceId, passageId, quote} reference against the manifest. → { ok:true, s, p, q } | { ok:false, reason } (messages are part of the contract) */
function resolveSource(src, ref) {
  if (!ref || !ref.sourceId) return { ok: false, reason: "no source reference" };
  const s = src.get(ref.sourceId);
  if (!s) return { ok: false, reason: `unknown source ${ref.sourceId}` };
  if (s.licenseVerified !== true) return { ok: false, reason: `license of ${s.id} is not verified` };
  if (!licenseOk(s.license)) return { ok: false, reason: `license "${s.license}" is not bundleable (NC/SA/unknown)` };
  const p = (s.passages || []).find((x) => x.id === ref.passageId);
  if (!p) return { ok: false, reason: `passage ${ref.passageId} not found` };
  const q = squash(ref.quote);
  if (q.length < 12) return { ok: false, reason: "quote too short" };
  if (!squash(p.text).includes(q)) return { ok: false, reason: "quote not found verbatim in the cited passage" };
  return { ok: true, s, p, q };
}

export function buildFacts(manifest, candidates, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const src = new Map((manifest.sources || []).map((s) => [s.id, s]));
  const accepted = [], rejected = [];
  for (const c of candidates) {
    const fail = (reason) => rejected.push({ id: c && c.id, reason });
    const ref = c && c.source;
    const r = resolveSource(src, ref);
    if (!r.ok) { fail(r.reason); continue; }
    const { s, p, q } = r;
    const fact = { ...c, source: { url: s.url, license: s.license, attribution: s.attribution || "", quote: q, passageId: p.id, verified: true }, checkedAt: today };
    const errs = validateFact(fact);
    if (errs.length) { fail("schema: " + errs.join(", ")); continue; }
    accepted.push(fact);
  }
  return { accepted, rejected };
}

/* ── v3.46 · SPECIALIZED layer ──
   candidates: { id, title, kind, statement, aliases, value:{category,beyondGeneral,generalAnswerRisk}, clinical:{scope}, scope, applicability:{conditions}, exceptions | noExceptionsNote,
                 evidence:[{ sourceId, passageId, quote }], approval:{status,reviewer,reviewedAt}, version, reviewBy, effectiveFrom? }
   manifest sources additionally carry  type  (one of EVIDENCE_TYPES).
   opts.general = { facts, rules } of the GENERAL layer: an entry that merely restates one is rejected (the safety layer already covers it; no duplication). */
export function buildSpecialized(manifest, candidates, { today = new Date().toISOString().slice(0, 10), general = { facts: [], rules: [] } } = {}) {
  const src = new Map((manifest.sources || []).map((s) => [s.id, s]));
  const surrogates = generalSurrogates(general);
  const accepted = [], rejected = [], seen = new Set();
  for (const c of candidates) {
    const fail = (reason) => rejected.push({ id: c && c.id, reason });
    if (!c || typeof c !== "object") { fail("not an object"); continue; }
    if (seen.has(c.id)) { fail("duplicate id in this build"); continue; }
    if (!Array.isArray(c.evidence) || !c.evidence.length) { fail("no evidence: an unsupported entry is not accepted"); continue; }
    const evidence = [];
    let bad = "";
    for (const ref of c.evidence) {
      const r = resolveSource(src, ref);
      if (!r.ok) { bad = r.reason; break; }
      if (!EVIDENCE_TYPES.has(r.s.type)) { bad = `source ${r.s.id} has type "${r.s.type || ""}": textbooks, wikis, AI text and untyped sources are not evidence for this layer`; break; }
      evidence.push({
        sourceId: r.s.id, url: r.s.url, license: r.s.license, attribution: r.s.attribution || "",
        type: r.s.type, passageId: r.p.id, quote: r.q,
        /* Provenance only: the builder verifies the source/license and exact quote, never the clinical meaning. */
        verified: true, sourceVerified: true, quoteVerified: true,
      });
    }
    if (bad) { fail(bad); continue; }
    const entry = { ...c, evidence, checkedAt: today };
    const errs = validateSpecialized(entry);
    if (errs.length) { fail("schema: " + errs.join("; ")); continue; }
    const dup = duplicatesGeneral(entry, surrogates);
    if (dup) { fail(`duplicates the general layer (${dup}): the safety layer already covers it`); continue; }
    seen.add(c.id);
    accepted.push(entry);
  }
  return { accepted, rejected };
}

/* re-check a shipped module against a corpus: every verified fact must still match its quote */
export function recheck(facts, manifest) {
  const { rejected } = buildFacts(manifest, facts.filter((f) => f.source && f.source.verified).map((f) => ({ ...f, source: { sourceId: f.source.sourceId, passageId: f.source.passageId, quote: f.source.quote } })));
  return rejected;
}

const main = async () => {
  const flags = process.argv.slice(2);
  const specialized = flags.includes("--specialized");
  const [manifestPath, candPath, outPath, id = specialized ? "specialized-built" : "core-built"] = flags.filter((a) => !a.startsWith("--"));
  if (!manifestPath || !candPath || !outPath) { console.error("usage: build-kb.mjs [--specialized] <manifest.json> <candidates.json> <out.js> [module-id] [--strict]"); process.exit(2); }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")), cands = JSON.parse(fs.readFileSync(candPath, "utf8"));
  let accepted, rejected;
  if (specialized) {
    /* the general layer is loaded so overlap can be refused; if it cannot be loaded the build stops rather than silently skipping the check */
    let general;
    try { const KB = await import("../src/lib/kb/index.js"); await KB.loadKb({ discipline: "general" }); general = { facts: KB.loadedFacts(), rules: KB.allRules() }; }
    catch (e) { console.error("cannot load the general KB for the overlap check: " + e.message + "\n(run with: node --import ./tests/register.mjs scripts/build-kb.mjs --specialized …)"); process.exit(2); }
    ({ accepted, rejected } = buildSpecialized(manifest, cands, { general }));
    fs.writeFileSync(outPath, `/* generated by scripts/build-kb.mjs --specialized — do not edit by hand */\nexport const id = ${JSON.stringify(id)};\nexport const entries = ${JSON.stringify(accepted, null, 1)};\n`);
  } else {
    ({ accepted, rejected } = buildFacts(manifest, cands));
    fs.writeFileSync(outPath, `/* generated by scripts/build-kb.mjs — do not edit by hand */\nexport const id = ${JSON.stringify(id)};\nexport const facts = ${JSON.stringify(accepted, null, 1)};\n`);
  }
  console.log(`accepted ${accepted.length}, rejected ${rejected.length}`);
  for (const r of rejected) console.log(`  ✗ ${r.id || "?"}: ${r.reason}`);
  if (rejected.length && flags.includes("--strict")) process.exit(1);
};
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
