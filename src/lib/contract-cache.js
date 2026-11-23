/* ClinixStudy · contract result cache (v3.69). A re-run of the same case (same text, same contract version) costs ZERO requests: on a free key
   with ~20 Flash requests a day, regenerating an answer the student already paid for is the most expensive thing the app can do.
   Stores the parsed ITEMS (not the assembled text), so every deterministic audit and the trust pass run again on the cached content with today's rules.
   Never stores a defective answer. Newest 3, 14 days. "Retry" bypasses it on purpose. */
const LS = "clinix:contract:v1", MAX = 3, TTL = 14 * 864e5;
let _now = () => Date.now();
export const __contractClock = (fn) => { _now = fn || (() => Date.now()); };
const hash = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
export const contractKey = (text, version) => `${hash(String(text))}.${String(text).length}.${version}`;
const read = () => { try { return JSON.parse(window.localStorage.getItem(LS) || "[]").filter((e) => e && _now() - e.t < TTL); } catch (e) { return []; } };
export function getContractResult(key) { const e = read().find((x) => x.k === key); return e ? { items: new Map(e.items), model: e.model || "" } : null; }
export function putContractResult(key, map, model = "") {
  try { window.localStorage.setItem(LS, JSON.stringify([{ k: key, t: _now(), model, items: [...map.entries()] }, ...read().filter((x) => x.k !== key)].slice(0, MAX))); } catch (e) { /* storage may be full or unavailable: caching is optional */ }
}
export const clearContractResults = () => { try { window.localStorage.removeItem(LS); } catch (e) { /* ignore */ } };
