/* ───────────── lib/claims.js · F3 background verification, the code side (v3.43) ─────────────
   selectClaims   which sentences ride in the proof request (unresolved high-risk, not cached, safety-critical first, ≤ 25, standalone)
   applyVerdicts  what a verdict may change. A model with no source is an OPINION (C3/C4): without an allowlisted URL a "T" proves nothing (stays ؟ UNVERIFIABLE)
                  and an "F" only turns the sentence into ⚠ "AI check disagrees" with the suggestion shown on tap. With an allowlisted source an "F" is applied IN PLACE
                  and a "T" becomes ✓ with that source. No regeneration, no second loop. A claim is checked at most once (cache by normalised-claim hash). */
import { claimHash } from "./reports.js";
import { SAFETY_CRITICAL } from "./accuracy.js";
import { examOf } from "./profile.js";

export const ALLOW = ["who.int", "cdc.gov", "nih.gov", "ncbi.nlm.nih.gov", "medlineplus.gov", "openstax.org", "dailymed.nlm.nih.gov", "fda.gov", "ema.europa.eu", "merckmanuals.com"];
const REGION_AUTH = { US: ["hhs.gov", "ahrq.gov"], GB: ["nhs.uk", "nice.org.uk"], EG: ["mohp.gov.eg"], EU: ["ecdc.europa.eu"] };
const LS = "clinix:verdicts";
const DAY = 864e5, TTL = 30 * DAY, TTL_SENSITIVE = 7 * DAY;

export function allowedDomains(profile) {
  const e = examOf(profile);
  return [...ALLOW, ...((e && e.officialDomains) || []), ...((profile && profile.domains) || []), ...(REGION_AUTH[profile && profile.region] || [])];
}
/* Google's grounding links are redirects whose TITLE is the site: the host is read from the title then */
export function hostOf(link) {
  let h = ""; try { h = new URL(link.url).hostname.toLowerCase(); } catch (e) { h = ""; }
  if (/vertexaisearch\.cloud\.google\.com|google\.com$/.test(h) && link.title) h = String(link.title).toLowerCase().replace(/^https?:\/\//, "").split("/")[0];
  return h.replace(/^www\./, "");
}
export function allowlisted(link, profile) {
  const h = hostOf(link);
  if (!h) return false;
  if (/\.edu$|\.edu\.[a-z]{2}$/.test(h)) return true;
  return allowedDomains(profile).some((d) => h === d || h.endsWith("." + d));
}

const read = () => { try { return JSON.parse(window.localStorage.getItem(LS) || "{}") || {}; } catch (e) { return {}; } };
const write = (o) => { try { window.localStorage.setItem(LS, JSON.stringify(o)); } catch (e) { /* ignore */ } };
export function cachedVerdict(sentence, kind, now = Date.now()) {
  const c = read()[claimHash(sentence)];
  if (!c) return null;
  return now - c.at < (SAFETY_CRITICAL.has(kind) || kind === "clinical_rule" || kind === "number" ? TTL_SENSITIVE : TTL) ? c : null;
}
const remember = (sentence, v, now) => { const o = read(); o[claimHash(sentence)] = { ...v, at: now }; const keys = Object.keys(o); if (keys.length > 600) for (const k of keys.sort((a, b) => o[a].at - o[b].at).slice(0, keys.length - 600)) delete o[k]; write(o); };

const plain = (s) => String(s).replace(/\*\*|==|^>\s*|🔗[^=]*/g, "").replace(/\s+/g, " ").trim().slice(0, 240);

/* items (already labeled by kb/check.js) → the claims to ask about */
export function selectClaims(items, { now = Date.now() } = {}) {
  const out = [];
  for (const it of items) {
    if (it.label !== "unverified") continue;
    if (cachedVerdict(it.sentence, it.kind, now)) continue;
    out.push({ id: it.id, text: plain(it.sentence), kind: it.kind });
  }
  out.sort((a, b) => (SAFETY_CRITICAL.has(b.kind) ? 1 : 0) - (SAFETY_CRITICAL.has(a.kind) ? 1 : 0));
  return out.slice(0, 25);
}

/* the cached verdicts → labels, before anything is asked */
export function applyCached(items, { now = Date.now() } = {}) {
  for (const it of items) {
    if (it.label !== "unverified") continue;
    const c = cachedVerdict(it.sentence, it.kind, now);
    if (c) applyOne(it, c);
  }
}
function applyOne(it, v) {
  if (v.v === "F" && v.fix && v.url) { it.before = it.sentence; it.text = v.fix; it.label = "corrected"; it.note = `checked against ${v.host}`; it.sourceUrl = v.url; it.memorize = false; return; }
  if (v.v === "F") { it.label = "uncertain"; it.note = "AI check disagrees" + (v.fix ? `: ${v.fix}` : ""); it.suggestion = v.fix || ""; it.memorize = false; return; }
  if (v.v === "T" && v.url) { it.label = "verified"; it.note = `checked against ${v.host}`; it.sourceUrl = v.url; it.memorize = true; return; }
  /* T without a source, or U → stays ؟ */
}

/*
 * A verdict is claim-specific. A reputable URL elsewhere in a response does not
 * support every sentence in that response. Only the explicitly mapped grounding
 * source for this claim may be attached; otherwise the result remains unverified.
 */
export function applyVerdicts(items, claimList, verdicts, { links = [], profile, now = Date.now() } = {}) {
  const find = (claim) => items.find((i) => i.label === "unverified" && plain(i.sentence) === claim.text);
  let applied = 0;
  for (const v of verdicts || []) {
    const claim = claimList[v.n - 1];
    const it = claim && find(claim);
    if (!it || it.label !== "unverified") continue;
    const fix = v.fix && v.fix.length <= 240 && !/https?:\/\//i.test(v.fix) ? v.fix : "";
    const mapped = Number.isInteger(v.sourceIndex) ? links[v.sourceIndex - 1] : null;
    const good = mapped && allowlisted(mapped, profile) ? mapped : null;
    const rec = { v: v.v, fix: good ? fix : "", url: good ? good.url : "", host: good ? hostOf(good) : "" };
    // An unsupported F is only a disagreement signal, never an automatic correction.
    remember(it.sentence, rec, now);
    applyOne(it, rec);
    applied += 1;
  }
  return applied;
}
export const __clearVerdicts = () => write({});
