# Golden sets

`accuracy/seeded.json` — seeded errors the accuracy layer must patch, remove or label (used by tests/accuracy.test.mjs).

`questions/<profile>/*.json` — calibration sets, ≥300 questions per profile with verified keys (≥50 multi-select / vignette / multi-part where the exam has them),
taken ONLY from openly licensed sources or the owner's own human-verified items. Never copy a proprietary bank. Item shape:

    { "id": "...", "profile": "nursing/nclex-rn", "format": "mcq|sata|matrix|...", "stem": "...", "options": {"A": "..."}, "key": ["B"],
      "source": { "name": "...", "license": "...", "url": "..." }, "verifiedBy": "human reviewer id", "verifiedAt": "YYYY-MM-DD" }

**v3.43 ships NO calibrated profile.** `_synthetic/` holds a few made-up items that only exercise the harness; they are not calibration data.
Run the solve request over a set, write `[{id,p1,margin,correct}]`, then `node scripts/calibrate.mjs <profile> results.json`.
