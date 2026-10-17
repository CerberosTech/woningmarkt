// Annuity repayment schedule for a given loan, rate and term. Pure ESM, shared by the build, the tests and the browser.
import { annuityFactor } from './affordability.mjs';

/**
 * Gross monthly payment and the yearly split between interest and repayment of an annuity loan.
 * No tax effects (no mortgage interest deduction) and a constant rate over the whole term.
 * @returns {{ monthly:number, totalInterest:number, years:Array<{ year:number, interest:number, repayment:number, balance:number }> }}
 */
export function annuitySchedule(principal, ratePct, years = 30) {
  const P = Math.max(0, +principal || 0), r = Math.max(0, +ratePct || 0) / 100 / 12;
  const monthly = P ? P * annuityFactor(Math.max(0, +ratePct || 0), years) : 0;
  const out = [];
  let balance = P, totalInterest = 0;
  for (let y = 1; y <= years; y++) {
    let interest = 0, repayment = 0;
    for (let m = 0; m < 12; m++) { const i = balance * r, p = Math.min(balance, monthly - i); interest += i; repayment += p; balance -= p; }
    totalInterest += interest;
    out.push({ year: y, interest, repayment, balance: Math.max(0, balance) });
  }
  return { monthly, totalInterest, years: out };
}
