# Guide pipeline (notes for writers; files starting with "_" are not published)

One file per guide per language: `content/gidsen/<slug>.md`.

Front matter (between `---` lines):

- `title` (required), `description` (required, about 150 characters)
- `lang`: `nl` (default) or `en`. NL guides go to `/gidsen/<slug>/`, EN guides to `/en/guides/<slug>/`.
- `slug`: optional, defaults to the file name.
- `twin`: slug of the same guide in the other language. Both files must point at each other. This makes the hreflang links.
- `updated`: `YYYY-MM-DD`. `author`, `reviewer`: shown in the byline (YMYL: fill them in).
- `slots`: optional comma list of ad placeholders: `verhuismatch`, `coolblue`, `overstappen`, `advisor`. Never `advisor` in a rates context.

Body rules:

- Use `#` headings (they become `<h2>`; the title is the `<h1>`). No tables.
- Link to another guide in the same language with its bare slug: `[kosten koper](kosten-koper)`. A missing guide gives a build warning.
- Link to site pages root-relative: `[kaart](/kaart/)`. The build adds the `/woningmarkt` base.
- Never type a figure that lives in `data/*.json`. Use a token instead. An unknown token stops the build.
- End with a `# Bronnen` / `# Sources` list.

Tokens (values follow the page language):

- `{{year}}` rules year; `{{dataYear}}` latest CBS price year; `{{cbsUpdated}}` CBS 83625NED update date
- `{{ttOwn}}` `{{ttStarter}}` `{{ttNotMain}}` `{{ttOther}}` transfer-tax rates
- `{{starterMax}}` `{{starterAgeMin}}` `{{starterAgeMax}}` starter exemption
- `{{nhgLimit}}` `{{nhgLimitEBV}}` `{{nhgFeePct}}` NHG; `{{toetsrenteMin}}` minimum test rate; `{{ltvMax}}` maximum loan-to-value
- `{{avgPriceNL}}` national average sale price in `{{dataYear}}`
- Worked example at that average price: `{{exTaxOwn}}` transfer tax at the own-home rate, `{{exStarterOk}}` / `{{exNhgOk}}` (ja/nee, yes/no) whether the starter exemption or NHG is possible, `{{exNhgLoan}}` / `{{exNhgFeeAtLimit}}` the NHG fee on a loan at the limit
