/* ───────────── Sources (v3.27) ─────────────
   The tutor's chat answers with Google Search switched on: Gemini searches, writes from what it found, and Google sends back
   `groundingMetadata` — the pages used (`groundingChunks[].web = { uri, title }`) and the searches made (`webSearchQueries`).
   This file turns that into the small, tidy list shown under the answer so the student can open the pages and check the facts. Plain logic, tested in Node. */

/* grounding objects of several requests (a big answer is written by several writers) → { links: [{ url, title }], queries: [] }   (title may be empty) */
export function readSources(groundings) {
  const list = (Array.isArray(groundings) ? groundings : [groundings]).filter(Boolean);
  const links = [], queries = [];
  const seen = new Set();
  for (const g of list) {
    for (const c of g.groundingChunks || []) {
      const w = c && c.web;
      if (!w || !/^https?:\/\//i.test(w.uri || "")) continue;
      const title = String(w.title || "").trim();
      const key = (title || w.uri).toLowerCase();                 // the same site can be cited by several writers; the uri itself is a one-off redirect
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ url: w.uri, title });          // the uri is a Google redirect page: its host says nothing, the title is the site
    }
    for (const q of g.webSearchQueries || []) { const t = String(q || "").trim(); if (t && !queries.includes(t)) queries.push(t); }
  }
  return { links, queries };
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch (e) { return ""; }
}

/* merge two grounding objects of ONE streamed request (they arrive in pieces) */
export function mergeGrounding(a, b) {
  if (!b) return a || null;
  if (!a) return b;
  return {
    ...a, ...b,
    groundingChunks: [...(a.groundingChunks || []), ...(b.groundingChunks || [])],
    webSearchQueries: [...new Set([...(a.webSearchQueries || []), ...(b.webSearchQueries || [])])],
  };
}

/* the answer carries real text but no sources: say so honestly instead of letting it pass for checked */
export const needsNote = (text, sources, searchOn) => !!searchOn && String(text || "").trim().length > 220 && !(sources && sources.links && sources.links.length);
