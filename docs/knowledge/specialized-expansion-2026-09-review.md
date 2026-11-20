# Specialized Pharmacogenomics Expansion — 2026-09 FDA Update

**Release:** ClinixStudy v3.48.0  
**Batch:** `specialized-pharmacogenomics-expansion-2026-09`  
**New entries:** 10  
**Status:** all 10 are `draft`; none is enabled for student retrieval.

## Scope of this expansion

This is a focused second batch, not a general pharmacology chapter. It adds treatment-changing or safety-critical gene–drug details across oncology, cardiovascular pharmacology, anesthesia and neurotherapeutics.

| Area | Added specialist entry | Core distinction captured |
|---|---|---|
| Oncology | DPYD + capecitabine | Complete deficiency: avoid; partial deficiency: individualize based on tolerance and treatment intent; early/unusually severe toxicity requires withholding/discontinuation. |
| Oncology | DPYD + fluorouracil | Complete deficiency: no dosage proven safe; partial deficiency: FDA states evidence is insufficient to recommend a dosage. Kept separate from capecitabine. |
| Oncology | UGT1A1 + irinotecan | Distinguishes intermediate from poor metabolizers; captures higher SN-38 exposure/toxicity and the current CERSI-PGx poor-metabolizer first-cycle guidance. |
| Cardiovascular | CYP2C19 + clopidogrel | Reduced active-metabolite formation and antiplatelet response in intermediate/poor metabolizers; alternative P2Y12 inhibitor may be considered. |
| Cardiovascular | CYP2D6 + propafenone + CYP3A4 inhibitor | A three-factor avoid-use situation; not a blanket rule for CYP2D6 poor metabolizers alone. |
| Anesthesia | BCHE + succinylcholine | Prolonged neuromuscular blockade; FDA wording distinguishes poor from intermediate metabolizers. |
| Anesthesia | RYR1/CACNA1S + trigger agents | FDA-listed contraindication applies to desflurane, isoflurane, sevoflurane and succinylcholine in known/suspected susceptibility. |
| Neurotherapeutics | APOE ε4/ε4 + lecanemab | Higher ARIA risk; use benefit–risk framing rather than calling genotype an automatic contraindication. |
| Neurotherapeutics | APOE ε4/ε4 + donanemab | Separate drug-specific ARIA risk record; same benefit–risk boundary. |
| Dermatology | CYP2C9 poor metabolizer + deuruxolitinib | FDA-listed contraindication in poor metabolizers; do not extend it to intermediate metabolizers. |

## Source and currency notes

1. **FDA Table of Pharmacogenetic Associations** — current page checked 2026-11-20; update history lists September 10, 2026. Source: https://www.fda.gov/medical-devices/precision-medicine/table-pharmacogenetic-associations . FDA-authored U.S. government material; the builder checks the public-domain licensing basis and exact passage text.
2. **CERSI-PGx UGT1A1/irinotecan guideline** — published online July 2, 2026, issue date September 2026. Source: https://pmc.ncbi.nlm.nih.gov/articles/PMC13519796/ . Open access under CC BY 4.0. It recommends a 30% Cycle 1 reduction for poor metabolizers with subsequent titration based on tolerability and neutrophil counts; it states that evidence is insufficient for recommendations in rare malignancies such as sarcomas.

The FDA table itself cautions that table inclusion does not necessarily mandate pre-prescription testing and does not provide comprehensive prescribing information. Refer to current product labeling and indication-specific guidelines for the full treatment decision. The entries do not infer universal testing mandates.

## Required clinician review before production approval

For each record, the reviewer must check:

- The full claim is supported by the linked source passages, not merely by matching terminology.
- The gene, phenotype, drug and any combined interaction are stated exactly and are not generalized to another drug or phenotype.
- Applicability and exceptions match current labeling and guidance for the relevant indication, formulation and population.
- The record's source date and review-by date remain current.

Only the actual reviewer may populate `approval.reviewer` and `approval.reviewedAt`, then set the three required checks (`claimSupport`, `clinicalAccuracy`, `scopeAndExceptions`) to true. The build process does not create clinical approval.

## Evaluation status

The new entries are built and tested for schema, source references, quote provenance, lazy loading, draft exclusion and retrieval relevance after approval in an isolated test fixture. No live Gemini A/B benchmark was run, so this release makes no claim that the new library measurably improves model accuracy. Run a paired benchmark only after a human reviewer has approved the selected records and the current Gemini API key is stored locally in an environment variable (never commit it or include it in a report).
