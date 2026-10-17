// Average Dutch bank mortgage rates (new business) by fixation period from the ECB Data Portal (MIR, compiled by DNB).
// ECB statistics may be reused free of charge with source attribution. Plus editorial lender rates in data/lender-rates.json (manually captured, dated).
import fs from 'node:fs';
const S = { F:{nl:'Variabel / tot 1 jaar vast',en:'Variable / up to 1 year fixed'}, I:{nl:'1–5 jaar vast',en:'1–5 years fixed'}, O:{nl:'5–10 jaar vast',en:'5–10 years fixed'}, P:{nl:'Meer dan 10 jaar vast',en:'Over 10 years fixed'}, A:{nl:'Alle looptijden',en:'All fixation periods'} };
const out = { fetchedAt:new Date().toISOString(), source:{ name:'ECB Data Portal – MFI interest rate statistics (MIR), Netherlands, compiled by De Nederlandsche Bank', url:'https://data.ecb.europa.eu/data/datasets/MIR', dnb:'https://www.dnb.nl/statistieken/dashboards/woninghypotheken/hypotheekrentes-banken/', license:'ECB statistics: free reuse with attribution (Source: ECB/DNB)', credit:'Bron: ECB/DNB' }, series:{} };
for (const [k,label] of Object.entries(S)) {
  const key = `M.NL.B.A2C.${k}.R.A.2250.EUR.N`;
  const r = await fetch(`https://data-api.ecb.europa.eu/service/data/MIR/${key}?format=csvdata&lastNObservations=120`);
  if (!r.ok) { console.error('skip', key, r.status); continue; }
  const lines = (await r.text()).trim().split('\n'); const h = lines[0].split(',');
  const tt = h.indexOf('TITLE'); const ti = h.indexOf('TIME_PERIOD'), vi = h.indexOf('OBS_VALUE');
  out.series[k] = { label, ecbTitle: (lines[1].match(/Bank interest rates - ([^,"]*)/)||[])[1]?.trim(), key:'MIR.'+key, data: lines.slice(1).map(l=>l.split(',')).map(c=>({ month:c[ti], rate: c[vi]===''?null:+c[vi] })) };
}
fs.writeFileSync('data/rates.json', JSON.stringify(out, null, 1));
console.log('rates', Object.entries(out.series).map(([k,v])=>k+':'+v.data.at(-1)?.month+'='+v.data.at(-1)?.rate).join(' '));
