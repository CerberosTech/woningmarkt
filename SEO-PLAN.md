# SEO plan: Dutch housing market analyser (NL + EN)

Research date: 2026-10-17. Sources: Google autocomplete (suggestqueries.google.com, client=firefox, gl=nl, hl=nl and hl=en). Raw output: research/autocomplete.txt (partial run).
**No search volumes appear in this plan.** I had no access to a keyword-volume tool. Priority labels (High/Med/Low) are **estimates** based on how often a term shows up in autocomplete, its year variants and how many SERP competitors target it. Check them in Google Search Console after launch, or in Keyword Planner.

# 1. Keyword clusters

## NL clusters (seen in autocomplete)
- **Huizenprijzen <stad>** (High, est.): huizenprijzen utrecht, huizenprijzen amsterdam, huizenprijzen amersfoort, huizenprijzen utrecht 2026, huizenprijzen 2026, huizenprijzen 2027, huizenprijzen dalen, huizenprijzen verwachting, huizenprijzen cbs, huizenprijzen grafiek, huizenprijzen grafiek 10 jaar, huizenprijzen nederland.
- **Gemiddelde huizenprijs** (High, est.): gemiddelde huizenprijs nederland (2026), gemiddelde huizenprijs amsterdam/utrecht, gemiddelde huizenprijs per gemeente, gemiddelde huizenprijs nederland grafiek.
- **Hypotheekrente** (High, est.): hypotheekrente actueel, hypotheekrente verwachting, hypotheekrente 10 jaar vast, hypotheekrente vergelijken, hypotheekrente grafiek/ontwikkeling, hypotheekrente rabobank/ing/abn amro, hypotheekrenteaftrek (berekenen).
- **Maximale hypotheek berekenen** (High, est.; banks and Independer dominate the SERP): maximale hypotheek berekenen 2026, … rabobank/ing/abn/florius/asn/asr, … ondernemer.
- **Kosten koper** (Med-High, est.): kosten koper berekenen (2026), kosten koper percentage, kosten koper starters, kosten koper eerste huis, kosten koper meefinancieren, kosten koper betekenis, kosten koper hoeveel.
- **Overbieden** (Med, est.; low competition is the opportunity): overbieden huis, overbieden 2026, overbieden hypotheek, overbieden utrecht/amsterdam/groningen (2026), **overbieden huis per gemeente** (a perfect fit for the map).
- **WOZ waarde** (High, est., navigational toward wozwaardeloket): woz waarde checken/opzoeken/2026. Use it as a supporting topic only, because the government site owns the intent.
- **Huis kopen <stad>** (Med, est.): huis kopen utrecht, huis kopen amersfoort. Funda owns the listings intent, so target the "wat kost een huis in <stad>" angle instead.

## EN clusters (seen in autocomplete)
- **Buying a house in the Netherlands** (High for expats, est.): … as an expat, … as a foreigner, … as an american, … under 35, … process, … steps, … guide, … reddit, house buying costs netherlands.
- **Mortgage Netherlands** (High, est.): mortgage netherlands calculator, … rates, … interest rates, … comparison, … expat, … temporary contract, … non resident, … reddit.
- **30% ruling mortgage** (Low-Med, est.; the niche has little content): 30 ruling mortgage netherlands.
- **House prices Netherlands** (High, est.): house prices netherlands 2026, … graph/chart, … forecast, … history, … trend, … vs uk, … reddit.
- **Expat mortgage** (Med, est.): expat mortgage netherlands, expat mortgages amsterdam/utrecht/rotterdam, expat mortgage advisor.
- Inferred, not yet verified in autocomplete (check in GSC): house prices amsterdam/utrecht/rotterdam, transfer tax netherlands (overdrachtsbelasting), overbidding netherlands, NHG mortgage, kosten koper meaning.

"reddit" variants show up in EN autocomplete for every head term. That is a strong signal that expats trust community answers, so the launch plan in section 6 leans on that.

# 2. URL plan
Static GitHub Pages. NL is the default at root and EN sits at /en/ as a full mirror. Every page has a self-canonical plus `<link rel="alternate" hreflang="nl">`, `hreflang="en"` and `hreflang="x-default"` (pointing at the NL page), placed reciprocally on both language versions. Use one sitemap.xml with xhtml:link alternates. Keep slugs lowercase with hyphens. The NL slug is Dutch and the EN slug is English, mapped in a single routes file.

