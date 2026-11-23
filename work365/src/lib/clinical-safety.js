import { isHealthDomainContext } from "./clinical-quality.js";

/*
 * Clinical safety rules (v3.60).
 *
 * This is a conservative contradiction detector, not a diagnostic engine.
 * It only blocks narrowly defined, high-impact overclaims / missing safety
 * actions. Unknown inputs remain unknown; no absent criterion is scored as 0.
 */
const n = (s) => String(s ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/٫/g, ".").replace(/⁹/g, "^9").replace(/[μµ]/g, "u");
const has = (s, re) => re.test(String(s || ""));
const isAffirmed = (text, re) => has(text, re);

export function isPotentialClinicalContext(text = "") {
  // Routing hint only. It does not imply that an answer is medically correct.
  return isHealthDomainContext(text);
}

function measurement(text, re, convert = (value) => value) {
  const source = n(text);
  const flags = `${re.flags.replace(/g/g, "") }g`;
  const matches = [...source.matchAll(new RegExp(re.source, flags))]
    .map((m) => ({ value: convert(Number(m[1].replace(/,/g, "")), String(m[2] || "")), rawUnit: String(m[2] || "") }))
    .filter((x) => Number.isFinite(x.value));
  if (!matches.length) return null;
  const values = [...new Set(matches.map((x) => x.value))];
  return values.length === 1 ? { value: values[0], unit: matches[0].rawUnit } : { ambiguous: true, values };
}

function hscorePartial(caseText) {
  const t = n(caseText).replace(/⁹/g, "^9").replace(/μ/g, "u").replace(/µ/g, "u");
  const components = [];
  const missing = [];
  const add = (name, points, detail) => components.push({ name, points, detail });
  const use = (name, result, detail) => {
    if (!result || result.ambiguous) {
      missing.push(`${name}${result?.ambiguous ? " (conflicting values)" : " with verified units"}`);
      return null;
    }
    return { value: result.value, unit: result.unit, detail };
  };

  // HScore's immunosuppression item is a clinical history criterion, not just a mention of a drug.
  const immunosuppression = /\b(?:currently taking|taking|on maintenance|maintenance therapy with|receiving|treated with)\b.{0,80}\b(?:tacrolimus|cyclosporine|mycophenolate|prednisone|prednisolone|dexamethasone|immunosuppress(?:ant|ive)|chemotherapy)\b/i.test(t)
    || /\bmaintenance\b.{0,100}\b(?:tacrolimus|cyclosporine|mycophenolate|prednisone|prednisolone|immunosuppress(?:ant|ive))\b/i.test(t)
    || /\b(?:tacrolimus|cyclosporine|mycophenolate|prednisone|prednisolone)\b.{0,60}\b(?:maintenance|daily|ongoing|current)\b/i.test(t)
    || /\b(?:HIV|AIDS)\b/i.test(t);
  if (immunosuppression) add("immunosuppression", 18, "current immunosuppressive treatment / immunodeficiency documented");
  else missing.push("current immunosuppression or immunodeficiency status");

  const hb = measurement(t, /\b(?:hemoglobin|haemoglobin|hb)\s*[:=]?\s*([\d,.]+)\s*(g\s*\/\s*dl|g\s*\/\s*l)\b/i, (v, u) => /g\s*\/\s*l/i.test(u) ? v / 10 : v);
  // Separate patterns keep the same numeric capture for the two common equivalent WBC/platelet units.
  const normalizedCount = (label) => {
    const re = new RegExp(`\\b(?:${label})\\s*[:=]?\\s*([\\d,.]+)\\s*(?:[x×]\\s*)?10\\s*(?:\\^\\s*9|9)\\s*\\/\\s*l\\b|\\b(?:${label})\\s*[:=]?\\s*([\\d,.]+)\\s*(?:k\\s*\\/\\s*u?l|10\\s*\\^\\s*3\\s*\\/\\s*u?l)\\b`, "ig");
    const vals = [...t.matchAll(re)].map((m) => Number((m[1] || m[2]).replace(/,/g, ""))).filter(Number.isFinite);
    if (!vals.length) return null;
    const unique = [...new Set(vals)];
    return unique.length === 1 ? { value: unique[0] } : { ambiguous: true, values: unique };
  };
  const hbv = use("hemoglobin", hb);
  const wbcv = use("WBC", normalizedCount("white blood cell count|wbc"));
  const plv = use("platelets", normalizedCount("platelets?|platelet count"));
  if (hbv && wbcv && plv) {
    const count = Number(hbv.value <= 9.2) + Number(wbcv.value <= 5) + Number(plv.value <= 110);
    const points = count >= 3 ? 34 : count === 2 ? 24 : 0;
    add("cytopenias", points, `${count}/3 lineages meet HScore thresholds (Hb in g/dL; WBC/platelets in 10⁹/L or equivalent)`);
  } else missing.push("all three cytopenia values with supported units (Hb, WBC, platelets)");

  const ferritin = measurement(t, /\bferritin\s*[:=]?\s*([\d,.]+)\s*(ng\s*\/\s*ml|mcg\s*\/\s*l|ug\s*\/\s*l|µg\s*\/\s*l)\b/i);
  const fv = use("ferritin", ferritin);
  if (fv) add("ferritin", fv.value > 6000 ? 50 : fv.value >= 2000 ? 35 : 0, `${fv.value} ng/mL or equivalent`);

  const tg = measurement(t, /\b(?:triglycerides?|tg)\s*[:=]?\s*([\d,.]+)\s*(mg\s*\/\s*dl|mmol\s*\/\s*l)\b/i, (v, u) => /mg/i.test(u) ? v * 0.01129 : v);
  const tgv = use("triglycerides", tg);
  if (tgv) add("triglycerides", tgv.value > 4 ? 64 : tgv.value >= 1.5 ? 44 : 0, `${tgv.value.toFixed(2)} mmol/L`);

  const fibrinogen = measurement(t, /\bfibrinogen\s*[:=]?\s*([\d,.]+)\s*(mg\s*\/\s*dl|g\s*\/\s*l)\b/i, (v, u) => /mg/i.test(u) ? v / 100 : v);
  const fib = use("fibrinogen", fibrinogen);
  if (fib) add("fibrinogen", fib.value <= 2.5 ? 30 : 0, `${fib.value.toFixed(2)} g/L`);

  const temp = measurement(t, /\b(?:temperature|temp)\s*[:=]?\s*([\d,.]+)\s*(°\s*c|celsius|°\s*f|fahrenheit)\b/i, (v, u) => /f/i.test(u) ? (v - 32) * 5 / 9 : v);
  const tv = use("temperature", temp);
  if (tv) add("temperature", tv.value > 39.4 ? 49 : tv.value >= 38.4 ? 33 : 0, `${tv.value.toFixed(1)} °C`);

  const ast = measurement(t, /\bast\s*[:=]?\s*([\d,.]+)\s*(u\s*\/\s*l|iu\s*\/\s*l)\b/i);
  const astv = use("AST", ast);
  if (astv) add("AST", astv.value >= 30 ? 19 : 0, `${astv.value} U/L`);

  const negativeOrganomegaly = /\b(?:no|without|absence of|negative for)\s+(?:hepatosplenomegaly|hepatomegaly|splenomegaly|organomegaly)\b/i.test(t)
    || /\b(?:no|without|absence of)\s+(?:hepatomegaly\s+or\s+splenomegaly|splenomegaly\s+or\s+hepatomegaly)\b/i.test(t)
    || /\b(?:no|without|absence of)\s+(?:evidence of\s+)?(?:liver|hepatic|spleen|splenic)\s+(?:or\s+)?(?:spleen|liver)?\s*(?:enlargement|enlarged)\b/i.test(t);
  const hepatosplenomegaly = /\bhepatosplenomegaly\b/i.test(t) && !negativeOrganomegaly;
  const hepatomegaly = /\bhepatomegaly\b/i.test(t) && !negativeOrganomegaly;
  const splenomegaly = /\bsplenomegaly\b/i.test(t) && !negativeOrganomegaly;
  if (hepatosplenomegaly) add("organomegaly", 38, "hepatosplenomegaly documented");
  else if (hepatomegaly || splenomegaly) add("organomegaly", 23, "hepatomegaly or splenomegaly documented");
  else if (negativeOrganomegaly) add("organomegaly", 0, "organomegaly explicitly absent");
  else missing.push("liver/spleen size or organomegaly status");

  const marrowNegative = /\b(?:bone marrow|marrow)\b.{0,70}\b(?:negative|absent|no hemophagocytosis|without hemophagocytosis|does not show hemophagocytosis)\b/i.test(t)
    || /\bno\s+(?:evidence of\s+)?hemophagocytosis\b/i.test(t);
  const marrowPositive = /\b(?:bone marrow|marrow)\b.{0,100}\b(?:shows?|demonstrates?|positive for|with|reveals?)\b.{0,50}\b(?:hemo|haemo)phagocytosis\b/i.test(t)
    || /\b(?:hemo|haemo)phagocytosis\b.{0,50}\b(?:on|in)\s+(?:the\s+)?bone marrow\b/i.test(t);
  if (marrowNegative) add("bone_marrow", 0, "bone-marrow hemophagocytosis explicitly absent");
  else if (marrowPositive) add("bone_marrow", 35, "hemophagocytosis documented on bone marrow");
  else missing.push("bone-marrow hemophagocytosis status");

  if (!components.length) return null;
  return { score: components.reduce((sum, x) => sum + x.points, 0), components, missing, complete: missing.length === 0 };
}

