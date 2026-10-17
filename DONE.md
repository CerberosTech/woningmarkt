# DONE: Woningmarkt NL build

Built on 2026-10-17. The site is complete as specified in BRIEF.md, SEO-PLAN.md section 2 and the legal notes in MONETIZATION.md.

## Result

- `node --test`: 31 tests, 31 pass (Node 26 locally; also on Node 20, the version the workflow uses).
- `node build.mjs`: 164 indexable pages (82 NL, 82 EN) plus `404.html`. The build takes less than 1 second. The Node 20 output is identical to the Node 26 output.
- `node scripts/check.mjs`: 330 page loads (165 URLs at 1280 px and 375 px), served under `/woningmarkt/`. Result: 0 console errors, 0 failed requests and 0 horizontal overflow. The script also drives the map, both calculators and the comparison tool at both widths. All gave the expected result.
- The SEH check case passes in the engine, the tests and the browser: income €46,500 at 5% gives 24.6% and a maximum mortgage of €177,573.

## Pages (NL / EN)

| Page | NL | EN | Count per language |
|---|---|---|---|
| Home | `/` | `/en/` | 1 |
| Map (SVG choropleth: 342 municipalities and 12 provinces; 4 metrics; click panel; search; `#GMxxxx` deep links; sortable table of all municipalities) | `/kaart/` | `/en/map/` | 1 |
| National house prices | `/huizenprijzen/` | `/en/house-prices/` | 1 |
| City pages (the 25 slugs from the brief) | `/huizenprijzen/<stad>/` | `/en/house-prices/<city>/` | 25 |
| Compare hub (any 2 of 342 municipalities, client-side) | `/vergelijk/` | `/en/compare/` | 1 |
| Compare pairs (15 curated, plus the 2 nearest cities of each city) | `/vergelijk/<a>-vs-<b>/` | `/en/compare/<a>-vs-<b>/` | 40 |
| Mortgage calculator | `/maximale-hypotheek-berekenen/` | `/en/mortgage-calculator/` | 1 |
| Buying-costs calculator | `/kosten-koper-berekenen/` | `/en/buying-costs-calculator/` | 1 |
| Rates hub (ECB/DNB chart and table, editorial lender table) | `/hypotheekrente/` | `/en/mortgage-rates/` | 1 |
| Rate terms 5, 10, 20, 30 | `/hypotheekrente/N-jaar-vast/` | `/en/mortgage-rates/N-year-fixed/` | 4 |
| Rate history ("forecast": history only) | `/hypotheekrente/verwachting/` | `/en/mortgage-rates/forecast/` | 1 |
| Guides hub and 1 sample guide | `/gidsen/`, `/gidsen/kosten-koper/` | `/en/guides/`, `/en/guides/buying-costs-netherlands/` | 2 |
| Methods and sources, privacy, disclosure | 3 pages | 3 pages | 3 |
| 404 (bilingual, noindex) | `/404.html` | — | 1 in total |

Each city page shows:

- a 10-year chart of the city, its province and NL;
- quarterly index figures (only for Amsterdam, Rotterdam, Den Haag and Utrecht, the only municipalities in CBS 85792NED);
- WOZ value and housing stock;
- the floor-area class distribution with the median class (no exact average m²);
- the national split of houses against apartments, labelled as national only;
- a local choropleth of the city and its neighbouring municipalities, with a table;
- 2 to 6 comparison links and the 4 nearest cities;
- a "what we do not show" box (rooms, parking, overbidding, price per m², time on market);
- an inactive advertiser slot for an adviser or estate agent.

## Files

- `build.mjs`: the builder. It reads `data/*.json` and `content/gidsen/*.md` and writes `dist/`.
- `lib/`: building blocks for the builder.
  - `routes.mjs`: the single routes file (NL/EN slugs, cities, pairs, terms).
  - `markdown.mjs`: the guide pipeline, adapted from the isde-checker builder.
  - `geo.mjs`: projection, simplification, interior points, province lookup and neighbours.
  - `charts.mjs`: inline SVG line charts.
  - `format.mjs`: number and date formatting for both languages.
