/* v3.46 · the SPECIALIZED knowledge layer. Every fixture here is FICTIONAL (a made-up country, drug and council): no real medical fact is added by this task.
   Covers: accepted entries, generic entries rejected, missing / bad evidence, scope mismatches, outdated entries, retrieval relevance, and the separation from the general safety layer. */
import test from "node:test";
import assert from "node:assert/strict";
import * as KB from "../src/lib/kb/index.js";
import * as T from "../src/lib/trust.js";
import { buildSpecialized } from "../scripts/build-kb.mjs";
import * as SP from "../src/lib/kb/specialized.js";

const NOW = Date.parse("2026-11-20");
const GEN = { discipline: "general", exam: "", region: "" };
const RU_NURSE = { discipline: "nursing", exam: "", region: "RU" };

const manifest = {
  sources: [
    { id: "s-notice", url: "https://example.invalid/ruritania/notice-12", license: "CC0", licenseVerified: true, attribution: "Fictional Ruritania Nursing Council", type: "regulator-notice",
      passages: [
        { id: "p1", text: "Under Ruritania Nursing Council notice 12, a registered nurse in Ruritania may start a zorbitol infusion above 40 mL per hour only after a second-nurse check. The check must be documented on the infusion chart." },
        { id: "p2", text: "The second-nurse check is not required for zorbitol infusions given in the resuscitation room of a Ruritania hospital." },
      ] },
    { id: "s-blueprint", url: "https://example.invalid/exams/xnle-blueprint", license: "CC0", licenseVerified: true, type: "exam-blueprint",
      passages: [{ id: "p1", text: "XNLE candidates are scored on the first-line escalation step; the XNLE rubric awards credit only when the escalation is documented before the reassessment." }] },
    { id: "s-textbook", url: "https://example.invalid/textbook", license: "CC0", licenseVerified: true, type: "textbook",
      passages: [{ id: "p1", text: "The zorbitol infusion above 40 mL per hour needs a second-nurse check in Ruritania according to this textbook." }] },
    { id: "s-untyped", url: "https://example.invalid/untyped", license: "CC0", licenseVerified: true,
      passages: [{ id: "p1", text: "The zorbitol infusion above 40 mL per hour needs a second-nurse check in Ruritania." }] },
    { id: "s-nc", url: "https://example.invalid/nc", license: "CC BY-NC 4.0", licenseVerified: true, type: "guideline",
      passages: [{ id: "p1", text: "The zorbitol infusion above 40 mL per hour needs a second-nurse check in Ruritania." }] },
  ],
};

const base = () => ({
  id: "ru-zorbitol-second-check",
  title: "Zorbitol infusion second-nurse check (Ruritania)",
  kind: "local-practice",
  statement: "In Ruritania, a zorbitol infusion above 40 mL per hour requires a documented second-nurse check before the nurse starts it.",
  aliases: { en: ["zorbitol infusion", "second-nurse check"], ar: [] },
  value: {
    category: "jurisdiction-specific",
    beyondGeneral: "The second-nurse threshold is set by the national council notice, not by general pharmacology; a general answer gives the textbook rate and omits the local rule.",
    generalAnswerRisk: "A general answer would say one nurse may start the infusion at any rate.",
  },
  clinical: { scope: "Starting a zorbitol infusion on an adult ward in Ruritania" },
  scope: { discipline: ["nursing"], exam: [], jurisdiction: "RU" },
  applicability: { conditions: ["The infusion rate is above 40 mL per hour", "The nurse is registered in Ruritania"] },
  exceptions: [{ when: "The infusion is given in the resuscitation room", effect: "The second-nurse check is not required" }],
  evidence: [{ sourceId: "s-notice", passageId: "p1", quote: "may start a zorbitol infusion above 40 mL per hour only after a second-nurse check" }],
  approval: { status: "approved", reviewer: "fixture-reviewer", reviewedAt: "2026-10-01", checks: { claimSupport: true, clinicalAccuracy: true, scopeAndExceptions: true } },
  version: "Notice 12 (fictional)", reviewBy: "2028-01-01",
});
const build = (over, opts) => buildSpecialized(manifest, [typeof over === "function" ? over(base()) : { ...base(), ...over }], { today: "2026-11-20", ...(opts || {}) });
const reasonOf = (r) => (r.rejected[0] || {}).reason || "";
/* a built, valid entry to register */
const good = (over = {}) => { const r = build(over); assert.equal(r.rejected.length, 0, JSON.stringify(r.rejected)); return r.accepted[0]; };

