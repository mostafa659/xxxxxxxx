# ClinixStudy v3.55.0 — Root-Cause Audit: Ameloblastic Fibrosarcoma, APS and Mandibular Reconstruction

**Date:** 21 November 2026  
**Baseline:** ClinixStudy v3.54.0  
**Case:** 39-year-old man with an aggressive mandibular odontogenic neoplasm, triple-positive thrombotic APS, warfarin–fluconazole interaction, bilateral peronea arteria magna and V3 perineural spread.

## 1. What was actually supplied

The current-model answer field in the user's message was empty. The attached text contains the modern model's answer, which selects option C. Therefore this audit evaluates the supplied modern answer and the five options; it cannot make a direct current-vs-modern model comparison because the current model's response was not supplied.

## 2. Diagnostic interpretation

The described H&E pattern supports **ameloblastic fibrosarcoma (AFS)**:

- The epithelial component retains bland ameloblastic/odontogenic morphology, including peripheral palisading and reverse nuclear polarity.
- The ectomesenchymal stromal component is overtly malignant: marked cellularity, pleomorphism, hyperchromasia, high mitotic activity (14/10 HPF) and atypical mitoses.
- The Ki-67 difference (38% in stromal spindle cells versus <2% in epithelial islands) is supportive of compartmental biological divergence. It is not a validated universal percentage threshold for diagnosing AFS.

The distinction is based primarily on morphology and which compartment is malignant. Ameloblastic carcinoma requires epithelial malignancy; odontogenic carcinosarcoma requires malignant epithelial and mesenchymal components. BRAF V600E is biologically relevant but is not pathognomonic and should not replace histologic diagnosis.

A seven-case molecular series reported BRAF V600E in five AFS cases. However, separate compartment analysis was available in only limited material: the authors describe one assessable VE1 IHC case showing staining in the stromal compartment, and discuss the limits of assigning mutation to a specific component without microdissection. This supports BRAF as an interesting molecular finding, not a universal diagnostic test or standard postoperative prescription.

## 3. Option assessment

**Option C is the closest exam answer among the supplied choices. It is not a complete, uniquely established clinical protocol.** The answer engine should separate these two judgements.

### A — not safe on the supplied facts

- The morphology supports AFS rather than ameloblastic carcinoma.
- Routine fibula harvest is contraindicated when the peroneal artery is the sole dominant foot supply and the tibial arteries are absent/hypoplastic, unless formal vascular testing demonstrates adequate independent collateral supply and a vascular team explicitly clears harvest.
- A permanent apixaban switch is not a routine solution for triple-positive APS with prior arterial thrombosis. EULAR recommends VKA rather than DOACs in definite APS with arterial events because of recurrent thrombosis concerns.
- PCC may be appropriate for urgent warfarin reversal in selected emergency settings, but it must not be a reflex action for INR 4.8 in a patient with severe thrombotic risk; urgency, bleeding, surgical timing and vitamin K strategy need review.

### B — not safe as worded

- Concurrent dabrafenib/trametinib with high-dose head-and-neck radiotherapy without a scenario-specific adaptation should not be labelled safe.
- In the described medication history, the patient is not stated to be taking a BRAF/MEK inhibitor. A BRAF mutation is not itself a current medication to “hold.”
- BRAF/MEK therapy is not an established routine adjuvant standard for resected AFS; the available AFS molecular literature calls for clinical investigation of targeted approaches.

### C — closest, but incomplete

