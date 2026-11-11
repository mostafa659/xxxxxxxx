import React, { useState, useRef } from "react";
import Icon from "./Icon.jsx";

const fmtSize = (n) => (!n ? "" : n >= 1048576 ? `${Math.round((n / 1048576) * 10) / 10} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/* The one place where the student gives the app a question (or study material):
   any number of files (pictures, PDF, Word, PowerPoint, Excel, EPUB, text …) AND/OR text typed / pasted right here. */
export default function SourceBox({ kind, items, imageUrl, onFiles, onText, onRemove, onClear }) {
  const lesson = kind === "lesson";
  const fileRef = useRef(null);
  const [over, setOver] = useState(false);
  const [text, setText] = useState("");

  const pick = (e) => { onFiles(e.target.files); e.target.value = ""; };
  const addText = () => { if (text.trim()) { onText(text); setText(""); } };
  const hasMulti = items.length > 1 || items.some((i) => i.t !== "image");
  const truncated = items.some((i) => i.truncated);

  return (
    <div className="src"
      onDragOver={(e) => { if (e.dataTransfer?.types?.includes("Files")) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); setOver(false); onFiles(e.dataTransfer.files); } }}>
      <input ref={fileRef} type="file" multiple hidden onChange={pick} />

      {items.length === 0 ? (
        <button type="button" data-over={over} className="drop" onClick={() => fileRef.current?.click()}>
          <span className="drop-ico"><Icon name={lesson ? "bookOpen" : "imagePlus"} size={28} /></span>
          <b>{lesson ? "ارفع المادة: كتب، صور، ملفات…" : "ارفع السؤال: صورة أو أي ملف"}</b>
          <span className="hint">اضغط عشان تختار (ممكن أكتر من ملف)، أو اسحبهم هنا، أو الصق بـ Ctrl+V</span>
          <span className="src-types">صور · PDF · Word · PowerPoint · Excel · EPUB · نص</span>
        </button>
      ) : (
        <div className="card preview" data-over={over}>
          <img src={imageUrl} alt="المصدر" />
          <ul className="src-list">
            {items.map((it) => (
              <li key={it.id}>
                <span className="src-tag" data-t={it.t}>{it.label || it.t}</span>
                <span className="src-name" dir="auto">{it.name}</span>
                <small><bdi dir="ltr">{fmtSize(it.size)}</bdi></small>
                <button type="button" className="iconbtn" aria-label={`شيل ${it.name}`} onClick={() => onRemove(it.id)}><Icon name="x" size={14} /></button>
              </li>
            ))}
          </ul>
          <div className="preview-actions">
            <button type="button" onClick={() => fileRef.current?.click()} className="btn btn-ghost btn-sm"><Icon name="plus" size={16} /> أضف ملفات</button>
            <button type="button" onClick={onClear} className="btn btn-danger btn-sm"><Icon name="x" size={16} /> شيل الكل</button>
          </div>
          {truncated && <p className="doc-hint">فيه ملف طويل اتقطع عند أول 150 ألف حرف. ارفع الجزء اللي عايز تذاكره بس لو محتاج.</p>}
          {!lesson && hasMulti && <p className="doc-hint">الملفات فيها أكتر من سؤال؟ افتح «عنوان وتعليمات إضافية» واكتب رقم السؤال أو الصفحة.</p>}
        </div>
      )}

      <div className="src-text">
        <label htmlFor="src-ta" className="label">{lesson ? "أو اكتب / الصق نص الشرح هنا" : "أو اكتب / الصق نص السؤال هنا"}</label>
        <textarea id="src-ta" dir="auto" rows={3} value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); addText(); } }}
          className="input area" style={{ overflow: "auto" }}
          placeholder={lesson ? "الصق هنا فقرة من كتاب أو ملاحظاتك…" : "الصق السؤال بالاختيارات، أو اكتبه بنفسك…"} />
        <button type="button" className="btn btn-ghost btn-sm src-add" disabled={!text.trim()} onClick={addText}><Icon name="plus" size={16} /> أضف النص</button>
      </div>
    </div>
  );
}
