# Specialized Pharmacogenomics Pilot — Review and Evaluation

**Pilot:** `specialized-pharmacogenomics-pilot-2026-09`  
**Primary source:** U.S. FDA, [Table of Pharmacogenetic Associations](https://www.fda.gov/medical-devices/precision-medicine/table-pharmacogenetic-associations)  
**Source currency checked:** 2026-11-20; FDA page's update history lists 2026-09-10.  
**Current library state:** 7 draft entries; none is approved for student-answer retrieval.

## Why this is a useful first batch

This is deliberately not a pharmacology textbook summary. It captures high-value distinctions that a generic answer can easily flatten:

1. FDA pharmacogenetic evidence tiers are not interchangeable.
2. A table listing alone is not a universal pre-prescription testing mandate.
3. Aficamten is a concrete exception: the titration/monitoring schedule accounts for CYP2C9 variation, so the table says a genotype-based adjustment is not necessary.
4. MT-RNR1 m.1555A>G is linked to aminoglycoside-associated ototoxicity.
5. TPMT and NUDT15 must be interpreted jointly for azathioprine-associated myelosuppression risk.
6. HLA-B*57:01/abacavir and HLA-B*15:02/carbamazepine must not be conflated; the latter's FDA wording includes a benefit-risk exception and continued clinical vigilance.

## Human clinical approval required

The entries are intentionally `approval.status: "draft"`. Source identity, page URL, source type, license basis and verbatim quote provenance were checked by the builder; that is **not** a clinical approval. A qualified human reviewer must independently confirm each exact claim, source support, applicability and exceptions before changing an entry to `approved`.

For each entry, the reviewer must:

- Confirm that the cited FDA passage supports the complete statement, not merely overlapping words.
- Confirm clinical accuracy and that no statement extends beyond the FDA table's wording.
- Check applicability, variant specificity, drug specificity, and every listed exception.
- Check whether the source has changed since the recorded version date.
- Enter their real name and review date in `approval`, and set all three checks to `true` only after review.

Do not invent reviewer identities or mark a record approved to make it appear in production. Until approved, entries are loaded for internal review but are excluded by production retrieval.

## Paired Gemini benchmark

The benchmark asks each fixed question twice using the same selected model and generation settings:

- **Baseline:** no specialized entries.
- **Enriched:** the same prompt plus only the relevant draft entries.

Call order alternates between cases. Outputs are written as blinded A/B pairs, with the condition key in a separate file. No reference answer is supplied to Gemini. This reduces prompt leakage and makes human comparison easier.

Run:

```bash
GEMINI_API_KEY=YOUR_KEY GEMINI_MODEL=gemini-flash-latest npm run kb:pilot
```

The script makes 14 Gemini calls for 7 cases. The API key is read only from the environment; it is not written to files. Prepare prompts without making API calls:

```bash
npm run kb:pilot:prepare
```

## Blinded scoring rubric

Score A and B independently before opening the condition key. Use 0, 1 or 2 for each dimension:

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Factual correctness | Incorrect / materially misleading | Partly correct, key nuance missing | Correct on all material points |
| Specialist nuance | Misses the key distinction | Mentions it incompletely | Applies the exact distinction and its limits |
| Evidence discipline | Invents facts or overstates the source | Minor unsupported extension | No unsupported claims; scope is respected |
| Explanation quality | Confusing or contradictory | Understandable but incomplete | Clear, concise and useful for a student |

Maximum: 8 per answer. Record material errors separately; one dangerous false claim outweighs a stylistic improvement.

**Decision rule:** do not accept the library merely because enriched prose is longer or sounds more expert. Keep an entry only if a clinical reviewer confirms it and the paired results show a meaningful accuracy or nuance gain without adding unsupported claims. If baseline is already correct and complete, remove or narrow the entry rather than keeping it for volume.

## Benchmark cases and expected review points

See `tests/fixtures/specialized-pharmacogenomics-pilot.json`. Its `rubric` and `mustNotClaim` fields are evaluation-only and are not sent to Gemini.