test.beforeEach(() => SP.__resetSpecialized());

/* ───────── accepted ───────── */
test("an entry with value, scope, applicability, exceptions, verified evidence and approval is accepted, and the builder resolves its evidence", () => {
  const r = build({});
  assert.equal(r.rejected.length, 0, JSON.stringify(r.rejected));
  const e = r.accepted[0];
  assert.equal(e.evidence[0].verified, true); assert.equal(e.evidence[0].sourceVerified, true); assert.equal(e.evidence[0].quoteVerified, true);
  assert.equal(e.evidence[0].type, "regulator-notice"); assert.equal(e.evidence[0].url, "https://example.invalid/ruritania/notice-12");
  assert.equal(e.checkedAt, "2026-11-20");
  assert.deepEqual(SP.validateSpecialized(e), []);
  assert.deepEqual(SP.specificityAnchors(e), ["jurisdiction"]);
});

test("an exam-specific entry with no jurisdiction is accepted (the exam is its specificity anchor); «no exceptions» needs a stated reason", () => {
  const exam = (o) => ({ ...base(), id: "xnle-escalation", title: "XNLE escalation documentation credit", kind: "exam-format",
    statement: "The XNLE rubric awards credit for the first-line escalation only when it is documented before the reassessment.",
    aliases: { en: ["XNLE rubric", "escalation documentation"], ar: [] },
    value: { category: "exam-specific", beyondGeneral: "Scoring order is a property of this exam's rubric, not of clinical practice, so a general answer cannot know which step earns credit.", generalAnswerRisk: "A general answer would describe the clinically sensible order without the scoring rule." },
    clinical: { scope: "Answering XNLE escalation items under timed conditions" },
    scope: { discipline: ["all"], exam: ["xnle"], jurisdiction: "intl" },
    applicability: { conditions: ["The item is scored with the XNLE rubric"] },
    evidence: [{ sourceId: "s-blueprint", passageId: "p1", quote: "the XNLE rubric awards credit only when the escalation is documented before the reassessment" }],
    ...o });
  const none = build(() => exam({ exceptions: [], noExceptionsNote: "The blueprint states the rubric order without any case-based exception." }));
  assert.equal(none.rejected.length, 0, JSON.stringify(none.rejected)); assert.deepEqual(SP.specificityAnchors(none.accepted[0]), ["exam"]);
  assert.match(reasonOf(build(() => exam({ exceptions: [] }))), /noExceptionsNote/);
});

test("a dated recent guideline change is an anchor of its own", () => {
  const e = { ...good(), scope: { discipline: ["nursing"], exam: [], jurisdiction: "intl" }, value: { ...base().value, category: "recent-guideline-change" }, effectiveFrom: "2026-01-01" };
  assert.deepEqual(SP.specificityAnchors(e), ["recent-change"]);
  assert.deepEqual(SP.validateSpecialized(e), []);
  assert.ok(SP.specificityAnchors({ ...e, effectiveFrom: undefined }).length === 0, "without the date it is just an international claim");
});

/* ───────── rejected: generic / unsupported / safety-layer content ───────── */
test("generic textbook entries are rejected: generic category, no specificity anchor, boilerplate justification", () => {
  assert.match(reasonOf(build({ value: { ...base().value, category: "textbook" } })), /generic textbook knowledge is not accepted/);
  assert.match(reasonOf(build({ value: { ...base().value, category: "general-knowledge" } })), /generic textbook knowledge/);
  assert.match(reasonOf(build({ scope: { discipline: ["all"], exam: [], jurisdiction: "intl" } })), /no specificity anchor/);
  assert.match(reasonOf(build({ scope: { discipline: ["all"], exam: [], jurisdiction: "" } })), /no specificity anchor|scope\.jurisdiction/);
  assert.match(reasonOf(build({ value: { ...base().value, beyondGeneral: "This is a well known fact that is described in every standard textbook of pharmacology and nursing." } })), /well known|generic/);
  assert.match(reasonOf(build({ value: { ...base().value, beyondGeneral: "short" } })), /beyondGeneral/);
  assert.match(reasonOf(build({ value: { ...base().value, generalAnswerRisk: "" } })), /generalAnswerRisk/);
});

