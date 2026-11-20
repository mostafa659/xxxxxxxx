# ClinixStudy v3.50.0 — Fourth major specialist expansion

## Scope and size

This is the largest specialist-library expansion shipped in this project so far: **24 new, focused entries**, bringing the bundled specialist corpus from **22 to 46 records**. The batch was constructed around previously observed model failure families: inappropriate dose aggregation, atypical toxicity presentations, mechanistic overreach, species crossover, assay-to-clinic extrapolation, and fixed-dose claims from drug-interaction pathways.

The 24 entries are divided into four domains:

- **Dental anaesthesia / local-anaesthetic systemic toxicity (11 entries):** additive amide toxicity; fractional-dose calculation; third-agent and vasoconstrictor accounting; source/jurisdiction differences in maximum recommended doses; atypical and delayed LAST; differential from vasovagal and adrenaline reactions; sedation-masked neurologic prodrome; protein-binding risk; bupivacaine/CCB pharmacodynamic interaction; airway and oxygenation priority with ILE as rescue.
- **FH-deficient renal cell carcinoma / HLRCC (7 entries):** hereditary versus sporadic distinction; HLRCC terminology boundary; fumarate–PHD–HIF pseudohypoxia; broader α-KG-dependent dioxygenase effects; non-specificity of fumarate accumulation; limits of morphology alone; KEAP1–NRF2 signalling.
- **Veterinary MDR1 / ABCB1 (4 entries):** species-specific canine/feline deletion variants; cohort-specific feline allele frequency; loss of transporter efflux in mutant constructs; the boundary between in-vitro transporter inhibition and clinical dose/toxicity decisions.
- **Warfarin precision pharmacology (2 entries):** patient-specific interaction magnitude and pharmacogenetic algorithms incorporating clinical covariates.

## Sources and provenance

Every entry is derived from one or more of four peer-reviewed sources whose source pages declare CC BY 4.0. The manifest records attribution and the exact passage snippets. The builder verifies that each stored quotation is present verbatim in its passage and that the declared source licence is in the application's approved bundleable set.

The builder's verification is **provenance verification only**. It does not establish that the medical interpretation is correct, that the source passage fully supports the whole statement, or that the exception list is exhaustive. Each record remains unapproved until a named qualified clinician/specialist independently checks claim support, clinical accuracy, applicability, and exceptions.

## Deliberate limits

- No universal local-anaesthetic maximum dose is supplied: the reviewed source documents meaningful disagreement between product information and prescribing references. The entry requires the applicable agent, formulation, patient context, jurisdiction, and source to be identified.
- The fractional-dose rule is described as a safety heuristic with pharmacokinetic limitations, not a guarantee that toxicity cannot occur.
- The 30-minute post-injection vigilance statement is attributed to the cited dental review and must not be silently represented as a universal protocol for all settings.
- Fumarate accumulation or a plausible HIF/NRF2 mechanism is not proof of hereditary HLRCC, a specific tumour morphology, or a germline variant.
- The feline MDR1 frequency is limited to the studied German veterinary-clinic cohort; it is not a worldwide prevalence estimate. Canine and feline variants are not interchangeable.
- MDR1 inhibitor concentrations measured in cell systems are not clinical dose or toxicity thresholds.
- Warfarin pathway or pharmacogenetic information does not independently prescribe an interaction-specific dose change or replace INR-guided clinical management.

## AI-error regression coverage

Eight new failure-family rows were added to `knowledge/specialized/error-driven/ai-error-regression-matrix.json`. They cover combined local-anaesthetic dose additivity, non-classic/sedation-masked LAST, hereditary diagnosis overreach in FH-deficient tumours, invented histology, dog/cat ABCB1 mutation transfer, in-vitro IC50 extrapolation, universal warfarin dose percentages, and genotype-only warfarin dosing.

The answer prompt now explicitly requires the original case to remain the sole source of patient-specific findings, forbids invented measurements and history, separates literature/cohort/in-vitro facts from the current patient, requires supplied inputs and units for calculations, and blocks unsupported mechanism-to-diagnosis, assay-to-dose, or species-to-species extrapolation.

## Release state

All 24 new entries are shipped as `draft`. The registry loads them for internal review, but normal retrieval excludes every draft. Automated tests use synthetic approval fixtures solely to test retrieval behaviour; those fixtures are not medical approvals. No Gemini A/B improvement is claimed. Vite production build and Android packaging were not run in this environment because project dependencies are not installed.