- `engine/affordability.mjs`, `engine/costs.mjs`, `engine/stats.mjs`: pure ESM. The build copies them to `dist/engine/`, and the browser imports them.
- `test/`: `affordability`, `costs`, `stats` and `site`. The site test builds into a temp folder and checks:
  - hreflang reciprocity, canonicals, the sitemap and internal links;
  - JSON-LD, titles, the disclaimer and the CBS stamp;
  - that no page claims "live" or "real-time" data;
  - that the ad slots have no outbound links and that no slot is on a rate page;
  - that the city figures match `data/`.
- `src/`: `style.css`, `js/` (site, map, mortgage, costs, compare), `icon.svg`, `favicon.ico`, `apple-touch-icon.png`, `og-image.png` and the IndexNow key file `7050a14134a33070f25080bb4f9f5edd.txt`.
- `content/gidsen/`: `kosten-koper.md` (NL) and `buying-costs-netherlands.md` (EN), which are twins. `_README.md` holds the writer notes for Bragi: front matter, slots and the full token list.
- `.github/workflows/pages.yml`: runs on push to main, daily at 05:17 UTC and by hand.
  1. Fetch the data (continue on failure; restore the committed `data/` if the fetch fails).
  2. Run `node --test`, then `node build.mjs`.
  3. Upload `dist/` and deploy.
  4. Run the IndexNow job (`continue-on-error`).
- `scripts/indexnow.mjs`: adapted for `https://cerberostech.github.io/woningmarkt/` with key `7050a14134a33070f25080bb4f9f5edd`. The new option `--dry --local` reads `dist/sitemap.xml` (tested: 164 URLs).
- Helper scripts:
  - `scripts/serve.mjs`: local server under `/woningmarkt/`.
  - `scripts/check.mjs`: the browser check.
  - `scripts/chrome.mjs`: a Chrome DevTools client over a pipe.
  - `scripts/make-icons.mjs`: regenerates the icons and the OG image.
- `.gitignore`: `dist/` and `verify/` (screenshots from the check).

## How the "no invented numbers" rule is met

- Every figure on a page comes from `data/*.json`, directly or calculated from it (changes, shares, median class, tax and fee amounts).
- A missing value shows "geen officiële bron" / "no official source".
- Guides cannot contain hard-coded data figures. They use `{{tokens}}` that the build fills from the data, and an unknown token stops the build. The footer of a guide lists only the sources of the tokens it uses.
- The calculators do not assume market prices. Notary, valuation, advice and bank-guarantee costs start empty, and the page tells the user to enter amounts from quotes.
- The default purchase price is the CBS average for 2025. The default rate is the ECB/DNB average for the fixed-period series the user selects.

## Open issues

1. **Example input.** The mortgage calculator starts with an income of €46,500 and shows the SEH check case (€46,500 at 5%) as a worked example. These are example inputs from the brief, not data, and the page labels them as such. Remove them if you do not want any example input.
2. **Lender rates.** Only ABN AMRO has a rate (10 years fixed, NHG, by energy label, checked 2026-10-17). Rabobank, ING, de Volksbank and Obvion show "pending terms check" without numbers. The table therefore appears only on the hub and on the 10-year page.
3. **Ad slots are placeholders.** Coolblue Energie and Overstappen are on the buying-costs page. VerhuisMatch is on the compare pages and the buying guide. The adviser/estate-agent slot is on the mortgage calculator and the city pages. None has a live link. Before you activate one, update `/disclosure/` and `/privacy/`.
4. **Mortgage model limits.** The calculator uses the total test income that the user enters. It does not model the Trhk partner-income rules, other debts, alimony or ground lease. The page says so.
5. **Province level on the map.** There is no WOZ figure per province in the data, so the panel says "no data". The province share of multi-family homes comes from 83704NED, while the municipality share comes from 86165NED. Both the panel and the methods page say this.
6. **Map shape.** The CBS generalised boundaries include water, for example the IJsselmeer, so some municipalities look large. The map paths have no tab stops; keyboard users use the search field and the sortable table.
7. **Small chart text on phones.** At 375 px, chart labels are about 9 px. Every chart has a data table or a table next to it.
8. **Data recency.** Municipal prices are annual up to 2025 (83625NED, updated 17 Feb 2026). Quarterly figures (up to Q2 2026) exist only for NL, the provinces and the 4 largest cities.
9. **Guides.** Only the sample pair exists. The other 9 guides from SEO-PLAN section 4 are still to write. Each guide needs a reviewer name for YMYL (the `reviewer:` field is supported).
10. **Not a git repository.** This folder has no `.git`, so I made no commit. To publish:
    1. Create the repo `cerberostech/woningmarkt`, so the base path matches.
    2. Set Pages → Source to "GitHub Actions".
    3. Push to `main`.
