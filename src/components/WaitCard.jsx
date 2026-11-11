import React, { useState, useEffect, useMemo } from "react";
import { waitItems, waitProgress, waitExpected, waitHeadline, waitClock } from "../lib/waiting.js";

/* The "please wait" card of the chat: what is happening now · a progress bar that never lies · one small thing worth reading (tip / B2+ word / encouragement),
   changed every 7 seconds. Looks after itself: it counts its own seconds and is removed by the chat when the first words of the answer arrive. */
export default function WaitCard({ kind = "text", level = "balanced", stage = null, label = "", since = 0, search = false }) {
  const elapsed = () => (since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : 0);
  const [secs, setSecs] = useState(elapsed);
  const [turn, setTurn] = useState(0);
  const items = useMemo(() => waitItems(Math.floor(Math.random() * 1000)), []);
  useEffect(() => {
    const a = setInterval(() => setSecs((s) => (since ? elapsed() : s + 1)), 1000);
    const b = setInterval(() => setTurn((n) => n + 1), 7000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [since]); // eslint-disable-line react-hooks/exhaustive-deps
  const it = items[turn % items.length];
  const head = waitHeadline({ kind, level, stage, secs, label, search });
  const pct = Math.round(waitProgress(secs, waitExpected(level, { kind, stage })) * 100);
  const dots = stage && stage.kind === "write" && stage.n ? Array.from({ length: stage.n }, (_, i) => i < (stage.done || 0)) : null;
  return (
    <div className="wait-card" role="status" aria-live="polite">
      <div className="wait-head">
        <span className="wait-emoji" aria-hidden="true">{head.emoji}</span>
        <b>{head.text}</b>
        <small>{waitClock(secs)}</small>
      </div>
      <div className="wait-bar" aria-hidden="true"><i style={{ width: `${Math.max(4, pct)}%` }} /></div>
      {dots && <div className="wait-dots" aria-hidden="true">{dots.map((on, i) => <i key={i} data-on={on} />)}</div>}
      {head.sub && <p className="wait-sub">{head.sub}</p>}
      <div className="wait-item" key={turn} data-k={it.k}>
        {it.k === "word"
          ? <><span className="wait-tag">📖 كلمة B2+</span><p><b className="wait-word" dir="ltr">{it.w}</b> — {it.m}</p></>
          : <><span className="wait-tag">{it.k === "tip" ? "💡 معلومة سريعة" : "💙 شدّ حيلك"}</span><p>{it.t}</p></>}
      </div>
    </div>
  );
}
