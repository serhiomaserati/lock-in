// Checks the website in a headless Chromium browser (Edge or Chrome) and takes screenshots. No npm packages:
// a tiny static server, and the browser driven over the DevTools protocol (Node 22+ has WebSocket built in).
//
//   node website/tools/check-site.mjs [screenshot folder]
//
// Per page and width (360, 390, 768, 1440, and 1440 at 200 % zoom = 720 CSS px):
// horizontal overflow, elements wider than the viewport, broken images, console errors and failed requests,
// fonts actually loaded. Also: every internal link and #anchor, keyboard focus outline, the page without JavaScript,
// and contrast of the colour pairs the site uses.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shotsDir = process.argv[2] ? path.resolve(process.argv[2]) : null
const PAGES = ['index.html', 'how-it-works.html', 'privacy.html', 'terms.html', 'support.html']
const WIDTHS = [
  { name: '360', width: 360, scale: 2, mobile: true },
  { name: '390', width: 390, scale: 3, mobile: true },
  { name: '768', width: 768, scale: 2, mobile: true },
  { name: '1440', width: 1440, scale: 1, mobile: false },
  { name: '1440-zoom200', width: 720, scale: 2, mobile: false },
]
const problems = []
const note = (msg) => problems.push(msg)

// ---------------------------------------------------------------- static server
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.mjs': 'text/javascript', '.txt': 'text/plain' }
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x')
  let file = path.join(site, decodeURIComponent(url.pathname))
  if (file.endsWith(path.sep) || url.pathname === '/') file = path.join(file, 'index.html')
  if (!file.startsWith(site) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found')
    return
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' })
  fs.createReadStream(file).pipe(res)
})
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}/`

// ---------------------------------------------------------------- browser
const candidates = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]
const exe = candidates.find((p) => fs.existsSync(p))
if (!exe) throw new Error('No Edge or Chrome found')
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lockin-site-check-'))
const port = 9300 + Math.floor(Math.random() * 500)
const browser = spawn(exe, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' })
let target
for (let i = 0; i < 50 && !target; i++) {
  await new Promise((r) => setTimeout(r, 200))
  try {
    target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page')
  } catch {}
}
if (!target) throw new Error('Browser did not start')

const ws = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let nextId = 0
const pending = new Map()
const listeners = []
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id)
    pending.delete(msg.id)
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
  } else if (msg.method) listeners.forEach((l) => l(msg))
})
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })
const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value

let current = ''
listeners.push((m) => {
  if (m.method === 'Runtime.exceptionThrown') note(`${current}: JS exception ${m.params.exceptionDetails.text}`)
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type))
    note(`${current}: console.${m.params.type} ${m.params.args.map((a) => a.value).join(' ')}`)
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') note(`${current}: ${m.params.entry.text} ${m.params.entry.url ?? ''}`)
  if (m.method === 'Network.loadingFailed') note(`${current}: request failed ${m.params.errorText}`)
  if (m.method === 'Network.responseReceived' && m.params.response.status >= 400) note(`${current}: ${m.params.response.status} ${m.params.response.url}`)
})
await send('Page.enable')
await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')

async function load(url, w) {
  current = `${url.replace(base, '')} @${w.name}`
  await send('Emulation.setDeviceMetricsOverride', { width: w.width, height: 900, deviceScaleFactor: w.scale, mobile: w.mobile })
  const loaded = new Promise((r) => {
    const l = (m) => m.method === 'Page.loadEventFired' && (listeners.splice(listeners.indexOf(l), 1), r())
    listeners.push(l)
  })
  await send('Page.navigate', { url })
  await loaded
  await evaluate('document.fonts.ready.then(() => true)')
  // Scroll through once so lazy images load (as they would for a reader), then back to the top.
  await evaluate(`(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { scrollTo({ top: y, behavior: 'instant' }); await new Promise((r) => setTimeout(r, 40)) }
    await Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r })))
    scrollTo({ top: 0, behavior: 'instant' })
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    return true
  })()`)
}

async function shot(name, fullPage = true) {
  if (!shotsDir) return
  fs.mkdirSync(shotsDir, { recursive: true })
  const { cssContentSize } = await send('Page.getLayoutMetrics')
  const { data } = await send('Page.captureScreenshot', {
    format: 'png',
    captureBeyondViewport: fullPage,
    clip: { x: 0, y: 0, width: cssContentSize.width, height: fullPage ? Math.min(cssContentSize.height, 16000) : 900, scale: 1 },
  })
  fs.writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'))
}

// ---------------------------------------------------------------- layout checks per page and width
for (const page of PAGES) {
  for (const w of WIDTHS) {
    await load(base + page, w)
    const r = await evaluate(`(() => {
      const vw = document.documentElement.clientWidth
      const wide = [...document.querySelectorAll('body *')]
        .filter((el) => { const b = el.getBoundingClientRect(); return b.width > 0 && (b.right > vw + 1 || b.left < -1) })
        .slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' ' + Math.round(el.getBoundingClientRect().right))
      // Content that scrolls or is clipped inside a box (e.g. a table wider than its container) also counts.
      const clipped = [...document.querySelectorAll('body *')]
        .filter((el) => el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !['visible', 'clip'].includes(getComputedStyle(el).overflowX) && el.tagName !== 'HTML' && el.tagName !== 'BODY')
        .slice(0, 5).map((el) => el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : '') + ' ' + (el.scrollWidth - el.clientWidth) + 'px')
      const broken = [...document.images].filter((i) => !i.complete || i.naturalWidth === 0).map((i) => i.getAttribute('src'))
      const fonts = ['400 16px Inter', '600 16px Inter', '700 16px "Barlow Condensed"', 'italic 800 16px "Barlow Condensed"'].filter((f) => !document.fonts.check(f))
      return { overflow: document.documentElement.scrollWidth - vw, wide, clipped, broken, fonts }
    })()`)
    if (r.overflow > 0) note(`${current}: horizontal scroll ${r.overflow}px (${r.wide.join(', ')})`)
    else if (r.wide.length) note(`${current}: wider than viewport: ${r.wide.join(', ')}`)
    if (r.clipped.length) note(`${current}: content wider than its box: ${r.clipped.join(', ')}`)
    if (r.broken.length) note(`${current}: broken images ${r.broken.join(', ')}`)
    if (r.fonts.length) note(`${current}: fonts not loaded ${r.fonts.join(', ')}`)
  }
}

// ---------------------------------------------------------------- links and anchors
const ids = {}
for (const page of PAGES) ids[page] = new Set([...fs.readFileSync(path.join(site, page), 'utf8').matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))
let links = 0
for (const page of PAGES) {
  const html = fs.readFileSync(path.join(site, page), 'utf8')
  for (const [, href] of html.matchAll(/<a\b[^>]*\bhref="([^"]+)"/g)) {
    links++
    if (/^(https?:|mailto:|solanadappstore:)/.test(href)) { note(`${page}: external link ${href} (check by hand)`); continue }
    const [file, hash] = href.split('#')
    const targetPage = file === '' ? page : file
    if (!PAGES.includes(targetPage)) {
      const res = await fetch(new URL(href, base + page))
      if (!res.ok) note(`${page}: link ${href} → ${res.status}`)
      continue
    }
    if (hash && !ids[targetPage].has(hash)) note(`${page}: anchor #${hash} missing on ${targetPage}`)
  }
}

