// Maximum mortgage on income (indicative), after the Tijdelijke regeling hypothecair krediet (Trhk) 2026.
// Pure ESM, no dependencies: runs in Node (build, tests) and in the browser (calculator).
// Every rule value comes from the params object (data/params-2026.json). Nothing is hard-coded here.

/** Index of the first band whose upper bound (inclusive) is >= value. */
export function bandIndex(value, uppers) {
  const i = uppers.findIndex(u => value <= u);
  return i < 0 ? uppers.length - 1 : i;
}

/** Test rate: below 10 years fixed the rate is at least the AFM minimum; 10 years or more uses the actual rate. */
export function toetsrente(ratePct, fixedYears, a) {
  return fixedYears < 10 ? Math.max(ratePct, a.minToetsrente) : ratePct;
}

/** Financieringslast percentage from Trhk Bijlage 1 (Tabel 1 below AOW age, Tabel 2 at AOW age). */
export function financieringslast(income, ratePct, aow, a) {
  const table = aow ? a.flTableAOW : a.flTableBelowAOW;
  let row = table[0];
  for (const r of table) if (income >= r[0]) row = r;
  return { pct: row[1 + bandIndex(ratePct, a.rateBandsUpperPct)], rowFrom: row[0] };
}

/** Monthly gross annuity payment per euro borrowed. */
export function annuityFactor(ratePct, years) {
  const r = ratePct / 100 / 12, n = years * 12;
  return r === 0 ? 1 / n : r / (1 - Math.pow(1 + r, -n));
}

/** Gross-up factor for study debt (Trhk art. 4), by test rate band. */
export function bruteringsfactor(ratePct, a) {
  const row = a.bruteringsfactor.find(([upper]) => ratePct <= upper) || a.bruteringsfactor.at(-1);
  return row[1];
}

export const ENERGY_LABELS = ['EFG', 'CD', 'AB', 'A+/A++', 'A+++', 'A++++', 'A++++ garantie'];

/**
 * @param {object} input
 * @param {number} input.income            toetsinkomen (gross per year, total of all applicants as entered)
 * @param {number} input.ratePct           mortgage interest rate in percent
 * @param {number} input.fixedYears        fixed-rate period in years
 * @param {boolean} [input.aow]            applicant has reached AOW age
 * @param {number} [input.studyDebtMonthly] actual monthly study-debt payment
 * @param {string} [input.energyLabel]     one of ENERGY_LABELS, or '' for unknown
 * @param {boolean} [input.energySaving]   plans energy-saving measures (adds the energySavingExtra room)
 * @param {number} [input.homeValue]       market value; caps the income-based part at ltvMax x value
 * @param {object} params                  data/params-2026.json
 */
export function maxMortgage(input, params) {
  const a = params.affordability;
  const income = Math.max(0, Number(input.income) || 0);
  const ratePct = Number(input.ratePct);
  const fixedYears = Number(input.fixedYears);
  const tr = toetsrente(ratePct, fixedYears, a);
  const fl = financieringslast(income, tr, !!input.aow, a);
  const monthlyMax = income * fl.pct / 100 / 12;
  const brut = bruteringsfactor(tr, a);
  const studyDebtMonthly = Math.max(0, Number(input.studyDebtMonthly) || 0);
  const studyDebtCharge = studyDebtMonthly * brut;
  const monthlyAvailable = Math.max(0, monthlyMax - studyDebtCharge);
  const factor = annuityFactor(tr, a.termYears);
  const onIncome = monthlyAvailable / factor;
  const homeValue = Number(input.homeValue) || 0;
  const ltvCap = homeValue > 0 ? homeValue * a.ltvMax : null;
  const base = ltvCap == null ? onIncome : Math.min(onIncome, ltvCap);
  const label = ENERGY_LABELS.includes(input.energyLabel) ? input.energyLabel : '';
  const labelExtra = label ? a.energyLabelExtra[label] ?? 0 : 0;
  const savingExtra = label && input.energySaving ? a.energySavingExtra[label] ?? 0 : 0;
  const total = base + labelExtra + savingExtra;
  return {
    toetsrente: tr, minApplied: tr !== ratePct, shortFixed: fixedYears < 10, financieringslastPct: fl.pct, tableRowFrom: fl.rowFrom,
    monthlyMax, bruteringsfactor: brut, studyDebtCharge, monthlyAvailable, annuityFactor: factor,
    onIncome, ltvCap, limitedByValue: ltvCap != null && ltvCap < onIncome, base, labelExtra, savingExtra, total,
    nhgLimit: params.nhg.limit, withinNhg: total <= params.nhg.limit, termYears: a.termYears,
  };
}
