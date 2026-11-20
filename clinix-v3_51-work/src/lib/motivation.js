/* ───────────── Motivation helpers (pure functions, no UI) ─────────────
   Design rules: celebrate effort (not only results), never shame a missed day, always offer a tiny next step. */

import { dayKey } from "./parse.js";

/* levels are based on how many questions you have saved */
export const LEVELS = [
  { min: 0,   name: "طالب جديد",     emoji: "🌱" },
  { min: 3,   name: "متدرّب",        emoji: "📘" },
  { min: 10,  name: "ممرض واعد",     emoji: "🩺" },
  { min: 25,  name: "شبه جاهز",      emoji: "💪" },
  { min: 50,  name: "محترف",         emoji: "⭐" },
  { min: 100, name: "جاهز للامتحان", emoji: "🏆" },
];

export function levelInfo(total) {
  let idx = 0;
  LEVELS.forEach((l, i) => { if (total >= l.min) idx = i; });
  const cur = LEVELS[idx];
  const next = LEVELS[idx + 1] || null;
  const pct = next ? (total - cur.min) / (next.min - cur.min) : 1;
  return { idx, level: idx + 1, ...cur, next, pct, toNext: next ? next.min - total : 0 };
}

/* the last 7 days (oldest → today) with how many questions were added each day */
export function weekDays(questions) {
  const counts = new Map();
  questions.forEach((q) => {
    const k = dayKey(q.createdAt || q.updatedAt || 0);
    counts.set(k, (counts.get(k) || 0) + 1);
  });
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    let label = "";
    try { label = d.toLocaleDateString("ar-EG", { weekday: "short" }); } catch (e) { /* ignore */ }
    out.push({ key: dayKey(d.getTime()), label, count: counts.get(dayKey(d.getTime())) || 0, today: i === 0 });
  }
  return out;
}

/* one warm line for the top of the home screen */
export function heroMessage({ total, today, goal, streak }) {
  const left = Math.max(0, goal - today);
  if (total === 0) return "أول سؤال هو أصعب خطوة. بعدها كل حاجة بتبقى أسهل 💙";
  if (today >= goal) return "خلّصت هدفك النهاردة 🎉 أي سؤال زيادة مكسب إضافي";
  if (today > 0) return `إنت ماشي كويس 👏 فاضل ${left} ${left <= 10 ? "أسئلة" : "سؤال"} وتحقق هدفك`;
  if (streak > 0) return `عندك ${streak} ${streak <= 10 ? "أيام" : "يوم"} ورا بعض. سؤال واحد يحافظ عليهم 🔥`;
  return "ابدأ بسؤال واحد بس. الباقي بيمشي لوحده 🌱"; // coming back after a break: no guilt, just a tiny step
}

const MILESTONES = [3, 7, 14, 30, 60, 100];

/* what to say (and whether to throw confetti) right after a NEW question is saved */
export function saveCheer(before, after, goal) {
  const lvBefore = levelInfo(before.total);
  const lvAfter = levelInfo(after.total);
  if (lvAfter.idx > lvBefore.idx) return { confetti: true, msg: `ترقّيت لمستوى ${lvAfter.level}: ${lvAfter.name} ${lvAfter.emoji}` };
  if (before.today < goal && after.today >= goal) return { confetti: true, msg: "🎉 حققت هدف النهاردة! تعبك مش رايح على الفاضي" };
  if (after.streak > before.streak && MILESTONES.includes(after.streak)) return { confetti: true, msg: `🔥 ${after.streak} ${after.streak <= 10 ? "أيام" : "يوم"} ورا بعض. استمرارك هو سرّ النجاح` };
  if (after.today < goal) {
    const left = goal - after.today;
    return { confetti: false, msg: left === 1 ? "فاضل سؤال واحد على هدفك 💪" : `كمّلت ${after.today} من ${goal} النهاردة 👏` };
  }
  return { confetti: false, msg: "" };
}

/* a saved word that stays the same all day and changes tomorrow ("shuffle" moves to the next one) */
export function pickWord(lines, shift = 0) {
  if (!lines.length) return null;
  const d = new Date();
  const seed = d.getFullYear() * 400 + d.getMonth() * 31 + d.getDate();
  return lines[(seed + shift) % lines.length];
}
