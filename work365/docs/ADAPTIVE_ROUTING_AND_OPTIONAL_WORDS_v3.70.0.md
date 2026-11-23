# ClinixStudy v3.70.0 — Adaptive difficulty router + optional new-words list

## What the student sees
* **Mode picker**: a new first option **تلقائي** (default for anyone who never chose; a saved manual choice is kept). A small Gemini model reads the question and says easy / medium / hard; a line under the picker shows what it chose (and whether it was raised for safety, deepened by *Retry*, or estimated locally because the model did not answer).
* **الكلمات الجديدة** is a switch, **off by default**. Off = no words card, no words step in the progress lamps, **no word-list request**. Turning it on restores today's behaviour. A saved question that already has words still shows them.

## How the router decides (lib/difficulty.js, analysis.js)
| Step | Cost |
|---|---|
| Source prescribes numbered tasks → already "hard" by structure → one-request contract path | **0** router requests |
| Cached verdict for the same question | **0** |
| Otherwise ONE tiny request to the lightest Gemini lane (≈ 60 output tokens, no thinking, 8 s box); the model sees the same text / image / PDF as the writers and does not answer it | 1 request on the Flash-Lite quota |
| Model silent / garbage / error | **fails open** to a free rule-based estimate (never blocks the answer); an image with no text and no verdict is treated as medium, not easy |
| Safety floor | rules say hard + model says easy → medium; any detected calculation / dosing ≥ medium; the model may always go UP; the prompt says "when unsure choose the higher" |
| *Retry* on an auto-routed answer | one level deeper, reusing the cached verdict (no second classification) |

Levels → presets: **easy → `light`** (no silent solve: part A + one writer that solves by itself, shorter parts) · **medium → `balanced`** (unchanged) · **hard → `deep`**, but on a small/free key **`deepflash`** (Flash with high thinking, because that key's strong lane has no quota and a request to it would only 429) · contract source → the v3.69 one-request path.

## Request arithmetic (mocked pipeline, small key, words ON → OFF)
| Level | router | part A | solve | writer(s) | words | total | on the Flash lane (20/day on a free key) |
|---|---:|---:|---:|---:|---:|---:|---:|
| easy | 1 (Lite) | 1 | 0 | 1 | 1 (Lite) / 0 | 4 / **3** | **2** (was 3) |
| medium | 1 (Lite) | 1 | 1 | 1 | 1 / 0 | 5 / **4** | 3 (same) |
| hard (small key) | 1 (Lite) | 1 | 1 (Flash, high thinking) | 1 | 1 / 0 | 5 / **4** | 3 (deeper thinking) |

Honest reading: the router does **not** reduce the total number of requests (its own request cancels the easy-question saving). What it saves is the **scarce quota**: easy questions use one fewer Flash request, the router and the words list run on the much larger Flash-Lite quota, and a hard question gets deeper thinking instead of a doomed strong-lane request. Turning words off saves one Lite request per question.

## Verified
`npm test` **619/619** (601 + 18 new in `v370-adaptive.test.mjs`; two existing source-text/budget tests were updated on purpose: hidden presets are allowed and stay inside the deep caps, and `runBatch` now forwards `withWords`). `npm run build` OK.
New tests cover: rule estimates, verdict parsing (JSON, fenced, loose, garbage), the safety floor, presets, cache, optional-words config, and end-to-end runs through the real pipeline: easy/medium/hard routing, the floor, fail-open on a broken or garbage router, contract source = zero router requests, retry deepens without a new classification, words off = no word request and no words update, manual mode = no router request.

## Limits
1. **The classifier's accuracy is unmeasured.** The tests prove the plumbing and the safety rules, not that Gemini-Lite rates real questions well. Measure it: run 30–50 of your own questions, compare its level with yours, and tune the rubric in `buildDifficultyPrompt()` and the thresholds in `heuristicLevel()`.
2. A mis-rated *easy* is the costly error (shallower answer). The floor and "choose the higher" reduce it, they do not remove it; *Retry* is the escape (it goes one level up).
3. The `light` preset (no silent solve) has not been compared with `balanced` for answer quality on real easy questions.
4. The router is skipped for study material (lessons) and in batch mode it reads each question separately (one extra Lite request each).
5. Free-tier limits are third-party snapshots (Oct 2026); the app's own 429 handling remains authoritative.
6. UI was built and compiled but **not run in a browser**; check the mode picker, the route line and the words switch by eye.
