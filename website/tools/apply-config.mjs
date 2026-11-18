// Fills the site's open values from site.config.json into the pages. Run from the repo root:
//
//   node website/tools/apply-config.mjs          apply
//   node website/tools/apply-config.mjs --check  list what is still missing, change nothing
//
// In the HTML each value is an element with data-config="<key>": a highlighted <span class="todo"> while the value is
// missing, plain text (or a mailto link for supportEmail) once it is set. The script can be run again after a change.
// With "domain" set it also adds canonical, og:url and link preview image tags (assets/img/og-image.png, made by
// store/promo/render.sh); without a domain the pages carry no absolute URLs.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const config = JSON.parse(fs.readFileSync(path.join(site, 'site.config.json'), 'utf8'))
const check = process.argv.includes('--check')
const pages = fs.readdirSync(site).filter((f) => f.endsWith('.html'))

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const element = /<(span|a)\b[^>]*\bdata-config="([A-Za-z]+)"[^>]*>([\s\S]*?)<\/\1>/g

const missing = new Map()
for (const page of pages) {
  const file = path.join(site, page)
  let html = fs.readFileSync(file, 'utf8')
  html = html.replace(element, (whole, _tag, key, inner) => {
    const value = config[key]
    if (!value) {
      missing.set(key, [...(missing.get(key) ?? []), page])
      // Keep (or restore) the placeholder, preserving its text.
      const text = /class="todo"/.test(whole) ? inner : `${key}, to be added`
      return `<span class="todo" data-config="${key}">${text}</span>`
    }
    if (key === 'supportEmail') return `<a data-config="${key}" href="mailto:${esc(value)}">${esc(value)}</a>`
    return `<span data-config="${key}">${esc(value)}</span>`
  })
  if (config.domain) {
    const url = `https://${config.domain}/${page === 'index.html' ? '' : page}`
    const image = `https://${config.domain}/assets/img/og-image.png`
    html = html.replace(/\s*<link rel="canonical"[^>]*>|\s*<meta (?:property="og:(?:url|image[a-z:]*)"|name="twitter:card")[^>]*>/g, '')
    html = html.replace(
      /(\s*)<link rel="stylesheet"/,
      [
        `<link rel="canonical" href="${url}">`,
        `<meta property="og:url" content="${url}">`,
        `<meta property="og:image" content="${image}">`,
        '<meta property="og:image:width" content="1200">',
        '<meta property="og:image:height" content="630">',
        '<meta property="og:image:alt" content="Lock-In: Keep your word. The Android app showing a step goal.">',
        '<meta name="twitter:card" content="summary_large_image">',
        '<link rel="stylesheet"',
      ].map((tag) => `$1${tag}`).join(''),
    )
  }
  if (!check) fs.writeFileSync(file, html)
}

if (!config.domain) missing.set('domain', ['canonical / og:url tags', 'app identity (seeker-app/constants/app-config.ts)'])
if (missing.size === 0) console.log('All site values are set.')
for (const [key, where] of missing) console.log(`missing: ${key}  (${[...new Set(where)].join(', ')})`)
