/*
 * Clinical safety rules (v3.53).
 *
 * This is a conservative contradiction detector, not a diagnostic engine.
 * It only blocks narrowly defined, high-impact overclaims / missing safety
 * actions. Unknown inputs remain unknown; no absent criterion is scored as 0.
 */
const n = (s) => String(s ?? "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0)).replace(/٫/g, ".").replace(/⁹/g, "^9").replace(/[μµ]/g, "u");
const has = (s, re) => re.test(String(s || ""));
const isAffirmed = (text, re) => has(text, re);

export function isPotentialClinicalContext(text = "") {
  return has(text, /\b(?:patient|clinical|diagnos(?:is|e)|treatment|therapy|dose|drug|medication|mg\/|mmol\/|mmhg|laboratory|ferritin|platelets|tacrolimus|transplant|sepsis|infection|HLH|HScore|creatinine|oxygen|antibiotic|voriconazole|PJP|aspergillus|β[- ]?D[- ]?glucan)\b/i)
    || has(text, /مريض|مريضة|تشخيص|علاج|جرعة|دواء|تحليل|صفائح|فريتين|عدوى|زرع|كلية|كبد|مضاد|التهاب|سمية/);
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

  // TMP-SMX can still be indicated for PJP, but hyperkalaemia/AKI demand renal-aware dosing and monitoring.
  const potassium = number(/(?:potassium|serum potassium|\bK\+?)\s*[:=]?\s*([\d,.]+)\s*(?:mmol\s*\/\s*l|meq\s*\/\s*l)/i);
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
  if (/\b(?:TMP[- ]?SMX|trimethoprim[- ]sulfamethoxazole)\b/i.test(proposedPlan) && renalRisk) {
    const renalDosePlan = /\b(?:renal[- ]adjusted|adjust(?:ed|ment)? for renal|dose adjustment for renal|kidney[- ]adjusted|adjust dose based on (?:renal|kidney)|creatinine clearance[- ]based)\b/i.test(proposedPlan);
    const potassiumMonitor = /\b(?:monitor|repeat|serial|trend).{0,45}(?:potassium|K\+)|(?:potassium|K\+).{0,45}(?:monitor|repeat|serial|trend)\b/i.test(proposedPlan);
    if (!renalDosePlan || !potassiumMonitor) rule("tmp-smx-renal-hyperkalemia-safety", `The plan includes TMP-SMX in a patient with ${potassium != null && potassium >= 5.5 ? `hyperkalaemia (K ${potassium})` : "acute renal dysfunction"}. Require kidney-function-based dosing plus explicit potassium and renal monitoring; do not let a PJP treatment recommendation bypass this patient-specific safety constraint.`);
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
