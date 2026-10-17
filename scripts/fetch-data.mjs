// Fetches official open data into data/*.json. Zero deps, Node 20+. Run: node scripts/fetch-data.mjs
// Sources: CBS StatLine OData (CC BY 4.0), PDOK CBS gebiedsindelingen (open). Never invents values: missing = null.
import fs from 'node:fs';
const B = 'https://opendata.cbs.nl/ODataApi/odata';
const j = async u => { for (let i=0;i<3;i++){ try{ const r=await fetch(u); if(r.ok) return r.json(); }catch{} await new Promise(r=>setTimeout(r,2000)); } throw new Error('fetch failed '+u); };
const all = async u => { let out=[], next=u; while(next){ const d=await j(next); out=out.concat(d.value); next=d['odata.nextLink']||null; } return out; };
const meta = async t => (await j(`${B}/${t}/TableInfos?$format=json`)).value[0];
const now = new Date().toISOString();
const sources = {};
const src = async (t,extra={}) => { const m = await meta(t); sources[t] = { table:t, title:m.Title, modified:m.Modified, url:`https://opendata.cbs.nl/statline/#/CBS/nl/dataset/${t}`, api:`${B}/${t}`, license:'CC BY 4.0', credit:'Bron: CBS', ...extra }; };

// 1) Average sale price existing homes, annual, all regions (83625NED)
await src('83625NED');
const regs = (await j(`${B}/83625NED/RegioS?$format=json`)).value.map(r=>({code:r.Key.trim(),name:r.Title}));
const per = (await j(`${B}/83625NED/Perioden?$format=json`)).value.map(p=>p.Key).filter(k=>/JJ00$/.test(k));
const years = per.slice(-11);
const p1 = await all(`${B}/83625NED/TypedDataSet?$format=json&$filter=(${years.map(y=>`Perioden eq '${y}'`).join(' or ')})`);
const prices = {}; for (const r of p1){ const c=r.RegioS.trim(); (prices[c] ??= {})[r.Perioden.slice(0,4)] = r.GemiddeldeVerkoopprijs_1; }

// 2) Quarterly/monthly recent avg price + index + sales for NL, provinces, big 4 (85792NED)
await src('85792NED');
const q = await all(`${B}/85792NED/TypedDataSet?$format=json`);
const recent = {}; for (const r of q){ (recent[r.RegioS.trim()] ??= []).push({ period:r.Perioden, index:r.PrijsindexVerkoopprijzen_1, yoy:r.OntwikkelingTOVEenJaarEerder_3, sold:r.VerkochteWoningen_4, avg:r.GemiddeldeVerkoopprijs_7 }); }

// 3) National by dwelling type: houses vs apartments (85791NED)
await src('85791NED');
const types = (await j(`${B}/85791NED/TypeWoning?$format=json`)).value;
const t3 = await all(`${B}/85791NED/TypedDataSet?$format=json`);
const byType = types.map(t=>({ key:t.Key.trim(), name:t.Title, series:t3.filter(r=>r.TypeWoning===t.Key).filter(r=>/JJ00|KW/.test(r.Perioden)).map(r=>({period:r.Perioden, avg:r.GemiddeldeVerkoopprijs_7, sold:r.VerkochteWoningen_4})) }));

