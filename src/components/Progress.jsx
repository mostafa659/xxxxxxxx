import React from "react";
import Icon from "./Icon.jsx";
import { fmtRemaining } from "../lib/progress.js";

/* One heartbeat every 150 units; 8 beats so the sweep (exactly 2 beats) loops without a seam on any screen width. */
const BEAT = [[0, 38], [40, 38], [48, 38], [56, 12], [68, 58], [78, 38], [112, 38], [120, 38], [127, 27], [137, 45], [144, 38], [150, 38]];
const TRACE = "M" + [0, 1, 2, 3, 4, 5, 6, 7].flatMap((k) => BEAT.map(([x, y]) => `${x + k * 150} ${y}`)).join(" L");

/* A finished lamp shows a check, a running one a pulsing dot. */
function Steps({ steps }) {
  return (
    <ul className="prog-steps">
      {steps.map((s) => (
        <li key={s.id} data-s={s.s}>
          {s.s === "done" ? <Icon name="check" size={14} stroke={3} /> : <i />}
          {s.label}
        </li>
      ))}
    </ul>
  );
}

/* Same language as the result cards: white card, teal side bar, soft chips, teal → sky gradient. */
export function Monitor({ snap, steps, onStop }) {
  const eta = snap.almost ? "لحظات وهنخلّص…" : "بيذاكر سؤالك بعمق… الوقت بيختلف حسب الضغط";   // no seconds estimate: it was always wrong
  return (
    <section className="prog sec-teal" aria-live="polite" aria-label="تقدّم التحليل">
      <div className="prog-head">
        <span className="prog-ico"><Icon name="heartPulse" size={22} /></span>
        <div className="prog-title">
          <h3>جاري التحليل</h3>
          <p>النتايج بتظهر تحت أول بأول</p>
        </div>
        <b className="prog-pct">{snap.percent}<small>%</small></b>
      </div>

      <div className="prog-trace" aria-hidden="true">
        <svg viewBox="0 0 1200 64"><path d={TRACE} /></svg>
      </div>

      <div className="prog-eta">
        <b>{eta}</b>
        <span>مرّ {Math.round(snap.elapsedSec)} ث</span>
      </div>
      <div className="prog-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={snap.percent}>
        <i style={{ width: `${snap.percent}%` }} />
      </div>

      <Steps steps={steps} />

      <div className="prog-foot">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onStop}>
          <Icon name="stop" size={14} /> إيقاف التحليل
        </button>
      </div>
    </section>
  );
}
