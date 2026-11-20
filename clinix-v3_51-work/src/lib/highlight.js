/* ───────────── Highlight the part of a saved item that a chat answer came from ─────────────
   The student taps a source link under an answer → the item opens → the part (one to three blocks) that best matches the
   sentence of the answer gets a yellow highlight, is scrolled into the middle of the screen, and the highlight fades out
   and is removed after HL_MS (8 seconds; a link chip between two questions asks for 20 s: `ms`). */

import { bestBlocks } from "./library.js";

export const HL_MS = 8000;
const CLS = "hl-flash";
let timer = null;

export function clearFlash() {
  clearTimeout(timer);
  timer = null;
  document.querySelectorAll(`.${CLS}`).forEach((el) => { el.classList.remove(CLS); el.style.removeProperty("--hl-ms"); });
}

/* field = "original_question_text" | "explanation" | "tricks" (the section is found by data-field). Returns true when something was highlighted. */
export function flashPassage(field, claim, { ms = HL_MS, onDone } = {}) {
  const sec = document.querySelector(`section[data-field="${field}"]`);
  if (!sec) return false;
  const blocks = [...sec.querySelectorAll(".rt > *, .qv > *")];
  if (!blocks.length) return false;
  const pick = bestBlocks(blocks.map((b) => b.textContent || ""), claim);
  if (!pick.length) return false;
  clearFlash();
  const els = pick.map((i) => blocks[i]);
  els.forEach((el) => { el.classList.remove(CLS); el.style.setProperty("--hl-ms", `${ms}ms`); void el.offsetWidth; el.classList.add(CLS); });   // reflow → the animation restarts
  els[0].scrollIntoView({ block: "center", behavior: "smooth" });
  timer = setTimeout(() => { els.forEach((el) => { el.classList.remove(CLS); el.style.removeProperty("--hl-ms"); }); timer = null; onDone && onDone(); }, ms);
  return true;
}