// 4) Kerncijfers wijken en buurten (latest table with WOZ at gemeente level)
const KWB = process.env.KWB || '86165NED'; await src(KWB);
const fields = ['Gemeentenaam_1','SoortRegio_2','Codering_3','AantalInwoners_5','Woningvoorraad_35','GemiddeldeWOZWaardeVanWoningen_39','PercentageEengezinswoning_40','PercentageMeergezinswoning_45','Koopwoningen_47','HuurwoningenTotaal_48','BouwjaarAfgelopenTienJaar_52','PersonenautoSParticulierenPerHh_107'];
const k = await all(`${B}/${KWB}/TypedDataSet?$format=json&$filter=substringof('GM',WijkenEnBuurten) or substringof('NL',WijkenEnBuurten)&$select=WijkenEnBuurten,${fields.join(',')}`);
const kern = {}; for (const r of k){ const c=r.WijkenEnBuurten.trim(); if(!/^(GM\d{4}|NL00)$/.test(c)) continue; kern[c.replace('NL00','NL01')] = { name:(r.Gemeentenaam_1||'').trim(), inhabitants:r.AantalInwoners_5, dwellings:r.Woningvoorraad_35, wozAvgK:r.GemiddeldeWOZWaardeVanWoningen_39, pctSingleFamily:r.PercentageEengezinswoning_40, pctMultiFamily:r.PercentageMeergezinswoning_45, pctOwner:r.Koopwoningen_47, pctRent:r.HuurwoningenTotaal_48, pctBuiltLast10y:r.BouwjaarAfgelopenTienJaar_52, carsPerHousehold:r.PersonenautoSParticulierenPerHh_107 }; }

// 5) Dwelling stock by floor-area class and type (83704NED), latest year, gemeenten + provinces + NL
await src('83704NED');
const ap = (await j(`${B}/83704NED/Perioden?$format=json`)).value.map(p=>p.Key); const ay = ap[ap.length-1];
const cls = (await j(`${B}/83704NED/Oppervlakteklasse?$format=json`)).value.map(c=>({key:c.Key.trim(),name:c.Title}));
let a=[]; for (const w of ['T001100','ZW10290','ZW10340']) for (const c of cls) a=a.concat(await all(`${B}/83704NED/TypedDataSet?$format=json&$filter=Perioden eq '${ay}' and Woningtype eq '${w}' and Oppervlakteklasse eq '${c.key}'`));
const area = {}; const wt = {T001100:'all',ZW10290:'house',ZW10340:'apartment'};
for (const r of a){ const c=r.RegioS.trim(); const t=wt[r.Woningtype.trim()]; if(!t) continue; ((area[c] ??= {})[t] ??= {})[r.Oppervlakteklasse.trim()] = r.BeginstandWoningvoorraad_1; }

// 6) PDOK boundaries (generalised), GeoJSON EPSG:4326
const yr = process.env.GEO_YEAR || '2025';
const geo = async l => j(`https://service.pdok.nl/cbs/gebiedsindelingen/${yr}/wfs/v1_0?service=WFS&version=2.0.0&request=GetFeature&typeNames=gebiedsindelingen:${l}_gegeneraliseerd&outputFormat=application/json&srsName=EPSG:4326`);
const round = g => JSON.parse(JSON.stringify(g, (k,v)=> typeof v==='number' ? Math.round(v*1e4)/1e4 : v));
for (const l of ['gemeente','provincie']){ const g=await geo(l); g.features.forEach(f=>{ f.properties={code:f.properties.statcode, name:f.properties.statnaam}; }); fs.writeFileSync(`data/geo-${l}.json`, JSON.stringify(round(g))); }
sources.pdok = { title:`CBS Gebiedsindelingen ${yr} (gegeneraliseerd) via PDOK`, url:'https://www.pdok.nl/introductie/-/article/cbs-gebiedsindelingen', license:'CC BY 4.0 (CBS/Kadaster)', credit:'Kaart: CBS/PDOK' };

const out = { fetchedAt: now, sources, regions: regs, prices, recent, byType, kern, kernTable: KWB, area:{ year: ay.slice(0,4), classes: cls, data: area },
  notAvailable: { rooms:'No free official regional source for number of rooms found (CBS/Kadaster). Not shown.', parking:'No free official source for parking/garage availability per region. Not shown. Cars per household (CBS) is context only, NOT a parking measure.' } };
fs.writeFileSync('data/housing.json', JSON.stringify(out));
console.log('ok', Object.keys(prices).length,'regions prices', Object.keys(kern).length,'kern', Object.keys(area).length,'area');