export function auditClinicalSafety({ caseText = "", answerText = "", selectedOptionText = "", narrative = "" } = {}) {
  const context = `${caseText}\n${selectedOptionText}`;
  const answer = `${answerText}\n${narrative}`;
  const all = `${context}\n${answer}`;
  const conflicts = [];
  const advisories = [];
  const rule = (id, message, severity = "high") => conflicts.push({ code: id, ruleId: id, severity, message });

  // A biomarker with limited specificity must not be promoted to a disease-specific confirmation.
  if (/β\s*[-–]?\s*d\s*[-–]?\s*glucan|beta\s*[-–]?\s*d\s*[-–]?\s*glucan/i.test(all)
      && /\b(?:proves?|confirms?|diagnostic(?: of| for)?|definitively|establishes?)\b|يثبت|يؤكد|تشخيص قاطع/i.test(answer)
      && /\b(?:aspergillus|aspergillosis|pneumocystis|PJP)\b/i.test(answer)) {
    rule("bdg-nonspecific-overclaim", "β-D-glucan is a non-specific fungal biomarker; it cannot by itself confirm Aspergillus or PJP. State the differential and require pathogen-specific testing / clinical correlation.");
  }

  // A negative serum galactomannan does not exclude invasive aspergillosis in SOT recipients.
  if (/\b(?:solid[- ]organ transplant|SOT|kidney transplant|renal transplant|liver transplant|heart transplant|lung transplant|transplant recipient)\b/i.test(context)
      && /\bserum galactomannan\b/i.test(context)
      && /\b(?:negative|normal|undetectable)\b/i.test(context)
      && /\b(?:rules? out|excludes?|no aspergillus|not aspergillosis|cannot be aspergillus)\b|يستبعد|ينفي/i.test(answer)) {
    rule("negative-serum-gm-does-not-exclude-sot-ia", "A negative serum galactomannan result does not reliably exclude invasive aspergillosis in a solid-organ transplant recipient. Do not use it as a rule-out test.");
  }

  const proposedPlan = `${selectedOptionText}\n${answer}`;
  const selectedPlan = String(selectedOptionText || "").trim() || answer;

  // Odontogenic sarcoma pattern: benign ameloblastic epithelium with malignant stroma supports AFS.
  // BRAF on an unmicrodissected NGS specimen does not, by itself, prove which compartment carries it.
  const blandOdontogenicEpithelium = /(?:cytologically\s+)?bland.{0,80}(?:odontogenic\s+)?epithelium|(?:odontogenic\s+)?epitheli(?:al|um).{0,80}bland/i.test(context);
  const malignantSpindleStroma = /(?:hypercellular|pleomorphic|hyperchromatic|malignant).{0,120}(?:spindle[- ]cell|ectomesenchymal|mesenchymal|stromal)|(?:spindle[- ]cell|ectomesenchymal|mesenchymal|stromal).{0,120}(?:hypercellular|pleomorphic|hyperchromatic|malignant)/i.test(context);
  const afsMorphology = blandOdontogenicEpithelium && malignantSpindleStroma;
  const afsMentioned = /\bAFS\b|ameloblastic\s+fibrosarcoma/i.test(context) || afsMorphology;
  if (afsMorphology) {
    const diagnosisText = String(selectedOptionText || answer);
    const wrongDiagnosis = /(?:definitive\s+diagnosis|diagnosis|diagnosed\s+as|most\s+consistent\s+with|the\s+tumou?r\s+is|this\s+is|choose\s+(?:option\s+)?[A-E])\s*[:=-]?\s*.{0,75}\b(?:ameloblastic\s+carcinoma|odontogenic\s+carcinosarcoma|ameloblastic\s+fibroma)\b/i.test(diagnosisText)
      || /^\s*[A-E][).:-]\s*(?:ameloblastic\s+carcinoma|odontogenic\s+carcinosarcoma|ameloblastic\s+fibroma)\b/i.test(diagnosisText);
    if (wrongDiagnosis) {
      rule("afs-compartment-diagnosis-mismatch", "The supplied morphology shows bland ameloblastic/odontogenic epithelium with a malignant pleomorphic spindle-cell ectomesenchymal stroma. This supports ameloblastic fibrosarcoma; ameloblastic carcinoma requires epithelial malignancy, while odontogenic carcinosarcoma requires malignant epithelial and mesenchymal components. Do not relabel the lesion from the stromal findings alone.");
    }
  }

  const ki67Match = /Ki[- ]?67(?:\s+proliferation\s+index|\s+index)?\s*[:=]?\s*(?:[<>≤≥]=?\s*)?([\d,.]+)\s*%/i.exec(n(context));
  if (afsMorphology && ki67Match && /(?:Ki[- ]?67|proliferation\s+index).{0,80}(?:threshold|cut[- ]?off|diagnostic|criterion|>\s*30|30\s*%)/i.test(answer)) {
    advisories.push({ code: "afs-ki67-not-universal-diagnostic-threshold", message: `The case reports a stromal Ki-67 index of ${ki67Match[1]}%, which supports high proliferative activity in the malignant stromal compartment. Do not present >30% (or any single Ki-67 percentage) as a validated universal diagnostic cut-off for AFS; the diagnosis rests on the histomorphologic malignant stromal component and benign ameloblastic epithelium, interpreted by an oral/head-and-neck pathologist.` });
  }

  const brafV600e = /BRAF.{0,25}(?:p\.)?V600E|(?:p\.)?V600E.{0,25}BRAF/i.test(context);
  const compartmentLocalisation = /(?:laser[- ]microdissect|microdissect|stromal\s+component.{0,80}(?:BRAF|V600E|VE1)|(?:BRAF|V600E|VE1).{0,80}stromal\s+component|mesenchymal\s+component.{0,80}(?:BRAF|V600E|VE1))/i.test(context);
  if (afsMorphology && brafV600e && /(?:BRAF.{0,50}(?:confirms?|proves?|establishes?|diagnostic)|(?:confirms?|proves?|establishes?).{0,50}BRAF.{0,30}(?:AFS|ameloblastic\s+fibrosarcoma)|BRAF.{0,50}pathognomonic)/i.test(answer)) {
    rule("afs-braf-not-diagnostic-alone", "BRAF p.V600E is a potentially relevant molecular finding in ameloblastic fibrosarcoma, but it is not pathognomonic and does not replace the compartment-specific morphology. The diagnosis is based on the benign ameloblastic epithelial component and malignant mesenchymal stroma; the NGS specimen's cellular compartment should be clarified before asserting a stromal driver.");
  }
  if (afsMentioned && brafV600e && !compartmentLocalisation && /BRAF.{0,80}(?:driver|drives|driven|stromal|mesenchymal)|(?:driver|drives|driven).{0,80}BRAF|mutation.{0,80}(?:stromal|mesenchymal)/i.test(answer)) {
    advisories.push({ code: "afs-braf-compartment-not-localised", message: "The case reports BRAF p.V600E by NGS but does not state that the specimen was laser-microdissected or that VE1/IHC/local sequencing localised the variant to the malignant stromal compartment. Small AFS series support recurrent BRAF V600E, including stromal expression in a demonstrated case, but whole-specimen NGS alone does not establish cellular localisation in this patient. Do not infer a stromal driver solely from the bulk result." });
  }
  if (afsMentioned && brafV600e && /\b(?:dabrafenib|trametinib|vemurafenib|BRAF\s*\/\s*MEK inhibitors?|BRAF inhibitors?)\b/i.test(proposedPlan)) {
    const trialOrAdvancedSetting = /clinical\s+trial|trial|unresectable|metastatic|recurrent|advanced\s+disease|salvage|compassionate|off[- ]label/i.test(proposedPlan);
    const explicitlyPrescribesTargetedTherapy = /(?:start|initiat|administer|recommend|use|treat(?:ment)?\s+with).{0,90}(?:dabrafenib|trametinib|vemurafenib|BRAF\s*\/\s*MEK)|(?:dabrafenib|trametinib|vemurafenib|BRAF\s*\/\s*MEK).{0,90}(?:start|initiat|administer|recommend|use|as\s+adjuvant|adjuvant\s+therapy)|ابدأ.{0,60}(?:دابرافينيب|تراميتينيب|BRAF)/i.test(selectedPlan);
    if (explicitlyPrescribesTargetedTherapy && !trialOrAdvancedSetting) {
      rule("afs-braf-targeted-therapy-not-established-standard", "BRAF p.V600E in AFS is a biologically relevant finding and a rationale for investigation/selected advanced-disease use, but it does not establish dabrafenib/trametinib as standard adjuvant treatment after resection. Do not prescribe targeted therapy from mutation status alone; require compartment-aware pathology review, disease setting, molecular tumour-board rationale and clinical-trial/rare-tumour expertise.");
    } else {
      advisories.push({ code: "afs-braf-targeted-therapy-evidence-limited", message: "BRAF-targeted therapy in AFS remains an emerging/rare-tumour strategy rather than an established adjuvant standard. Confirm that treatment is actually indicated and that the variant is relevant to the malignant component before treating the molecular result as a prescription." });
    }
  }

  // In AFS, surgery is the mainstay; radiotherapy is individualised because the evidence base is small.
  if (afsMentioned && /(?:adjuvant\s+)?(?:IMRT|radiotherap|radiation|irradiat)/i.test(proposedPlan)) {
    const hasFinalPathologyBasis = /(?:negative|positive|close|involved|clear|R0|R1|R2)\s+(?:surgical\s+)?margins?|margins?.{0,45}(?:negative|positive|close|involved|clear|R0|R1|R2)|final\s+patholog|perineural\s+(?:invasion|spread).{0,80}(?:extent|length|proximal|skull)|tumou?r\s+board|multidisciplinary\s+(?:tumou?r|oncology)/i.test(proposedPlan);
    if (!hasFinalPathologyBasis) {
      advisories.push({ code: "afs-adjuvant-rt-needs-final-pathology", message: "AFS evidence supports complete/segmental resection with free margins as the main treatment; there is no universally accepted adjuvant-radiotherapy protocol for every resected AFS. Decide whether RT is warranted, its dose and the V3/foramen-ovale target only after final margin/pathology review, mapped perineural extent, skull-base imaging and a rare-tumour/head-and-neck multidisciplinary discussion." });
    }
    if (/60\s*[-–]\s*66\s*Gy|66\s*Gy|60\s*Gy/i.test(proposedPlan)) {
      advisories.push({ code: "afs-radiation-dose-not-universal", message: "A 60–66 Gy prescription is not a validated universal AFS rule. The literature is dominated by case reports/series; dose and target volumes must follow postoperative anatomy, margin status, perineural spread, organ-at-risk constraints and institutional sarcoma/head-and-neck planning." });
    }
  }
  if (afsMentioned && !/chest\s+(?:CT|imaging)|CT\s+(?:of\s+the\s+)?chest|pulmonary\s+staging|lung\s+staging/i.test(context + "\n" + proposedPlan)) {
    advisories.push({ code: "afs-systemic-staging-not-mentioned", message: "The case text does not document chest/pulmonary staging. Include appropriate baseline chest imaging in the rare odontogenic sarcoma work-up; lung is the commonest reported distant metastatic site, although metastasis is uncommon." });
  }

  // Peronea arteria magna: preserve the peroneal artery when it is the foot's only dominant inflow.
  const peroneaMagna = /peronea\s+(?:arteria\s+)?magna|great\s+peroneal\s+artery/i.test(context);
  const peronealSoleFootSupply = /(?:sole|only|dominant)\s+(?:dominant\s+)?(?:blood\s+)?supply\s+to\s+(?:the\s+)?(?:foot|pedal\s+arch)|peroneal\s+artery.{0,90}(?:sole|only|dominant).{0,45}(?:foot|pedal)|(?:posterior\s+tibial\s+artery).{0,90}(?:aplasia|absent).{0,100}(?:anterior\s+tibial|hypoplasia)/i.test(context);
  const plansFibulaHarvest = /(?:free\s+)?fibul(?:a|ar).{0,55}(?:free\s+)?flap|(?:harvest|harvesting).{0,45}fibula/i.test(selectedPlan);
  const documentedCollateralSafety = /(?:balloon\s+occlusion|peroneal\s+artery\s+occlusion\s+test|collateral\s+(?:flow|perfusion|circulation).{0,60}(?:adequate|sufficient|confirmed)|adequate\s+collateral\s+perfusion|duplex.{0,60}(?:collateral|occlusion\s+test))/i.test(proposedPlan);
  if (peroneaMagna && peronealSoleFootSupply && plansFibulaHarvest && !documentedCollateralSafety) {
    rule("peronea-magna-fibula-harvest-contraindicated", "The supplied CTA states that the peroneal artery is the sole/dominant pedal-arch supply with absent/hypoplastic tibial arteries. Harvesting that fibula would endanger the donor foot and is contraindicated on the information supplied. Choose another donor site (e.g., vascularised iliac crest/DCIA or scapula) unless formal collateral/occlusion testing demonstrates adequate independent foot perfusion and a vascular team explicitly clears harvest.");
  }
  if (peroneaMagna && /DCIA|deep circumflex iliac|iliac crest/i.test(selectedPlan)) {
    advisories.push({ code: "mandibular-donor-flap-selection-needs-anatomy-review", message: "Avoiding routine fibula harvest is appropriate for the stated peronea-magna anatomy. DCIA/iliac crest is one vascularised alternative, not the only possible alternative; scapular and other donor flaps may suit some defects. Select after defining exact mandibular endpoints, bone/soft-tissue needs, donor-site anatomy and recipient-vessel availability." });
  }
  if (/(?:Jewel|Jewer)\s+L[-–]?C\s+defect/i.test(context)) {
    advisories.push({ code: "jewer-lc-defect-anatomy-confirmation", message: "‘Jewel L-C’ appears to refer to the established Jewer LC mandibular-defect classification (lateral plus central segments), rather than an undefined classification. The described angle-to-central-symphysis extent is compatible with an LC-type defect, but the operative plan must still document whether the condyle is preserved, exact resection endpoints, mucosal/skin loss and remaining suprahyoid/genioglossus attachments; these details determine flap geometry and resuspension." });
  }

  // Triple-positive thrombotic APS with previous arterial and venous events is not an indication to switch to a DOAC.
  const triplePositiveAps = /triple[- ]positive.{0,80}(?:antiphospholipid|APS)|(?:antiphospholipid|APS).{0,80}triple[- ]positive/i.test(context)
    && /lupus\s+anticoagulant/i.test(context)
    && /anticardiolipin/i.test(context)
    && /anti.{0,15}(?:β|beta|b).{0,10}2.{0,20}glycoprotein|beta2[- ]glycoprotein/i.test(context);
  const previousArterialThrombosis = /(?:ischemic|ischaemic)\s+stroke|arterial\s+thrombosis|cerebral\s+infarct/i.test(context);
  const proposesDoacSwitch = /(?:switch|transition|convert|replace|start|initiat|permanently\s+change).{0,80}\b(?:apixaban|rivaroxaban|dabigatran|edoxaban|DOACs?|direct\s+oral\s+anticoagulants?)\b|\b(?:apixaban|rivaroxaban|dabigatran|edoxaban|DOACs?)\b.{0,80}(?:instead\s+of\s+warfarin|replace\s+warfarin|warfarin\s+alternative)/i.test(selectedPlan);
  if (triplePositiveAps && previousArterialThrombosis && proposesDoacSwitch) {
    rule("triple-positive-aps-doac-switch-unsafe", "This patient has triple-positive thrombotic APS and a prior arterial event (ischaemic stroke), in addition to PE. Do not switch warfarin to apixaban or another DOAC as a routine perioperative solution; vitamin-K-antagonist therapy remains preferred in this high-risk phenotype because DOAC trials/guidance show excess recurrent events and guidelines advise against DOACs in APS with arterial events.");
  }
  if (triplePositiveAps && previousArterialThrombosis && /(?:stop|discontinue|hold|withhold).{0,50}warfarin/i.test(selectedPlan)
      && /without\s+(?:heparin\s+)?bridg|no\s+(?:heparin\s+)?bridg|omit\s+(?:the\s+)?bridg|do\s+not\s+bridge/i.test(selectedPlan)) {
    rule("triple-positive-aps-unbridged-warfarin-interruption", "This is very-high-risk thrombotic APS (triple-positive with prior arterial stroke and PE). A plan to interrupt warfarin without a specialist-directed bridging strategy is unsafe to present as routine. Individualise bridging and timing with hematology, anesthesia and microsurgery, balancing the major operative bleeding risk.");
  }

  // Fluconazole inhibits warfarin metabolism and the measured INR is already supratherapeutic.
  const inrMatches = [...n(context).matchAll(/\bINR\s*[:=]?\s*([\d,.]+)\b/ig)];
  // A target interval (e.g. target INR 2.5–3.5) is not the measured admission INR.
  // Prefer an explicitly current/admission measurement; otherwise use the last scalar INR occurrence.
  const explicitMeasuredInr = /\b(?:admission|current|measured|presenting|at\s+presentation)\s+INR\s*[:=]?\s*([\d,.]+)\b/i.exec(n(context));
  const warfarinInrMatch = explicitMeasuredInr || inrMatches.at(-1) || null;
  const warfarinInr = warfarinInrMatch ? Number(warfarinInrMatch[1].replace(/,/g, "")) : null;
  const warfarinFluconazoleInteraction = /\bwarfarin\b/i.test(context) && /\bfluconazole\b/i.test(context) && warfarinInr != null && warfarinInr >= 4;
  if (warfarinFluconazoleInteraction) {
    const stopInteraction = /(?:hold|stop|withhold|discontinue).{0,45}(?:fluconazole|warfarin)|(?:fluconazole|warfarin).{0,45}(?:hold|stop|withhold|discontinue)/i.test(proposedPlan);
    const followInr = /(?:repeat|recheck|monitor|trend|serial).{0,45}INR|INR.{0,45}(?:repeat|recheck|monitor|trend|serial)/i.test(proposedPlan);
    if (!stopInteraction || !followInr) {
      advisories.push({ code: "warfarin-fluconazole-high-inr-not-managed", message: `INR ${warfarinInr} is supratherapeutic in a patient receiving warfarin plus fluconazole, a documented CYP2C9-mediated interaction. Stop/review the interacting regimen with the prescriber and repeat/monitor INR before surgery; whether vitamin K or urgent reversal is needed depends on bleeding and surgical urgency.` });
    }
    const immediateTherapeuticHeparin = /(?:start|give|administer|initiate).{0,45}therapeutic\s+(?:LMWH|low[- ]molecular[- ]weight\s+heparin|UFH|heparin).{0,35}(?:now|immediately|while\s+INR\s*(?:is|remains)?\s*(?:4|4\.8|supratherapeutic))/i.test(proposedPlan);
    if (immediateTherapeuticHeparin) {
      rule("aps-bridge-before-inr-falls", "Do not start therapeutic LMWH/UFH while the INR is still documented as markedly supratherapeutic (4.8). In very-high-thrombotic-risk APS, consider bridging only once INR falls below the desired therapeutic range, with the last preoperative dose and surgical timing coordinated to the procedure and renal function.");
    }
  }
  if (triplePositiveAps && previousArterialThrombosis && /(?:therapeutic\s+LMWH|therapeutic\s+low[- ]molecular[- ]weight\s+heparin|therapeutic\s+UFH|therapeutic\s+heparin|bridge.{0,50}therapeutic)/i.test(selectedPlan)) {
    const preopTiming = /INR.{0,45}(?:below|subtherapeutic)|(?:once|when).{0,35}INR.{0,35}(?:below|subtherapeutic)|(?:last|final).{0,35}dose.{0,35}(?:24\s*(?:hours?|h)|day\s+before)|hold.{0,35}(?:LMWH|heparin).{0,25}24\s*(?:hours?|h)/i.test(proposedPlan);
    const postopStepwise = /(?:48\s*[-–]\s*72|48\s+to\s+72)\s*(?:hours?|h)|(?:post[- ]?operative|after\s+surgery).{0,70}(?:hemostas|haemostas|bleeding\s+risk|prophylactic\s+dose)|(?:prophylactic).{0,50}(?:then|escalat|therapeutic)/i.test(proposedPlan);
    if (!preopTiming || !postopStepwise) {
      advisories.push({ code: "aps-bridge-needs-bleed-risk-timing", message: "Therapeutic bridging is commonly selected for triple-positive APS and prior arterial thrombosis, but ‘therapeutic LMWH perioperatively’ is not a complete safe schedule for major mandibulectomy/free-flap surgery. Specify that preoperative heparin begins only after INR falls below the therapeutic range, the final LMWH dose is withheld sufficiently before surgery (typically ≥24 h, adjusted to agent/renal function), and postoperative anticoagulation is staged according to surgical haemostasis—often prophylactic first, with therapeutic-dose escalation delayed about 48–72 h after high-bleeding-risk surgery if safe. Coordinate hematology, anesthesia and microsurgery." });
    }
  }

  // BRAF/MEK–radiotherapy interactions require scenario-specific adaptation; do not recommend unmodified concurrency.
  const targetedBrafMek = /\b(?:dabrafenib|trametinib|vemurafenib|cobimetinib|BRAF\s*\/\s*MEK inhibitors?)\b/i.test(selectedPlan);
  const highDoseHeadNeckRt = /(?:IMRT|radiotherap|radiation|irradiat)/i.test(selectedPlan) && /(?:60\s*[-–]\s*66\s*Gy|66\s*Gy|60\s*Gy|high[- ]dose|fractionated)/i.test(selectedPlan);
  const concurrentBrafRt = /(?:concurrent|concomitant|simultaneous|together|during\s+(?:the\s+)?(?:radiotherapy|radiation|IMRT)|مع\s+الإشعاع|أثناء\s+الإشعاع)/i.test(selectedPlan);
  const rtAdaptation = /(?:hold|withhold|pause|interrupt|temporarily\s+stop|dose\s+reduc|major\s+adapt|adaptation|modify\s+(?:the\s+)?RT|treatment\s+break)/i.test(proposedPlan);
  if (targetedBrafMek && highDoseHeadNeckRt && concurrentBrafRt && !rtAdaptation) {
    rule("braf-mek-concurrent-high-dose-head-neck-rt-unadapted", "Do not present unmodified concurrent dabrafenib/trametinib with high-dose head-and-neck RT as safe. The 2026 ESMO–ESTRO consensus recommends a major adaptation for BRAF/MEK inhibitor combinations with head-and-neck RT (evidence level V); interruption, dose/RT adaptation and timing must be agreed by medical and radiation oncology.");
  }
  if (afsMentioned && brafV600e && /hold.{0,65}(?:BRAF|MEK|dabrafenib|trametinib).{0,65}(?:throughout|during|radiotherap|radiation)|(?:BRAF|MEK|dabrafenib|trametinib).{0,65}(?:hold|withhold).{0,65}(?:throughout|during|radiotherap|radiation)/i.test(selectedPlan)
      && !/currently\s+(?:taking|receiving|on).{0,50}(?:dabrafenib|trametinib|BRAF|MEK)|started.{0,40}(?:dabrafenib|trametinib)/i.test(context)) {
    advisories.push({ code: "braf-mek-hold-assumes-unprescribed-drug", message: "The medication history does not say the patient is taking dabrafenib/trametinib. A BRAF mutation alone is not a current drug exposure to ‘hold’. State that targeted therapy is not established routine adjuvant AFS treatment; if a tumour board later considers it, use scenario-specific ESMO–ESTRO RT adaptations rather than a blanket hold order." });
  }

  // Patient-specific tacrolimus–voriconazole interaction: block unqualified co-use.
  if (/\btacrolimus\b/i.test(context) && /\bvoriconazole\b/i.test(proposedPlan)) {
    const doseAction = /\b(?:one[- ]third|⅓|reduce.{0,50}tacrolimus|tacrolimus.{0,50}reduce|dose reduction|hold.{0,30}tacrolimus|withhold.{0,30}tacrolimus)\b/i.test(answer);
    const monitoring = /\b(?:trough|tacrolimus level|therapeutic drug monitoring|monitor.{0,40}tacrolimus|tacrolimus.{0,40}monitor)\b/i.test(answer);
    if (!doseAction || !monitoring) rule("voriconazole-tacrolimus-unmanaged", "The selected plan includes voriconazole in a patient taking tacrolimus but does not document BOTH an explicit tacrolimus hold/reduction and therapeutic-drug-level monitoring. This is a high-risk interaction and must be resolved before treating the option as safe.");
    else advisories.push({ code: "voriconazole-tacrolimus-plan-present", message: "Tacrolimus–voriconazole interaction language is present; confirm the actual dose plan, trough monitoring and restart plan against current product information." });
  }

  // Do not add stress-dose corticosteroid as an automatic sepsis step without documented septic shock or adrenal indication.
  // The current adult SCCM focused update suggests corticosteroids for septic shock; simple infection or one low BP value is not enough.
  if (/\bstress[- ]dose hydrocortisone\b|\bhydrocortisone\b.{0,35}\b(?:septic shock|sepsis)\b/i.test(proposedPlan)
      && !/\b(?:septic shock|vasopressor[- ]dependent|requiring vasopressors|refractory shock|ongoing vasopressor|adrenal insufficiency|adrenal crisis)\b/i.test(context)) {
    rule("hydrocortisone-indication-not-documented", "Stress-dose hydrocortisone is recommended without documented septic shock or an adrenal-insufficiency/crisis indication in the case data. Infection or an isolated hypotensive reading alone is not sufficient to present it as routine.");
  }

  // Compute only what is known for HScore; a partial sum is not the full score.
  const hscore = /\b(?:HLH|HScore|hemophagocytic|haemophagocytic)\b/i.test(all) ? hscorePartial(context) : null;
  if (hscore) {
    const explicitlyPartial = /\b(?:partial|subtotal|incomplete|known components)\b.{0,35}\bHScore\b|\bHScore\b.{0,35}\b(?:partial|subtotal|incomplete)\b/i.test(answer);
    const assertsFull = (!explicitlyPartial && /\b(?:HScore|HSCORE)\s*(?:=|of|is|:)?\s*\d+/i.test(answer))
      || /\b(?:confirmed|definite|diagnosed with)\s+(?:secondary\s+)?HLH\b|تشخيص مؤكد.{0,30}HLH|HLH مؤكد/i.test(answer);
    if (assertsFull && !hscore.complete) {
      rule("partial-hscore-presented-as-final", `Only a partial HScore can be derived from the supplied data (known-component subtotal ${hscore.score}; missing: ${hscore.missing.join(", ")}). Do not present the subtotal as a complete HScore or use it alone to confirm HLH.`);
    }
    if (!hscore.complete && hscore.score >= 169) {
      advisories.push({ code: "partial-hscore-lower-bound-high", message: `The known-component HScore subtotal is already ${hscore.score}, above the commonly used 169 screening threshold. Because unmeasured components remain, call this a high-priority HLH signal requiring complete assessment—not a completed score or a diagnosis.` });
    }
  }

  // Procedure-risk guard: a transbronchial biopsy is not a routine immediate step
  // when the case itself documents severe hypoxemia and major bleeding risk.
  const number = (re) => {
    const m = re.exec(n(context));
    return m ? Number(m[1].replace(/,/g, "")) : null;
  };
  const spo2 = number(/(?:oxygen saturation|spo2)\s*(?:is|was|[:=])?\s*([\d,.]+)\s*%/i);
  const platelets = number(/(?:platelets?|platelet count)\s*[:=]?\s*([\d,.]+)\s*(?:[x×]\s*10\s*\^?\s*9\s*\/\s*l|10\s*\^?\s*9\s*\/\s*l|k\s*\/\s*u?l)/i);
  const inr = number(/\bINR\s*[:=]?\s*([\d,.]+)\b/i);
  const severeHypoxemia = spo2 != null && spo2 < 90;
  const coagulopathyRisk = (platelets != null && platelets < 100) || (inr != null && inr > 1.5);
  if (/\b(?:transbronchial|trans-bronchial|lung)\s+biopsy\b/i.test(proposedPlan) && (severeHypoxemia || coagulopathyRisk)) {
    rule("transbronchial-biopsy-procedure-risk", `The proposed plan includes lung/transbronchial biopsy while the supplied case documents ${[severeHypoxemia ? `severe hypoxemia (SpO₂ ${spo2}%)` : "", coagulopathyRisk ? `bleeding risk (platelets ${platelets ?? "not supplied"}; INR ${inr ?? "not supplied"})` : ""].filter(Boolean).join(" and ")}. Do not present an immediate biopsy as routine; require stabilisation, bleeding-risk correction/assessment and specialist procedural judgement.`);
  }

  // TMP-SMX safety is triggered only by a proposed start/continuation, not by a history mention or a recommendation to hold it.
  const potassium = (() => {
    const source = n(context);
    const re = /(?:serum\s+potassium|potassium|\bK\+?)\b[^0-9]{0,100}([\d,.]+)\s*(mmol\s*\/\s*l|meq\s*\/\s*l)/ig;
    const candidates = [...source.matchAll(re)].map((m) => {
      const before = m[0].slice(0, m[0].lastIndexOf(m[1]));
      const around = source.slice(m.index, m.index + m[0].length + 70);
      const invalidSample = /(?<!non[- ])hemoly[sz]ed|contaminated/i.test(around);
      const preferredRepeat = /repeat|non[- ]?hemoly[sz]ed|confirmed|second sample/i.test(before);
      return { value: Number(m[1].replace(/,/g, "")), invalidSample, score: preferredRepeat ? 2 : 1 };
    }).filter((x) => Number.isFinite(x.value) && !x.invalidSample);
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.value ?? null;
  })();
  const creatinine = number(/(?:serum )?creatinine\s*[:=]?\s*([\d,.]+)\s*mg\s*\/\s*dl/i);
  const baselineCreatinine = (() => {
    const pair = /(?:serum\s+)?creatinine\s*[:=]?\s*[\d,.]+\s*mg\s*\/\s*dl\s*\(\s*baseline\s+([\d,.]+)\s*mg\s*\/\s*dl\s*\)/i.exec(n(context));
    return pair ? Number(pair[1].replace(/,/g, "")) : number(/baseline creatinine\s*[:=]?\s*([\d,.]+)\s*mg\s*\/\s*dl/i);
  })();
  const renalRisk = (potassium != null && potassium >= 5.5) || (creatinine != null && baselineCreatinine != null && creatinine >= baselineCreatinine * 1.5);

  // A supratherapeutic calcineurin-inhibitor level with acute renal deterioration
  // requires an explicit medicine-review action and repeat level monitoring.
  const tacrolimusLevel = number(/tacrolimus\s+(?:trough\s+)?level\s*[:=]?\s*([\d,.]+)\s*ng\s*\/\s*ml/i);
  const tacrolimusTarget = /tacrolimus.{0,50}?(?:target|goal|range)\s*[:=]?\s*([\d,.]+)\s*[-–]\s*([\d,.]+)\s*ng\s*\/\s*ml/i.exec(n(context));
  const targetHigh = tacrolimusTarget ? Number(tacrolimusTarget[2].replace(/,/g, "")) : null;
  const akiRisk = creatinine != null && baselineCreatinine != null && creatinine >= baselineCreatinine * 1.5;
  if (tacrolimusLevel != null && targetHigh != null && tacrolimusLevel > targetHigh * 1.2 && akiRisk) {
    const tacroAction = /\b(?:hold|withhold|stop|discontinue|reduce|adjust|review).{0,45}tacrolimus|tacrolimus.{0,45}(?:hold|withhold|stop|discontinue|reduce|adjust|review)\b/i.test(proposedPlan);
    const tacroMonitoring = /\b(?:repeat|monitor|trend|check|recheck).{0,45}(?:tacrolimus|trough)|(?:tacrolimus|trough).{0,45}(?:repeat|monitor|trend|check|recheck)\b/i.test(proposedPlan);
    if (!tacroAction || !tacroMonitoring) rule("supratherapeutic-tacrolimus-with-aki", `Tacrolimus trough ${tacrolimusLevel} ng/mL exceeds the stated upper target ${targetHigh} ng/mL while creatinine is ${creatinine} mg/dL versus baseline ${baselineCreatinine} mg/dL. The plan must explicitly hold/review or adjust tacrolimus and repeat/monitor trough levels with the transplant team.`);
  }
  const tmpSmxDrug = /\b(?:TMP[- ]?SMX|trimethoprim[- ]sulfamethoxazole)\b/i;
  const tmpSmxMentioned = tmpSmxDrug.test(proposedPlan);
  const tmpSmxAction = String(proposedPlan).split(/(?<=[.;!?])\s+|\n+/).some((sentence) => {
    const drugAt = tmpSmxDrug.exec(sentence)?.index;
    const action = /\b(?:start|initiat(?:e|ing)|prescrib(?:e|ing)|administer|give|continu(?:e|es|ed|ing)|resum(?:e|es|ed|ing)|restart(?:ed|ing)?|maintain(?:ed|ing)?|us(?:e|es|ed|ing))\b/i.exec(sentence);
    if (drugAt == null || !action || Math.abs(drugAt - action.index) > 90) return false;
    const actionContext = sentence.slice(Math.max(0, action.index - 65), Math.min(sentence.length, action.index + action[0].length + 25));
    // Negated recommendations ("should not continue", "avoid restarting", "do not use")
    // are not affirmative prescribing actions and must not trigger a continuation warning.
    return !/\b(?:not|never|avoid|hold|withhold|stop|discontinue|defer|contraindicat(?:ed|ion)|recommend\w*\s+against)\b/i.test(actionContext);
  });
  if (tmpSmxMentioned && tmpSmxAction && renalRisk) {
    const renalDosePlan = /\b(?:renal[- ]adjusted|adjust(?:ed|ment)? for renal|dose adjustment for renal|kidney[- ]adjusted|adjust dose based on (?:renal|kidney)|creatinine clearance[- ]based)\b/i.test(proposedPlan);
    const potassiumMonitor = /\b(?:monitor|repeat|serial|trend|recheck).{0,45}(?:potassium|K\+)|(?:potassium|K\+).{0,45}(?:monitor|repeat|serial|trend|recheck)\b/i.test(proposedPlan);
    const renalMonitor = /\b(?:monitor|repeat|serial|trend|recheck).{0,45}(?:renal function|creatinine|eGFR)|(?:renal function|creatinine|eGFR).{0,45}(?:monitor|repeat|serial|trend|recheck)\b/i.test(proposedPlan);
    if (!renalDosePlan || !potassiumMonitor || !renalMonitor) rule("tmp-smx-renal-hyperkalemia-safety", `The proposed plan starts or continues TMP-SMX in a patient with ${potassium != null && potassium >= 5.5 ? `hyperkalaemia (K ${potassium})` : "acute renal dysfunction"}. Verify that TMP-SMX remains indicated, use kidney-function-based dosing, and explicitly monitor potassium and renal function. A plan to hold TMP-SMX does not require dose adjustment.`);
  }

  // A high-consequence omission check: severe hyperkalaemia plus ECG toxicity needs an explicit emergency response.
  // This is an advisory, not an automatic treatment order or a replacement for local protocols.
  const hyperkalaemicEcgThreat = /peaked\s+t\s+waves?|widen(?:ed|ing)?\s+qrs|qrs.{0,30}(?:wide|widen|prolong)|bradycardia|heart block|conduction abnormalit|hyperkalaemic ecg|hyperkalemic ecg/i.test(context);
  // 6.0–6.4 mmol/L is not ignored when the patient is acutely unwell or has ECG toxicity.
  // The July 2026 UKKA guidance specifically includes clinically unwell patients in this range
  // among those needing continuous cardiac monitoring; this is a software alert, not a treatment order.
  const highRiskHyperkalaemia = potassium != null && (potassium >= 6.5 || (potassium >= 6.0 && hyperkalaemicEcgThreat));
  const acuteHyperkalaemiaResponse = /(?:urgent|emergency|immediate).{0,70}(?:hyperkala|potassium|ecg|cardiac)|(?:hyperkala|potassium).{0,70}(?:urgent|emergency|immediate)|continuous ecg|continuous cardiac monitor|cardiac monitoring|iv calcium|intravenous calcium|calcium gluconate|calcium chloride|membrane stabilis|insulin.{0,30}(?:glucose|dextrose)/i.test(proposedPlan);
  if (highRiskHyperkalaemia && hyperkalaemicEcgThreat && !acuteHyperkalaemiaResponse) {
    advisories.push({ code: "high-risk-hyperkalaemia-with-ecg-changes-needs-emergency-response", message: `The verified non-hemolyzed/current potassium pattern includes K ${potassium} mmol/L with an ECG/conduction warning. The plan should explicitly address immediate emergency escalation, continuous ECG monitoring and urgent hospital-based assessment under the applicable local protocol; do not treat slow potassium-removal measures as immediate cardiac protection.` });
  }

  // VA-ECMO with femoral arterial return can create two differently oxygenated arterial territories.
  // Radial and distal limb readings are different sampling sites, not duplicate values to average.
  const vaFemoralCase = /\bVA[- ]ECMO\b/i.test(context) && /femoro[- ]femoral|femoral.{0,40}arterial return|arterial.{0,40}femoral/i.test(context);
  const radialHypoxemia = /right radial.{0,100}(?:SpO2|oxygen saturation|PaO2).{0,35}(?:6[0-9]|[0-5]\d)\s*(?:%|mm\s*hg)/i.test(context)
    || /(?:SpO2|oxygen saturation).{0,30}(?:69|6[0-9])\s*%/i.test(context)
    || /right radial ABG.{0,100}PaO2\s*[:=]?\s*(?:[0-5]\d)\s*mm\s*hg/i.test(context);
  const lowerBodyBetterOxygenation = /(?:toe|pedal|lower extremity|lower limb).{0,80}(?:SpO2|oxygen saturation).{0,25}(?:9[5-9]|100)\s*%/i.test(context);
  const postOxygenatorWellOxygenated = /post[- ]oxygenator.{0,80}PaO2\s*[:=]?\s*(?:[2-9]\d\d|[1-9]\d{3})\s*mm\s*hg/i.test(context);
  const differentialHypoxemia = vaFemoralCase && radialHypoxemia && (lowerBodyBetterOxygenation || postOxygenatorWellOxygenated);
  if (differentialHypoxemia && !/\bV[- ]?AV\b|veno[- ]arterial[- ]venous|upper[- ]body oxygenat|axillary arterial return|central arterial return|central cannulat/i.test(proposedPlan)) {
    rule("va-ecmo-differential-hypoxemia-not-addressed", "The case has a femoral VA-ECMO upper/lower-body oxygenation gradient (right-radial hypoxaemia with better oxygenator/distal signals). The plan must address proximal/coronary/cerebral oxygen delivery—e.g. a carefully configured V-AV strategy or another centre-specific upper-body return strategy—not merely raise ventilator FiO2 or pump speed.");
  }
  if (/non[- ]?pulsatile.{0,90}(?:toe|pedal|lower limb)|(?:toe|pedal).{0,90}non[- ]?pulsatile/i.test(context)
      && /(?:toe|pedal).{0,50}(?:SpO2|oxygen saturation).{0,25}9[5-9]\s*%|(?:SpO2|oxygen saturation).{0,50}(?:toe|pedal).{0,25}9[5-9]\s*%/i.test(context)
      && !/femoral.{0,50}(?:arterial blood gas|ABG|arterial sample)|(?:arterial blood gas|ABG).{0,50}femoral|NIRS|near[- ]infrared|distal arterial gas/i.test(proposedPlan)) {
    advisories.push({ code: "nonpulsatile-toe-spo2-needs-confirmation", message: "A 99% toe pulse-oximeter value recorded during explicitly non-pulsatile continuous flow may be unreliable without a valid plethysmographic signal. Do not treat it as a definitive lower-body arterial saturation; confirm distal oxygenation/perfusion with an appropriate arterial sample and/or regional NIRS while retaining the clearly severe right-radial hypoxaemia." });
  }

  // Severe LV distension on VA-ECMO needs a case-specific unloading plan, not just a circuit-flow increase.
  const severeLvDistension = /LVEF\s*~?\s*(?:1[0-9]|[0-9])\s*[-–/]?\s*15?\s*%|LVEF.{0,25}10\s*[-–]\s*15\s*%/i.test(context)
    && /spontaneous echo contrast|\bsmoke\b/i.test(context)
    && /aortic valve.{0,45}(?:intermittent|every|rare|occasion|opens?)/i.test(context)
    && /PCWP\s*[:=]?\s*(?:2[0-9]|[3-9]\d)\s*mm\s*hg/i.test(context);
  if (severeLvDistension && !/\b(?:Impella|LV vent|left ventricular vent|left atrial vent|surgical vent|unload(?:ing)? the left ventricle|left ventricular decompression|IABP|intra[- ]aortic balloon)\b/i.test(proposedPlan)) {
    rule("va-ecmo-lv-distension-not-addressed", "The case documents severe LV distension/stasis (very low LVEF, spontaneous echo contrast, rare aortic-valve opening and high PCWP). The plan must explicitly address LV unloading/venting and reassess native ejection; increasing VA-ECMO flow alone can worsen LV afterload and pulmonary congestion.");
  }
  if (/\bImpella\b.{0,55}\bor\b.{0,55}\batrial septostomy\b|\batrial septostomy\b.{0,55}\bor\b.{0,55}\bImpella\b/i.test(proposedPlan)) {
    advisories.push({ code: "lv-unloading-modalities-not-equivalent", message: "Do not present Impella and atrial septostomy as identical: both may be used in an LV unloading/venting strategy, but Impella actively unloads the LV and reduces wall stress/myocardial oxygen demand, whereas atrial septostomy is passive pressure decompression and does not substantially lower wall stress. Select and monitor the strategy according to anatomy, aortic-valve opening, LV stasis, oxygenation and procedural risks." });
  }
  if (vaFemoralCase && /\b(?:Impella|atrial septostomy|LV vent|left ventricular vent|left atrial vent)\b/i.test(proposedPlan)
      && !/access.{0,60}(?:review|assess|feasib|anatom)|(?:review|assess|confirm).{0,55}(?:vascular|arterial|femoral|axillary|transseptal) access|contraindicat|vascular anatomy/i.test(proposedPlan)) {
    advisories.push({ code: "lv-unloading-access-feasibility-not-addressed", message: "Before selecting or inserting an LV unloading/venting device, explicitly assess arterial/venous or transseptal access feasibility, existing ECMO cannulae, reconstructed aortic/iliofemoral anatomy, device-specific contraindications and the severe bleeding/thrombosis balance. Do not treat a device name as a complete procedural plan." });
  }

  // Overt abdominal compartment syndrome requires urgent decompression assessment.
  const iap = number(/(?:bladder\s+pressure(?:\s*\(IAP\))?|intra[- ]abdominal pressure|\bIAP\b)\s*[:=]?\s*([\d,.]+)\s*mm\s*hg/i);
  const oliguria = /urine output\s*[:=]?\s*(?:[0-9]|1[0-4])\s*mL\s*\/\s*hr|oliguria|anuria/i.test(context);
  if (iap != null && iap >= 20 && oliguria && !/decompressive laparotomy|surgical abdominal decompression|open the abdomen|abdominal decompression/i.test(proposedPlan)) {
    rule("overt-acs-not-decompressed", `Bladder/IAP is ${iap} mmHg with new oliguria, supporting overt abdominal compartment syndrome (assuming standardized measurement). The plan must explicitly prioritize urgent surgical decompression assessment; fluid loading or watchful waiting alone is not adequate.`);
  }

  // Spinal cord rescue after extensive TAAA repair is time-critical, but a bloody drain under bivalirudin is not a routine flush.
  const postTaaaCordDeficit = /thoracoabdominal aortic|\bTAAA\b|extent\s*(?:I|II|2)/i.test(context)
    && /bilateral.{0,45}(?:motor loss|paralysis|weakness)|0\s*\/\s*5.{0,45}(?:bilateral|lower extremit)|paraplegia/i.test(context);
  const csfPressure = number(/(?:intrathecal\s+)?CSF\s+pressure\s*[:=]?\s*([\d,.]+)\s*mm\s*hg/i);
  const bloodyCsf = /blood[- ]tinged.{0,25}CSF|bloody CSF|CSF.{0,30}blood[- ]tinged|lumbar CSF drain.{0,300}blood[- ]tinged/i.test(context);
  const bivalirudinActive = /\bbivalirudin\b/i.test(context) && /aPTT\s*[:=]?\s*(?:[5-9]\d|1\d\d)\s*(?:sec|seconds|s)\b/i.test(context);
  const severeNeuraxialBleedingRisk = (platelets != null && platelets < 50) || (inr != null && inr >= 1.5) || (number(/fibrinogen\s*[:=]?\s*([\d,.]+)\s*mg\s*\/\s*dl/i) != null && number(/fibrinogen\s*[:=]?\s*([\d,.]+)\s*mg\s*\/\s*dl/i) < 150);
  const explicitAvoidDrainManipulation = /(?:do not|avoid|never|must not).{0,55}(?:flush|irrigat|aspirat|replace|exchange|manipulat|insert)|(?:لا\s*(?:تغسل|تشفط|تسحب|تدخل|تستبدل|تعبث)).{0,45}(?:المصرف|القسطرة|السائل النخاعي)/i.test(proposedPlan);
  const drainManipulation = !explicitAvoidDrainManipulation && /\b(?:flush|force[- ]flush|irrigat|aspirat|replace|exchange|insert|manipulat)\w*.{0,45}(?:lumbar|CSF|spinal|neuraxial)?|(?:lumbar|CSF|spinal|neuraxial).{0,45}\b(?:flush|irrigat|aspirat|replace|exchange|insert|manipulat)\w*/i.test(proposedPlan);
  if (postTaaaCordDeficit && bloodyCsf && bivalirudinActive && severeNeuraxialBleedingRisk && drainManipulation) {
    rule("bloody-csf-drain-manipulation-on-bivalirudin", "Progressive paralysis plus blood-tinged CSF, active bivalirudin (aPTT prolonged) and severe thrombocytopenia/coagulopathy is not a routine drain-obstruction scenario. Do not blindly/forcefully flush, aspirate, replace or manipulate the neuraxial catheter. Hold/reassess anticoagulation as the bleeding risk dictates, obtain urgent spine/neurosurgical and anesthesia review, and evaluate for compressive neuraxial hematoma while balancing ECMO-circuit thrombosis risk.");
  }
  if (postTaaaCordDeficit && csfPressure != null && csfPressure >= 10) {
    const mapRescue = /(?:MAP|mean arterial pressure).{0,70}(?:9[0-9]|100)\s*mm\s*hg|(?:target|augment|raise|increase|maintain).{0,55}(?:MAP|mean arterial pressure).{0,30}(?:9[0-9]|100)|(?:MAP|mean arterial pressure).{0,45}(?:augment|raise|increase|target)/i.test(proposedPlan);
    if (!mapRescue) advisories.push({ code: "taa-sci-rescue-map-not-explicit", message: "The plan should include a spinal-cord rescue bundle, not CSF-drain work alone: verify the arterial pressure site/level and consider protocol-directed MAP augmentation (published rescue protocols commonly target ≥90–95 mmHg), optimize oxygen delivery/hemoglobin and correct hypoxia/hypercarbia. Targets must be individualized to the patient and repair." });
    if (bloodyCsf && !/MRI.{0,50}spine|spinal MRI|CT.{0,50}spine|neuraxis imaging|spinal hematoma|epidural hematoma|compressive hematoma/i.test(proposedPlan)) {
      advisories.push({ code: "bloody-csf-neuraxial-imaging-not-mentioned", message: "Blood-tinged CSF with progressive bilateral motor loss and coagulopathy requires urgent assessment for a compressive spinal/neuraxial hematoma (imaging when feasible), not an assumption of simple catheter obstruction. Coordinate any imaging/intervention with ECMO and surgical teams." });
    }
    if (/dampened|damped|blunted|poor waveform/i.test(context) && !/zero|level|transducer|waveform|signal.{0,25}valid|verify.{0,35}(?:pressure|waveform)|confirm.{0,35}(?:pressure|waveform)/i.test(proposedPlan)) {
      advisories.push({ code: "dampened-csf-pressure-trace-needs-validation", message: "The reported intrathecal pressure is accompanied by a dampened waveform. Verify transducer zero/level, stopcock and line setup, and whether the trace is technically valid before treating 34 mmHg as a reliable pressure measurement; do not use blind flushing to validate it in a bloody, anticoagulated system." });
    }
    const hbValue = number(/(?:hemoglobin|haemoglobin|\bHb\b)\s*[:=]?\s*([\d,.]+)\s*g\s*\/\s*dl/i);
    if (hbValue != null && hbValue < 10 && !/transfus|red blood cell|packed red cells|hemoglobin.{0,30}(?:target|optim|raise)|haemoglobin.{0,30}(?:target|optim|raise)/i.test(proposedPlan)) {
      advisories.push({ code: "taa-sci-oxygen-delivery-hb-not-addressed", message: `Hemoglobin is ${hbValue} g/dL in a patient with suspected spinal-cord ischemia and systemic hypoxia. Include an explicit oxygen-delivery/transfusion assessment; some aortic rescue protocols target Hb ≥10 g/dL, but this is protocol- and patient-dependent rather than a universal threshold.` });
    }
    if (!/\b(?:drain|CSF pressure|cerebrospinal fluid|spinal cord perfusion|SCPP)\b/i.test(proposedPlan)) rule("taa-sci-rescue-not-addressed", "Progressive neurologic deficit after extensive TAAA repair with markedly elevated CSF pressure requires an explicit spinal-cord rescue pathway, coordinated with the bleeding/anticoagulation risk.");
  }

  // Chattering signals drainage insufficiency/suction; avoid reflex RPM escalation or large volume loading.
  const drainageChatter = /chatter|chattering|chugging|suction event/i.test(context);
  if (drainageChatter && /increase.{0,35}(?:RPM|pump speed|flow)|raise.{0,35}(?:RPM|pump speed)|5,?200\s*RPM|6\.0\s*L\s*\/\s*min/i.test(proposedPlan)) {
    rule("ecmo-chatter-rpm-escalation", "The drainage cannula is chattering. Raising RPM/flow can intensify venous suction and drainage collapse; stabilize flow (often by temporarily reducing RPM) and assess venous return, cannula position/obstruction, bleeding, tamponade, pneumothorax and raised intra-abdominal pressure before titration.");
  }
  if (drainageChatter && !/reduce.{0,35}(?:RPM|pump speed)|lower.{0,35}(?:RPM|pump speed)|stabiliz.{0,45}(?:drainage|venous return)|assess.{0,70}(?:cannula|venous return|preload|tamponade|pneumothorax|intra[- ]abdominal)/i.test(proposedPlan)) {
    advisories.push({ code: "ecmo-chatter-workup-omitted", message: "Frequent drainage-line chatter is not fixed by an automatic 2-L albumin bolus. The answer should address pump-speed reduction/stabilization and investigate cannula position/obstruction, venous return, bleeding, tamponade, pneumothorax and the very high IAP." });
  }
  if (drainageChatter && /\b(?:2\s*l|2,000\s*ml)\b.{0,25}albumin|albumin.{0,25}\b(?:2\s*l|2,000\s*ml)\b/i.test(proposedPlan) && (iap != null && iap >= 20)) {
    rule("ecmo-chatter-reflex-volume-in-acs", "A large empiric albumin bolus is unsafe to present as the default response to ECMO chatter in a patient with overt abdominal compartment physiology and severe pulmonary venous congestion. Diagnose the cause of drainage insufficiency and give volume only if objective assessment supports it.");
  }

  // Muscle injury, hyperkalaemia and dark urine require urgent limb/perfusion and metabolic evaluation.
  const ck = number(/\bCK\s*[:=]?\s*([\d,.]+)\s*(?:U\s*\/\s*L)?/i);
  const darkUrine = /(?:tea[- ]colou?red|dark).{0,25}urine/i.test(context);
  if ((ck != null && ck >= 5000 && darkUrine) || (potassium != null && potassium >= 6.0 && ck != null && ck >= 5000)) {
    const limbAssessment = /limb perfusion|distal perfusion|vascular assessment|doppler|duplex|compartment assessment|compartment syndrome|serial neurovascular/i.test(proposedPlan);
    const hyperKAction = /hyperkala?emia|hyperkalemia|potassium.{0,35}(?:treat|correct|monitor|repeat)|(?:treat|correct|monitor|repeat).{0,35}potassium/i.test(proposedPlan);
    if (!limbAssessment) advisories.push({ code: "rhabdo-limb-ischemia-assessment-omitted", message: `CK ${ck} U/L with dark urine and/or marked hyperkalaemia raises concern for severe muscle injury/rhabdomyolysis or limb malperfusion. Include urgent bilateral limb perfusion/compartment assessment; do not perform fasciotomy without a clinical compartment-syndrome indication.` });
    if (!hyperKAction) advisories.push({ code: "severe-hyperkalemia-response-omitted", message: "Potassium ≥6.0 mmol/L in this context is immediately dangerous. The integrated plan should include urgent hyperkalaemia assessment/treatment, repeat potassium/ECG and renal-support planning alongside definitive perfusion control." });
  }

  // Major bleeding on bivalirudin has no specific pharmacological antidote; circuit thrombosis risk remains.
  const overtBleeding = /dark maroon.{0,35}nasogastric|maroon.{0,35}gastric|active bleeding|major bleeding|blood[- ]tinged CSF/i.test(context);
  if (overtBleeding && /\bbivalirudin\b/i.test(context)) {
    const holdBival = /\b(?:hold|withhold|pause|interrupt|stop|temporarily discontinue)\b.{0,50}\bbivalirudin\b|\bbivalirudin\b.{0,50}\b(?:hold|withhold|pause|interrupt|stop)\b/i.test(proposedPlan);
    if (!holdBival) rule("major-bleeding-bivalirudin-not-reassessed", "The case suggests major bleeding while bivalirudin is running. The plan must explicitly reassess/hold anticoagulation as clinically indicated, urgently control bleeding and correct hemostatic deficits, while continuously balancing the substantial oxygenator/LV/circuit thrombosis risk. Bivalirudin has no specific reversal antidote; protamine does not reverse it.");
    else advisories.push({ code: "bivalirudin-hold-requires-circuit-balance", message: "Holding bivalirudin during major bleeding may be necessary, but it is not a definitive reversal and creates ECMO/cardiac thrombosis risk. State frequent reassessment of bleeding, aPTT/other hemostatic tests, circuit/oxygenator and LV stasis, with a multidisciplinary restart threshold." });
  }
  if (/\bprotamine\b/i.test(proposedPlan) && /\bbivalirudin\b/i.test(context)) {
    rule("protamine-does-not-reverse-bivalirudin", "Protamine reverses heparin, not bivalirudin. Do not use protamine as a bivalirudin antidote; the direct thrombin inhibitor has no specific pharmacological antidote.");
  }

  return {
    triggered: isPotentialClinicalContext(all),
    conflicts,
    advisories,
    hscorePartial: hscore,
    status: conflicts.length ? "blocked" : advisories.length ? "review" : "no-specific-rule-triggered",
    disclaimer: "Rule coverage is finite: no triggered rule means only that these programmed checks found no matching pattern; it does not establish clinical correctness.",
  };
}

