import React, { useState, useRef } from "react";
import Icon from "./Icon.jsx";
import { downloadBackup, restoreBackup, LAST_KEY } from "../lib/backup.js";
import { prefs } from "../lib/storage.js";

const mb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const when = (ts) => { try { return new Date(+ts).toLocaleString("ar-EG", { day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }); } catch (e) { return ""; } };

export default function BackupModal({ onClose }) {
  const [msg, setMsg] = useState({ text: "", kind: "" });
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(() => prefs.get(LAST_KEY));
  const fileRef = useRef(null);

  const save = async () => {
    setBusy(true); setMsg({ text: "بنجهّز النسخة…", kind: "" });
    try {
      const r = await downloadBackup();
      const what = `${r.count} سؤال${r.mistakes ? ` و${r.mistakes} من غلطاتي` : ""} · ${mb(r.bytes)}`;
      if (r.cancelled) setMsg({ text: "اتلغى الحفظ. النسخة ما اتحفظتش، جرّب تاني واختار مكان للحفظ.", kind: "warn" });
      else if (r.how === "share") setMsg({ text: `النسخة جاهزة (${what}). اختار من القائمة مكان الحفظ (Drive أو الملفات أو واتساب…) علشان تتحفظ فعلاً ✅`, kind: "ok" });
      else setMsg({ text: `اتنزّلت نسخة (${what}). دوّر عليها في مجلد التنزيلات ✅`, kind: "ok" });
      setLast(prefs.get(LAST_KEY));
    } catch (e) { setMsg({ text: `ما قدرتش أعمل النسخة: ${(e && e.message) || "مشكلة غير معروفة"}`, kind: "err" }); }
    setBusy(false);
  };

  const restore = async (f) => {
    setBusy(true); setMsg({ text: "بنسترجع…", kind: "" });
    try {
      const r = await restoreBackup(f);
      setMsg({ text: `اترجّع ${r.added} سؤال جديد (الإجمالي ${r.total})${r.mistakes ? ` و${r.mistakes} غلطة` : ""}. بيتعاد التحميل…`, kind: "ok" });
      setTimeout(() => window.location.reload(), 1200);
      return;
    } catch (e) { setMsg({ text: (e && e.message) || "حصلت مشكلة.", kind: "err" }); }
    setBusy(false);
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal" role="dialog" aria-modal="true" aria-label="نسخة احتياطية" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h2>نسخة احتياطية</h2><button type="button" className="iconbtn" onClick={onClose} aria-label="إغلاق"><Icon name="x" size={18} /></button></div>
        <p className="move-sub">كل أسئلتك وشروحاتك وكلماتك وغلطاتك ومعرض الصور محفوظين على الجهاز ده بس. خُد نسخة دورية علشان ما تضيعش لو مسحت بيانات التطبيق أو غيّرت الجهاز. مفتاح Gemini مش بيتحفظ فيها.</p>
        {last && <p className="move-sub" style={{ marginTop: 6 }}>آخر نسخة: {when(last)}</p>}
        <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
          <button type="button" className="btn btn-teal" disabled={busy} onClick={save}>
            <Icon name="download" size={18} /> حفظ نسخة احتياطية
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => fileRef.current?.click()}>استرجاع من نسخة</button>
          <input ref={fileRef} type="file" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) restore(f); }} />
        </div>
        {msg.text && <p className="move-sub bk-msg" data-k={msg.kind} role="status" style={{ marginTop: 12 }}>{msg.text}</p>}
      </div>
    </div>
  );
}
