## v3.54.0 — VA-ECMO / TAAA Root-Cause Regression

This release fixes two general validation defects surfaced by the latest ECMO case:

- **Measurement identity:** values from the right radial artery, lower-extremity arterial territory, and post-oxygenator blood gas retain their site/sample qualifiers. A MAP or pH difference between distinct sites/samples is not automatically reported as a duplicate conflict; repeated values from the same site remain reviewable.
- **Domain leakage across answer choices:** the mention of CRRT in one distractor and 5% albumin in another no longer activates the drug-binding/CRRT infusion-rate calculator. Explicit protein-binding/PK language is still required.
- **ECMO and aortic-surgery safety checks:** differential hypoxaemia, LV distension, ACS, bloody lumbar CSF on bivalirudin/coagulopathy, spinal rescue MAP/oxygen delivery, dampened pressure-waveform validation, drainage-line chatter, non-pulsatile toe pulse-oximetry limitations, hyperkalaemia/rhabdomyolysis, limb perfusion, and bivalirudin/protamine are covered by targeted regression rules.
- **Answer assessment:** option B is flagged as the closest exam option, but a version of B that recommends unqualified flushing of the bloody lumbar drain is not cleared as fully safe.

See [the complete case and evidence audit](docs/ROOT_CAUSE_ECMO_TAAA_v3.54.0.md) and [the test/build record](docs/TEST_RESULTS_v3.54.0.md). Automated tests are not medical validation; no live Gemini A/B or clinical sign-off is claimed.

---

## v3.53.0 — Root-Cause Clinical Safety Layer

This release addresses cross-cutting failure paths found in the v3.52.0 code review, rather than simply adding more medical knowledge or prompt warnings.

- **Fail-closed clinical validation:** validator exceptions do not release unchecked exam answers; question explanations/options are withheld while streaming and evaluated only after final checks.
- **Visual source-reading first:** image/scanned-PDF questions receive a separate model transcription before solving; unclear values must remain `[unclear]`. This is not a separate OCR engine or human verification.
- **Data-integrity controls:** repeated measurements are preserved, conflicting values block calculations, labelled extraction captures repeated values, and Arabic/Persian numerals are normalized.
- **Claim-specific source mapping:** a trusted URL cannot be attached to unrelated claims merely because it appears elsewhere in the response.
- **Patient-specific high-risk checks:** partial HScore handling; non-specific fungal biomarkers; negative serum galactomannan in SOT; tacrolimus level/AKI and voriconazole interaction; TMP-SMX in hyperkalaemia/renal dysfunction; biopsy risk under hypoxaemia/coagulopathy; stress-dose hydrocortisone indication (documented septic shock/adrenal indication).

See [the full v3.53.0 root-cause report](docs/ROOT_CAUSE_SAFETY_v3.53.0.md). Passing unit tests is not clinical validation. No live Gemini A/B comparison or successful Vite production build was claimed in that release.

---

