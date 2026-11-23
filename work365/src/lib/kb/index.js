/* ───────────── The verified knowledge base: registry + lazy loading (v3.43 · F2) ─────────────
   • Modules are separate chunks (dynamic import) loaded the FIRST time a profile needs them: never on the startup path (storage.js loadBoot does not import this file).
   • core modules always load for every profile; discipline and exam modules load for that profile only.
   • Modules are ES modules exporting { id, facts }. bundle sizes: `node scripts/kb-sizes.mjs`. */
import { validateFact, factStatus } from "./schema.js";
import { buildIndex, search } from "./bm25.js";
import { cleanResidue } from "../accuracy.js";
import { parseRules, buildRuleIndex, normTerm } from "./rules.js";

const LOADERS = {
  "core-digestive": () => import("./modules/core-digestive.js"),
  "core-ranges": () => import("./modules/core-ranges.js"),
  "scope-nursing": () => import("./modules/scope-nursing.js"),
};
/* scope-* modules are tiny trigger lists and load for EVERY profile: a nursing-only rule can only be recognised (and refused) for another profession if its trigger is known there */
const CORE = ["core-digestive", "core-ranges", "scope-nursing"];
const BY_DISCIPLINE = {};
const BY_EXAM = { "nclex-rn": [] };

/* v3.44 · concept-rule modules (kb/rules.js DSL): one lazy chunk per domain */
const RULE_LOADERS = {
  "r-antidotes": () => import("./modules/r-antidotes.js"),
  "r-drugs": () => import("./modules/r-drugs.js"),
  "r-classes": () => import("./modules/r-classes.js"),
  "r-physiology": () => import("./modules/r-physiology.js"),
  "r-clinical": () => import("./modules/r-clinical.js"),
  "r-nursing": () => import("./modules/r-nursing.js"),
  "r-anatomy": () => import("./modules/r-anatomy.js"),
  "r-micro": () => import("./modules/r-micro.js"),
};
const RULES_ALL = Object.keys(RULE_LOADERS);
const loadedRules = new Map();       // module id → rules[]
let _ruleIdx = null;
export const ruleModulesFor = (profile) => {
  const d = profile && profile.discipline;
  if (["nursing", "midwifery", "medicine", "pharmacy", "emergency", "general", undefined].includes(d)) return RULES_ALL;
  return RULES_ALL.filter((m) => !["r-nursing"].includes(m));            // dentistry / lab / radiology / nutrition / public health / physio: no ward-nursing rule pack
};
export const rulesIndex = () => _ruleIdx;
export const allRules = () => (_ruleIdx ? _ruleIdx.rules : []);
const rebuildRules = () => { const all = [...loadedRules.values()].flat(); _ruleIdx = all.length ? buildRuleIndex(all) : null; };
/* tests and the offline builder register rule text directly */
export function registerRuleText(id, text) { loadedRules.set(id, parseRules(text, id)); rebuildRules(); }

const loaded = new Map();            // module id → facts[]
let _index = null, _facts = [];
let _compiled = null;

export const modulesFor = (profile) => [...new Set([...CORE, ...(BY_DISCIPLINE[profile && profile.discipline] || []), ...(BY_EXAM[profile && profile.exam] || [])])];

function rebuild() {
  _facts = [...loaded.values()].flat();
  _index = buildIndex(_facts);
  _compiled = null;
}

/* tests and the offline builder register modules directly */
export function registerModule(id, facts, { strict = true } = {}) {
  if (strict) for (const f of facts) { const e = validateFact(f); if (e.length) throw new Error(`KB fact ${f && f.id}: ${e.join(", ")}`); }
  loaded.set(id, facts);
  rebuild();
}
export const __resetKb = () => { loaded.clear(); loadedRules.clear(); rebuild(); rebuildRules(); };

/* → Promise<facts[]> — loads (once) what this profile needs */
export async function loadKb(profile) {
  const want = modulesFor(profile);
  let changed = false;
  await Promise.all(want.filter((m) => !loaded.has(m) && LOADERS[m]).map(async (m) => {
    try { const mod = await LOADERS[m](); loaded.set(m, mod.facts || (mod.default && mod.default.facts) || []); changed = true; } catch (e) { /* a missing module only means less coverage, never an error */ }
  }));
  if (changed || !_index) rebuild();
  let rchanged = false;
  /* sequential, with a yield after each pack: every task stays under ~15 ms so the UI never janks while the KB loads in the background */
  for (const m of ruleModulesFor(profile).filter((x) => !loadedRules.has(x))) {
    try { const mod = await RULE_LOADERS[m](); loadedRules.set(m, parseRules(mod.rules, mod.id || m)); rchanged = true; } catch (e) { /* a missing pack only means less coverage */ }
    await new Promise((r) => setTimeout(r, 0));
  }
  if (rchanged) rebuildRules();
  return _facts;
}
export const loadedFacts = () => _facts;
export const kbReady = (profile) => modulesFor(profile).every((m) => loaded.has(m)) && ruleModulesFor(profile).every((m) => loadedRules.has(m));

/* scope: a fact applies to a profile when its discipline list says "all" or names the profile's discipline, and (when it names exams) the exam; jurisdiction is never mixed silently */
export function inScope(f, profile) {
  const s = f.scope || {};
  const dOk = !s.discipline || s.discipline.includes("all") || (profile && s.discipline.includes(profile.discipline));
  const eOk = !s.exam || !s.exam.length || (profile && s.exam.includes(profile.exam));
  return dOk && eOk;
}
export function jurisdictionMismatch(f, profile) {
  const j = f.scope && f.scope.jurisdiction;
  return !!(j && profile && profile.region && j !== profile.region && j !== "intl");
}

export function lookup(query, profile, k = 5) {
  if (!_index) return [];
  return search(_index, query, k).filter((r) => inScope(r.fact, profile));
}

/* compiled regexes of every forbidden pattern, once per loaded set */
export function compiled() {
  if (_compiled) return _compiled;
  _compiled = [];
  for (const f of _facts) for (const p of f.forbidden_patterns || []) {
    try {
      /* prefilter: a pattern can only match a sentence that shares a (stemmed) word with its fact's aliases */
      const anchors = [...new Set([...(f.aliases.en || []), ...(f.aliases.ar || []), f.topic].flatMap((a) => normTerm(a).split(" ")).filter((w) => w.length >= 3))];
      _compiled.push({ fact: f, re: new RegExp(p.re, p.flags || "iu"), correction: p.correction, anchors });
    } catch (e) { /* validated at build time */ }
  }
  return _compiled;
}
export { factStatus };
export const asOf = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);
export const __clean = cleanResidue;