11. **Repo link.** `/privacy/` links to `github.com/cerberostech/woningmarkt` for questions. Confirm that URL.
12. **Fetched data is not committed back.** The daily job builds from fresh data but does not commit it. The committed `data/` is the fallback. If fresh data breaks a test, the deploy stops and the live site stays as it was.

## GoatCounter

Added on 2026-10-17.

### What changed

- `build.mjs` has one `ANALYTICS` constant with the GoatCounter script. `page()` puts it just before `</body>`, so it is on all 165 pages, including the 404 page and the guides.
- Click names use one key per page. The key does not depend on the language, so NL and EN twins share it. GoatCounter records the page URL for each click, which shows the language.
  - Page keys: `home`, `map`, `prices`, `compare`, `calc-mortgage`, `calc-costs`, `rates`, `rates-forecast`, `guides`, `methods`, `privacy`, `disclosure`, `city-<slug>`, `compare-<a>-vs-<b>`, `rates-<n>y`, `guide-<nl slug>`, `404`.
  - Ad slots: `aff-coolblue-energie-<page>`, `aff-overstappen-<page>`, `aff-verhuismatch-<page>` and `lead-advisor-<page>`. Examples: `aff-coolblue-energie-calc-costs` and `lead-advisor-city-amsterdam`. The attribute is on the `<aside class="ad">`, because the slots have no link yet.
  - CTAs: `tagCtas()` names every link in `<main>` that goes to the map, a calculator, the compare tool or a comparison page. The name is `cta-<target>-<page>`, for example `cta-calc-mortgage-home` or `cta-compare-amsterdam-vs-utrecht-city-amsterdam`. If the same name occurs again on one page, it gets `-2`, `-3`. The menu, the footer and the breadcrumbs are navigation, so they get no CTA name.
  - Explicit names: `cta-map-home-hero`, `cta-calc-mortgage-home-hero`, `cta-map-home-hero-map`, `cta-compare-submit` (the button on the compare tool), `cta-localmap-city-<slug>` (all areas of the local map on a city page), `cta-map-404-nl` and `cta-map-404-en`.
  - Language switch: `nav-lang-en` / `nav-lang-nl` in the header, and `nav-lang-en-footer` / `nav-lang-nl-footer` in the footer.
  - The site has no newsletter, so there is no `newsletter-signup`.
- `/privacy/` and `/en/privacy/` now have a GoatCounter section. It says what we count (page views and clicks on CTAs, the language switch and ad slots) and that GoatCounter sets no cookies. It also says GoatCounter stores no IP address, no full User-Agent and no tracking ID. It names the storage location (Hetzner in Finland and Germany) and links to https://www.goatcounter.com/help/privacy. The lead text, the meta description and the "What we process" list were changed to match.
- `test/site.test.mjs` has 3 new tests:
  1. The script occurs exactly once on every page and comes just before `</body>`.
  2. Every ad slot has an `aff-`/`lead-` name, every language switch has a `nav-lang-` name, and every tool link in `<main>` has a `cta-` name. All names are lowercase kebab-case.
  3. Both privacy pages name GoatCounter and link its privacy policy.
- `scripts/chrome.mjs` has a new `stubs` option for `open()`. It answers matching requests locally with the DevTools Fetch domain. `scripts/check.mjs` stubs `*://gc.zgo.at/*`, so the check never counts a visit and needs no network. It also reports a problem if the script does not load exactly once on a page.

### Before an ad slot goes live

Move `data-goatcounter-click` from the `<aside>` to the outbound link. If you do not, a click on the disclosure link inside the slot also counts as a slot click. Update the test at the same time.

### Results

- `node --test`: 34 tests, 34 pass, 0 fail.
- `node build.mjs`: `wrote 164 indexable pages (nl 82, en 82) + 404; 25 cities, 40 comparisons, 2 guides; data year 2025`.
- `node scripts/check.mjs`: 330 page loads (165 URLs x 2 widths), 0 problems. The GoatCounter stub loaded once on every page load, and the check saw 5712 click-named elements in total. All interaction results are unchanged, for example the mortgage check case still gives € 177.573 / 24,6%.
- Not tested: real counting on goatcounter.com. That needs the live site and the `woningmarkt` GoatCounter account.