test("an entry that merely restates the general layer is rejected (no duplication of the safety layer)", () => {
  KB.__resetKb();
  const stmt = "Heparin infusion monitoring uses aPTT; protamine sulfate reverses heparin overdose in adults.";
  const general = { facts: [], rules: [{ id: "r-antidotes.1", subj: ["heparin"], cue: ["overdose", "reversal"], truth: ["protamine sulfate"], fix: "Protamine sulfate reverses heparin overdose in adults; monitoring uses aPTT" }] };
  const m = { sources: [{ id: "s", url: "https://example.invalid/h", license: "CC0", licenseVerified: true, type: "guideline", passages: [{ id: "p", text: stmt }] }] };
  const cand = { ...base(), id: "dup-heparin", title: "Heparin overdose reversal and monitoring", statement: stmt, aliases: { en: ["heparin overdose"], ar: [] },
    scope: { discipline: ["nursing"], exam: [], jurisdiction: "RU" }, evidence: [{ sourceId: "s", passageId: "p", quote: stmt }] };
  const r = buildSpecialized(m, [cand], { general });
  assert.equal(r.accepted.length, 0); assert.match(r.rejected[0].reason, /duplicates the general layer \(rule:r-antidotes\.1\)/);
  assert.equal(buildSpecialized(m, [cand], { general: { facts: [], rules: [] } }).accepted.length, 1, "only the overlap is the reason");
});

test("the real general KB does not flag a genuinely specialized entry as a duplicate (no false positives), and forbidden_patterns / rule fields are refused", async () => {
  await T.ensureKb(GEN);
  const general = { facts: KB.loadedFacts(), rules: KB.allRules() };
  assert.ok(general.facts.length > 0 && general.rules.length > 100, "the general layer is loaded");
  assert.equal(build({}, { general }).rejected.length, 0);
  for (const f of ["forbidden_patterns", "support", "truth", "wrong"]) assert.match(reasonOf(build({ [f]: [{ re: "x", correction: "y" }] })), new RegExp(`${f}: belongs to the general safety layer`));
});

test("unsupported entries are rejected: no evidence, unknown source, unverified or non-open license, quote not verbatim, wrong evidence type", () => {
  assert.match(reasonOf(build({ evidence: [] })), /no evidence/);
  assert.match(reasonOf(build({ evidence: undefined })), /no evidence/);
  assert.match(reasonOf(build({ evidence: [{ sourceId: "ghost", passageId: "p1", quote: "may start a zorbitol infusion above 40 mL per hour" }] })), /unknown source ghost/);
  assert.match(reasonOf(build({ evidence: [{ sourceId: "s-notice", passageId: "p9", quote: "may start a zorbitol infusion above 40 mL per hour" }] })), /passage p9 not found/);
  assert.match(reasonOf(build({ evidence: [{ sourceId: "s-notice", passageId: "p1", quote: "may start a zorbitol infusion above 50 mL per hour only after a check" }] })), /not found verbatim/);
  assert.match(reasonOf(build({ evidence: [{ sourceId: "s-notice", passageId: "p1", quote: "short" }] })), /quote too short/);
  assert.match(reasonOf(build({ evidence: [{ sourceId: "s-nc", passageId: "p1", quote: "needs a second-nurse check in Ruritania" }] })), /not bundleable/);
  assert.match(reasonOf(build({ evidence: [{ sourceId: "s-textbook", passageId: "p1", quote: "needs a second-nurse check in Ruritania" }] })), /textbooks, wikis, AI text and untyped sources are not evidence/);
  assert.match(reasonOf(build({ evidence: [{ sourceId: "s-untyped", passageId: "p1", quote: "needs a second-nurse check in Ruritania" }] })), /untyped|not evidence/);
  const unverified = { sources: [{ ...manifest.sources[0], licenseVerified: false }] };
  assert.match(buildSpecialized(unverified, [base()]).rejected[0].reason, /license of s-notice is not verified/);
});

test("evidence must actually support the statement: an invented number or an unrelated quote is rejected", () => {
  assert.match(reasonOf(build({ statement: "In Ruritania, a zorbitol infusion above 45 mL per hour requires a documented second-nurse check before the nurse starts it." })), /number\(s\) 45 that no evidence quote contains/);
  assert.match(reasonOf(build({ statement: "Patients with unrelated renal impairment should always receive reduced maintenance dosing under supervision of a specialist." })), /fewer than 2 content words/);
});

