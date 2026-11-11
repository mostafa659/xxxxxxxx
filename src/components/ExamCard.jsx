import React from "react";
import Icon from "./Icon.jsx";
import { RichText } from "./rich.jsx";
import { recordAnswer } from "../lib/mistakes.js";

/* An interactive exam inside the chat. The whole state lives in `exam` (saved with the message), so closing the chat or the app
   never loses progress:  { title, intro, questions:[{type,stem,options,correct,rationale,topic}], answers:{ [i]:{sel:[],checked} }, cur, done } */

const L = "ABCDEF";
const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
const isRight = (q, a) => !!a && a.checked && same(a.sel, q.correct);

export function scoreOf(exam) {
  const ans = exam.answers || {};
  return exam.questions.reduce((n, q, i) => n + (isRight(q, ans[i]) ? 1 : 0), 0);
}

export default function ExamCard({ exam, onChange, onAsk, busy, onOpenMistakes }) {
  const qs = exam.questions;
  const total = Math.max(exam.total || qs.length, qs.length);   // v3.20: questions arrive while the student is already answering
  const loading = !!exam.loading;
  const ans = exam.answers || {};
  const cur = Math.max(0, Math.min(exam.cur || 0, qs.length - 1));
  const q = qs[cur];
  const a = ans[cur] || { sel: [], checked: false };
  const set = (patch) => onChange({ ...exam, ...patch });
  const setAns = (i, patch) => set({ answers: { ...ans, [i]: { sel: [], checked: false, ...(ans[i] || {}), ...patch } } });

  const pick = (i) => {
    if (a.checked) return;
    if (q.type === "multi") setAns(cur, { sel: a.sel.includes(i) ? a.sel.filter((x) => x !== i) : [...a.sel, i] });
    else setAns(cur, { sel: [i] });
  };
  /* confirming an answer: a wrong one is saved to «غلطاتي» automatically (a right one only counts when that question was a mistake before) */
  const confirm = () => {
    if (!a.sel.length || a.checked) return;
    recordAnswer(q, a.sel, { exam: exam.title });
    setAns(cur, { checked: true });
  };
  const askAbout = (idx) => {
    const k = qs[idx];
    const mine = (ans[idx] && ans[idx].sel) || [];
    onAsk(`اشرحلي سؤال رقم ${idx + 1} من الامتحان بالتفصيل، وليه كل اختيار صح أو غلط:\n${k.stem}\n${k.options.map((o, j) => `${L[j]}) ${o}`).join("\n")}\nإجابتي: ${mine.length ? mine.map((j) => L[j]).join(", ") : "ما جاوبتش"}`, { exam: false });
  };

  /* ───── result screen ───── */
  if (exam.done) {
    const score = scoreOf(exam);
    const pct = Math.round((score / qs.length) * 100);
    const wrong = qs.map((k, i) => ({ k, i })).filter(({ k, i }) => !isRight(k, ans[i]));
    const weak = {};
    wrong.forEach(({ k }) => { if (k.topic) weak[k.topic] = (weak[k.topic] || 0) + 1; });
    const weakList = Object.entries(weak).sort((x, y) => y[1] - x[1]).slice(0, 4);
    const verdict = pct >= 85 ? "ممتاز! 🏆" : pct >= 70 ? "كويس جداً 👏" : pct >= 50 ? "في أمل، راجع الغلط 💪" : "محتاج مراجعة، وإنت قدها 💙";
    return (
      <div className="exam" data-view="result">
        <div className="exam-head"><b>{exam.title}</b><small>النتيجة</small></div>
        <div className="exam-score" data-lv={pct >= 70 ? "hi" : pct >= 50 ? "mid" : "lo"}>
          <div className="exam-ring"><b>{score}<i>/{qs.length}</i></b><span>{pct}%</span></div>
          <p>{verdict}</p>
        </div>
        {weakList.length > 0 && (
          <p className="exam-weak">نقاط تحتاج مراجعة: {weakList.map(([t, n]) => <span key={t} className="exam-tag" dir="ltr">{t}{n > 1 ? ` ×${n}` : ""}</span>)}</p>
        )}
        <div className="exam-dots" role="list">
          {qs.map((k, i) => (
            <button key={i} type="button" role="listitem" data-s={!ans[i] || !ans[i].checked ? "skip" : isRight(k, ans[i]) ? "ok" : "no"}
              onClick={() => set({ done: false, cur: i })} aria-label={`سؤال ${i + 1}`}>{i + 1}</button>
          ))}
        </div>
        <div className="exam-actions">
          {wrong.length > 0 && <button type="button" className="btn btn-teal btn-sm" onClick={() => set({ done: false, cur: wrong[0].i })}>راجع الغلط ({wrong.length})</button>}
          {wrong.length > 0 && onOpenMistakes && <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenMistakes}><Icon name="circleX" size={15} /> افتح غلطاتي</button>}
          {wrong.length > 0 && <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAsk(`اشرحلي الأسئلة اللي غلطت فيها في الامتحان ده (رقم ${wrong.map((w) => w.i + 1).join("، ")}) واديني القاعدة اللي لازم أحفظها لكل واحد:\n\n${wrong.map(({ k, i }) => `${i + 1}) ${k.stem}`).join("\n\n")}`, { exam: false })}>اشرحلي أخطائي</button>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onAsk(`اعملي امتحان تاني ${qs.length} أسئلة على نفس الموضوع (${exam.title}) بأسئلة مختلفة${weakList.length ? "، وركّز على: " + weakList.map(([t]) => t).join(", ") : ""}`, { exam: true })}>امتحان تاني</button>
        </div>
      </div>
    );
  }

  /* ───── a question ───── */
  const last = cur === qs.length - 1;
  const waiting = loading && last;           // this is the newest question and the next one is still being written
  const right = isRight(q, a);
  const nextOrResult = () => (waiting ? null : last ? set({ done: true }) : set({ cur: cur + 1 }));
  return (
    <div className="exam" data-view="q">
      <div className="exam-head">
        <b>{exam.title}</b>
        <small>{cur + 1} / {total}</small>
      </div>
      <div className="exam-bar" aria-hidden="true"><i style={{ width: `${Math.round(((a.checked ? cur + 1 : cur) / total) * 100)}%` }} /></div>
      {loading && <p className="exam-loadnote">بنكتب باقي الأسئلة… جاهز {qs.length} من {total}</p>}

      <div className="exam-q" dir="ltr">
        {q.topic && <span className="exam-tag">{q.topic}</span>}
        <p className="exam-stem">{q.stem}</p>
        {q.type === "multi" && <p className="exam-hintline">Select all that apply — اختار كل الإجابات الصح</p>}
      </div>

      <div className="exam-opts" role={q.type === "multi" ? "group" : "radiogroup"} dir="ltr">
        {q.options.map((o, i) => {
          const on = a.sel.includes(i);
          const key = q.correct.includes(i);
          const st = a.checked ? (key ? (on ? "ok" : "miss") : on ? "no" : "idle") : on ? "on" : "idle";
          return (
            <button key={i} type="button" className="exam-opt" data-s={st} role={q.type === "multi" ? "checkbox" : "radio"} aria-checked={on} onClick={() => pick(i)} disabled={a.checked}>
              <i className={q.type === "multi" ? "sq" : ""}>{a.checked && key ? <Icon name="check" size={14} stroke={3} /> : a.checked && on ? <Icon name="x" size={14} stroke={3} /> : L[i]}</i>
              <span>{o}</span>
            </button>
          );
        })}
      </div>

      {a.checked && (
        <div className="exam-why" data-ok={right}>
          <b>{right ? "✅ إجابة صح" : "❌ إجابة غلط"}{!right && <small dir="ltr"> · الصح: {q.correct.map((j) => L[j]).join(", ")}</small>}</b>
          {q.rationale && <RichText text={q.rationale} />}
          {!right && <small className="exam-saved"><Icon name="bookmark" size={13} /> اتحفظ السؤال ده في «غلطاتي»{onOpenMistakes && <> · <button type="button" className="linkbtn" onClick={onOpenMistakes}>افتحها</button></>}</small>}
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => askAbout(cur)}><Icon name="chat" size={15} /> اشرحلي أكتر</button>
        </div>
      )}

      <div className="exam-nav">
        <button type="button" className="iconbtn" onClick={() => set({ cur: cur - 1 })} disabled={cur === 0} aria-label="السؤال اللي قبله"><Icon name="chevRight" size={18} /></button>
        {!a.checked ? (
          <>
            <button type="button" className="btn btn-teal btn-sm exam-go" disabled={!a.sel.length} onClick={confirm}>تأكيد الإجابة</button>
            <button type="button" className="btn btn-ghost btn-sm" disabled={waiting} onClick={nextOrResult}>{waiting ? "…" : last ? "النتيجة" : "تخطّي"}</button>
          </>
        ) : (
          <button type="button" className="btn btn-teal btn-sm exam-go" disabled={waiting} onClick={nextOrResult}>
            {waiting ? "بنجهّز السؤال اللي بعده…" : last ? "شوف النتيجة" : "التالي"}
          </button>
        )}
        <button type="button" className="iconbtn" onClick={() => set({ cur: cur + 1 })} disabled={last} aria-label="السؤال اللي بعده"><Icon name="chevLeft" size={18} /></button>
      </div>
    </div>
  );
}
