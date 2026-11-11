import React from "react";

/* the keys of the three photo sources (🔑 window). Each source is optional: whatever has a key is searched. */
const FIELDS = [
  { id: "google", label: "Google API key", ph: "AIza…", hint: "Custom Search JSON API — الصور بتتفلتر بالرخص الحرة (CC) تلقائي. الخطة المجانية: 100 بحث في اليوم" },
  { id: "cx", label: "Google Search Engine ID (cx)", ph: "0123456789abcdef:xyz", hint: "من programmablesearchengine.google.com · فعّل Image search" },
  { id: "unsplash", label: "Unsplash Access Key", ph: "Access Key", hint: "من unsplash.com/developers · النسخة التجريبية 50 طلب في الساعة" },
  { id: "pexels", label: "Pexels API Key", ph: "API Key", hint: "من pexels.com/api" },
];

export default function PhotoKeysPanel({ keys, setKeys }) {
  return (
    <div className="xeng">
      <b className="xeng-h">🖼️ مصادر الصور التوضيحية <small>(اختياري)</small></b>
      <p style={{ margin: "6px 0 10px", fontSize: 12.5, color: "var(--ink-2)" }}>
        لما تفعّل زر الصور في الشات، الـ AI بيقرّر لوحده هل الرد محتاج صور، وبيجيبها من المصادر اللي ليها مفتاح هنا في نفس الوقت.
      </p>
      {FIELDS.map((f) => (
        <label key={f.id} style={{ display: "block", marginBottom: 10 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 800 }}>{f.label}</span>
          <input value={keys[f.id] || ""} onChange={(e) => setKeys({ ...keys, [f.id]: e.target.value })} dir="ltr" className="input"
            placeholder={f.ph} autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          <small style={{ color: "var(--ink-3)" }}>{f.hint}</small>
        </label>
      ))}
    </div>
  );
}
