/* ───────────── KB fact schema (v3.43 · F2) ─────────────
   {
     id, topic, aliases: { ar:[], en:[] }   (drug INN and brand names both go here),
     kind: list | count | relation | framework | term | pair | rule | range | antidote | dose | item-format,
     data,                                   kind-specific payload
     forbidden_patterns: [{ re, correction, flags? }]   common misconceptions / distractors with the right statement
     support: [regex string]                 statements that CONFIRM the fact (optional)
     scope: { discipline:["all"|ids], exam:[], jurisdiction:"" }
     source: { url, license, quote, verified }   verified === true ONLY when build-kb.mjs found `quote` verbatim in the cited passage
     version, checkedAt, reviewBy            (guideline / edition / year; ISO dates)
   }
   A fact whose source.verified is not true can still PATCH a clear error, but it is never shown as ✓: it is shown as "reference — source check pending". */

export const KINDS = ["list", "count", "relation", "framework", "term", "pair", "rule", "range", "antidote", "dose", "item-format", "mnemonic"];
export const TIME_SENSITIVE = new Set(["rule", "range", "dose", "antidote", "item-format", "framework"]);

export function validateFact(f) {
  const errs = [];
  const need = (c, m) => { if (!c) errs.push(m); };
  need(f && typeof f.id === "string" && f.id, "id");
  need(f && typeof f.topic === "string" && f.topic, "topic");
  need(f && KINDS.includes(f.kind), "kind");
  need(f && f.aliases && (Array.isArray(f.aliases.en) || Array.isArray(f.aliases.ar)), "aliases");
  need(f && f.source && typeof f.source.url === "string" && f.source.url, "source.url");
  need(f && f.source && typeof f.source.license === "string" && f.source.license, "source.license");
  need(f && f.scope && Array.isArray(f.scope.discipline), "scope.discipline");
  if (f && TIME_SENSITIVE.has(f.kind)) { need(f.version, "version (time-sensitive kind)"); need(f.reviewBy, "reviewBy (time-sensitive kind)"); need(f.scope && "jurisdiction" in f.scope, "scope.jurisdiction (time-sensitive kind)"); }
  if (f && f.source && f.source.verified === true) need(typeof f.source.quote === "string" && f.source.quote.length >= 12, "source.quote (verified facts need a verbatim quote)");
  for (const p of (f && f.forbidden_patterns) || []) { try { new RegExp(p.re, p.flags || "iu"); } catch (e) { errs.push("bad regex " + p.re); } need(p.correction, "forbidden_patterns.correction"); }
  if (f && f.kind === "range") {
    const d = f.data || {};
    need(Array.isArray(d.strata) && d.strata.length, "range.strata");
    need(d.si && d.si.unit, "range.si.unit");
    need("variesByLab" in d, "range.variesByLab");
  }
  return errs;
}

/* the status a fact can carry TODAY: verified ✓ only when source-checked and not past its review date */
export function factStatus(f, now = Date.now()) {
  if (f.reviewBy && Date.parse(f.reviewBy) < now) return "outdated";
  if (!(f.source && f.source.verified === true)) return "pending";
  return "verified";
}
