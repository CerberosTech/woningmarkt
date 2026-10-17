// Locale-aware number and date formatting for the two site languages.

export const LOCALE = { nl: 'nl-NL', en: 'en-GB' };
export const NA = { nl: 'geen officiële bron', en: 'no official source' };

const cache = new Map();
const nf = (lang, o) => { const k = lang + JSON.stringify(o); if (!cache.has(k)) cache.set(k, new Intl.NumberFormat(LOCALE[lang], o)); return cache.get(k); };

export const eur = (n, lang) => n == null || !Number.isFinite(n) ? NA[lang] : nf(lang, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0, minimumFractionDigits: 0 }).format(Math.round(n));
export const num = (n, lang, d = 0) => n == null || !Number.isFinite(n) ? NA[lang] : nf(lang, { maximumFractionDigits: d, minimumFractionDigits: d }).format(n);
/** Percentage from a percent value (5.2 -> "5,2%"). signed adds "+" for positive values. */
export const pct = (n, lang, d = 1, signed = false) => n == null || !Number.isFinite(n) ? NA[lang]
  : (signed && n > 0 ? '+' : '') + nf(lang, { maximumFractionDigits: d, minimumFractionDigits: d }).format(n) + '%';
/** Rule percentages as published: 2 -> "2%", 10.4 -> "10,4%", 0.4 -> "0,4%". */
export const rulePct = (n, lang) => nf(lang, { maximumFractionDigits: 2 }).format(n) + '%';
/** Compact euros for axes: 480000 -> "€ 480k" / "€480k". */
export const eurK = (n, lang) => (lang === 'nl' ? '€ ' : '€') + nf(lang, { maximumFractionDigits: 0 }).format(n / 1000) + 'k';

export const dateLong = (iso, lang) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString(LOCALE[lang], { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const monthLong = (ym, lang) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(LOCALE[lang], { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const monthShort = (ym, lang) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString(LOCALE[lang], { month: 'short', year: 'numeric', timeZone: 'UTC' });

/** CBS period codes: "2026KW02" -> "2e kwartaal 2026" / "Q2 2026"; "2025JJ00" -> "2025". */
export function period(code, lang, short = false) {
  const m = String(code).match(/^(\d{4})(KW|JJ|MM)(\d\d)$/);
  if (!m) return code;
  const [, y, kind, n] = m;
  if (kind === 'JJ') return y;
  if (kind === 'KW') return lang === 'nl' ? (short ? `K${+n} ${y}` : `${+n}e kwartaal ${y}`) : `Q${+n} ${y}`;
  return monthLong(`${y}-${n}`, lang);
}
