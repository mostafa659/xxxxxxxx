/* ───────────── The waiting experience (v3.27) ─────────────
   A long answer takes time; the student should never stare at three dots. While the tutor works the chat shows
     · what is happening right now (planning · writing 3 sections · thinking deeply …) with a progress bar that never lies by hitting 100 %
     · one small thing worth reading, changed every few seconds: an NCLEX tip, a B2+ word with its meaning, or a word of encouragement
   Plain logic (no React, no timers) so it is tested in Node. */

/* about how long each level takes (seconds); the bar is paced by it */
export const WAIT_EXPECT = { quick: 8, balanced: 18, deep: 45, max: 100 };

export const WAIT_TIPS = [
  "الأولويات في NCLEX: ABC — Airway ثم Breathing ثم Circulation. المجرى الهوائي قبل أي حاجة 🫁",
  "لو اختيارين صح: اسأل نفسك أنهي واحد فيهم بيحمي حياة المريض وسلامته الأول؟ 🛡️",
  "في أغلب الأسئلة: Assess قبل Intervene، إلا لو الحالة طارئة وبتهدد الحياة.",
  "المريض غير المستقر (unstable) دايماً قبل المريض المستقر (stable) في الأولوية 🚑",
  "قبل أي دوا اتأكد من المريض بمعرّفين اتنين (مثلاً الاسم + تاريخ الميلاد) ✅",
  "غسل الإيدين أهم وسيلة لمنع انتقال العدوى 🧼",
  "الطبيعي تقريباً: البوتاسيوم 3.5 – 5.0 mEq/L والصوديوم 135 – 145 mEq/L 🧪",
  "في الحريق افتكر RACE: Rescue · Alarm · Contain · Extinguish (أو Evacuate) 🔥",
  "مساعد التمريض (UAP) ممكن ياخد علامات حيوية لمريض مستقر، لكن التقييم والتعليم مش من شغله 📋",
  "Digoxin: قيس النبض قبل الإعطاء، ولو أقل من 60 في البالغين اتأخر وبلّغ الدكتور 💓",
  "اقرا السؤال للآخر: كلمات زي FIRST وBEST وEXCEPT بتغيّر الإجابة كلها 🔍",
  "Maslow: الاحتياجات الفسيولوجية والسلامة قبل الاحتياجات النفسية والاجتماعية 🔺",
  "الكلمات المطلقة زي always وnever في الاختيارات غالباً بتبقى مش الإجابة الصح ⚠️",
  "بعد ما تعلّم مريض اطلب منه يعيد بكلامه (teach-back) علشان تتأكد إنه فهم 🗣️",
];

export const WAIT_WORDS = [
  { w: "prioritize", m: "يحدّد الأولوية (إيه اللي يتعمل الأول)" },
  { w: "adverse", m: "ضارّ وغير مرغوب" },
  { w: "exacerbation", m: "تفاقم مفاجئ في المرض" },
  { w: "deteriorate", m: "حالته بتسوء" },
  { w: "intervene", m: "يتدخّل" },
  { w: "comply", m: "يلتزم بالتعليمات" },
  { w: "contraindicated", m: "ممنوع استخدامه في حالة معينة" },
  { w: "impaired", m: "ضعيف أو متضرر" },
  { w: "mitigate", m: "يخفّف الضرر" },
  { w: "subsequent", m: "لاحق، اللي بييجي بعده" },
];

export const WAIT_CHEERS = [
  "كل سؤال بتفهمه النهاردة بيقرّبك من الـ RN 💙",
  "الصبر جزء من التعلّم، وإنت ماشي صح 🌱",
  "فهم سؤال واحد صح أحسن من حفظ عشرة 🌟",
  "بنجهّز لك شرح على مقاسك، مش كلام عام 🎯",
  "خطوة صغيرة النهاردة، رخصة بكرة 🩺",
  "المذاكرة المنتظمة أقوى من المذاكرة الطويلة مرة واحدة 📆",
  "إنت أقرب مما تتخيل. كمّل! 🚀",
  "الرد المظبوط يستاهل ثواني انتظار ⏳",
];

/* tip → cheer → word → tip … so the three kinds alternate; `seed` (any integer) decides where the walk starts */
export function waitItems(seed = 0) {
  const tips = WAIT_TIPS.map((t) => ({ k: "tip", t }));
  const cheers = WAIT_CHEERS.map((t) => ({ k: "cheer", t }));
  const words = WAIT_WORDS.map((x) => ({ k: "word", w: x.w, m: x.m }));
  const n = Math.max(tips.length, cheers.length, words.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (tips.length) out.push(tips[i % tips.length]);
    if (cheers.length) out.push(cheers[i % cheers.length]);
    if (words.length) out.push(words[i % words.length]);
  }
  const off = ((Math.floor(seed) % out.length) + out.length) % out.length;
  return [...out.slice(off), ...out.slice(0, off)];
}

/* the bar approaches 94 % and never reaches it: no "stuck at 100 %" */
export function waitProgress(secs, expected) {
  const e = Math.max(3, expected || 15);
  return Math.min(0.94, 0.94 * (1 - Math.exp(-Math.max(0, secs) / e)));
}

export function waitExpected(level, { kind = "text", stage = null } = {}) {
  if (kind === "image") return 25;
  if (kind === "exam") return 45;
  const base = WAIT_EXPECT[level] || WAIT_EXPECT.balanced;
  return stage && stage.kind === "write" ? Math.max(base, 40) : base;
}

const LEVEL_HEAD = {
  quick: { emoji: "⚡", text: "بنجهّز لك رد سريع" },
  balanced: { emoji: "💭", text: "بنفكّر في ردّك" },
  deep: { emoji: "🧠", text: "الموديل القوي بيفكّر بعمق" },
  max: { emoji: "🎯", text: "أقصى دقة: بيحلّها من الصفر وبيراجع نفسه" },
};

/* what is happening now → { emoji, text, sub } */
export function waitHeadline({ kind = "text", level = "balanced", stage = null, secs = 0, label = "", search = false } = {}) {
  let head;
  if (kind === "image") head = { emoji: "🎨", text: label || "بنرسم لك الصورة" };
  else if (kind === "exam") head = { emoji: "✅", text: label || "بنجهّز امتحانك" };
  else if (stage && stage.kind === "plan") head = { emoji: "🧩", text: "بنقسّم الرد لأقسام علشان يوصلك أسرع" };
  else if (stage && stage.kind === "write" && stage.n) head = { emoji: "✍️", text: `بنكتب ${stage.n} أقسام في نفس اللحظة · خلّص ${stage.done || 0} من ${stage.n}` };
  else if (search && secs < 10) head = { emoji: "🔎", text: "بنبحث ونراجع المصادر قبل ما نرد" };
  else head = LEVEL_HEAD[level] || LEVEL_HEAD.balanced;
  let sub = "";
  if (kind === "text") {
    if (secs >= 80) sub = "تقدر تقفل الشات وترجع، الرد هيكمل ومش هيضيع 🙌";
    else if (secs >= 40) sub = "لسه شغالين عليه، الرد المظبوط يستاهل الانتظار 💪";
    else if (secs >= 15) sub = "الجودة بتاخد شوية وقت، وإنت تستاهل رد مظبوط 💙";
  }
  return { ...head, sub };
}

/* 12 s → "12 ث" · 75 s → "1:15" */
export const waitClock = (secs) => (secs < 60 ? `${secs}ث` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`);
