/* core · digestive system — SEED module (v3.43)
   These facts come from the digestive-system errors found in review. Every fact is `source.verified:false`: the quotes have NOT been extracted from the cited
   book yet (no network where this was built), so they patch clear errors but are never shown as ✓. `node scripts/build-kb.mjs` upgrades a fact to verified
   only when it finds a verbatim quote in a passage of an openly licensed corpus. */
const SRC = { url: "https://openstax.org/books/anatomy-and-physiology-2e/pages/23-introduction", license: "CC BY 4.0 (OpenStax; confirm per book before bundling)", quote: null, verified: false };
const SCOPE = { discipline: ["all"], exam: [], jurisdiction: "intl" };
const base = { scope: SCOPE, source: SRC, version: "OpenStax A&P 2e", checkedAt: null, reviewBy: "2030-01-01" };
const R = String.raw;
const it = (id, en, ar, extra = []) => ({ id, en, ar, aliases: [en, ...extra] });

export const id = "core-digestive";
export const facts = [
  { ...base, id: "dig.pharynx.parts", topic: "pharynx parts air food", kind: "list",
    aliases: { en: ["pharynx", "nasopharynx", "oropharynx", "laryngopharynx", "throat"], ar: ["البلعوم", "البلعوم الأنفي", "البلعوم الفموي", "البلعوم الحنجري"] },
    data: { items: [it("nas", "nasopharynx", "البلعوم الأنفي", ["الأنفي"]), it("oro", "oropharynx", "البلعوم الفموي", ["الفموي"]), it("lar", "laryngopharynx", "البلعوم الحنجري", ["الحنجري"])],
      note: "Nasopharynx: air only. Oropharynx and laryngopharynx: air and food." },
    forbidden_patterns: [
      { re: R`(?:nasopharynx|البلعوم الأنفي)[^.\n]{0,40}(?:food|swallow|طعام|أكل|اكل|بلع)`, correction: "The nasopharynx carries air only; the oropharynx and laryngopharynx carry both air and food." },
      { re: R`(?:pharynx|البلعوم)[^.\n]{0,25}(?:two|2|four|4|اثنين|اتنين|أربع\w*|اربع\w*)\s+(?:parts|regions|sections|أجزاء|اجزاء)`, correction: "The pharynx has three parts: nasopharynx, oropharynx, laryngopharynx." },
      { re: R`any\s+(?:problem|disease|condition|disorder)\s+(?:in|of|with)\s+the\s+pharynx[^.\n]{0,50}(?:threaten|airway|immediate)|أي\s+مشكلة\s+في\s+البلعوم[^.\n]{0,50}(?:تهدد|الممر الهوائي|الهواء|فورا|فوراً)`, correction: "Not every pharynx problem threatens the airway immediately: it depends on whether the airway is narrowed or blocked." },
    ] },
  { ...base, id: "dig.stomach.regions", topic: "stomach regions cardia fundus body pylorus orifice", kind: "list",
    aliases: { en: ["stomach", "cardia", "fundus", "pylorus", "cardiac orifice", "pyloric orifice", "pyloric sphincter"], ar: ["المعدة", "الفؤاد", "قاع المعدة", "البواب", "الفتحة الفؤادية", "الفتحة البوابية"] },
    data: { items: [it("car", "cardia", "الفؤاد", ["cardiac region"]), it("fun", "fundus", "القاع"), it("bod", "body", "الجسم"), it("pyl", "pylorus", "البواب", ["pyloric region"])],
      note: "Cardiac orifice: esophagus → stomach. Pyloric orifice: stomach → duodenum." },
    forbidden_patterns: [
      { re: R`(?:pyloric|بوابي\w*)\s*(?:orifice|sphincter|opening|فتحة|صمام)[^.\n]{0,50}(?:esophag|oesophag|مريء)`, correction: "The cardiac orifice joins the esophagus to the stomach; the pyloric orifice joins the stomach to the duodenum." },
      { re: R`(?:cardiac|cardia|فؤادي\w*)\s*(?:orifice|sphincter|opening|فتحة|صمام)[^.\n]{0,50}(?:duoden|الاثني|الاثنى)`, correction: "The cardiac orifice joins the esophagus to the stomach; the pyloric orifice joins the stomach to the duodenum." },
    ] },
  { ...base, id: "dig.stomach.curvatures", topic: "stomach curvatures lesser greater border ligament", kind: "relation",
    aliases: { en: ["lesser curvature", "greater curvature", "curvature"], ar: ["التقوس الأصغر", "التقوس الأكبر", "الانحناء الأصغر", "الانحناء الأكبر"] },
    data: { subject: "lesser and greater curvatures", relation: "are borders of the stomach", object: "not ligaments (the lesser and greater omentum attach to them)" },
    forbidden_patterns: [
      { re: R`(?:lesser|greater)\s+curvature\s+(?:is|are)\s+(?:a\s+|the\s+)?ligament|(?:التقوس|الانحناء)\s+(?:الأصغر|الاصغر|الأكبر|الاكبر)\s+(?:هو\s+)?رباط`, correction: "The lesser and greater curvatures are the borders (edges) of the stomach, not ligaments; the lesser and greater omentum attach to them." },
    ] },
  { ...base, id: "dig.large-intestine.parts", topic: "large intestine cecum colon rectum anal canal appendix", kind: "list",
    aliases: { en: ["large intestine", "large bowel", "cecum", "colon", "rectum", "anal canal", "appendix", "ascending colon", "transverse colon", "descending colon", "sigmoid colon"], ar: ["الأمعاء الغليظة", "القولون", "الأعور", "المستقيم", "القناة الشرجية", "الزائدة الدودية"] },
    data: { items: [it("cec", "cecum", "الأعور", ["caecum"]), it("col", "colon", "القولون"), it("rec", "rectum", "المستقيم"), it("anc", "anal canal", "القناة الشرجية"), it("app", "appendix", "الزائدة الدودية", ["vermiform appendix"])],
      note: "The colon has 4 parts: ascending, transverse, descending, sigmoid. The appendix hangs from the cecum." },
    forbidden_patterns: [
      { re: R`(?:large\s+(?:intestine|bowel)|الأمعاء\s+الغليظة|الامعاء\s+الغليظة)[^.\n]{0,30}\b(?:7|seven|سبع\w*)\s+(?:parts|sections|segments|regions|أجزاء|اجزاء|أقسام|اقسام)`, correction: "The large intestine = cecum, colon (4 parts: ascending, transverse, descending, sigmoid), rectum and anal canal, with the appendix attached to the cecum." },
      { re: R`\bcolon\b[^.\n]{0,20}\b(?:3|three|5|five|6|six)\s+(?:parts|sections|segments)`, correction: "The colon has 4 parts: ascending, transverse, descending and sigmoid." },
    ] },
  { ...base, id: "dig.liver.lobes", topic: "liver lobes anatomical right left caudate quadrate", kind: "list",
    aliases: { en: ["liver", "hepatic lobes", "caudate lobe", "quadrate lobe"], ar: ["الكبد", "فصوص الكبد", "الفص الذنبي", "الفص المربع"] },
    data: { items: [it("rig", "right lobe", "الفص الأيمن"), it("lef", "left lobe", "الفص الأيسر"), it("cau", "caudate lobe", "الفص الذنبي"), it("qua", "quadrate lobe", "الفص المربع")], note: "4 anatomical lobes; the falciform ligament separates the right and left lobes." },
    forbidden_patterns: [
      { re: R`(?:liver|الكبد)[^.\n]{0,30}\b(?:two|2|three|3|five|5|six|6|اتنين|اثنين|ثلاث\w*|خمس\w*)\s+(?:anatomical\s+)?(?:lobes|فصوص)`, correction: "The liver has 4 anatomical lobes: right, left, caudate and quadrate (the falciform ligament separates the right and left lobes)." },
    ] },
  { ...base, id: "dig.bile", topic: "bile liver gallbladder makes stores concentrates", kind: "relation",
    aliases: { en: ["bile", "gallbladder", "gall bladder"], ar: ["الصفراء", "العصارة الصفراوية", "المرارة"] },
    data: { subject: "liver", relation: "makes bile", object: "gallbladder stores and concentrates it, releases it when needed" },
    support: [R`(?:liver|الكبد)\s+[^.\n]{0,30}(?:makes?|produces?|secretes?|بتصنع|بتفرز|بتنتج|بيصنع|بيفرز)[^.\n]{0,15}(?:bile|الصفراء)`, R`(?:gallbladder|gall bladder|المرارة)\s+[^.\n]{0,30}(?:stores?|concentrates?|بتخزن|بتركز|بيخزن)`],
    forbidden_patterns: [
      { re: R`(?:gallbladder|gall\s+bladder|المرارة)\s+(?:also\s+|itself\s+)?(?:secretes?|produces?|makes?|synthesi[sz]es?|تفرز|تصنع|تنتج|بتفرز|بتصنع|بتنتج|بيفرز|بيصنع)\s+(?:the\s+)?(?:bile|الصفراء)`, correction: "The liver makes bile; the gallbladder stores and concentrates it and releases it when needed." },
    ] },
  { ...base, id: "dig.pancreas.roles", topic: "pancreas exocrine endocrine pancreatic juice", kind: "relation",
    aliases: { en: ["pancreas", "pancreatic juice", "exocrine", "endocrine"], ar: ["البنكرياس", "العصارة البنكرياسية"] },
    data: { subject: "pancreas", relation: "makes pancreatic juice (exocrine) and hormones such as insulin and glucagon (endocrine)", object: "" },
    forbidden_patterns: [
      { re: R`(?:pancreas|البنكرياس)\s+(?:secretes?|produces?|makes?|بتفرز|بيفرز|تفرز)\s+(?:the\s+)?(?:bile|الصفراء)`, correction: "The pancreas makes pancreatic juice (exocrine) and hormones such as insulin and glucagon (endocrine); bile is made by the liver." },
      { re: R`(?:pancreas|البنكرياس)[^.\n]{0,30}\b(?:only|just|فقط)\s+(?:an?\s+)?(?:endocrine|exocrine|غدة صماء|غدة خارجية)`, correction: "The pancreas has both roles: exocrine (pancreatic juice with digestive enzymes) and endocrine (hormones such as insulin and glucagon)." },
    ] },
  { ...base, id: "dig.si.absorption", topic: "small intestine absorption duodenum jejunum ileum iron B12", kind: "relation",
    aliases: { en: ["small intestine", "duodenum", "jejunum", "ileum", "vitamin B12", "iron absorption", "absorption"], ar: ["الأمعاء الدقيقة", "الاثني عشر", "الصائم", "اللفائفي", "فيتامين ب12", "امتصاص الحديد"] },
    data: { subject: "small intestine", relation: "absorbs by region", object: "duodenum: iron and calcium; jejunum: most carbohydrates, proteins and water-soluble vitamins; ileum: vitamin B12 and bile salts" },
    forbidden_patterns: [
      { re: R`(?:vitamin\s*B\s*-?\s*12|\bB12\b|فيتامين\s*(?:ب|B)\s*-?\s*12)[^.\n]{0,40}(?:absorbed|absorption|بيتمتص|بتتمتص|امتصاص)[^.\n]{0,25}(?:in|at|from|في)\s+(?:the\s+)?(?:duodenum|jejunum|stomach|colon|الاثني عشر|الصائم|المعدة|القولون)`, correction: "Vitamin B12 (bound to intrinsic factor from the stomach) is absorbed in the terminal ileum." },
      { re: R`(?:\biron\b|الحديد)[^.\n]{0,40}(?:absorbed|absorption|بيتمتص|بيمتص|امتصاص)[^.\n]{0,25}(?:in|at|من|في)\s+(?:the\s+)?(?:ileum|colon|stomach|اللفائفي|القولون|المعدة)`, correction: "Iron is absorbed mainly in the duodenum (and the start of the jejunum)." },
    ] },
  { ...base, id: "dig.gi-vs-digestive", topic: "GI tract versus digestive system accessory organs", kind: "pair",
    aliases: { en: ["GI tract", "gastrointestinal tract", "alimentary canal", "digestive system", "accessory organs"], ar: ["القناة الهضمية", "الجهاز الهضمي", "الأعضاء الملحقة"] },
    data: { a: "GI tract (alimentary canal): the hollow tube from mouth to anus", b: "Digestive system: the GI tract plus the accessory organs (salivary glands, liver, gallbladder, pancreas)" },
    forbidden_patterns: [
      { re: R`(?:liver|pancreas|gallbladder|salivary\s+glands?|الكبد|البنكرياس|المرارة|الغدد\s+اللعابية)[^.\n]{0,25}(?:is|are|هو|هي|تعتبر|يعتبر)\s+(?:a\s+|an\s+)?part\s+of\s+(?:the\s+)?(?:GI|gastrointestinal|alimentary)\s+(?:tract|canal)`, correction: "The liver, gallbladder, pancreas and salivary glands are accessory organs of the digestive system; the GI tract itself is the tube from mouth to anus." },
    ] },
  { ...base, id: "dig.ileum-ilium", topic: "ileum versus ilium", kind: "pair",
    aliases: { en: ["ileum", "ilium"], ar: ["اللفائفي", "الحرقفة", "عظم الحرقفة"] },
    data: { a: "ileum: the last part of the small intestine", b: "ilium: the large upper bone of the hip (pelvis)" },
    forbidden_patterns: [
      { re: R`\bilium\b[^.\n]{0,50}(?:intestin|absor|small\s+bowel|jejunum)`, correction: "Ilium (with an i) is a hip bone; the ileum (with an e) is the last part of the small intestine." },
      { re: R`\bileum\b[^.\n]{0,50}(?:\bhip\b|pelvi|\bbone\b|iliac\s+crest)`, correction: "Ileum (with an e) is the last part of the small intestine; the ilium (with an i) is a hip bone." },
    ] },
  { ...base, id: "dig.salivary.glands", topic: "major salivary glands three pairs parotid submandibular sublingual", kind: "list",
    aliases: { en: ["salivary glands", "parotid", "submandibular", "sublingual"], ar: ["الغدد اللعابية", "الغدة النكفية", "الغدة تحت الفك", "الغدة تحت اللسان"] },
    data: { items: [it("par", "parotid", "النكفية"), it("sub", "submandibular", "تحت الفك"), it("sbl", "sublingual", "تحت اللسان")], note: "3 pairs of major salivary glands." },
    forbidden_patterns: [
      { re: R`\b(?:two|2|four|4|five|5|six|6)\s+pairs?\s+of\s+(?:major\s+)?salivary|(?:اتنين|اثنين|أربع\w*|اربع\w*|خمس\w*)\s+(?:ازواج|أزواج|زوج)\s+من\s+الغدد\s+اللعابية`, correction: "There are 3 pairs of major salivary glands: parotid, submandibular and sublingual." },
    ] },
];
