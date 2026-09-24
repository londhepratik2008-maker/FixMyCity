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

async function apiLogin(email) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  })
  const data = await res.json()
  const token = data.token || data.accessToken
  if (!token) throw new Error(`Login failed for ${email}: ${JSON.stringify(data)}`)
  return token
}

// 1) Create complaint (citizen)
const citizenToken = await apiLogin('citizen@fixmycity.com')
const createFd = new FormData()
createFd.append('title', 'Repair AI live check')
createFd.append('description', 'E2E for live proof-of-repair verification on after-repair photo upload.')
createFd.append('severity', 'high')
createFd.append('latitude', '19.2200')
createFd.append('longitude', '72.9800')
createFd.append('image', new Blob([fs.readFileSync(path.join(ROOT, 'POTH1.jpg'))], { type: 'image/jpeg' }), 'before.jpg')
const created = await (await fetch(`${API}/api/complaints`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${citizenToken}` },
  body: createFd,
})).json()
const complaintId = created?.complaint?._id
check('Created test complaint', Boolean(complaintId), complaintId || JSON.stringify(created).slice(0, 200))

// 2) Assign contractor (municipal)
const municipalToken = await apiLogin('municipal@fixmycity.com')
let contractorId = null
for (const url of ['/api/complaints/contractors', '/api/complaints/contractors/list', '/api/users/contractors']) {
  try {
    const res = await fetch(`${API}${url}`, { headers: { Authorization: `Bearer ${municipalToken}` } })
    if (!res.ok) continue
    const data = await res.json()
    const list = data.contractors || data.users || (Array.isArray(data) ? data : [])
    const found = list.find((c) => c.role === 'contractor' || c.email?.includes('contractor'))
    if (found?._id) { contractorId = found._id; break }
  } catch { /* try next */ }
}
check('Found contractor', Boolean(contractorId), contractorId || 'none')
if (complaintId && contractorId) {
  const assignRes = await fetch(`${API}/api/complaints/${complaintId}/assign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${municipalToken}` },
    body: JSON.stringify({ contractorId }),
  })
  const assignBody = await assignRes.json().catch(() => ({}))
  check('Assigned contractor', assignRes.status === 200, JSON.stringify(assignBody).slice(0, 200))
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()
const consoleErrors = []
page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push(String(err)))

async function loginUi(email) {
  await context.clearCookies()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.fill('#email', email)
  await page.fill('#password', 'password123')
  await page.click('button[type=submit]')
  await page.waitForURL(/\/(citizen|municipal|contractor)\//, { timeout: 20000 })
}

try {
  if (!complaintId || !contractorId) throw new Error('Setup failed, aborting UI flow')

  await loginUi('contractor@fixmycity.com')
  await page.goto(`${BASE}/contractor/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForSelector('#repair-image-upload', { state: 'attached', timeout: 15000 })
  check('Repair form visible for assigned complaint', true)

  // ── Phase 1: REAL Gemini check — open pothole must be rejected + block submit ──
  await page.setInputFiles('#repair-image-upload', path.join(ROOT, 'POTH1.jpg'))
  await page.waitForSelector('[data-testid="repair-ai-analyzing"]', { timeout: 10000 })
  check('Analyzing state shown after photo select', true)

  await page.waitForSelector('[data-testid="repair-ai-rejected"], [data-testid="repair-ai-review"], [data-testid="repair-ai-accepted"]', { timeout: 120000 })
  await page.waitForTimeout(500)
  const phase1Rejected = await page.isVisible('[data-testid="repair-ai-rejected"]')
  check('Open-pothole photo → rejected view (live Gemini)', phase1Rejected)
  await page.screenshot({ path: path.join(SHOTS, 'repair-ai-rejected.png'), fullPage: true })

  // Submit must be blocked while AI verdict is NOT_A_REPAIR
  await page.click('[data-testid="submit-repair"]')
  await page.waitForTimeout(800)
  const blockedText = await page.textContent('body')
  check('Submit blocked with AI rejection message', blockedText.includes('AI rejected this photo'))
  const afterBlocked = await (await fetch(`${API}/api/contractor/${complaintId}`, {
    headers: { Authorization: `Bearer ${await apiLogin('contractor@fixmycity.com')}` },
  })).json()
  check('No repair submission was created while blocked', !afterBlocked?.complaint?.repairSubmissionId, JSON.stringify(afterBlocked?.complaint?.repairSubmissionId || null))

  // ── Phase 2: MOCKED accept verdict → accepted view + submission proceeds ──
  await page.route('**/api/ai/check-repair-photo', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        verdict: 'REPAIR_VISIBLE',
        confidence: 92,
        notes: 'The image shows a freshly filled asphalt patch with a smooth, level surface and no open cavity.',
        blocksSubmission: false,
        message: 'Repair photo accepted (92% confidence) — the image shows completed repair work.',
      }),
    })
  )

  await page.setInputFiles('#repair-image-upload', path.join(ROOT, 'POTH2.jpg'))
  await page.waitForSelector('[data-testid="repair-ai-accepted"]', { timeout: 20000 })
  check('Mocked accept verdict → accepted view', true)
  await page.screenshot({ path: path.join(SHOTS, 'repair-ai-accepted.png'), fullPage: true })

  await page.click('[data-testid="submit-repair"]')
  await page.waitForSelector('[data-testid="repair-ai-accepted"]', { state: 'detached', timeout: 30000 })
  check('Submission proceeded after accepted verdict (form cleared)', true)

  await page.waitForTimeout(2500)
  const submitted = await (await fetch(`${API}/api/contractor/${complaintId}`, {
    headers: { Authorization: `Bearer ${await apiLogin('contractor@fixmycity.com')}` },
  })).json()
  check('Repair submission persisted', Boolean(submitted?.complaint?.repairSubmissionId), `status=${submitted?.complaint?.status}`)
  check('Verification result attached to complaint', Boolean(submitted?.complaint?.verificationResultId),
    `score=${submitted?.complaint?.verificationResultId?.totalScore}`)

  await page.screenshot({ path: path.join(SHOTS, 'repair-ai-after-submit.png'), fullPage: true })

  const panelText = await page.textContent('body')
  check('Scorecard visible on contractor page after submit', panelText.includes('AI Proof-of-Repair Verification'))

  await page.unroute('**/api/ai/check-repair-photo')
  check('No unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean')
} catch (err) {
  check(`REPAIR AI CHECK CRASH: ${err.message}`, false)
  await page.screenshot({ path: path.join(SHOTS, 'repair-ai-crash.png') }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log('\n========== REPAIR PHOTO AI CHECK ==========')
console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`)
if (failed.length) {
  failed.forEach((f) => console.log(`  ✗ ${f.name} ${f.detail}`))
  process.exit(1)
}
console.log('LIVE REPAIR-PHOTO AI VERIFICATION ✅')
