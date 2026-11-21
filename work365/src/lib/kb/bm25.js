/* A tiny BM25 index over fact topics + aliases (EN + AR). Built once per loaded module set; a lookup is a few hundred multiplications. */
import { tokens } from "../accuracy.js";

export function buildIndex(facts) {
  const docs = facts.map((f) => {
    const text = [f.topic, ...((f.aliases && f.aliases.en) || []), ...((f.aliases && f.aliases.ar) || [])].join(" ");
    const t = tokens(text);
    const tf = new Map();
    for (const w of t) tf.set(w, (tf.get(w) || 0) + 1);
    return { f, tf, len: t.length };
  });
  const df = new Map();
  for (const d of docs) for (const w of d.tf.keys()) df.set(w, (df.get(w) || 0) + 1);
  const avg = docs.reduce((a, d) => a + d.len, 0) / (docs.length || 1);
  return { docs, df, avg, n: docs.length };
}

export function search(index, query, k = 5) {
  const q = [...new Set(tokens(query))];
  const out = [];
  const k1 = 1.4, b = 0.75;
  for (const d of index.docs) {
    let s = 0;
    for (const w of q) {
      const f = d.tf.get(w);
      if (!f) continue;
      const idf = Math.log(1 + (index.n - (index.df.get(w) || 0) + 0.5) / ((index.df.get(w) || 0) + 0.5));
      s += idf * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d.len / index.avg));
    }
    if (s > 0) out.push({ fact: d.f, score: s });
  }
  return out.sort((a, b2) => b2.score - a.score).slice(0, k);
}
