import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const SHOTS = path.join(ROOT, 'test-artifacts')
fs.mkdirSync(SHOTS, { recursive: true })

const BASE = 'http://127.0.0.1:5173'
const API = 'http://127.0.0.1:5000'

const results = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

try {
  const loginRes = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'municipal@fixmycity.com', password: 'password123' }),
  })
  const login = await loginRes.json()
  const token = login.token || login.accessToken
  check('Municipal login', Boolean(token))

  const listRes = await fetch(`${API}/api/complaints?page=1&limit=50`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const list = await listRes.json()
  const target = (list.complaints || []).find((c) => c.verificationResultId)
  check('Found complaint with verification result', Boolean(target?._id), target?.complaintId || 'none')
  if (!target) throw new Error('No seeded complaint with verification result')

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.fill('#email', 'municipal@fixmycity.com')
  await page.fill('#password', 'password123')
  await page.click('button[type=submit]')
  await page.waitForURL(/\/municipal\//, { timeout: 20000 })

  await page.goto(`${BASE}/municipal/complaint/${target._id}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForSelector('text=AI Proof-of-Repair Verification', { timeout: 15000 })
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(SHOTS, 'scorebar-fix.png'), fullPage: true })

  const fills = await page.evaluate(() => {
    const tracks = [...document.querySelectorAll('div')].filter(
      (d) => d.classList.contains('h-2.5') && d.classList.contains('overflow-hidden')
    )
    return tracks.map((t) => {
      const fill = t.firstElementChild
      if (!fill) return null
      return { width: fill.style.width, bg: fill.style.backgroundColor }
    }).filter(Boolean)
  })

  check('Score bar fills found (criteria + total)', fills.length >= 6, `count=${fills.length}`)
  const missingBg = fills.filter((f) => !f.bg || f.bg === 'transparent' || f.bg === 'rgba(0, 0, 0, 0)')
  check('Every fill has a background color', missingBg.length === 0, missingBg.length ? JSON.stringify(missingBg.slice(0, 3)) : 'all colored')
  const widths = fills.map((f) => parseFloat(f.width) || 0)
  check('At least one fill has non-zero width', widths.some((w) => w > 0), JSON.stringify(widths))

  const panelText = await page.textContent('body')
  const totalMatch = panelText.match(/Total Score\s*(\d+)\/100/)
  const totalScore = totalMatch ? Number(totalMatch[1]) : null
  check('Total score parsed from panel', typeof totalScore === 'number', `total=${totalScore}`)
  const totalBar = fills[fills.length - 1]
  if (typeof totalScore === 'number' && totalBar) {
    const barPct = parseFloat(totalBar.width) || 0
    check('Total bar width matches score', Math.abs(barPct - totalScore) <= 1, `bar=${barPct}% score=${totalScore}%`)
  }
} catch (err) {
  check(`SCOREBAR CHECK CRASH: ${err.message}`, false)
  await page.screenshot({ path: path.join(SHOTS, 'scorebar-crash.png') }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log('\n========== SCORE BAR CHECK ==========')
console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`)
if (failed.length) {
  failed.forEach((f) => console.log(`  ✗ ${f.name} ${f.detail}`))
  process.exit(1)
}
console.log('SCORE BARS RENDER FILLED ✅')
