# ClinixStudy v3.63.0 — Root-Cause Review: TrustPanel Supplementary-Content Bypass

## Triggering evidence

The v3.62.0 live retest correctly detected that the model reported anion gap 129 mmol/L while application arithmetic from extracted values gave 21 mmol/L. The main generated explanation was withheld and the deterministic audit was displayed. However, the UI still showed AI-generated analogies and a memory aid. One analogy included a blanket instruction to stop several medicines immediately.

## Confirmed root cause

The clinical synthesis gate in `src/lib/analysis.js` replaced the main explanation and cleared the `tricks` field. But the final trust payload was built separately and unconditionally included:

- `analogies` extracted from the generated explanation and tricks;
- `memoAids` extracted from those same generated sections;
- reference cards, patches, conflicts, and developer-visible sentence items.

`src/components/TrustPanel.jsx` rendered the analogies and memory aids from this separate payload. Therefore those generated claims bypassed the main explanation gate. This is confirmed by the v3.62.0 source and matches the submitted output; it is not merely a speculative model prompt issue.

## v3.63.0 changes

1. Added `filterTrustForBlockedClinicalSynthesis()` as a fail-closed filter for the trust payload.
2. When a critical clinical synthesis gate is active, remove cards, source/reference conflict text, analogies, memory aids, patches, sentence items, and stripped generated snippets from the student-facing trust payload.
3. Keep the safety banner and aggregate diagnostic counters. The separate source-reading display and deterministic arithmetic/conflict report remain available.
4. Added `clinicalSynthesisBlocked` to the final trust payload so the rendering layer knows the main clinical synthesis is withheld.
5. Added a second defensive check in `lessonView()` and in developer-mode TrustPanel item rendering, so supplementary AI claims cannot reappear through an alternate presentation path.
6. Kept the calculation and clinical safety gates unchanged. This patch does not bypass validation or convert the model's 129 into an accepted result.

## Tests

- `npm test`: **526 passed, 0 failed, 0 skipped**.
- Added tests proving blocked trust payloads contain no cards, analogies, memory aids, patches, items, conflicts, or stripped snippets.
- Added a source-level regression test verifying `analysis.js` marks the payload and applies the filter before `onTrust` emission.

## Build and validation limitations

- `npm run build`: not completed because Vite is not installed in this environment (`sh: 1: vite: not found`, exit 127).
- No direct Gemini execution was performed on v3.63.0.
- No production deployment or human clinical validation was performed.
- The patch closes the identified supplementary-content bypass; it does not establish medical accuracy or guarantee that future, unrelated output paths cannot contain defects.
