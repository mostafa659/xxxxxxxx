import React from "react";
import { needsNote } from "../lib/sources.js";

/* The tidy list of pages Google Search used for an answer, under the answer, so the student can open them and check the facts.
   No sources while the answer is still being written (they arrive with its last words). */
export default function Sources({ sources, searched, text, busy }) {
  if (busy) return null;
  const links = (sources && sources.links) || [];
  const queries = (sources && sources.queries) || [];
  if (links.length) {
    return (
      <div className="src-box">
        <div className="src-head"><b>🔗 المصادر</b><small>افتح أي مصدر وتأكد بنفسك</small></div>
        <ol className="src-list">
          {links.slice(0, 8).map((l, i) => (
            <li key={l.url}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                <span className="src-n" aria-hidden="true">{i + 1}</span>
                <span className="src-t" dir="auto">{l.title || `مصدر ${i + 1}`}</span>
                <span className="src-go" aria-hidden="true">↗</span>
              </a>
            </li>
          ))}
        </ol>
        {queries.length > 0 && <p className="src-q">🔎 اتبحث عن: <span dir="auto">{queries.slice(0, 3).join(" · ")}</span></p>}
      </div>
    );
  }
  if (needsNote(text, sources, searched)) {
    return <div className="src-box src-none">⚠️ الرد ده اتكتب من غير مصادر بحث، فراجع المعلومات المهمة قبل ما تعتمد عليها.</div>;
  }
  return null;
}