## Features (builder scope)
| Feature | NL URL / keywords | EN URL / keywords |
|---|---|---|
| Home / analyser | `/` — huizenmarkt nederland, huizenprijzen actueel | `/en/` — dutch housing market, netherlands housing market 2026 |
| NL price map | `/kaart/` — huizenprijzen kaart, gemiddelde huizenprijs per gemeente, overbieden per gemeente | `/en/map/` — netherlands house prices map, house prices by municipality |
| Per-city pages (top 25) | `/huizenprijzen/<stad>/` — huizenprijzen <stad> (2026), gemiddelde huizenprijs <stad>, overbieden <stad> | `/en/house-prices/<city>/` — house prices <city>, average house price <city> |
| City comparison | `/vergelijk/<stad-a>-vs-<stad-b>/` + `/vergelijk/` — huizenprijzen vergelijken, <a> of <b> wonen | `/en/compare/<a>-vs-<b>/` — <a> vs <b> cost of living housing |
| Affordability check | `/maximale-hypotheek-berekenen/` — maximale hypotheek berekenen (2026), hoeveel hypotheek kan ik krijgen, wat kan ik betalen | `/en/mortgage-calculator/` — mortgage netherlands calculator, how much can I borrow netherlands, maximum mortgage netherlands |
| Kosten koper calculator | `/kosten-koper-berekenen/` — kosten koper berekenen 2026, kosten koper percentage, kosten koper starters | `/en/buying-costs-calculator/` — house buying costs netherlands, kosten koper meaning, transfer tax calculator |
| Mortgage rates hub | `/hypotheekrente/` — hypotheekrente actueel, hypotheekrente vergelijken | `/en/mortgage-rates/` — mortgage netherlands rates, dutch mortgage interest rates |
| Rate by term | `/hypotheekrente/10-jaar-vast/` (also 5, 20, 30) — hypotheekrente 10 jaar vast | `/en/mortgage-rates/10-year-fixed/` |
| Rate trend | `/hypotheekrente/verwachting/` — hypotheekrente verwachting, grafiek, ontwikkeling | `/en/mortgage-rates/forecast/` |
| National prices | `/huizenprijzen/` — huizenprijzen nederland, huizenprijzen grafiek 10 jaar, gemiddelde huizenprijs nederland | `/en/house-prices/` — house prices netherlands graph, history, forecast |
| Guides hub | `/gidsen/<slug>/` (from content/gidsen/<slug>.md) | `/en/guides/<slug>/` |

Do not create pages for each bank (rabobank/ing hypotheekrente). Those are brand-navigational queries and thin content. Mention the banks inside the rates hub instead.

**Top 25 cities (city slugs):** amsterdam, rotterdam, den-haag, utrecht, eindhoven, groningen, tilburg, almere, breda, nijmegen, apeldoorn, arnhem, haarlem, haarlemmermeer, amersfoort, zaanstad, den-bosch, zwolle, leiden, maastricht, dordrecht, zoetermeer, leeuwarden, delft, alkmaar. This list is roughly by municipality population. Swap in deventer or enschede if CBS data argues for it.

Each city page must carry unique data so it is not thin: median price trend, overbidding %, price per m², time on market, neighbourhood map, and links to 2 comparisons and nearby cities. Add schema: Dataset plus BreadcrumbList on the data pages, FAQPage only where there is a real FAQ, and WebApplication on the calculators. Show the "last updated" date visibly and set `dateModified`.

# 3. Competitor gaps
Caveat: this is based on autocomplete, which shows which brands appear (Rabobank, ING, ABN, Independer, Florius, berekenhet), and on general knowledge of the sites. The sitemap crawl was cut short, so I did not deep-audit the competitor sitemaps. Treat this section as hypotheses to check.
- **Funda / Huizenzoeker**: they own listings and per-city price stats, but only in Dutch, and they barely explain anything. **Gap:** an EN city price page for expats, with explanations.
- **CBS / Kadaster / NVM**: authoritative, but offered as PDFs, tables and quarterly releases. Nothing is interactive per municipality, and they don't speak to consumers. **Gap:** one map that combines CBS prices with overbidding.
- **Independer / banks / hypotheekrente comparison sites**: strong calculators, but their goal is lead generation. They offer little that is expat-specific (30% ruling, temporary contract, non-resident). **Gap:** an independent EN calculator that explains each assumption.
- **IamExpat / expat mortgage brokers**: plenty of expat guides, but no live data. **Gap:** guides that pull in live rates and city prices.
- **"overbieden per gemeente"** and **"30 ruling mortgage"** look underserved (estimate). These are quick wins.

# 4. Top 10 guides to write first
Pipeline rules: content/gidsen/<slug>.md, '#' headings only, no tables, links to other guides by bare slug. Each guide gets an EN twin with an English slug under /en/guides/.

1. **kosten-koper** (EN twin: buying-costs-netherlands)
   # Wat is kosten koper # Overdrachtsbelasting en vrijstelling voor starters # Notaris, taxatie, advies # Rekenvoorbeeld in tekst # Meefinancieren? # Links: overbieden, maximale-hypotheek
2. **maximale-hypotheek** (how-much-can-i-borrow-netherlands)
   # Inkomen en woonquote # Toetsrente # Studieschuld en partner # NHG-grens # Rekenvoorbeeld # Link: kosten-koper
3. **huis-kopen-als-expat** (buying-a-house-as-an-expat)
   # Can foreigners buy # Steps from viewing to notary # BSN, contract, residency # Costs # Timeline # Links: mortgage-30-percent-ruling, kosten-koper
4. **hypotheek-30-procent-regeling** (30-percent-ruling-mortgage)
   # How lenders treat the 30% ruling # 2024–2027 phase-down effects # Example # Brokers vs banks
5. **overbieden** (overbidding-netherlands)
   # Hoe vaak wordt overboden (data per gemeente) # Taxatie lager dan bod # Eigen geld # Strategie # Link to map
