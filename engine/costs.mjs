// Kosten koper (buying costs), indicative. Pure ESM, shared by build, tests and browser.
// Rule values (transfer-tax rates, starter exemption, NHG limit and fee) come from data/params-2026.json.
// Market prices (notary, valuation, advice, bank guarantee) are never assumed: the user enters them.

export const USES = ['own', 'notMain', 'other'];

/**
 * Overdrachtsbelasting.
 * own:     home the buyer will live in as main residence (2%, or 0% with the starter exemption)
 * notMain: home not used as main residence (8% from 2026)
 * other:   other property (10.4%)
 * The starter exemption needs: own use, age >= min and < max, not used before, price <= starterMaxValue.
 */
export function transferTax({ price, use = 'own', age = null, usedExemptionBefore = false }, params) {
  const t = params.transferTax;
  const p = Math.max(0, Number(price) || 0);
  const [minAge, maxAge] = t.starterAge;
  const checks = {
    ownUse: use === 'own',
    age: age != null && age !== '' && Number(age) >= minAge && Number(age) < maxAge,
    firstTime: !usedExemptionBefore,
    price: p <= t.starterMaxValue,
  };
  let ratePct, reason;
  if (use === 'notMain') { ratePct = t.notMainResidence; reason = 'notMain'; }
  else if (use === 'other') { ratePct = t.other; reason = 'other'; }
  else if (checks.age && checks.firstTime && checks.price) { ratePct = t.starter; reason = 'starter'; }
  else { ratePct = t.ownHome; reason = 'own'; }
  return { ratePct, amount: p * ratePct / 100, reason, starterChecks: checks };
}

/** NHG fee: feePct of the loan, only when the loan is within the limit (higher limit with energy-saving measures). */
export function nhgFee(mortgage, { energySaving = false } = {}, params) {
  const m = Math.max(0, Number(mortgage) || 0);
  const limit = energySaving ? params.nhg.limitWithEBV : params.nhg.limit;
  const eligible = m > 0 && m <= limit;
  return { eligible, limit, feePct: params.nhg.feePct, fee: eligible ? m * params.nhg.feePct / 100 : 0 };
}

/**
 * Total buying costs.
 * @param {object} i  { price, mortgage, use, age, usedExemptionBefore, nhg (wants NHG), energySaving,
 *                      extras: { notary, valuation, advice, guarantee, other } in euros, entered by the user }
 */
export function buyingCosts(i, params) {
  const tax = transferTax(i, params);
  const nhg = i.nhg ? nhgFee(i.mortgage, { energySaving: !!i.energySaving }, params) : null;
  const extras = Object.fromEntries(Object.entries(i.extras || {}).map(([k, v]) => [k, Math.max(0, Number(v) || 0)]));
  const extrasTotal = Object.values(extras).reduce((s, v) => s + v, 0);
  const total = tax.amount + (nhg ? nhg.fee : 0) + extrasTotal;
  const price = Math.max(0, Number(i.price) || 0);
  return { tax, nhg, extras, extrasTotal, total, pctOfPrice: price ? total / price * 100 : null };
}