test("schema gaps are named: missing clinical scope, applicability, exceptions, approval, review date; duplicate ids", () => {
  assert.match(reasonOf(build({ clinical: undefined })), /clinical\.scope/);
  assert.match(reasonOf(build({ applicability: { conditions: [] } })), /applicability\.conditions/);
  assert.match(reasonOf(build({ exceptions: undefined })), /exceptions/);
  assert.match(reasonOf(build({ exceptions: [{ when: "x", effect: "y" }] })), /exceptions\[\]/);
  assert.match(reasonOf(build({ approval: { status: "approved", reviewer: "reviewer", reviewedAt: "2026-10-01" } })), /approval\.checks\.claimSupport/);
  assert.match(reasonOf(build({ approval: { status: "approved" } })), /approval\.reviewer/);
  assert.match(reasonOf(build({ approval: { status: "maybe" } })), /approval\.status/);
  assert.match(reasonOf(build({ reviewBy: undefined })), /reviewBy/);
  assert.match(reasonOf(build({ kind: "list" })), /kind/);
  const two = buildSpecialized(manifest, [base(), base()], { today: "2026-11-20" });
  assert.equal(two.accepted.length, 1); assert.match(two.rejected[0].reason, /duplicate id/);
});

test("registerSpecialized (strict) refuses an invalid entry; a hand-written entry with unverified evidence never validates", () => {
  assert.throws(() => SP.registerSpecialized("m", [{ ...good(), evidence: [{ ...good().evidence[0], verified: false }] }]), /evidence provenance must be builder-verified/);
  assert.throws(() => SP.registerSpecialized("m", [{ ...good(), value: { ...good().value, category: "textbook" } }]), /generic/);
  assert.equal(SP.loadedSpecialized().length, 0);
});

/* ───────── retrieval: approved ∧ current ∧ in-scope ∧ relevant ───────── */
const Q = "Do I need a second-nurse check before starting a zorbitol infusion at 60 mL per hour?";
const ids = (r) => r.map((x) => x.entry.id);

test("retrieval returns an approved, current, in-scope, relevant entry together with its conditions and exceptions", () => {
  SP.registerSpecialized("m", [good()]);
  const r = SP.lookupSpecialized(Q, RU_NURSE, { now: NOW });
  assert.deepEqual(ids(r), ["ru-zorbitol-second-check"]);
  assert.ok(r[0].entry.applicability.conditions.length && r[0].entry.exceptions.length && r[0].entry.evidence[0].quote, "conditions, exceptions and evidence travel with the entry");
});

test("retrieval relevance: an unrelated question, a single common word and an empty query return nothing; an alias phrase is enough", () => {
  SP.registerSpecialized("m", [good()]);
  assert.deepEqual(SP.lookupSpecialized("What is the normal heart rate in adults?", RU_NURSE, { now: NOW }), []);
  assert.deepEqual(SP.lookupSpecialized("Which nurse should I ask?", RU_NURSE, { now: NOW }), [], "one shared common word is not relevance");
  assert.deepEqual(SP.lookupSpecialized("", RU_NURSE, { now: NOW }), []);
  assert.deepEqual(ids(SP.lookupSpecialized("second-nurse check?", RU_NURSE, { now: NOW })), ["ru-zorbitol-second-check"]);
});

test("retrieval ranks the better match first and honours k", () => {
  const other = good({ id: "ru-zorbitol-storage", title: "Zorbitol vial storage (Ruritania)", statement: "In Ruritania, zorbitol vials are stored in the ward medication room, and the stock is counted by the nurse at every shift handover.",
    aliases: { en: ["zorbitol vial storage"], ar: [] }, evidence: [{ sourceId: "s-notice", passageId: "p1", quote: "a registered nurse in Ruritania may start a zorbitol infusion" }],
    applicability: { conditions: ["The vials are kept on a Ruritania ward"] }, clinical: { scope: "Storing zorbitol vials on an adult ward in Ruritania" } });
  SP.registerSpecialized("m", [other, good()]);
  const r = SP.lookupSpecialized("zorbitol infusion second-nurse check", RU_NURSE, { now: NOW });
  assert.equal(r[0].entry.id, "ru-zorbitol-second-check");
  assert.equal(SP.lookupSpecialized("zorbitol infusion second-nurse check", RU_NURSE, { now: NOW, k: 1 }).length, 1);
});

