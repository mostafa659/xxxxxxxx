import test from "node:test";
import assert from "node:assert/strict";
import {
  CLINICAL_QUALITY_INSTRUCTION,
  CLINICAL_QUALITY_VERSION,
  isHealthDomainContext,
  classifyHealthIntent,
  auditClinicalQuality,
  formatClinicalQualityAudit,
  formatGroundingSources,
} from "../src/lib/clinical-quality.js";
import { FACT_RULE } from "../src/lib/guard.js";
import { isPotentialClinicalContext } from "../src/lib/clinical-safety.js";

const grounded = [{ url: "https://www.who.int/example", title: "WHO clinical guidance" }];

test("health-domain routing covers broad clinical and public-health domains", () => {
  for (const s of [
    "How should major depressive disorder be evaluated?",
    "Is this ECG consistent with atrial fibrillation?",
    "Antibiotic stewardship and antimicrobial resistance in hospitals",
    "Pregnancy and lactation medication safety",
    "Dental caries and periodontal disease management",
    "Veterinary dose of an antibiotic in a dog",
    "Public health screening and vaccine effectiveness",
    "ما أسباب الاكتئاب والقلق؟",
    "تفسير تحليل الغدة الدرقية والسكري",
    "جرعة دواء لطفل حديث الولادة",
  ]) assert.equal(isHealthDomainContext(s), true, s);
  assert.equal(isPotentialClinicalContext("What is the best way to organize a study desk?"), false);
});

test("health intent classification separates urgent care, medication and calculation tasks", () => {
  const intents = classifyHealthIntent("Emergency: what dose of insulin should I give now? Calculate mg/kg.");
  assert.ok(intents.includes("patient-care-or-urgent"));
  assert.ok(intents.includes("medication-or-dose"));
  assert.ok(intents.includes("calculation-or-interpretation"));
});

test("the universal protocol explicitly requires disconfirmation and calibrated uncertainty", () => {
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /actively search for evidence against the leading answer/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /Separate current, historical\/baseline, target, reference interval/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /Do not claim 100%/i);
  assert.match(CLINICAL_QUALITY_INSTRUCTION, /patient goals\/preferences/i);
  assert.match(FACT_RULE, /do not anchor on an early answer/i);
  assert.match(FACT_RULE, /actively search for facts that could disconfirm/i);
  assert.doesNotMatch(FACT_RULE, /make every sentence agree with it|never change your mind/i);
});

test("absolute clinical certainty triggers a general advisory, not an automatic block", () => {
  const a = auditClinicalQuality({
    caseText: "A patient with chest pain and a positive troponin test.",
    answerText: "This result proves myocardial infarction with 100% certainty.",
  });
  assert.equal(a.triggered, true);
  assert.equal(a.status, "review");
  assert.ok(a.advisories.some((x) => x.code === "absolute-language-needs-qualification"));
  assert.ok(a.advisories.some((x) => x.code === "single-test-diagnostic-overclaim-review"));
  assert.equal(a.version, CLINICAL_QUALITY_VERSION);
});

test("current guideline claims without source links trigger a source-review advisory", () => {
  const a = auditClinicalQuality({
    caseText: "A patient with hypertension.",
    answerText: "The latest recommended first-line treatment is to start drug therapy.",
    searchPerformed: true,
    sources: [],
  });
  assert.ok(a.advisories.some((x) => x.code === "time-sensitive-claim-not-currently-grounded"));
  assert.ok(a.advisories.some((x) => x.code === "high-impact-plan-needs-source-check"));
});

test("dose and procedure recommendations trigger patient-context and safety checks", () => {
  const a = auditClinicalQuality({
    caseText: "A 4-year-old child with renal impairment and a penicillin allergy.",
    answerText: "Start amoxicillin 500 mg. Perform surgery immediately.",
  });
  assert.ok(a.advisories.some((x) => x.code === "dose-instruction-incomplete"));
  assert.ok(a.advisories.some((x) => x.code === "medication-safety-screen-not-visible"));
  assert.ok(a.advisories.some((x) => x.code === "special-population-applicability-not-addressed"));
  assert.ok(a.advisories.some((x) => x.code === "management-plan-tradeoffs-not-visible"));
});

test("a cited link is not treated as proof that all claims are supported", () => {
  const a = auditClinicalQuality({
    caseText: "Patient with diabetes.",
    answerText: "The latest guideline says start treatment.",
    sources: grounded,
    searchPerformed: true,
  });
  assert.equal(a.sourcesFound, 1);
  assert.ok(a.disclaimer.includes("not proof"));
  assert.equal(a.advisories.some((x) => x.code === "time-sensitive-claim-not-currently-grounded"), false);
});

test("source formatter includes grounding URLs and states the limitation of search hits", () => {
  const out = formatGroundingSources(grounded, ["WHO recommendations for diabetes"]);
  assert.match(out, /https:\/\/www\.who\.int\/example/);
  assert.match(out, /WHO recommendations for diabetes/);
  assert.match(out, /does not mean it supports every claim|لا يعني أنه يدعم كل ادعاء/);
  assert.equal(formatGroundingSources([], []), "");
});

test("plain educational content outside healthcare does not trigger the clinical checker", () => {
  const a = auditClinicalQuality({ caseText: "A physics exam about acceleration.", answerText: "The answer is 9.8 m/s²." });
  assert.equal(a.triggered, false);
  assert.equal(a.status, "not-applicable");
});
