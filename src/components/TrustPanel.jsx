import React, { useState } from "react";
import { reportError, exportReports } from "../lib/reports.js";

/* v3.43 · F4 / B6 — everything the accuracy layer says about one result. It never blocks the text: it is drawn from what the final pass found.
   ✓ verified (tap → source, version) · ⚠ corrected / uncertain / possibly outdated · ؟ unverified. It never claims 100 % correctness. */
const ICON = { verified: "✓", grounded: "📄", reference: "🔎", corrected: "⚠", conflict: "⚠", outdated: "⚠", scope: "⚠", uncertain: "⚠", unverified: "؟" };
const WORD = { verified: "متحقق منه", grounded: "من مصدرك", reference: "مرجع (المصدر لسه بيتراجع)", corrected: "اتصحّح", conflict: "تعارض مع المصدر أو المرجع", outdated: "ممكن يكون قديم", scope: "قاعدة لتخصص/بلد تاني", uncertain: "مش مؤكد", unverified: "مش متحقق منه" };

export default function TrustPanel({ trust, onSecondOpinion, second }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState({});
  if (!trust) return null;
  const { banner, assess, stats, cards = [], conflicts = [], analogies = [], memoAids = [], items = [], patches = [] } = trust;
  const save = () => {
    try {
      const blob = new Blob([exportReports()], { type: "application/json" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "clinix-reports.json"; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    } catch (e) { /* export unavailable */ }
  };
  const report = (it) => { reportError({ sentence: it.sentence, kind: it.kind, answer: assess ? assess.answer : "", where: "lesson" }); setSent((m) => ({ ...m, [it.id]: true })); };
  return (
    <div className="trust" dir="rtl">
      {banner && (
        <div className={`trust-banner t-${banner.tier.toLowerCase()}`} role="status">
          <b>⚠ {banner.head}</b>
          {banner.likely && <div>{banner.likely}{banner.runnerUp ? ` · ${banner.runnerUp}` : ""}</div>}
          {banner.why.length > 0 && <ul>{banner.why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          {banner.advice && <div className="trust-adv">{banner.advice}</div>}
          {banner.perOption.length > 0 && <div className="trust-per">{banner.perOption.map((o) => <span key={o.letter} className={o.high ? "hi" : "lo"}>{o.letter} {Math.round(o.p * 100)}%</span>)}</div>}
          {onSecondOpinion && !second && <button type="button" onClick={onSecondOpinion}>رأي تاني (موديل مختلف)</button>}
          {second && <div className="trust-second">{second}</div>}
        </div>
      )}
      {assess && assess.data && (
        <details className="trust-data"><summary>اللي قريته من صورتك</summary>
          <p dir="ltr">{assess.data}</p>
          {assess.dataFlags.map((f, i) => <p key={i} dir="ltr">{f.text} → {f.status}{f.range ? ` (${f.range})` : ""}</p>)}
          {assess.dataDoubts.length > 0 && <p>راجع الأرقام دي: {assess.dataDoubts.map((d) => d.token).join(" ")}</p>}
        </details>
      )}
      {conflicts.map((c, i) => <div key={i} className="trust-conf">المادة بتقول: «{c.source}» — المرجع بيقول: {c.reference}</div>)}
      {cards.map((c) => (
        <div key={c.id} className="trust-card">
          <b>📌 مرجع {c.label === "verified" ? "متحقق منه" : "(المصدر لسه بيتراجع)"}: {c.title}</b>
          <ul>{c.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          {c.note && <small>{c.note}</small>}
          {c.notCovered.length > 0 && <div>مش مذكور في المادة: {c.notCovered.join("، ")}</div>}
          <a href={c.source} target="_blank" rel="noreferrer">المصدر · {c.version}</a>
        </div>
      ))}
      {analogies.length > 0 && <div className="trust-box"><b>🧩 تشبيهات (للفهم بس، مش للحفظ)</b>{analogies.map((a, i) => <p key={i}>{a}</p>)}</div>}
      {memoAids.length > 0 && <div className="trust-box"><b>💡 حيلة حفظ من الـ AI (مش من مصدر متحقق منه)</b>{memoAids.map((a, i) => <p key={i}>{a}</p>)}</div>}
      {stats && (
        <div className="trust-foot">
          <button type="button" onClick={() => setOpen((o) => !o)}>
            ✓ {stats.verified} · 📄 {stats.grounded || 0} · 🔎 {stats.reference || 0} · ⚠ {stats.corrected + stats.conflict + stats.outdated + stats.scope} · ؟ {stats.unverified} — الـ AI ممكن يغلط؛ ده مش ضمان 100%
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