- AFS, segmental resection, and avoiding routine fibula harvest are directionally appropriate.
- DCIA/iliac crest is a reasonable vascularised alternative, but not the only possible donor flap; scapular and other options depend on the actual bone/soft-tissue defect, recipient vessels and patient factors.
- “Therapeutic LMWH perioperatively” lacks essential timing. In very-high-thrombotic-risk APS, bridging may be selected, but it should begin only when INR has fallen below the desired therapeutic range. Preoperative last-dose timing must account for agent, renal function and operation. For high-bleeding-risk surgery, therapeutic-dose anticoagulation is generally not restarted immediately: a haemostasis-dependent stepwise approach may start prophylactic dosing first, with later escalation only after reassessment and secure haemostasis. The 2026 APS cohort supports individualised, guideline-directed perioperative management, not an unconditional dose schedule.
- Fluconazole inhibits warfarin metabolism through CYP2C9 and can substantially increase prothrombin time/INR. With measured INR 4.8, stop/review the interacting regimen with the prescribing team, repeat INR and choose reversal only according to actual bleeding and urgency. Fluconazole's enzyme inhibition can persist several days after discontinuation.
- Adjuvant RT, exact dose (including 60–66 Gy) and the proximal V3/foramen-ovale target require final margin/pathology review, mapped perineural extent, skull-base imaging, organ-at-risk planning and an expert head-and-neck/rare-sarcoma MDT. A universal AFS RT protocol is not established.
- The “hold BRAF/MEK inhibitors throughout radiotherapy” clause should be rewritten as conditional: there is no current BRAF/MEK medication in the case history. If a future MDT elects to use one, apply current scenario-specific ESMO–ESTRO RT adaptation (drug interruption, dose reduction or RT adaptation) rather than a blanket rule.
- Baseline chest/pulmonary staging is not documented in the prompt and should be addressed because lung is the commonest reported distant site when AFS metastasises.
- “Jewel L-C” appears to be a misspelling of the established **Jewer LC** classification, describing a lateral-plus-central mandibular defect. Confirm whether the condyle and soft-tissue components are included, and map remaining suprahyoid/genioglossus attachments before selecting flap geometry or resuspension.

### D — not safe on the supplied facts

The option uses a diagnosis inconsistent with the compartment-specific morphology, proposes warfarin interruption without bridging in a very-high-risk thrombotic APS phenotype, and proposes fibula harvest despite the described sole peroneal foot supply. Immediate implant loading is also not something the supplied case details establish as appropriate.

### E — not safe on the supplied facts

The malignant stromal cytology, atypical mitoses and marked stromal proliferation are incompatible with treating this as an ordinary benign ameloblastic fibroma with reactive atypia or using a marginal/conservative strategy as definitive management.

## 4. Root causes converted into software checks

| Root-cause pattern | v3.55.0 behaviour |
|---|---|
| Malignancy assigned to the wrong tissue compartment | Blocks a selected carcinoma/carcinosarcoma/benign-fibroma diagnosis when the supplied morphology is bland ameloblastic epithelium plus malignant spindle stroma |
| Biomarker over-read | Blocks claims that BRAF V600E alone is pathognomonic; warns when bulk NGS is assumed to localise the variant to malignant stroma |
| False universal Ki-67 threshold | Warns against presenting >30% (or another single percentage) as a validated universal diagnostic cutoff |
| Rare molecular finding treated as standard treatment | Blocks routine adjuvant dabrafenib/trametinib prescription from mutation status alone; preserves trial/advanced-disease review as a separate clinical question |
| Radiation–targeted therapy overgeneralisation | Blocks unmodified concurrent BRAF/MEK plus high-dose head-and-neck RT; warns that current consensus is scenario-specific adaptation, not a blanket rule |
| Donor-vessel anatomy ignored | Blocks routine fibula harvest in sole-peroneal foot inflow unless collateral/occlusion testing and vascular clearance are documented |
| High-risk APS simplified to “bridge LMWH” or switched to DOAC | Blocks routine DOAC switch and unbridged interruption; flags missing INR, preoperative and postoperative timing |
| Target INR mistaken for current INR | Parser selects explicit admission/current INR or the last scalar INR, preventing target interval 2.5–3.5 from obscuring admission INR 4.8 |
| Known Jewer classification misrecognised as unknown | Recognises “Jewel L-C” as likely Jewer LC, then asks for condyle, soft-tissue and muscle-attachment details needed for reconstruction |
| Rare tumour treated as if an adjuvant RT protocol is settled | Warns when margins, perineural extent, skull-base imaging, systemic staging and MDT basis are missing |

