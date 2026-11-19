/* ───────────── local store: "Report error" + the KB gap list (v3.43 · F4) ─────────────
   Everything stays on the device (localStorage) and exports as one JSON file. Every unresolved high-risk claim is added to the gap list (grouped by profile)
   so the KB can grow OFFLINE and runtime verification shrinks over time. */
import { profileKey } from "./profile.js";
import { norm } from "./accuracy.js";

const LS_REPORTS = "clinix:reports", LS_GAPS = "clinix:kbgaps";
const MAX_REPORTS = 500, MAX_GAPS = 800;
const read = (k, d) => { try { return JSON.parse(window.localStorage.getItem(k) || "null") || d; } catch (e) { return d; } };
const write = (k, v) => { try { window.localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full: reports are best effort */ } };

export function claimHash(s) {
  const t = norm(s).replace(/[^a-z0-9\u0621-\u064A ]+/g, " ").replace(/\s+/g, " ").trim();
  let h = 5381;
  for (let i = 0; i < t.length; i++) h = ((h << 5) + h + t.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export function reportError({ sentence, answer = "", kind = "", note = "", profile, where = "" } = {}) {
  const list = read(LS_REPORTS, []);
  const r = { id: `r${Date.now().toString(36)}${list.length}`, at: new Date().toISOString(), sentence: String(sentence || "").slice(0, 600), answer: String(answer || "").slice(0, 200), kind, note: String(note || "").slice(0, 400), profile: profile ? profileKey(profile) : "general", where };
  list.push(r);
  write(LS_REPORTS, list.slice(-MAX_REPORTS));
  return r;
}
export const listReports = () => read(LS_REPORTS, []);

export function addGaps(profile, gaps) {
  if (!gaps || !gaps.length) return 0;
  const all = read(LS_GAPS, {});
  const key = profile ? profileKey(profile) : "general";
  const bucket = all[key] || (all[key] = {});
  let added = 0;
  for (const g of gaps) {
    const h = claimHash(g.sentence);
    if (bucket[h]) { bucket[h].count += 1; continue; }
    if (Object.keys(bucket).length >= MAX_GAPS) break;
    bucket[h] = { sentence: String(g.sentence).slice(0, 400), kind: g.kind, why: g.why, count: 1, firstAt: new Date().toISOString() };
    added += 1;
  }
  write(LS_GAPS, all);
  return added;
}
export const listGaps = () => read(LS_GAPS, {});

export const exportReports = () => JSON.stringify({ app: "ClinixStudy", format: "kb-gaps+reports/1", exportedAt: new Date().toISOString(), reports: listReports(), gaps: listGaps() }, null, 1);
export const clearReports = () => { write(LS_REPORTS, []); write(LS_GAPS, {}); };
