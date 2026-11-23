/* r-antidotes · antidotes and reversal agents (v3.44). Slot «antidote»: wrong = the OTHER rules' antidotes. Every legitimate alternative is listed in `truth`
   (e.g. glucagon also treats insulin overdose), so a correct comparative statement can never fire. All facts are standard textbook pharmacology; source quotes are NOT attached (unverified). */
export const id = "r-antidotes";
export const rules = `
== antidotes
antidote; heparin|unfractionated heparin|هيبارين; $ad; protamine sulfate|protamine|بروتامين; @;
antidote; warfarin|coumadin|وارفارين; $ad; vitamin k|phytonadione|fresh frozen plasma|prothrombin complex concentrate|kcentra|فيتامين ك; @;
antidote; opioid|morphine|fentanyl|heroin|oxycodone|hydromorphone|methadone|opiate; $ad; naloxone|narcan|nalmefene|نالوكسون; @;
antidote; benzodiazepine|diazepam|lorazepam|midazolam|alprazolam|clonazepam; $ad; flumazenil|فلومازينيل; @;
antidote; acetaminophen|paracetamol|tylenol|باراسيتامول; $ad; acetylcysteine|n acetylcysteine|mucomyst|acetadote; @;
antidote; digoxin|lanoxin|digitalis|ديجوكسين; $ad; digoxin immune fab|digifab|digibind|antidigoxin antibody; @;
antidote; methotrexate; $ad; leucovorin|folinic acid|levoleucovorin|glucarpidase; @;
antidote; organophosphate|nerve agent|malathion|parathion|cholinesterase inhibitor poisoning; $ad; atropine|pralidoxime|2 pam|pam|اتروبين; @;
antidote; cyanide|cyanide poisoning; $ad; hydroxocobalamin|cyanokit|sodium nitrite|sodium thiosulfate|amyl nitrite; @;
antidote; carbon monoxide|co poisoning; $ad; 100 oxygen|hyperbaric oxygen|high flow oxygen|oxygen; @;
antidote; iron overdose|iron toxicity|ferrous sulfate overdose|iron poisoning; $ad; deferoxamine|desferal; @;
antidote; methanol|ethylene glycol|antifreeze; $ad; fomepizole|ethanol|alcohol dehydrogenase inhibitor; @;
antidote; beta blocker overdose|beta blocker toxicity|metoprolol overdose|propranolol overdose|atenolol overdose; $ad; glucagon|high dose insulin; @;
antidote; calcium channel blocker overdose|calcium channel blocker toxicity|verapamil overdose|diltiazem overdose|nifedipine overdose; $ad; calcium gluconate|calcium chloride|intravenous calcium|high dose insulin|glucagon; @;
antidote; thrombolytic|alteplase|tpa|tenecteplase|streptokinase|fibrinolytic; $ad; aminocaproic acid|tranexamic acid|cryoprecipitate; @;
antidote; dabigatran|pradaxa; $ad; idarucizumab|praxbind; @;
antidote; rivaroxaban|apixaban|xarelto|eliquis|factor xa inhibitor|edoxaban; $ad; andexanet alfa|andexxa|prothrombin complex concentrate|kcentra; @;
antidote; rocuronium|vecuronium|nondepolarizing neuromuscular blocker; $ad; sugammadex|bridion|neostigmine; @;
antidote; malignant hyperthermia|succinylcholine; $ad; dantrolene|دانترولين; @;
antidote; tricyclic antidepressant|amitriptyline|nortriptyline|tca overdose|imipramine; $ad; sodium bicarbonate|bicarbonate; @;
antidote; insulin overdose|insulin toxicity|sulfonylurea overdose|hypoglycemic agent overdose; $ad; dextrose|glucose|glucagon|d50|octreotide|جلوكاجون; @;
antidote; isoniazid overdose|isoniazid toxicity|isoniazid neuropathy; $ad; pyridoxine|vitamin b6; @;
antidote; magnesium sulfate toxicity|magnesium toxicity|magnesium overdose|hypermagnesemia; $ad; calcium gluconate|calcium chloride; @;
antidote; salicylate overdose|aspirin overdose|salicylate toxicity|aspirin toxicity; $ad; sodium bicarbonate|bicarbonate|urinary alkalinization|hemodialysis|dialysis; @;
antidote; serotonin syndrome; $ad; cyproheptadine; @;
antidote; bupivacaine toxicity|local anesthetic toxicity|local anesthetic systemic toxicity; $ad; lipid emulsion|intralipid|20 lipid emulsion; @;
antidote; methemoglobinemia; $ad; methylene blue; @;
antidote; neostigmine overdose|cholinergic crisis; $ad; atropine; @;
antidote; hyperkalemia ecg changes|hyperkalemic cardiac toxicity; $ad; calcium gluconate|calcium chloride; @;
`;
