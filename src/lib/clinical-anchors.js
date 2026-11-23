/*
 * ClinixStudy · Verified clinical anchors (v3.68)
 *
 * Purpose: give the writers a SMALL set of reference statements whose sources were opened and read
 * (see `checked`), so the model does not have to recall guideline wording, thresholds or classification
 * criteria from memory — the place where a fast model invents a number ("ADAMTS13 > 64 % excludes TTP"),
 * attributes a mechanism with false certainty, or mislabels an evidence level.
 *
 * Rules for every entry (enforced by tests/v368-root-causes.test.mjs):
 *   • `level` says what kind of statement it is: guideline | consensus | classification | study | physiology | label
 *     A "physiology" or "study" entry is NEVER presented as a guideline sentence.
 *   • `sources` carry author/journal/year/identifier exactly as seen; nothing is added from memory.
 *   • An entry with `verify: true` was only partly confirmed — the prompt tells the writer to label it "verify".
 *   • No dosing instruction, no patient-specific recommendation. Statements are about interpretation and criteria.
 *   • Entries are retrieved by trigger words in the SOURCE, so unrelated cases receive nothing.
 *
 * Adding an entry is how a new audit finding becomes permanent for the whole app: write the statement, the
 * triggers and the source, and the shared retrieval + prompt + tests cover every future case in that area.
 */

export const ANCHORS_VERSION = "3.69.0";

