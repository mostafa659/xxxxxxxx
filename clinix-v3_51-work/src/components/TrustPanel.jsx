import React, { useState } from "react";
import { reportError, exportReports } from "../lib/reports.js";
import { lessonView, isDeveloper } from "../lib/studentview.js";

/* v3.45 · STUDENT-FRIENDLY. The student sees only what helps: a banner when THIS answer has a concrete problem, a calm line when something was corrected automatically,
   a warning for a statement that differs from their own source, the reference cards and the analogy / memory-aid boxes.
   Missing coverage, «source check pending», unverified counts and probabilities are NOT shown: they stay on the payload (trust.items / trust.stats / the gap list) and appear
   in the audit footer only in developer mode (lib/studentview.js → isDeveloper). It still never claims 100 % correctness: it simply does not nag about it. */
const ICON = { verified: "✓", grounded: "📄", reference: "🔎", corrected: "⚠", conflict: "⚠", outdated: "⚠", scope: "⚠", uncertain: "⚠", unverified: "؟" };
const WORD = { verified: "متحقق منه", grounded: "من مصدرك", reference: "مرجع (المصدر لسه بيتراجع)", corrected: "اتصحّح", conflict: "تعارض مع المصدر أو المرجع", outdated: "ممكن يكون قديم", scope: "قاعدة لتخصص/بلد تاني", uncertain: "مش مؤكد", unverified: "مش متحقق منه" };

export default function TrustPanel({ trust, onSecondOpinion, second }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState({});
  if (!trust) return null;
  const v = lessonView(trust);
  const dev = isDeveloper();
  const { assess, stats, items = [], patches = [] } = trust;
  const { banner } = v;
  const save = () => {
    try {
      const blob = new Blob([exportReports()], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "clinix-reports.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch (e) { /* export unavailable */ }
  };
  const report = (it) => { reportError({ sentence: it.sentence, kind: it.kind, answer: assess ? assess.answer : "", where: "lesson" }); setSent((m) => ({ ...m, [it.id]: true })); };
  const hasReview = v.fixes.length > 0 || v.warnings.length > 0 || v.notes.length > 0;
  return (
    <div className="trust" dir="rtl">
      {banner && (
        <div className={`trust-banner t-${banner.tier.toLowerCase()}`} role="status">
          <b>{banner.head}</b>
          {banner.likely && <div>{banner.likely}{banner.runnerUp ? ` · ${banner.runnerUp}` : ""}</div>}
          {banner.why.length > 0 && <ul>{banner.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {banner.advice && <div className="trust-adv">{banner.advice}</div>}
          {banner.perOption.length > 0 && <div className="trust-per">{banner.perOption.map((o) => <span key={o.letter} className={o.high ? "hi" : "lo"}>{o.letter} {Math.round(o.p * 100)}%</span>)}</div>}
          {onSecondOpinion && !second && <button type="button" onClick={onSecondOpinion}>رأي تاني (موديل مختلف)</button>}
          {second && <div className="trust-second">{second}</div>}
        </div>
      )}
      {assess && assess.data && (assess.dataDoubts.length > 0 || assess.dataFlags.length > 0) && (
        <details className="trust-data"><summary>اللي قريته من صورتك</summary>
          <p dir="ltr">{assess.data}</p>
          {assess.dataFlags.filter((f) => f.status !== "no-range").map((f, i) => <p key={i} dir="ltr">{f.text} → {f.status}{f.range ? ` (${f.range})` : ""}</p>)}
          {assess.dataDoubts.length > 0 && <p>راجع الأرقام دي: {assess.dataDoubts.map((d) => d.token).join(" ")}</p>}
        </details>
      )}
      {v.conflicts.map((c, i) => <div key={i} className="trust-conf">المادة بتقول: «{c.source}» — المرجع بيقول: {c.reference}</div>)}
      {v.warnings.map((w) => (
        <div key={w.id} className="trust-conf" role="note">⚠ راجع المعلومة دي: «{w.sentence}»{w.why ? ` — ${w.why}` : ""}{" "}
          <button type="button" disabled={sent[w.id]} onClick={() => report({ id: w.id, sentence: w.sentence, kind: w.kind })}>{sent[w.id] ? "اتسجّل" : "بلّغ عن غلط"}</button></div>
      ))}
      {v.cards.map((c) => (
        <div key={c.id} className="trust-card">
          <b>📌 مرجع{c.verified ? " متحقق منه" : ""}: {c.title}</b>
          <ul>{c.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {c.note && <small>{c.note}</small>}
          {c.notCovered.length > 0 && <div>كمان في المرجع (مش في مادتك): {c.notCovered.join("، ")}</div>}
          <a href={c.source} target="_blank" rel="noreferrer">المصدر · {c.version}</a>
        </div>
      ))}
      {v.analogies.length > 0 && <div className="trust-box"><b>🧩 تشبيهات (للفهم بس، مش للحفظ)</b>{v.analogies.map((a, i) => <p key={i}>{a}</p>)}</div>}
      {v.memoAids.length > 0 && <div className="trust-box"><b>💡 حيلة حفظ مقترحة (من الـ AI)</b>{v.memoAids.map((a, i) => <p key={i}>{a}</p>)}</div>}
      {hasReview && (
        <details className="trust-review">
          <summary>{v.fixes.length > 0 ? `✓ اتصحّح تلقائيًا ${v.fixes.length === 1 ? "معلومة" : v.fixes.length + " معلومات"} لتطابق المرجع` : "تفاصيل المراجعة"}</summary>
          {v.fixes.map((f, i) => <p key={"f" + i}>«{f.before}» ← «{f.after}»</p>)}
          {v.notes.map((n, i) => <p key={"n" + i}>{n.text} «{n.sentence}»</p>)}
        </details>
      )}
      {dev && stats && (
        <div className="trust-foot" data-audit="developer">
          <button type="button" onClick={() => setOpen((o) => !o)}>
            [dev] ✓ {stats.verified} · 📄 {stats.grounded || 0} · 🔎 {stats.reference || 0} · ⚠ {stats.corrected + stats.conflict + stats.outdated + stats.scope} · ؟ {stats.unverified} · gaps {stats.gaps || 0}
          </button>
          {open && (
            <div>
              {patches.map((p, i) => <p key={"p" + i}>⚠ اتصحّح: «{p.before}» ← «{p.after}»</p>)}
              {items.filter((i) => i.label !== "verified").map((it) => (
                <p key={it.id}>{ICON[it.label]} {WORD[it.label] || it.label}{it.note ? ` — ${it.note}` : ""}{it.prov ? ` · ${it.prov.sourceType === "pdf" ? "PDF" : it.prov.sourceType}${it.prov.page ? " ص " + it.prov.page : ""}` : ""}: {it.sentence}{" "}
                  <button type="button" disabled={sent[it.id]} onClick={() => report(it)}>{sent[it.id] ? "اتسجّل" : "بلّغ عن غلط"}</button></p>
              ))}
              <button type="button" onClick={save}>صدّر البلاغات وقائمة الفجوات (JSON)</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
