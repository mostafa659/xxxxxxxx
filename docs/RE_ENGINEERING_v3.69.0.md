# ClinixStudy v3.69.0 — Same quality contract, one request

## 1. Findings that changed the design
| Finding | Source | Consequence |
|---|---|---|
| Free key (Oct 2026): Pro models 0 requests/day; a Flash model ≈ 5/min and 20/day; Flash-Lite 15/min, 500/day. Limits change without notice. | AI Studio snapshots reported by imisofts.com (21 Oct 2026) and DEV posts (7 and 25 Oct 2026); older articles disagree | v3.68 (1 ledger + 4 writers + repair, "pro" tier) was not slow on a free key, it was impossible: ≈ 30 % of a day's Flash quota per case, and the Pro lane has no quota |
| Gemini 3 Flash: 65,536 max output; `thinking_level` minimal/low/medium/high; thinking tokens are billed with output | Google AI docs | A 10-task answer (~7k tokens) fits one request; the model's own thinking replaces the "ledger" request |
| JSON mode / strict schema lowers reasoning accuracy | Tam et al., EMNLP-Industry 2024 | Loose text markers (`@@2.3@@`), not `responseSchema` |
| Cascades (cheap first, escalate on failure) cut cost up to 98 % at equal accuracy **when the accept/reject checker is informative** | Chen, Zaharia, Zou, FrugalGPT 2023 | Escalate only on code-detected defects. Our checker is informative for coverage, weak for correctness — stated below |
| Self-inflicted: v3.68 widened `PROSE_TASK`, which silently turned the proofreader (≤ 3 requests/answer on a big key) on for every main lesson | `gemini.js` gating | Fixed: `PROOF_TASK` keeps the v3.40 scope; contract tasks pass `proof:false` |

## 2. Design: spend a request only on what code cannot do
| Step | v3.68 | v3.69 |
|---|---|---|
| Analysis of the case | separate "ledger" request (strong, 16k thinking) | the model's own thinking inside the single request |
| Writing | 4 parallel strong writers, each re-reading source + anchors + ledger | **1** request, answers an **item-addressed skeleton** |
| Headings, item labels, requirement text | written by the model | **written by code** (fewer output tokens, cannot drift) |
| Completeness | lexical per task | **per item**: present, floor length, matrix fields named, word limit, "at least N" list length |
| Repair | one request, whole missing tasks | **≤ 1 batched request, only defective items** + flagged-trap items + unverified-citation items, with one-line context of the rest |
| Reasoning traps / citations | advisory text | same detectors **locate the item**, so the same single repair fixes them; unverified citations are marked in place |
| References | none | deterministic section: only retrieved anchors, with the links actually opened |
| Repeat of the same case | full price | **0 requests** (items cached; every audit and the trust pass re-run on cached content). *Retry* bypasses the cache |
| Request broke half-way | answer lost | already-streamed text is parsed; only the rest is repaired |
| Model lane | pro-first, Flash-Lite last | `auto`: big key → strong first, small key → Flash first; lightest model last and disclosed |
| Medical search grounding | attached to the ledger | off on this path (anchors are the verified set; free-tier grounding quota is separate and small) |

Request count (generative, excluding the cheap word-list request):
| Scenario | v3.68 | v3.69 |
|---|---:|---:|
| Clean answer | 5 (1 ledger + 4 writers) | **1** |
| Some items defective | 6 | **2** |
| Same case again | 5 | **0** |
| Free key, Flash 20/day | 1 case ≈ 25–30 % of the day | 1 case ≈ 5 % (10 % with repair) |

## 3. Evidence
`npm test`: **601 / 601** (593 + 8 new in `v369-one-request.test.mjs`, 4 rewritten); `npm run build` OK.
Tests assert the request counts through the real `createAnalysis` with a mocked model: 1 on the clean path, 2 with defects (and only the defective keys are in the repair prompt), 0 on a cache hit, honest notice + no caching when the repair does not close the gap, partial text reused. Also: item model (38 items: matrix rows with fields, 100-word limit on item 1.1, "at least 10" on 9.1), citation audit, references, proofreader scope.

## 4. Limits — read before trusting
1. **Not measured on the real model.** Quality of live Gemini output with one pass (vs v3.68's split) is unknown. Run `GEMINI_API_KEY=… node --import ./tests/register.mjs scripts/contract-bench.mjs`, grade the output with the rubric, and compare `CONTRACT` settings (`levels`, `tier`, `wordsBudget`). The expected risk of a single pass is shallower late items; the item audit + one repair is the mitigation, not a guarantee.
2. The audit is **lexical**: it proves presence, length, named fields, limits and list size; it cannot prove correctness. A fluent, complete, wrong item passes. The trap/citation detectors are narrow patterns; anchors are a hand-written set (9 entries); entries marked `verify` were only partly confirmed.
3. Citation audit proves a reference is *in the verified set*, not that it supports the sentence.
4. Free-tier numbers are snapshots from third-party posts that disagree on detail; the app's own 429 handling remains the source of truth for a given key.
5. Wait time is still the single request's generation time (thinking + ~7k output tokens): likely tens of seconds to a few minutes, not measured. Showing partial sections earlier would need a UI change and a "provisional" label (the app deliberately hides clinical answers until the gates run); not done.
6. Not done: deterministic score calculators (e.g. PLASMIC) in code; more anchors; a live A/B of thinking levels.