// ---------------------------------------------------------------- keyboard focus, no-JS, menu
await load(base + 'index.html', WIDTHS[3])
for (let i = 0; i < 3; i++) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 })
}
const focus = await evaluate(`(() => { const s = getComputedStyle(document.activeElement); return document.activeElement.textContent.trim().slice(0, 30) + ' | outline ' + s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor })()`)
if (!/solid 3px/.test(focus)) note(`focus outline not visible: ${focus}`)
await shot('check-focus-1440', false)

// The pages carry no scripts at all, so everything works without JavaScript (menu and FAQ are <details>).
const scripts = PAGES.filter((p) => /<script/i.test(fs.readFileSync(path.join(site, p), 'utf8')))
if (scripts.length) note(`pages with <script>: ${scripts.join(', ')}`)
await load(base + 'index.html', WIDTHS[1])
const faqWorks = await evaluate(`(() => { const d = document.querySelector('#faq details'); d.querySelector('summary').click(); return d.open })()`)
if (!faqWorks) note('FAQ: details did not open')
const menu = await evaluate(`(() => { const m = document.querySelector('.menu'); m.querySelector('summary').click(); const p = m.querySelector('.menu-panel').getBoundingClientRect(); return m.open && p.right <= document.documentElement.clientWidth })()`)
if (!menu) note('Phone menu: did not open inside the viewport')
await shot('check-menu-open-390', false)