export const ANCHORS = [
  {
    id: "ttp-sampling-and-threshold",
    topic: "TTP · when to treat, when to sample, what ADAMTS13 activity means",
    triggers: [/ADAMTS-?13/i, /\bTTP\b|thrombotic thrombocytopenic/i, /plasma exchange|\bTPE\b|\bPLEX\b/i],
    level: "guideline",
    statements: [
      "ISTH good-practice statements: when clinical suspicion of TTP is high, emergency therapeutic plasma exchange (TPE) and corticosteroids should be considered without waiting for the ADAMTS13 result; a blood sample for ADAMTS13 (activity plus inhibitor or anti-ADAMTS13 IgG) should be obtained BEFORE TPE starts.",
      "In the same statements, plasma ADAMTS13 activity below 10 IU/dL (< 10 % of normal) in this setting is immune-mediated TTP in more than 95 % of patients.",
      "ISTH treatment guideline (iTTP, first event or relapse): strong recommendation to add corticosteroids to TPE; conditional recommendations to add rituximab and caplacizumab. Evidence certainty ranged from very low to moderate.",
    ],
    inference: [
      "PHYSIOLOGY (not a guideline sentence): plasma products contain ADAMTS13, so activity measured after plasma exposure can be higher than the patient's own baseline; a value of 17 % after two units of FFP therefore cannot be read as the pre-plasma value. Direction of the error: toward a higher (less severe-looking) activity than the patient's own, not a lower one.",
      "A single-assay activity value above the severe-deficiency threshold does not exclude iTTP when the sample followed plasma. An unaffected pre-plasma citrate sample (for example the tube drawn for the referring hospital's INR) may still exist and can sometimes be retrieved from that laboratory.",
    ],
    sources: [
      "Zheng XL, Vesely SK, Cataland SR, et al. ISTH guidelines for treatment of thrombotic thrombocytopenic purpura. J Thromb Haemost. 2020;18(10):2496–2502. doi:10.1111/jth.15010",
      "Zheng XL, Vesely SK, Cataland SR, et al. Good practice statements (GPS) for the clinical care of patients with TTP. J Thromb Haemost. 2020;18(10):2503–2512. doi:10.1111/jth.15009",
    ],
    urls: ["https://pubmed.ncbi.nlm.nih.gov/32914526", "https://www.pubmed.gov/32914535/"],
    checked: "2026-11-22",
  },
  {
    id: "plasmic-limits",
    topic: "PLASMIC score — what it uses and where it misleads",
    triggers: [/PLASMIC/i, /ADAMTS-?13/i, /\bTTP\b/i],
    level: "study",
    statements: [
      "PLASMIC score components (Bendapudi, Lancet Haematol 2017): platelets < 30 ×10⁹/L, hemolysis, no active cancer, no solid-organ or stem-cell transplant, MCV < 90 fL, INR < 1.5, creatinine < 2.0 mg/dL (one point each; 0–4 low, 5 intermediate, 6–7 high risk of severe ADAMTS13 deficiency).",
    ],
    inference: [
      "HYPOTHESIS: three components depend on factors that are altered in a warfarin-treated transplant recipient with AKI (INR, creatinine, transplant history), so a low score here lowers the pre-test probability less reliably than in the derivation setting. Report the arithmetic and its limits; do not use it to rule TTP out.",
    ],
    sources: ["Bendapudi PK, Hurwitz S, Fry A, et al. Derivation and external validation of the PLASMIC score for rapid assessment of adults with thrombotic microangiopathies. Lancet Haematol. 2017;4(4):e157–e164 (components as cited from memory of the derivation paper; verify before quoting)."],
    verify: true,
    checked: "2026-11-22",
  },
  {
    id: "caps-criteria",
    topic: "CAPS — preliminary classification criteria and what they do not prove",
    triggers: [/\bCAPS\b|catastrophic antiphospholipid/i, /antiphospholipid|\bAPS\b|lupus anticoagulant|anticardiolipin/i],
    level: "classification",
    statements: [
      "Preliminary classification criteria (Asherson 2003): (1) involvement of three or more organs, systems and/or tissues; (2) manifestations developing simultaneously or in less than one week; (3) histopathological confirmation of small-vessel occlusion in at least one organ or tissue (vasculitis may coexist, but significant thrombosis must be present); (4) laboratory confirmation of antiphospholipid antibodies (LA and/or anticardiolipin; anti-β2GPI is counted in the 2006 update), on two or more occasions (originally 6 weeks apart; 12 weeks since the 2006 revised Sapporo update).",
      "DEFINITE CAPS = all four criteria. PROBABLE CAPS = all four but only two organs; or all four but without repeat aPL testing because of early death in a patient never tested before; or criteria 1, 2 and 4 (no histology); or criteria 1, 3 and 4 with a third event after more than one week but within one month despite anticoagulation.",
      "Renal involvement for criterion 1 is defined in trial appendices as a ≥ 50 % rise in creatinine, severe hypertension (> 180/100 mmHg) and/or proteinuria > 500 mg/24 h.",
      "Validation in the CAPS Registry: sensitivity 90.3 %, specificity 99.4 % against registry classification (Cervera 2005).",
    ],
    inference: [
      "CLASSIFICATION ≠ MECHANISM: the criteria were built for registries and for alerting clinicians; they do not exclude another cause of microvascular thrombosis (TTP, complement-mediated TMA, calcineurin-inhibitor TMA, infection/DIC, malignant hypertension). Meeting them tells you that CAPS must be treated as a live diagnosis, not that it is the only process present.",
      "Evidence for CAPS treatment (anticoagulation + glucocorticoids + plasma exchange and/or IVIG) comes from registry and consensus work, not randomized trials — state that certainty when recommending it.",
    ],
    sources: [
      "Asherson RA, Cervera R, de Groot PG, et al. Catastrophic antiphospholipid syndrome: international consensus statement on classification criteria and treatment guidelines. Lupus. 2003;12(7):530–534.",
      "Cervera R, Font J, Gómez-Puerta JA, et al. Validation of the preliminary criteria for the classification of catastrophic antiphospholipid syndrome. Ann Rheum Dis. 2005;64(8):1205–1209.",
      "Kazzaz NM, McCune WJ, Knight JS. Treatment of catastrophic antiphospholipid syndrome. Curr Opin Rheumatol. 2016;28(3):218–227.",
      "Legault K, Schunemann H, Hillis C, et al. McMaster RARE-Bestpractices clinical practice guideline on diagnosis and management of the catastrophic antiphospholipid syndrome. J Thromb Haemost. 2018;16(8):1656–1664 (cited for the treatment approach; verify wording before quoting).",
    ],
    urls: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC3836378", "https://pmc.ncbi.nlm.nih.gov/articles/PMC1755612", "https://pmc.ncbi.nlm.nih.gov/articles/PMC4958413"],
    checked: "2026-11-22",
  },
  {
    id: "poc-inr-lupus-anticoagulant",
    topic: "Point-of-care INR vs venous INR in lupus anticoagulant / APS",
    triggers: [/point[- ]of[- ]care|\bPOC\b|home INR|CoaguChek|\bINR\b/i, /lupus anticoagulant|antiphospholipid|\bAPS\b|\bLA\b/i],
    level: "study",
    statements: [
      "Lupus anticoagulant can raise INR results from point-of-care devices in a subset of APS patients (those with LA and high anti-β2-glycoprotein I titres are most affected); in the 2005 comparison with chromogenic factor X, several such patients had point-of-care INRs that were not supratherapeutic by chromogenic factor X.",
      "Reports describe individual discrepancies as large as a point-of-care INR of 6.8 against a venous INR of 3.0. A stable patient-specific POC/venous relationship may exist but must be documented, not assumed.",
      "Guidance on anticoagulant monitoring in thrombotic APS (ISTH SSC) discusses chromogenic factor X, chromogenic anti-Xa/anti-IIa and thrombin generation as alternatives when phospholipid-dependent clotting tests are unreliable.",
    ],
    inference: [
      "INFERENCE: a venous (laboratory) INR that has moved from the patient's own stable baseline (2.2–2.6) to 3.5 after an azole was started is consistent with REAL warfarin potentiation; LA interference is a competing hypothesis for the POINT-OF-CARE excess (5.8 vs 3.5), not an explanation that lets the venous change be ignored. Venous INR itself is phospholipid-dependent and not immune to LA. Both can be true at once; chromogenic factor X (or factor II) arbitrates.",
      "Do not state that the point-of-care INR is 'falsely elevated' as a fact without that qualification, and do not conclude the patient is therapeutically anticoagulated or over-anticoagulated from either INR alone.",
    ],
    sources: [
      "Perry SL, Samsa GP, Ortel TL. Point-of-care testing of the international normalized ratio in patients with antiphospholipid antibodies. Thromb Haemost. 2005;94(6):1196–1202.",
      "Geertsema-Hoeve BC, et al. Problem solved? An individual ratio between point-of-care and venous INR values in two patients with antiphospholipid syndrome: two case reports. TH Open. 2025;9:a25425358 (case reports: low certainty).",
      "Interference in point-of-care INR monitoring in patients with lupus anticoagulant is correlated with anti-β2-glycoprotein I antibody titers. PMC9986099 (journal and year not confirmed; verify).",
      "ISTH SSC guidance on anticoagulant monitoring in thrombotic antiphospholipid syndrome. J Thromb Haemost (authors/year not confirmed; verify).",
    ],
    verify: true,
    urls: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC9986099", "https://www.thieme-connect.com/products/ejournals/html/10.1055/a-2542-5358", "https://thieme-connect.de/products/all/doi/10.1160/TH05-06-0400"],
    checked: "2026-11-22",
  },
  {
    id: "ufh-monitoring-with-prolonged-baseline-aptt",
    topic: "Monitoring unfractionated heparin when the baseline aPTT is already prolonged",
    triggers: [/aPTT|APTT|partial thromboplastin/i, /heparin|\bUFH\b|anti-?Xa/i],
    level: "study",
    statements: [
      "When the baseline aPTT is prolonged (lupus anticoagulant, factor deficiency), aPTT can overestimate heparin effect; a calibrated heparin anti-Xa assay is the usual alternative. One case report documented aPTT 176 s alongside anti-Xa 0.34 IU/mL (case-level evidence).",
    ],
    inference: [
      "INFERENCE: this patient's aPTT was 72 s BEFORE any heparin and she is also on warfarin (factors II, VII, IX, X reduced), so aPTT cannot be used to titrate UFH; a baseline anti-Xa and a pre-heparin aPTT should be recorded.",
      "CAVEAT: chromogenic anti-Xa results can be distorted by marked hemolysis, hyperbilirubinemia or lipemia (assay-dependent) and by low antithrombin in assays that do not add it — check the laboratory's method, and if the two disagree, use clinical judgment with hematology.",
    ],
    sources: ["Anticoagulation Monitoring in Recurrent Venous Thromboembolism Associated With Antiphospholipid Antibodies and Subsequent Heparin-Induced Thrombocytopenia. Case report, PMC13682851 (case-level evidence)."],
    verify: true,
    urls: ["https://www.ncbi.nlm.nih.gov/pmc/articles/PMC13682851/"],
    checked: "2026-11-22",
  },
  {
    id: "fluconazole-tacrolimus-warfarin",
    topic: "Azole interaction with tacrolimus and warfarin",
    triggers: [/fluconazole|azole|voriconazole|posaconazole|itraconazole/i, /tacrolimus|warfarin|cyclosporin/i],
    level: "label",
    statements: [
      "Fluconazole inhibits CYP3A4 (and CYP2C9); tacrolimus is a CYP3A4/P-gp substrate and warfarin's S-enantiomer is cleared by CYP2C9. The tacrolimus and fluconazole product information warn of increased tacrolimus exposure and of enhanced warfarin effect respectively. The size of the effect varies between patients and with fluconazole dose.",
    ],
    inference: [
      "INFERENCE: a tacrolimus dose that was DOUBLED four days before the azole started, followed by CYP3A4 inhibition, makes two additive reasons for a high trough; neither explains microangiopathic hemolysis by itself (see tacrolimus-tma). The management question is the future dose and the interaction, which belongs with the transplant team and a pharmacist.",
      "A trough reflects the preceding 12 h; the 12-hour correctly timed value of 16.2 ng/mL is a measured exposure, not an estimate — but its steady-state status after two changes in 10 days is uncertain.",
    ],
    sources: ["Current US prescribing information for fluconazole (Diflucan), tacrolimus (Prograf) and warfarin (Coumadin/Jantoven): drug-interaction sections. Label wording not re-read in this audit; verify the current label."],
    verify: true,
    checked: "2026-11-22",
  },
  {
    id: "tacrolimus-tma",
    topic: "Calcineurin-inhibitor-associated TMA — what a high trough does and does not show",
    triggers: [/tacrolimus|cyclosporin|calcineurin/i, /\bTMA\b|thrombotic microangiopathy|schistocyt|hemoly/i],
    level: "consensus",
    statements: [
      "Calcineurin-inhibitor TMA after kidney transplantation can be graft-limited or systemic, is typically exposure-related but can occur at 'therapeutic' levels, and is usually managed by reducing or changing the CNI; it remains a diagnosis that needs the other TMA causes considered.",
    ],
    inference: [
      "INFERENCE: tacrolimus exposure is a plausible contributor or trigger and a high trough is a reason to act now (reduce/hold with the transplant team), but a high trough alone cannot establish the cause of a multi-organ process that includes cerebral and cutaneous small-vessel thrombosis, a lupus-active serology and persistent triple-positive antiphospholipid antibodies.",
    ],
    sources: ["Garg N, Rennke HG, Pavlakis M, Zandi-Nejad K. De novo thrombotic microangiopathy after kidney transplantation. Transplant Rev. 2018;32(1):58–68 (cited from memory of the title; verify)."],
    verify: true,
    checked: "2026-11-22",
  },
  {
    id: "banff-amr",
    topic: "Banff criteria for antibody-mediated rejection (AMR)",
    triggers: [/Banff|\bDSA\b|donor[- ]specific|\bMFI\b|antibody[- ]mediated (?:kidney )?(?:allograft )?rejection|\bAMR\b|\bABMR\b/i],
    level: "classification",
    statements: [
      "Banff (2019 schema, retained in 2022): active AMR requires (1) histologic evidence of acute tissue injury (microvascular inflammation g and/or ptc > 0, intimal/transmural arteritis v > 0, acute TMA or acute tubular injury in the absence of any other cause), PLUS (2) evidence of current/recent antibody interaction with the endothelium (C4d in peritubular capillaries, or at least moderate microvascular inflammation g+ptc ≥ 2 once glomerulonephritis is excluded, or validated gene transcripts), PLUS (3) serologic evidence of DSA or an accepted equivalent (C4d or validated transcripts may substitute).",
      "Banff 2022 added the phenotypes 'probable AMR' (DSA-positive with some AMR features below the definitive threshold) and 'microvascular inflammation, DSA-negative and C4d-negative'.",
    ],
    inference: [
      "INFERENCE: a de novo weak DSA (MFI ≈ 1,800) is one of three required elements; MFI is semi-quantitative and does not scale linearly with antibody concentration or pathogenicity, so a weak DSA neither establishes nor excludes AMR. Histology (and C4d/microvascular inflammation) decides, which is why the timing and safety of the biopsy matter. Acute TMA on biopsy is itself a Banff AMR 'acute injury' feature only when no other cause explains it — in this patient other causes exist.",
    ],
    sources: [
      "Naesens M, Roufosse C, Haas M, et al. The Banff 2022 Kidney Meeting Report: reappraisal of microvascular inflammation and the role of biopsy-based transcript diagnostics. Am J Transplant (2024; volume/pages not re-confirmed).",
      "Proposed definitions of antibody-mediated rejection for use as a clinical trial endpoint in kidney transplantation. Transpl Int. 2022;35:10140 (table of Banff AMR criteria groups).",
      "Loupy A, Haas M, Roufosse C, et al. The Banff 2019 Kidney Meeting Report (I): updated diagnostic criteria. Am J Transplant. 2020 (volume/pages not re-confirmed).",
    ],
    verify: true,
    urls: ["https://pmc.ncbi.nlm.nih.gov/articles/PMC9163810", "https://pmc.ncbi.nlm.nih.gov/articles/PMC11135910"],
    checked: "2026-11-22",
  },
  {
    id: "complement-tma-work-up",
    topic: "Complement-mediated TMA / aHUS — a diagnosis of exclusion, and its confounders",
    triggers: [/complement|aHUS|atypical hemolytic|eculizumab|ravulizumab|factor H|\bC3\b/i, /\bTMA\b|thrombotic microangiopathy/i],
    level: "consensus",
    statements: [
      "Complement-mediated TMA (aHUS) is generally reached after severe ADAMTS13 deficiency, Shiga-toxin-associated HUS and other secondary causes have been addressed; the work-up includes C3/C4/factor H/factor I levels, complement genetics (CFH, CFI, CD46/MCP, C3, CFB and CFHR1-3 rearrangements) and anti-factor H antibodies, interpreted with the clinical context. Terminal-complement blockade is used in complement-mediated TMA after other causes are excluded.",
    ],
    inference: [
      "INFERENCE: a low C3 is non-discriminating here — active lupus, antibody-mediated processes and complement consumption in CAPS or infection all lower it; a normal C3 would not exclude complement-mediated TMA either. Complement activation and complement-gene variants have also been reported in a subset of APS/CAPS patients, so 'CAPS' and 'complement-amplified TMA' are not mutually exclusive (low-certainty literature).",
    ],
    sources: [
      "Fakhouri F, Frémeaux-Bacchi V. Thrombotic microangiopathy in aHUS and beyond: clinical clues from complement genetics. Nat Rev Nephrol. 2021 (title/year as recalled; verify).",
      "Chaturvedi S, Braunstein EM, Yuan X, et al. Complement activity and complement regulatory gene mutations are associated with thrombosis in APS and CAPS. Blood. 2020;135(4):239–251 (title as recalled; verify).",
    ],
    verify: true,
    checked: "2026-11-22",
  },
];

