/*
 * ClinixStudy · Citation audit (v3.69). Deterministic, zero requests.
 *
 * A fast model cites from memory: the author, the year and the journal drift, and a plausible reference can simply not exist.
 * The contract path therefore treats the retrieved anchors as the only VERIFIED reference set. Every citation-shaped string in the answer is
 * checked against the text of those anchors (surname/acronym AND year must both be there). A citation that is not found and is not already
 * labelled "(من الذاكرة …)" is marked in place, so the student never reads an unverified reference as a verified one.
 * This proves that a reference is or is not in the verified set. It does NOT prove that a listed reference supports the sentence.
 */
const ORG = /\b(ISTH|KDIGO|ACR|EULAR|AHA|ASH|BSH|NICE|ESC|IDSA|CHEST|ASAIO|AST|Banff|Sapporo|Sydney|Asherson|Cervera|Zheng|Bendapudi|Perry|Legault|Fakhouri|Garg|Chaturvedi|Naesens|Loupy|Miyakis)\b[^.\n;()]{0,30}?\(?\b((?:19|20)\d\d)\b\)?/g;
const ETAL = /\b([A-Z][A-Za-z'’\-]{2,})(?: [A-Z]{1,3})?,? (?:et al\.?|and [A-Z][A-Za-z'’\-]+|& [A-Z][A-Za-z'’\-]+)[^.\n;]{0,60}?\(?\b((?:19|20)\d\d)\b\)?/g;
const MEMORY = /من الذاكرة|from memory|راجع المصدر|verify|\(unverified\)|غير موثّق/i;

export function auditCitations(text, anchors) {
  const known = (Array.isArray(anchors) ? anchors : []).map((a) => `${a.sources.join(" ")} ${a.statements.join(" ")}`).join(" ").toLowerCase();
  const found = [], seen = new Set();
  const scan = (re) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text))) {
      const name = m[1].toLowerCase(), year = m[2], key = `${name}|${year}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const sentence = text.slice(Math.max(0, text.lastIndexOf("\n", m.index) + 1), (() => { const e = text.indexOf("\n", m.index); return e < 0 ? text.length : e; })());
      const ok = known.includes(name) && known.includes(year);
      found.push({ cite: m[0].trim(), name, year, ok, acknowledged: MEMORY.test(sentence) });
    }
  };
  scan(ORG); scan(ETAL);
  return { found, unverified: found.filter((f) => !f.ok && !f.acknowledged), verified: found.filter((f) => f.ok).length };
}

/* mark each unverified citation in place (once per distinct citation) */
export function annotateCitations(text, audit, lang = "ar") {
  let out = text;
  const tag = lang === "en" ? " ⟦not in the verified reference set — check⟧" : " ⟦غير موجود في المراجع الموثّقة — تحقّق منه⟧";
  for (const u of audit.unverified) { const i = out.indexOf(u.cite); if (i >= 0 && !out.slice(i, i + u.cite.length + tag.length).includes("⟦")) out = out.slice(0, i + u.cite.length) + tag + out.slice(i + u.cite.length); }
  return out;
}
