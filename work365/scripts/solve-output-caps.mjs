/* the worst-case OUTPUT words a solve brief may have, read from the "max N words" caps written in the solve prompt itself.
   Fields without a cap (ANSWER, TYPE, CONCEPTS, the CONFIDENCE reason) are identical in v3.42 and v3.43 and are left out of the comparison. */
export function outputCaps(system) {
  const cap = (re) => { const m = re.exec(system); return m ? parseInt(m[1], 10) : 0; };
  return {
    premise: cap(/^PREMISE:[^\n]*?max (\d+) words/m),
    keyword: cap(/^KEYWORD:[^\n]*?max (\d+) words/m),
    data: cap(/^DATA:[^\n]*?max (\d+) words/m),
    dataWithCalc: cap(/^DATA:[^\n]*?max (\d+) when CALC/m),
    option: cap(/^A\) ✅ or ❌ <why, max (\d+) words>/m),
    calc: cap(/^CALC:[^\n]*?max (\d+) words/m),
    rationale: cap(/^RATIONALE:[^\n]*?max (\d+) words/m),
  };
}
/* worst case for an item with n options; `calc` = a calculation item */
export function worstWords(caps, n = 5, calc = false) {
  return caps.premise + caps.keyword + (calc && caps.dataWithCalc ? caps.dataWithCalc : caps.data) + caps.option * n + (calc ? caps.calc : 0) + caps.rationale;
}
