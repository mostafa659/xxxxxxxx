/* discipline module · nursing scope-of-practice and nursing frameworks — SEED (v3.43)
   Delegation / scope rules are profession- AND jurisdiction-specific (the v3.42 shared prompt applied them to everyone). They live here and only load for the nursing profile. */
const SRC = { url: "https://www.ncsbn.org/", license: "factual statement; paraphrased, not copied", quote: null, verified: false };
export const id = "scope-nursing";
export const facts = [
  { id: "scope.nursing.rn-delegation", topic: "RN delegation scope of practice assessment teaching evaluation unstable patients", kind: "rule",
    aliases: { en: ["delegation", "delegate", "scope of practice", "LPN", "LVN", "UAP", "nursing assistant"], ar: ["تفويض", "نطاق الممارسة"] },
    data: { text: "In the US NCLEX model the RN keeps assessment, teaching, evaluation and care of unstable patients; stable, routine tasks may be delegated to an LPN/VN or UAP. Delegation rules differ by country and by state.",
      triggers: [String.raw`\bdelegat\w*\b|\bassign\w*\s+(?:this\s+)?(?:to|the)\s+(?:an?\s+)?(?:LPN|LVN|UAP|nursing\s+assistant|aide)\b|تفويض|يتفوض`] },
    scope: { discipline: ["nursing"], exam: ["nclex-rn"], jurisdiction: "US" }, source: SRC, version: "US RN/LPN/UAP delegation (NCSBN concepts)", checkedAt: null, reviewBy: "2028-01-01", forbidden_patterns: [] },
  { id: "fw.abc", topic: "airway breathing circulation ABC priority", kind: "framework", aliases: { en: ["ABC", "airway breathing circulation", "airway, breathing, circulation"], ar: ["الممر الهوائي التنفس الدورة"] },
    data: { text: "Airway → Breathing → Circulation" }, scope: { discipline: ["all"], exam: [], jurisdiction: "intl" }, source: SRC, version: "general resuscitation priority order", checkedAt: null, reviewBy: "2028-01-01", forbidden_patterns: [] },
  { id: "fw.maslow", topic: "Maslow hierarchy of needs", kind: "framework", aliases: { en: ["Maslow", "hierarchy of needs"], ar: ["ماسلو", "هرم ماسلو"] },
    data: { text: "Physiological → Safety → Love/belonging → Esteem → Self-actualization" }, scope: { discipline: ["all"], exam: [], jurisdiction: "intl" }, source: SRC, version: "Maslow 1943", checkedAt: null, reviewBy: "2035-01-01", forbidden_patterns: [] },
  { id: "fw.adpie", topic: "nursing process ADPIE assess diagnose plan implement evaluate", kind: "framework", aliases: { en: ["nursing process", "ADPIE", "assess before you intervene"], ar: ["عملية التمريض"] },
    data: { text: "Assessment → Diagnosis → Planning → Implementation → Evaluation" }, scope: { discipline: ["nursing"], exam: [], jurisdiction: "intl" }, source: SRC, version: "ANA nursing process", checkedAt: null, reviewBy: "2035-01-01", forbidden_patterns: [] },
];
