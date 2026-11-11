/* ───────────── Inline layout: bold / highlight + English runs, without ever breaking a word ─────────────
   Two bugs lived here:
   1. A bold marker inside a word ("**S**ymphysis", "ك**بس**ولة") cut the word into separate elements. Each English piece
      became its own LTR island inside the RTL line, so the islands were laid out right-to-left: "ymphysis S".
      Arabic pieces in a different font weight also lost their cursive joining (the garbled letters).
   2. "**Secondary** cartilaginous joint" → the bold word and the words after it were two islands → wrong order.
   The fix: strip the markers FIRST (remembering which characters were emphasised), widen any emphasis that touches a
   word to the whole word, find the English runs on the CLEAN text, and only then cut the text into pieces — so one
   English phrase is always ONE island, whatever formatting sits inside it.
   Markers:  **bold / key term**    ==yellow highlight (link to an earlier question)==                                   */

const W0 = "[A-Za-z0-9+\\-<>=≥≤±/.%'’&]";             // first char of a token inside a run
const WN = "[A-Za-z0-9'’\\-/.%+&,;:!?<>=≥≤±]*";       // the rest of a token (keeps its punctuation)
const PAR = "\\([A-Za-z0-9 ,.'’\\-/%+&<>=≥≤±]*\\)";
export const LATIN_RUN = new RegExp(`(?:[A-H]\\)[ ]+)?[A-Za-z0-9]${WN}(?:[ ]+(?:${W0}${WN}|${PAR}))*(?:[ ]*${PAR})?`, "g");

const isLetter = (c) => !!c && /[\p{L}\p{M}]/u.test(c);
const BOLD = 1, HL = 2;

export function parseEmphasis(src) {
  let s = String(src || "");
  // an odd (unmatched) marker is just noise → drop the last one
  if ((s.match(/\*\*/g) || []).length % 2) s = s.replace(/\*\*(?![\s\S]*\*\*)/, "");
  if ((s.match(/==/g) || []).length % 2) s = s.replace(/==(?![\s\S]*==)/, "");
  let plain = "";
  const flags = [];
  let f = 0;
  for (const part of s.split(/(\*\*|==)/)) {
    if (part === "**") f ^= BOLD;
    else if (part === "==") f ^= HL;
    else for (let i = 0; i < part.length; i++) { plain += part[i]; flags.push(f); }
  }
  // emphasis that touches a letter on either side covers the WHOLE word
  const n = plain.length;
  for (const bit of [BOLD, HL]) {
    let i = 0;
    while (i < n) {
      if (!(flags[i] & bit)) { i++; continue; }
      const s0 = i;
      while (i < n && (flags[i] & bit)) i++;
      let l = s0, r = i - 1;
      while (l > 0 && isLetter(plain[l]) && isLetter(plain[l - 1])) { l--; flags[l] |= bit; }
      while (r < n - 1 && isLetter(plain[r]) && isLetter(plain[r + 1])) { r++; flags[r] |= bit; }
      i = Math.max(i, r + 1);
    }
  }
  return { plain, flags };
}

/* → [{ run:boolean, parts:[{ text, bold, hl }] }]   run = one English LTR island (render it as ONE <bdi>) */
export function layout(src) {
  const { plain, flags } = parseEmphasis(src);
  const groups = (a, b) => {
    const out = [];
    let i = a;
    while (i < b) {
      let j = i;
      while (j < b && flags[j] === flags[i]) j++;
      out.push({ text: plain.slice(i, j), bold: !!(flags[i] & BOLD), hl: !!(flags[i] & HL) });
      i = j;
    }
    return out;
  };
  const nodes = [];
  let last = 0;
  for (const m of plain.matchAll(LATIN_RUN)) {
    /* v3.37: punctuation that CLOSES an English phrase ("Heparin," "Warfarin." "Insulin:") belongs to the Arabic sentence, not to the English island.
       Inside the island an ASCII "," or "." is drawn on the English side (left of the word), i.e. the wrong side of an Arabic line. */
    let end = m.index + m[0].length;
    while (end > m.index + 1 && /[.,;:!?]/.test(plain[end - 1])) end--;
    if (m.index < last) continue;
    if (m.index > last) nodes.push({ run: false, parts: groups(last, m.index) });
    nodes.push({ run: true, parts: groups(m.index, end) });
    last = end;
  }
  if (last < plain.length) nodes.push({ run: false, parts: groups(last, plain.length) });
  return nodes;
}

/* reading direction of one line: Arabic when Arabic words are at least half as many as the English ones (an Arabic sentence with a few English
   terms), English when the line is mostly English with one Arabic word. (Any Arabic used to make the whole line right-to-left.) */
export function dirFor(s) {
  const t = String(s || "").replace(/\*\*|==/g, "");
  const ar = (t.match(/[\u0600-\u06FF]+/g) || []).length;
  if (!ar) return "ltr";
  const en = (t.match(/[A-Za-z][A-Za-z0-9'’\-/.%+&]*/g) || []).length;
  return ar * 2 >= en ? "rtl" : "ltr";
}
