import React, { useState } from "react";
import Icon from "./Icon.jsx";

/* "Put this question / lesson in another topic" — by hand. A hand-made choice is pinned: the AI never moves it again. */
export default function MoveModal({ title, topics, currentId, onPick, onClose, kind = "question" }) {
  const [name, setName] = useState("");
  const list = [...topics.list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card modal move-modal" role="dialog" aria-modal="true" aria-label="نقل لموضوع" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="modal-ico" style={{ background: "var(--teal-soft)", color: "var(--teal)" }}><Icon name="folder" size={22} /></span>
          <h2>{kind === "lesson" ? "نقل لموضوع (الشروحات)" : "نقل لموضوع (الأسئلة)"}</h2>
        </div>
        <p className="move-sub" dir="auto">{title}</p>
        <div className="move-list">
          {list.map((t) => (
            <button key={t.id} type="button" className="move-row" data-on={t.id === currentId} onClick={() => onPick(t.id)}>
              <span className="move-emoji">{t.emoji || "📘"}</span>
              <span className="move-name" dir="auto">{t.name}</span>
              <small>{t.qids.length}</small>
              {t.id === currentId && <Icon name="check" size={16} stroke={3} />}
            </button>
          ))}
          {!list.length && <p className="move-empty">لسه مفيش مواضيع. اكتب اسم موضوع جديد تحت.</p>}
        </div>
        <form className="move-new" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onPick({ name: name.trim() }); }}>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} dir="auto" placeholder="موضوع جديد… مثلاً: قصور القلب (Heart Failure)" />
          <button type="submit" className="btn btn-teal btn-sm" disabled={!name.trim()}><Icon name="plus" size={16} stroke={3} /> إنشاء</button>
        </form>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          {currentId && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(null)}>بدون موضوع</button>}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginInlineStart: "auto" }} onClick={onClose}>إلغاء</button>
        </div>
      </div>
    </div>
  );
}