test("scope mismatches are never returned: discipline, exam, jurisdiction (an unknown region cannot satisfy a specific one), institution, population", () => {
  SP.registerSpecialized("m", [good()]);
  const look = (p, c) => ids(SP.lookupSpecialized(Q, p, { now: NOW, context: c }));
  assert.deepEqual(look({ ...RU_NURSE, discipline: "pharmacy" }), [], "another discipline");
  assert.deepEqual(look({ ...RU_NURSE, region: "EG" }), [], "another jurisdiction");
  assert.deepEqual(look({ ...RU_NURSE, region: "" }), [], "unknown region: not silently assumed");
  assert.deepEqual(look({ discipline: "nursing" }), [], "no region on the profile");
  assert.equal(SP.scopeMismatch(good(), { ...RU_NURSE, region: "EG" }), "jurisdiction");
  assert.equal(SP.scopeMismatch(good(), { ...RU_NURSE, discipline: "pharmacy" }), "discipline");
  assert.equal(SP.scopeMismatch(good(), RU_NURSE), null);
  const ex = good({ id: "xnle-only", scope: { discipline: ["nursing"], exam: ["xnle"], jurisdiction: "RU" } });
  assert.equal(SP.scopeMismatch(ex, RU_NURSE), "exam"); assert.equal(SP.scopeMismatch(ex, { ...RU_NURSE, exam: "xnle" }), null);
  const inst = good({ id: "inst-only", scope: { discipline: ["nursing"], exam: [], jurisdiction: "RU", institution: "Fictional General Hospital" } });
  assert.equal(SP.scopeMismatch(inst, RU_NURSE, {}), "institution"); assert.equal(SP.scopeMismatch(inst, RU_NURSE, { institution: "Fictional General Hospital" }), null);
  const pop = good({ id: "peds-only", scope: { discipline: ["nursing"], exam: [], jurisdiction: "RU", population: ["pediatric"] } });
  assert.equal(SP.scopeMismatch(pop, RU_NURSE, {}), "population", "missing population context fails closed");
  assert.equal(SP.scopeMismatch(pop, RU_NURSE, { population: "adult" }), "population"); assert.equal(SP.scopeMismatch(pop, RU_NURSE, { population: "pediatric" }), null);
  const species = good({ id: "cat-only", value: { ...base().value, category: "species-specific-knowledge" }, scope: { discipline: ["veterinary"], exam: [], jurisdiction: "intl", specialty: "Feline medicine", species: ["cat"] } });
  assert.equal(SP.scopeMismatch(species, { discipline: "veterinary", exam: "", region: "" }, {}), "species");
  assert.equal(SP.scopeMismatch(species, { discipline: "veterinary", exam: "", region: "" }, { species: "dog" }), "species");
  assert.equal(SP.scopeMismatch(species, { discipline: "veterinary", exam: "", region: "" }, { species: "cat" }), null);
  SP.__resetSpecialized(); SP.registerSpecialized("m", [inst]);
  assert.deepEqual(look(RU_NURSE), [], "a hospital-specific entry stays hidden without that hospital");
  assert.deepEqual(look(RU_NURSE, { institution: "Fictional General Hospital" }), ["inst-only"]);
});

test("outdated, not-yet-effective, superseded, retired, draft and hand-injected unverified entries are never retrieved", () => {
  const entries = [
    good({ id: "e-current" }),
    good({ id: "e-outdated", reviewBy: "2025-06-01" }),
    good({ id: "e-future", effectiveFrom: "2027-06-01" }),
    good({ id: "e-superseded", supersededBy: "e-current" }),
    good({ id: "e-retired", approval: { status: "retired", reviewer: "fixture-reviewer", reviewedAt: "2026-10-01" } }),
    good({ id: "e-draft", approval: { status: "draft" } }),
  ];
  const status = Object.fromEntries(entries.map((e) => [e.id, SP.specializedStatus(e, NOW)]));
  assert.deepEqual(status, { "e-current": "current", "e-outdated": "outdated", "e-future": "not-yet-effective", "e-superseded": "superseded", "e-retired": "retired", "e-draft": "unapproved" });
  const sneaky = { ...good({ id: "e-unverified" }), evidence: [{ ...good().evidence[0], verified: false }] };
  SP.registerSpecialized("m", [...entries, sneaky], { strict: false });
  assert.deepEqual(ids(SP.lookupSpecialized(Q, RU_NURSE, { now: NOW, k: 10 })), ["e-current"]);
  assert.equal(SP.specializedStatus(sneaky, NOW), "unverified");
  assert.deepEqual(ids(SP.lookupSpecialized(Q, RU_NURSE, { now: Date.parse("2029-01-01"), k: 10 })), [], "the same entry ages out when its review date passes");
});