6. **hypotheekrente-verwachting** (mortgage-rate-forecast-netherlands)
   # Waar de rente vandaan komt (ECB, swap) # Historie # Vast vs variabel # Rentevaste periode kiezen
7. **huis-kopen-stappenplan** (house-buying-steps-netherlands)
   # Oriëntatie # Bezichtiging # Bod en voorbehouden # Koopovereenkomst en bedenktijd # Notaris
8. **hypotheek-tijdelijk-contract** (mortgage-temporary-contract)
   # Intentieverklaring # Perspectiefverklaring # Flex/ZZP
9. **nhg-hypotheek** (nhg-mortgage-explained)
   # Wat is NHG # Grens 2026 (look up the actual figure) # Kosten en voordeel
10. **huizenprijzen-verwachting** (house-prices-netherlands-forecast)
   # CBS/Kadaster trend # Forecasts from DNB/banks (cited) # Regional differences # Link: per-city pages

YMYL warning: mortgage content counts as financial advice territory. Each guide needs an author/reviewer, sources, an update date, and a "not financial advice" disclaimer. Check AFM rules before using any affiliate links to mortgage advisers.

# 5. Data sources (check the licences before launch)
- **CBS StatLine / Open Data (OData API, opendata.cbs.nl)**: datasets include the price index for existing owner-occupied homes (bestaande koopwoningen) and average sale prices per region. Licence: CC BY 4.0. Commercial reuse is allowed; attribution "Bron: CBS" is required.
- **Kadaster**: some open data is available via PDOK (BAG, BRK aggregates, CC0/CC BY). Transaction-level price data is paid (Kadaster products) and must not be scraped. Kadaster/CBS aggregates published through CBS are fine.
- **DNB statistics**: the interest rates table for new mortgage loans to households (average by fixed-rate period). DNB permits reuse with source attribution; confirm on the DNB website's terms page. Note these are averages with a lag, not live offer rates.
- **ECB Data Portal**: euro area MFI rates and the Euribor context. Free reuse with attribution.
- **PDOK / CBS gebiedsindelingen**: municipality boundaries (GeoJSON) for the map. CC0 / CC BY.
- **Live bank rates**: do NOT scrape Funda, Huizenzoeker, NVM, Independer or the banks' rate pages without permission. Their terms forbid it and database rights apply. Option: copy published rates by hand with the date and a link, or arrange a partnership.
- **NVM quarterly figures**: these are press releases. You may cite figures with attribution, but do not republish the datasets.
- **Belastingdienst / Rijksoverheid**: transfer tax rates, the starter exemption, NHG limits (nhg.nl). Public information; cite it.

# 6. Launch and backlink plan
**Technical first:** Search Console plus Bing Webmaster for the domain (a custom domain beats github.io for authority), submit sitemap.xml with hreflang, prerender static HTML so the map/calculator pages contain crawlable text (not JS-only), meet Core Web Vitals, add OG images.

**Communities.** Rules change, so read each subreddit's sidebar/wiki before you post. The notes below are my understanding and have **not been verified today**.
- r/Netherlands (EN, expat-heavy): generally bans self-promotion and advertising. Best approach: answer the recurring "buying a house" or "30% ruling mortgage" threads with genuinely useful answers, and link only when it directly answers the question. Disclose that you made it. Message the mods before any launch post.
- r/thenetherlands (NL): strict about spam and promotion. Expect mostly organic mentions. Asking the mods about a data-viz post (e.g. an "overbieden per gemeente" map image citing CBS) is the safest route.
- r/geldzaken: Dutch personal finance, focused on questions. Answer kosten koper and maximale hypotheek questions; links are only acceptable as a cited source.
- r/expats: a global sub, so low relevance. Use it rarely.
- r/dataisbeautiful (OC posts allowed, with source rules), which fits the map visuals.
- Pace: the 90/10 rule (no more than 1 in 10 contributions about your own site). Never use alt accounts or vote manipulation.

**Directories and expat sites (legit):** IamExpat (submit to their housing or partner listings, or pitch a guest column), DutchNews.nl (pitch a data story), Expatica NL, the expat centres (IN Amsterdam, The Hague International Centre, Holland Expat Center South: ask about resource-list inclusion), university international offices (TU Delft, UvA, Utrecht housing pages), Startpagina-type themed pages (e.g. hypotheek.startpagina.nl), Product Hunt / Hacker News "Show HN" for the open-source map.

**Digital PR:** a quarterly "overbieden per gemeente" data release (CBS/Kadaster-based) pitched to local news (AD regional editions, Het Parool, DUIC, RTV regional stations). The open-source GitHub repo plus an embeddable map widget with attribution earns natural links.

**Avoid:** bought links, PBNs, comment spam, scraped competitor data.

**Timeline (estimate):** wk 1–2 technical setup and the 4 tools; wk 3–6 the 25 city pages (NL+EN) and guides 1–5; wk 7–10 guides 6–10, comparison pages for the top 10 city pairs, and the first data PR; month 3+ refresh city pages monthly and use GSC queries to reprioritise.
