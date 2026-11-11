/* ───────────── Repeated easy questions (v3.35) ─────────────
   The one case where a saved answer is strictly cheaper than asking again: the student asks an EASY question that he has already asked (the same words, give or take
   word order, a stop-word or a spelling variant). Then the saved answer is exactly what he needs: no request, no token, no waiting.

   What this file deliberately does NOT do: it never pastes a piece of an old answer into a new request, and it never answers a merely "similar" question from the
   past. Measured on this app: a plain chat request is about 1,250 input tokens, so a 300–800 character excerpt adds 6–16 % input tokens to EVERY similar question, saves
   no output (the model still writes the whole reply, and writing is what takes the time), and risks anchoring the model on an answer that was written for another
   question. That costs more and is no faster, so it stays off. (What the app already does: the student's saved library is searched for the items that match the
   question and the matching ones are shown to the model, see library.js.)

   Plain logic + localStorage, no imports: tested in Node (tests/reuse.test.mjs). */

const LS = "clinix:reuse:v1";
const MAX_ENTRIES = 150;
const TTL_PLAIN = 60 * 864e5;       // an answer that needed no web facts
const TTL_SEARCHED = 14 * 864e5;    // an answer that came from a web search: facts move
const MIN_SAME = 0.9;               // Jaccard of the content words: practically the same sentence

let _now = () => Date.now();
export const __setReuseClock = (fn) => { _now = typeof fn === "function" ? fn : () => Date.now(); };
const get = () => { try { const a = JSON.parse(window.localStorage.getItem(LS)); return Array.isArray(a) ? a : []; } catch (e) { return []; } };
const put = (a) => { try { window.localStorage.setItem(LS, JSON.stringify(a)); } catch (e) { /* storage full: reuse simply stays off */ } };
export const __resetReuse = () => { try { window.localStorage.removeItem(LS); } catch (e) { /* ignore */ } };

const STOP = new Set(["the", "a", "an", "is", "are", "of", "in", "to", "and", "or", "what", "does", "do", "mean", "means", "meaning", "please", "me", "my", "it", "this", "that",
  "في", "من", "على", "الى", "إلى", "عن", "هو", "هي", "ده", "دي", "دا", "يعني", "ايه", "إيه", "ما", "ماذا", "معنى", "معني", "لو", "سمحت", "ممكن", "قولي", "قوللي", "عايز", "عاوز", "اعرف"]);

/* words of a sentence without the noise: lower case, no marks, Arabic letters unified (أإآ→ا · ى→ي · ة→ه), no stop-words */
export function words(text) {
  return String(text || "").toLowerCase()
    .replace(/[\u064B-\u0652\u0640\u060C\u061B\u061F\u066A-\u066D\u06D4]/g, " ")      // diacritics, tatweel and the Arabic punctuation marks (؟ ، ؛ …), which sit inside the Arabic letter block
    .replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/[^a-z0-9\u0600-\u06FF\s]/g, " ")
    .split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
}
export function similarity(a, b) {
  const A = new Set(words(a)), B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

/* the same place in the app: the general window, or one particular question / lesson */
export function placeOf(ctx) {
  if (!ctx || ctx.kind === "global") return "global";
  const s = `${ctx.kind || ""}|${ctx.title || ""}|${String(ctx.question || "").slice(0, 300)}`;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return `${ctx.kind || "q"}:${(h >>> 0).toString(36)}`;
}

/* → the saved entry for this question, or null. The comparison is on the distinctive words, so even a one-word question ("what does NPO mean?" → NPO) is matched exactly:
   "NPO" and "PRN" share nothing, "NPO" and "NPO after midnight" share a third. */
export function findSaved({ text, place }) {
  if (!words(text).length) return null;
  const t = _now();
  let best = null, bestS = 0;
  for (const e of get()) {
    if (e.place !== place || t - e.at > (e.searched ? TTL_SEARCHED : TTL_PLAIN)) continue;
    const s = similarity(text, e.q);
    if (s >= MIN_SAME && s > bestS) { best = e; bestS = s; }
  }
  return best;
}

export function saveAnswer({ text, place, answer, sources, searched }) {
  const q = String(text || "").trim(), a = String(answer || "").trim();
  if (!words(q).length || a.length < 20) return;
  const t = _now();
  const keep = get().filter((e) => t - e.at <= (e.searched ? TTL_SEARCHED : TTL_PLAIN) && !(e.place === place && similarity(e.q, q) >= MIN_SAME));
  keep.unshift({ q, place, answer: a, sources: sources || null, searched: !!searched, at: t });
  put(keep.slice(0, MAX_ENTRIES));
}