The selected-option audit for C returns **0 hard conflicts and 11 advisories** when the supplied modern answer is used. This means the narrow programmed checks did not identify one of the specifically coded catastrophic contradictions; it does **not** mean that C is clinically approved or that the full plan is complete.

## 5. Evidence consulted

1. Agaimy et al., *Ameloblastic fibrosarcoma: clinicopathological and molecular analysis of seven cases highlighting frequent BRAF and occasional NRAS mutations*, Histopathology (2020). https://onlinelibrary.wiley.com/doi/10.1111/his.14053
2. Gomez et al., *Ameloblastic fibroma and ameloblastic fibrosarcoma: A systematic review* (2017). 103 AFS cases were included; segmental resection was associated with lower recurrence than marginal resection. https://pubmed.ncbi.nlm.nih.gov/28776760/
3. NCBI Bookshelf, *Fibula Free Flaps*: if the peroneal artery is the primary/sole blood supply to the foot, fibula harvest on that side is contraindicated. https://www.ncbi.nlm.nih.gov/books/NBK564337/
4. 2026 case report, *Vascular Testing to Overcome Anatomical Contraindication: Fibula Free Flap in Bilateral Peronea Arteria Magna*: the exceptional harvest followed balloon-occlusion, duplex and collateral assessment. https://pubmed.ncbi.nlm.nih.gov/42375077/
5. EULAR recommendations for APS: DOACs are not recommended in definite APS with arterial events; vitamin-K antagonists remain preferred. https://pmc.ncbi.nlm.nih.gov/articles/11034817/
6. 2026 *Blood Advances*, *Perioperative management of antithrombotic therapy in patients with thrombotic antiphospholipid syndrome*: perioperative management should be guideline-directed and tailored to thrombotic and procedural bleeding risk. https://pmc.ncbi.nlm.nih.gov/articles/PMC13136740/
7. Thrombosis Canada, *Warfarin: Perioperative Management*: high-bleeding-risk procedures use haemostasis-dependent, stepwise postoperative anticoagulation; therapeutic LMWH/UFH should not be restarted immediately. https://www.thrombosiscanada.ca/hcp/practice/clinical_guides?guideID=PERIOPERATIVEMANAGEMENTOFPATIE_1&language=en-ca
8. Fluconazole SmPC: concurrent warfarin can prolong prothrombin time up to twofold via CYP2C9 inhibition; monitor PT/INR and adjust as clinically needed. https://www.medicines.org.uk/emc/medicine/24893/spc
9. 2026 ESMO–ESTRO consensus on targeted therapies and RT: scenario-specific recommendations for BRAF/MEK combinations include major adaptation for head-and-neck RT; evidence levels vary and recommendations are not a universal single hold interval. https://pmc.ncbi.nlm.nih.gov/articles/PMC12955645/
10. *Reconstruction of Mandibular Defects*: Jewer LC classification describes lateral plus central mandibular defects and is a recognised classification. https://pmc.ncbi.nlm.nih.gov/articles/PMC3324243/
11. ORAD, *Ameloblastic fibrosarcoma*: multidisciplinary work-up, chest imaging and the absence of a universal adjuvant-treatment protocol are discussed. https://www.orad.org/lesions/ameloblastic-fibrosarcoma

## 6. Limits

- No live Gemini call or before/after A/B benchmark was performed.
- No pathologist, hematologist, microsurgeon or radiation oncologist has signed off this synthetic case or any software rule.
- The Vite production build could not run because `vite` is not installed in the active workspace (`sh: 1: vite: not found`).
- Automated pattern checks are narrow and can miss novel cases or misread unusual phrasing. “No conflict” is not a medical correctness certificate.
