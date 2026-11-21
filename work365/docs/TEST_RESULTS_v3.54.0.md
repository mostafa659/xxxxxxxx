# ClinixStudy v3.54.0 — verification record

Date: 20 November 2026

## Automated tests

- Previous v3.53.0 baseline recorded in the project history: 471 tests.
- v3.54.0 focused calculation + clinical-safety regression suite: **63/63 passed**, 0 failed.
- v3.54.0 complete project suite (`npm test`): **476/476 passed**, 0 failed.
- The additional regressions cover site/sample-qualified ECMO measurements, true same-site conflicts, false PK activation across distractors, non-pulsatile distal oximetry, dampened CSF waveform validation, spinal-cord oxygen delivery, bloody neuraxial drain handling during bivalirudin/coagulopathy, ECMO chatter, and LV unloading modality/access distinctions.

## Production build

- `npm run build` was attempted. It did **not** complete: the shell reports `vite: not found` (exit status 127).
- `node_modules` / the Vite executable are not present in this environment. Therefore no production bundle or browser/runtime smoke test is claimed.
- ZIP archive integrity is checked separately after packaging.

## External and clinical validation

- No live Gemini API call, no before/after A/B comparison, and no blinded model evaluation were performed.
- No clinician sign-off was obtained.
- The rules are deterministic guardrails and regression checks, not a validated clinical decision-support device. Passing tests means only that the tested code paths behaved as specified.
- The supplied case is educational/synthetic; it is not a protocol for managing a real patient.
