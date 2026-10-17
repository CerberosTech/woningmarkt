// Single routes file: NL slug and EN slug for every page. Paths are relative to the site base, with a trailing slash.

export const ROUTES = {
  home: { nl: '', en: 'en/' },
  map: { nl: 'kaart/', en: 'en/map/' },
  prices: { nl: 'huizenprijzen/', en: 'en/house-prices/' },
  compare: { nl: 'vergelijk/', en: 'en/compare/' },
  mortgage: { nl: 'maximale-hypotheek-berekenen/', en: 'en/mortgage-calculator/' },
  costs: { nl: 'kosten-koper-berekenen/', en: 'en/buying-costs-calculator/' },
  rates: { nl: 'hypotheekrente/', en: 'en/mortgage-rates/' },
  forecast: { nl: 'hypotheekrente/verwachting/', en: 'en/mortgage-rates/forecast/' },
  guides: { nl: 'gidsen/', en: 'en/guides/' },
  methods: { nl: 'methode-en-bronnen/', en: 'en/methods-and-sources/' },
  privacy: { nl: 'privacy/', en: 'en/privacy/' },
  disclosure: { nl: 'disclosure/', en: 'en/disclosure/' },
};

export const cityRoute = s => ({ nl: `huizenprijzen/${s}/`, en: `en/house-prices/${s}/` });
export const pairRoute = (a, b) => ({ nl: `vergelijk/${a}-vs-${b}/`, en: `en/compare/${a}-vs-${b}/` });
export const termRoute = n => ({ nl: `hypotheekrente/${n}-jaar-vast/`, en: `en/mortgage-rates/${n}-year-fixed/` });
export const guideRoute = (lang, s) => lang === 'nl' ? `gidsen/${s}/` : `en/guides/${s}/`;

// Top 25 municipalities. cbs = the municipality name in CBS/PDOK, used to find the GM code at build time.
export const CITIES = [
  { slug: 'amsterdam', cbs: 'Amsterdam' },
  { slug: 'rotterdam', cbs: 'Rotterdam' },
  { slug: 'den-haag', cbs: "'s-Gravenhage", nl: 'Den Haag', en: 'The Hague' },
  { slug: 'utrecht', cbs: 'Utrecht' },
  { slug: 'eindhoven', cbs: 'Eindhoven' },
  { slug: 'groningen', cbs: 'Groningen' },
  { slug: 'tilburg', cbs: 'Tilburg' },
  { slug: 'almere', cbs: 'Almere' },
  { slug: 'breda', cbs: 'Breda' },
  { slug: 'nijmegen', cbs: 'Nijmegen' },
  { slug: 'apeldoorn', cbs: 'Apeldoorn' },
  { slug: 'arnhem', cbs: 'Arnhem' },
  { slug: 'haarlem', cbs: 'Haarlem' },
  { slug: 'haarlemmermeer', cbs: 'Haarlemmermeer' },
  { slug: 'amersfoort', cbs: 'Amersfoort' },
  { slug: 'zaanstad', cbs: 'Zaanstad' },
  { slug: 'den-bosch', cbs: "'s-Hertogenbosch", nl: "'s-Hertogenbosch (Den Bosch)", en: "'s-Hertogenbosch (Den Bosch)" },
  { slug: 'zwolle', cbs: 'Zwolle' },
  { slug: 'leiden', cbs: 'Leiden' },
  { slug: 'maastricht', cbs: 'Maastricht' },
  { slug: 'dordrecht', cbs: 'Dordrecht' },
  { slug: 'zoetermeer', cbs: 'Zoetermeer' },
  { slug: 'leeuwarden', cbs: 'Leeuwarden' },
  { slug: 'delft', cbs: 'Delft' },
  { slug: 'alkmaar', cbs: 'Alkmaar' },
];

// Comparisons people search for. The build adds each city's two nearest cities, so every city page has 2+ comparisons.
// Order inside a pair follows the CITIES order (larger municipality first).
export const CURATED_PAIRS = [
  ['amsterdam', 'rotterdam'], ['amsterdam', 'utrecht'], ['rotterdam', 'den-haag'], ['rotterdam', 'utrecht'], ['den-haag', 'utrecht'],
  ['amsterdam', 'haarlem'], ['amsterdam', 'almere'], ['utrecht', 'amersfoort'], ['den-haag', 'leiden'], ['den-haag', 'delft'],
  ['eindhoven', 'den-bosch'], ['eindhoven', 'tilburg'], ['groningen', 'leeuwarden'], ['nijmegen', 'arnhem'], ['eindhoven', 'utrecht'],
];

// Rate term pages and the honest ECB fixation bucket for each.
export const TERMS = [
  { years: 5, series: 'I' },
  { years: 10, series: 'O' },
  { years: 20, series: 'P' },
  { years: 30, series: 'P' },
];
