# Lock-In website

Static site: plain HTML and CSS, no build step, no JavaScript needed, no external requests (fonts and images are local).

| Page | What it is |
|---|---|
| `index.html` | Landing page: what Lock-In is, how it works, the two goal types, the deposit, FAQ |
| `how-it-works.html` | The full deposit rules, checked against the app and the program |
| `privacy.html` | Privacy policy (draft; the dApp Store listing needs its URL) |
| `terms.html` | Terms of use (draft, needs legal review) |
| `support.html` | Help and troubleshooting |

Style: the app's Dark Athletic tokens (`seeker-app/components/lockin/theme.ts`), Inter for text, Barlow Condensed for
headings and numbers. Both fonts are SIL Open Font License 1.1; the licenses are in `assets/fonts/`.

## Open it locally
From the repo root:
```
python -m http.server 8080 --directory website
```
Then open http://localhost:8080. (Opening the files directly also works.)

## Values still to fill
Everything that isn't decided yet lives in **`site.config.json`**:

| Key | Used in |
|---|---|
| `operatorName` | Privacy, Terms |
| `supportEmail` | Privacy, Terms, Support (becomes a mailto link) |
| `hostingProvider` | Privacy (server logs) |
| `domain` | `canonical` and `og:url` tags on every page |

Fill them, then run `node website/tools/apply-config.mjs`. `--check` lists what is still missing. Missing values show
as highlighted placeholders on the pages. The Terms also have two legal placeholders (restrictions, liability and
governing law) that only a lawyer should fill.

## Assets
`python website/tools/build-assets.py` rebuilds the fonts (subset to Latin, WOFF2), the screen crops and the icons from
the app project. The screens are real app screenshots from release build `1668a31` (`design/release-1668a31`), showing
sample goals only (no wallet address, no personal goal names).

## Before it goes live
1. **Domain.** Choose and buy it, set `domain` in `site.config.json`, and use it as the app's identity in
   `seeker-app/constants/app-config.ts` (`uri` = `https://<domain>`, `domain` = the bare host). Rebuild the app.
2. **Fill the values above** and get the Privacy and Terms drafts reviewed.
3. **Host it.** Cloudflare Pages or GitHub Pages both work for free. `.nojekyll` makes GitHub Pages serve `.well-known`.
4. **Check app verification.** `https://<domain>/.well-known/assetlinks.json` must load. It ties the domain to the
   Android app `app.lockin.mobile` signed with the EAS key, SHA-256 `E3:7B:…:C6:39`. Without it, wallets such as Phantom
   show "This app's identity could not be verified".