test("globally applicable expert knowledge is accepted without a country, exam, or institution anchor", () => {
  const expertManifest = { sources: [{ id: "s-paper", url: "https://example.invalid/paper", license: "CC0", licenseVerified: true, type: "peer-reviewed",
    passages: [{ id: "p1", text: "The fictional zeta pathway alters receptor recycling through a scaffold-dependent interaction in the specialized assay." }] }] };
  const candidate = {
    ...base(), id: "global-zeta-mechanism", title: "Zeta pathway scaffold-dependent receptor recycling", kind: "mechanism",
    statement: "The fictional zeta pathway alters receptor recycling through a scaffold-dependent interaction in the specified assay.",
    aliases: { en: ["zeta pathway", "scaffold-dependent receptor recycling"], ar: [] },
    value: { category: "rare-mechanism", beyondGeneral: "This uncommon scaffold-dependent mechanism is assay-specific and is easy to confuse with direct receptor degradation in a general explanation.", generalAnswerRisk: "A generic explanation would incorrectly describe direct receptor degradation instead of altered recycling." },
    clinical: { scope: "Molecular interpretation of the fictional zeta receptor assay" },
    scope: { discipline: ["medicine"], exam: [], jurisdiction: "intl", specialty: "Molecular pathology" },
    applicability: { conditions: ["The case concerns the specified zeta pathway assay"] },
    exceptions: [{ when: "The assay uses a different scaffold isoform", effect: "This mechanism cannot be assumed without isoform-specific evidence" }],
    evidence: [{ sourceId: "s-paper", passageId: "p1", quote: "The fictional zeta pathway alters receptor recycling through a scaffold-dependent interaction in the specialized assay." }],
  };
  const built = buildSpecialized(expertManifest, [candidate], { today: "2026-11-20" });
  assert.equal(built.rejected.length, 0, JSON.stringify(built.rejected));
  assert.deepEqual(SP.specificityAnchors(built.accepted[0]), ["specialty"]);
  SP.registerSpecialized("global", built.accepted);
  assert.equal(SP.lookupSpecialized("zeta pathway scaffold-dependent receptor recycling", { discipline: "medicine", exam: "", region: "" }, { now: NOW }).length, 1);
});

test("a specialty label alone cannot turn generic textbook content into specialized knowledge", () => {
  const r = build({
    id: "generic-specialty-label", value: { category: "textbook", beyondGeneral: "This fact is described in common textbooks but is written under a specialty label for testing purposes.", generalAnswerRisk: "A general answer would give the same textbook fact without additional detail." },
    scope: { discipline: ["medicine"], exam: [], jurisdiction: "intl", specialty: "Cardiology" },
  });
  assert.match(reasonOf(r), /generic textbook knowledge/);
});

test("approved status requires explicit human checks of claim support, clinical accuracy, and scope/exceptions", () => {
  for (const [field, value] of [["claimSupport", false], ["clinicalAccuracy", false], ["scopeAndExceptions", false]]) {
    const approval = { ...base().approval, checks: { ...base().approval.checks, [field]: value } };
    assert.match(reasonOf(build({ approval })), new RegExp(`approval\\.checks\\.${field}`));
  }
});

/* ───────── separation from the general safety layer ───────── */
test("the specialized layer is separate: pilot drafts load for review but remain excluded from production retrieval and do not change the general safety KB", async () => {
  await T.ensureKb(GEN);
  const snap = () => ({ facts: KB.loadedFacts().length, rules: KB.allRules().length, compiled: KB.compiled().length, v: JSON.stringify(T.verifyText({ text: "- The gallbladder secretes bile into the duodenum.", source: "The liver makes bile and the gallbladder stores it.", profile: GEN, part: "A" }).patches) });
  const before = snap();
  assert.equal(SP.loadedSpecialized().length, 0, "specialized chunks load lazily");
  const shipped = await SP.loadSpecialized(GEN);
  assert.equal(shipped.length, 80, "the pilot, pharmacogenomics batches, AI-error-driven, major, and fifth major expansion batches are bundled for review");
  assert.ok(shipped.every((e) => SP.specializedStatus(e) === "unapproved"), "specialized entries remain drafts until human clinical review");
  assert.deepEqual(SP.lookupSpecialized("HLA-B*57:01 abacavir hypersensitivity", GEN), [], "draft pilot entries are never used in production");
  SP.registerSpecialized("m", [good()]);
  assert.deepEqual(snap(), before);
  assert.equal(KB.lookup("zorbitol infusion", GEN).length, 0, "general lookup does not see specialized entries");
  assert.ok(before.v.includes("liver makes bile"), "the general contradiction check still patches");
  SP.__resetSpecialized();
  assert.deepEqual(snap(), before);
});