export function formatClinicalSafetyAudit(audit, lang = "ar") {
  if (!audit?.triggered) return "";
  const lines = [lang === "en" ? "CLINICAL SAFETY REVIEW (not a diagnosis or treatment authorization):" : "مراجعة السلامة السريرية (ليست تشخيصًا أو تصريحًا بالعلاج):"];
  if (audit.hscorePartial) {
    lines.push(lang === "en"
      ? `Partial HScore subtotal: ${audit.hscorePartial.score}; components missing: ${audit.hscorePartial.missing.join(", ") || "none"}. This is not a complete score.`
      : `المجموع الجزئي المعروف من HScore: ${audit.hscorePartial.score}؛ العناصر الناقصة: ${audit.hscorePartial.missing.join("، ") || "لا يوجد"}. هذا ليس مجموعًا كاملًا.`);
  }
  for (const c of audit.conflicts) lines.push(`- ${c.message}`);
  for (const a of audit.advisories) lines.push(`- ${a.message}`);
  if (!audit.conflicts.length && !audit.advisories.length) lines.push(lang === "en" ? audit.disclaimer : "عدم ظهور تنبيه لا يعني اعتماد الإجابة طبيًا؛ القواعد تغطي أنماطًا محددة فقط.");
  return lines.join("\n");
}
