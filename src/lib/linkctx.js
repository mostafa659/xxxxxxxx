/* ───────────── Links between questions (v3.28) ─────────────
   The explanation of a question can contain a small yellow chip  ==🔗 مرتبط بسؤال «Cushing syndrome» (نفس العلامة)==  (see lib/prompts.js linkBlock).
   Tapping it opens the earlier question, highlights the part that matches the sentence the chip sits in for LINK_HL_MS (20 s),
   and shows a "عد للسؤال الأصلي" button that returns to where the student was.
   The App provides { questions, selfId, open(question, claim, fromId) }; the chip (components/rich.jsx) reads it. */

import { createContext, useContext } from "react";

export const LINK_HL_MS = 20000;
export const LinkCtx = createContext(null);
export const useLinks = () => useContext(LinkCtx);

const norm = (s) => String(s || "").replace(/[«»=*\n]|🔗/gu, " ").replace(/\s+/g, " ").trim().toLowerCase();

/* the title written between « » inside a chip */
export const titleOf = (seg) => { const m = String(seg || "").match(/«([^»]+)»/); return m ? m[1].trim() : ""; };

/* the saved question a chip points at (the title in the chip may be cut at 70 characters, see App.jsx historyFor) */
export function findLinked(questions, seg, selfId) {
  const list = (questions || []).filter((q) => q && q.id && q.id !== selfId && q.title);
  const t = norm(titleOf(seg));
  if (t) {
    const exact = list.find((q) => norm(q.title) === t);
    if (exact) return exact;
    const part = list.find((q) => { const n = norm(q.title); return n.startsWith(t) || t.startsWith(n); });
    if (part) return part;
    if (t.length >= 6) { const inc = list.find((q) => norm(q.title).includes(t)); if (inc) return inc; }
  }
  const s = norm(seg);
  return list.find((q) => { const n = norm(q.title); return n.length >= 8 && s.includes(n); }) || null;
}
