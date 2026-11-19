/* ───────────── Profiles (v3.43 · P1) — zero tokens, zero network ─────────────
   A profile = { discipline, exam, region, languages, level }. The student sets it in settings; otherwise code infers it from keywords in the
   material or the question; the fallback is "general health sciences". The model is never asked to detect it.
   Everything specific to ONE discipline, exam or country lives in EXAMS / DISCIPLINES below (or in a KB module), never in shared code or prompts. */

export const GENERAL = { discipline: "general", exam: "", region: "", languages: ["ar", "en"], level: "student" };

/* discipline id → { en label, keywords that infer it (EN + AR) } */
export const DISCIPLINES = {
  general:      { label: "general health sciences", kw: [] },
  nursing:      { label: "nursing", kw: ["nurse", "nursing", "nclex", "delegat", "lpn", "uap", "تمريض", "ممرض"] },
  medicine:     { label: "medicine", kw: ["usmle", "plab", "step 1", "step 2", "most likely diagnosis", "best next step in management", "طب بشري"] },
  dentistry:    { label: "dentistry", kw: ["dental", "tooth", "teeth", "caries", "periodont", "endodont", "أسنان", "طب الأسنان"] },
  pharmacy:     { label: "pharmacy", kw: ["pharmacist", "pharmacokinetic", "bioavailab", "dispens", "naplex", "صيدلة", "صيدل"] },
  physiotherapy:{ label: "physiotherapy", kw: ["physiotherap", "physical therap", "rehabilitation exercise", "range of motion", "علاج طبيعي"] },
  laboratory:   { label: "medical laboratory", kw: ["laboratory technolog", "phlebotom", "specimen collection", "hematology analy", "مختبرات", "تحاليل طبية"] },
  radiology:    { label: "radiology", kw: ["radiograph", "radiolog", "ct scan", "mri sequence", "x-ray technique", "أشعة"] },
  nutrition:    { label: "nutrition", kw: ["dietitian", "dietetic", "nutritional assessment", "macronutrient", "تغذية"] },
  publichealth: { label: "public health", kw: ["epidemiolog", "incidence rate", "prevalence", "public health", "biostatistic", "صحة عامة"] },
  midwifery:    { label: "midwifery", kw: ["midwife", "midwifery", "antenatal", "postnatal", "labour stage", "partograph", "قبالة", "توليد"] },
  emergency:    { label: "emergency care", kw: ["paramedic", "emergency medical technician", "emt ", "prehospital", "triage category", "اسعاف", "إسعاف"] },
};

/* Exam modules hold ONLY what the exam body publishes: item formats, scoring rules, reasoning frameworks.
   STATUS: the NCLEX-RN module below was MOVED out of the v3.42 shared prompt; it has NOT been re-checked against NCSBN documents (no network in the build
   environment). `source.checkedAt: null` means exactly that, and the README lists it as untested. */
export const EXAMS = {
  "nclex-rn": {
    label: "NCLEX-RN",
    discipline: "nursing",
    source: { url: "https://www.ncsbn.org/exams/exam-content.page", checkedAt: null, note: "moved from the v3.42 prompt; not re-verified" },
    officialDomains: ["ncsbn.org"],
    itemFormats: ["mcq", "sata", "matrix", "cloze", "bowtie", "highlight", "dragdrop", "ordered", "casestudy"],
    /* item formats where a wrong pick costs points (so "select only what you are sure of" is real advice) — from the v3.43 brief; to be confirmed against NCSBN scoring documents */
    penalizesWrongPicks: ["sata", "matrix", "highlight"],
    negativeKeywords: ["EXCEPT", "NOT", "least likely", "further teaching", "requires follow-up", "requires follow up", "needs further"],
    /* injected into the solve / lesson prompts for THIS exam only */
    solveLine: "Exam: NCLEX-RN (NCSBN). Item types: MCQ, select-all-that-apply, Next-Gen (case study, drop-down, matrix, bow-tie, highlight, drag-and-drop, ordered response). Frameworks that apply here: airway–breathing–circulation; acute before chronic; unstable before stable; actual before potential; assess before you intervene; RN scope (assessment, teaching, evaluation, unstable patients) vs. tasks that may be delegated to LPN/VN or UAP; infection-control precautions; medication safety. Use only the information given.",
    studyLine: "Exam: NCLEX-RN; say what the item tests (test-plan category, Clinical Judgment step).",
  },
};

export const LEVELS = ["student", "intern", "resident"];
const LS = "clinix:profile";

const norm = (s) => String(s || "").toLowerCase();

export function shapeProfile(p) {
  const d = p && DISCIPLINES[p.discipline] ? p.discipline : "general";
  const e = p && EXAMS[p.exam] ? p.exam : "";
  return {
    discipline: d, exam: e, region: String((p && p.region) || "").slice(0, 8),
    languages: Array.isArray(p && p.languages) && p.languages.length ? p.languages.slice(0, 3) : GENERAL.languages,
    level: LEVELS.includes(p && p.level) ? p.level : "student",
    explicit: !!(p && (p.explicit || p.discipline)),
  };
}

export function getProfile() {
  try { const raw = JSON.parse(window.localStorage.getItem(LS) || "null"); if (raw) return shapeProfile({ ...raw, explicit: true }); } catch (e) { /* ignore */ }
  return { ...GENERAL, explicit: false };
}
export function setProfile(p) { try { window.localStorage.setItem(LS, JSON.stringify(p ? shapeProfile(p) : null)); } catch (e) { /* ignore */ } }

/* keywords in the material / the question → a profile. An explicit setting always wins. Fallback = general health sciences. Never a model call. */
export function inferProfile(text, explicit) {
  const set = explicit || getProfile();
  if (set && set.explicit) return set;
  const t = norm(text);
  let best = "general", bestN = 0;
  for (const [id, d] of Object.entries(DISCIPLINES)) {
    if (id === "general") continue;
    let n = 0;
    for (const k of d.kw) if (t.includes(k)) n += 1;
    if (n > bestN) { best = id; bestN = n; }
  }
  const exam = /\bnclex\b/.test(t) ? "nclex-rn" : "";
  if (exam) best = "nursing";
  return { ...GENERAL, discipline: best, exam, explicit: false };
}

export const profileKey = (p) => `${p.discipline}${p.exam ? "/" + p.exam : ""}`;
export const examOf = (p) => (p && p.exam && EXAMS[p.exam]) || null;

/* the ONE short profile line that goes into the prompts (a few tokens); a generic profile adds nothing */
export function profileLine(p, kind = "solve") {
  const e = examOf(p);
  const base = p && p.discipline && p.discipline !== "general" ? `Field: ${DISCIPLINES[p.discipline].label}${p.region ? ", " + p.region : ""}. ` : "";
  const ex = e ? (kind === "solve" ? e.solveLine : e.studyLine) : "";
  return (base + ex).trim();
}

export const penalizesWrongPicks = (p, itemType) => { const e = examOf(p); return !!(e && e.penalizesWrongPicks.includes(itemType)); };