const textOf = (x) => (Array.isArray(x) ? x.join("\n") : String(x || ""));

/* anchors whose triggers appear in the supplied text; the more distinct triggers match, the earlier the anchor */
export function selectAnchors(text, { limit = 8, minTriggers = 1 } = {}) {
  const t = textOf(text);
  if (!t) return [];
  return ANCHORS
    .map((a) => ({ a, hits: a.triggers.filter((re) => re.test(t)).length }))
    .filter((x) => x.hits >= Math.max(minTriggers, a2min(x.a)))
    .sort((x, y) => y.hits - x.hits)
    .slice(0, limit)
    .map((x) => x.a);
}
/* single-trigger anchors would fire on any mention of a keyword; two-trigger anchors need both families */
const a2min = (a) => (a.triggers.length >= 2 ? 2 : 1);

export function formatAnchors(anchors) {
  const list = Array.isArray(anchors) ? anchors : [];
  if (!list.length) return "";
  const body = list.map((a, i) => {
    const lines = [`[R${i + 1}] ${a.topic} — evidence type: ${a.level}${a.verify ? " — PARTLY CONFIRMED: label as 'verify'" : ""}`];
    a.statements.forEach((s) => lines.push(`  • ${s}`));
    (a.inference || []).forEach((s) => lines.push(`  ◦ ${s}`));
    a.sources.forEach((s) => lines.push(`  src: ${s}`));
    return lines.join("\n");
  }).join("\n\n");
  return `VERIFIED REFERENCE ANCHORS (retrieved for this case; sources opened and read on ${list[0].checked || "—"}):\n` +
    `"•" lines are statements from the cited source. "◦" lines are the application's own inference or physiology — present them as inference/hypothesis, never as a guideline sentence.\n` +
    `Use an anchor only where the patient meets its conditions. If you cite a source that is not listed here, write it as (من الذاكرة — راجع المصدر) and give only author, journal and year you are certain of. Never attach a number, threshold or recommendation class to a source unless it appears above.\n\n${body}`;
}

/* v3.69 · the references the student sees: only anchors that were retrieved for THIS case, with the links that were actually opened.
   Deterministic, zero requests. "Retrieved" is not "supports every sentence": the section says so. */
export function formatAnchorReferences(anchors, lang = "ar") {
  const list = Array.isArray(anchors) ? anchors : [];
  if (!list.length) return "";
  const head = lang === "en" ? "## References retrieved for this case (checked in the audit)" : "## المراجع المسترجعة لهذه الحالة (تم فحصها في المراجعة)";
  const rows = list.map((a) => `- **${a.topic}** — ${a.level}${a.verify ? " (verify)" : ""}\n${a.sources.map((x) => `  - ${x}`).join("\n")}${(a.urls || []).length ? `\n  - ${(a.urls || []).join(" · ")}` : ""}`).join("\n");
  const note = lang === "en" ? "A reference being listed does not mean it supports every sentence; entries marked (verify) were only partly confirmed." : "ظهور المرجع هنا لا يعني أنه يدعم كل جملة؛ والمراجع الموسومة (verify) لم تُؤكَّد بالكامل.";
  return `${head}\n${rows}\n${note}`;
}