// ---------------------------------------------------------------- screenshots
const SHOTS = [
  ['index.html', 3, 'home-1440'],
  ['index.html', 1, 'home-390'],
  ['how-it-works.html', 3, 'how-it-works-1440'],
  ['how-it-works.html', 1, 'how-it-works-390'],
  ['privacy.html', 1, 'privacy-390'],
  ['terms.html', 3, 'terms-1440'],
  ['support.html', 1, 'support-390'],
]
for (const [page, wi, name] of SHOTS) {
  await load(base + page, WIDTHS[wi])
  await shot(name)
}

// ---------------------------------------------------------------- fragments (changed places)
// [page, width index, from selector, to selector or null (= the element itself), name]
const FRAGMENTS = [
  ['how-it-works.html', 0, '#not-met', '#safe-mode', 'frag-not-met-table-360'],
  ['how-it-works.html', 1, '#not-met', '#safe-mode', 'frag-not-met-table-390'],
  ['how-it-works.html', 4, '#not-met', '#safe-mode', 'frag-not-met-table-zoom200'],
  ['how-it-works.html', 1, '#fees', '#status', 'frag-fees-390'],
  ['privacy.html', 1, '#phone', '#health-connect', 'frag-privacy-phone-390'],
  ['privacy.html', 0, '#solana', '#services', 'frag-privacy-table-360'],
  ['index.html', 3, '.outcomes', null, 'frag-home-outcomes-1440'],
]
async function fragment([page, wi, from, to, name]) {
  await load(base + page, WIDTHS[wi])
  const box = await evaluate(`(() => {
    const a = document.querySelector('${from}').getBoundingClientRect()
    const end = ${to ? `document.querySelector('${to}').getBoundingClientRect().top - 16` : 'a.bottom'}
    return { x: 0, y: a.top + scrollY - 16, width: document.documentElement.clientWidth, height: end - a.top + 16 }
  })()`)
  fs.mkdirSync(shotsDir, { recursive: true })
  const { data } = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { ...box, scale: 1 } })
  fs.writeFileSync(path.join(shotsDir, `${name}.png`), Buffer.from(data, 'base64'))
}
if (shotsDir) for (const f of FRAGMENTS) await fragment(f)

// ---------------------------------------------------------------- contrast
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
const lum = (h) => { const [r, g, b] = hex(h); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05) }
const PAIRS = [['text on bg', '#f5f6f0', '#111310'], ['text-2 on bg', '#a3aa99', '#111310'], ['text-2 on card', '#a3aa99', '#1b1e18'], ['text-3 on bg', '#8a9182', '#111310'], ['text-3 on card', '#8a9182', '#1b1e18'], ['lime on bg', '#d4f66a', '#111310'], ['lime on card', '#d4f66a', '#1b1e18'], ['dark on lime', '#111310', '#d4f66a'], ['amber on bg', '#e6be76', '#111310'], ['amber on card', '#e6be76', '#1b1e18']]
const contrast = PAIRS.map(([n, f, b]) => `${n} ${ratio(f, b).toFixed(1)}`)
PAIRS.forEach(([n, f, b]) => ratio(f, b) < 4.5 && note(`contrast ${n} ${ratio(f, b).toFixed(2)} < 4.5`))

ws.close()
browser.kill()
server.close()
console.log(`Checked ${PAGES.length} pages × ${WIDTHS.length} widths, ${links} links. Focus: ${focus}. Pages with scripts: ${scripts.length}.`)
console.log(`Contrast: ${contrast.join(' · ')}`)
console.log(problems.length ? `\n${problems.length} problem(s):\n- ${problems.join('\n- ')}` : '\nNo problems found.')
if (shotsDir) console.log(`Screenshots: ${shotsDir}`)
