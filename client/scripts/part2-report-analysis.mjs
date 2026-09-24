import { chromium } from 'playwright'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '../..')
const SHOTS = path.join(ROOT, 'test-artifacts')
fs.mkdirSync(SHOTS, { recursive: true })

const BASE = 'http://127.0.0.1:5173'

const results = []
const consoleErrors = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

const REPORT_ANALYSIS = {
  evidenceStatus: 'ACCEPTED',
  status: 'POTHOLE_DETECTED',
  isPothole: true,
  confidence: 92,
  severity: 'HIGH',
  defectType: 'Pothole',
  description: 'Large deep pothole in asphalt lane with broken edge crumbling into adjacent lane.',
  environment: 'Multi-lane urban highway, daytime, dry surface, metal guardrail on left.',
  evidenceQuality: 'GOOD',
  message: 'Pothole detected with 92% confidence. Evidence accepted.',
  analyzedAt: new Date().toISOString()
}

const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await context.newPage()

page.on('console', (msg) => {
  if (msg.type() !== 'error') return
  const text = `${msg.text()} ${msg.location()?.url || ''}`
  if (/logo\.png|favicon|ERR_FAILED|validate-image/i.test(text)) return
  consoleErrors.push(text)
})
page.on('pageerror', (err) => consoleErrors.push(String(err)))

async function login(email) {
  await context.clearCookies()
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.fill('#email', email)
  await page.fill('#password', 'password123')
  await page.click('button[type=submit]')
  await page.waitForURL(/\/(citizen|municipal|contractor)\//, { timeout: 20000 })
}

function hasReportPanel(text) {
  return text.includes('AI Report Validation') && text.includes('Evidence Quality')
}

function hasScorecard(text) {
  return text.includes('AI Proof-of-Repair Verification') && text.includes('Total Score')
}

try {
  // Create complaint with permanent report analysis (same payload ReportPothole.jsx sends)
  await login('citizen@fixmycity.com')
  const created = await page.evaluate(async ({ analysis }) => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` }
    const fd = new FormData()
    fd.append('title', 'Part2 permanent report analysis check')
    fd.append('description', 'Manual verification that report-time AI analysis survives RESOLVED.')
    fd.append('severity', 'high')
    fd.append('latitude', '19.2200')
    fd.append('longitude', '72.9800')
    fd.append('reportAnalysis', JSON.stringify(analysis))
    const imgRes = await fetch('http://127.0.0.1:5000/uploads/sample-pothole-2.jpg')
    const blob = await imgRes.blob()
    fd.append('image', blob, 'before.jpg')
    const res = await fetch('http://127.0.0.1:5000/api/complaints', { method: 'POST', headers, body: fd, credentials: 'include' })
    return res.json()
  }, { analysis: REPORT_ANALYSIS })
  const complaintId = created?.complaint?._id
  check('Created complaint with reportAnalysis', Boolean(complaintId), complaintId || JSON.stringify(created).slice(0, 200))
  if (!complaintId) throw new Error('No complaint id')
  check('Create response carries reportAnalysis', created?.complaint?.reportAnalysis?.evidenceStatus === 'ACCEPTED',
    JSON.stringify(created?.complaint?.reportAnalysis || {}).slice(0, 200))

  // Citizen detail — report panel visible at REPORTED
  await page.goto(`${BASE}/citizen/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  let text = await page.textContent('body')
  check('Citizen sees AI Report Validation panel at REPORTED', hasReportPanel(text), '')
  check('Report panel shows confidence + quality', text.includes('92%') && text.includes('GOOD'), '')

  // Assign → start → repair submit → RESOLVED
  await login('municipal@fixmycity.com')
  const contractors = await page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` }
    const res = await fetch('http://127.0.0.1:5000/api/complaints/contractors', { headers, credentials: 'include' })
    return res.json()
  })
  const contractorId = (contractors.contractors || []).find((c) => c.email?.includes('contractor'))?._id
    || (contractors.contractors || [])[0]?._id
  check('Found contractor for assignment', Boolean(contractorId), contractorId || '')

  const assign = await page.evaluate(async ({ id, contractorId }) => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }
    const res = await fetch(`http://127.0.0.1:5000/api/complaints/${id}/assign`, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify({ contractorId })
    })
    return { status: res.status }
  }, { id: complaintId, contractorId })
  check('Assigned contractor', assign.status === 200, `status=${assign.status}`)

  await login('contractor@fixmycity.com')
  const start = await page.evaluate(async (id) => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` }
    const res = await fetch(`http://127.0.0.1:5000/api/contractor/${id}/start-repair`, { method: 'POST', headers, credentials: 'include' })
    return { status: res.status }
  }, complaintId)
  check('Started repair', start.status === 200, `status=${start.status}`)

  const submit = await page.evaluate(async (id) => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` }
    const imgRes = await fetch('http://127.0.0.1:5000/uploads/sample-repair-1.png')
    const blob = await imgRes.blob()
    const fd = new FormData()
    fd.append('image', blob, 'after.png')
    fd.append('latitude', '19.2201')
    fd.append('longitude', '72.9801')
    fd.append('notes', 'Part2 manual UI check')
    const res = await fetch(`http://127.0.0.1:5000/api/contractor/${id}/repair-submission`, { method: 'POST', headers, body: fd, credentials: 'include' })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }, complaintId)
  const scoreAtSubmit = submit.body?.complaint?.verificationResultId?.totalScore
  check('Submitted repair evidence with score', submit.status === 200 && typeof scoreAtSubmit === 'number', `score=${scoreAtSubmit}`)

  // Contractor detail — BOTH panels before RESOLVED
  await page.goto(`${BASE}/contractor/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(1500)
  text = await page.textContent('body')
  check('Contractor sees report panel + scorecard before RESOLVED', hasReportPanel(text) && hasScorecard(text), '')

  // Municipal → RESOLVED
  await login('municipal@fixmycity.com')
  const resolve = await page.evaluate(async (id) => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }
    const res = await fetch(`http://127.0.0.1:5000/api/complaints/${id}/status`, {
      method: 'PATCH', headers, credentials: 'include', body: JSON.stringify({ status: 'RESOLVED' })
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }, complaintId)
  const ra = resolve.body?.complaint?.reportAnalysis
  check('Municipal set status RESOLVED', resolve.status === 200, `status=${resolve.status}`)
  check('Status response keeps reportAnalysis', ra?.evidenceStatus === 'ACCEPTED' && ra?.confidence === 92, JSON.stringify(ra || {}).slice(0, 200))

  // Municipal detail after RESOLVED — both panels
  await page.goto(`${BASE}/municipal/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(SHOTS, 'p2-municipal-resolved.png'), fullPage: true })
  text = await page.textContent('body')
  check('Municipal report panel after RESOLVED', hasReportPanel(text), '')
  check('Municipal scorecard after RESOLVED', hasScorecard(text), '')
  check('Municipal shows 92% + score', text.includes('92%') && text.includes(`${scoreAtSubmit}/100`), `score=${scoreAtSubmit}`)

  // Citizen detail after RESOLVED — both panels + hard reload
  await login('citizen@fixmycity.com')
  await page.goto(`${BASE}/citizen/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(SHOTS, 'p2-citizen-resolved.png'), fullPage: true })
  text = await page.textContent('body')
  check('Citizen report panel after RESOLVED', hasReportPanel(text), '')
  check('Citizen scorecard after RESOLVED', hasScorecard(text) && text.includes(`${scoreAtSubmit}/100`), '')

  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  text = await page.textContent('body')
  check('Citizen hard reload: both panels survive', hasReportPanel(text) && hasScorecard(text), '')

  // Contractor detail after RESOLVED — both panels
  await login('contractor@fixmycity.com')
  await page.goto(`${BASE}/contractor/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(SHOTS, 'p2-contractor-resolved.png'), fullPage: true })
  text = await page.textContent('body')
  check('Contractor report panel after RESOLVED', hasReportPanel(text), '')
  check('Contractor scorecard after RESOLVED', hasScorecard(text) && text.includes(`${scoreAtSubmit}/100`), '')

  check('No unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean')
} catch (err) {
  check(`PART2 UI CRASH: ${err.message}`, false)
  await page.screenshot({ path: path.join(SHOTS, 'p2-crash.png') }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log('\n========== PART 2 REPORT ANALYSIS VERIFICATION ==========')
console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`)
if (failed.length) {
  failed.forEach((f) => console.log(`  ✗ ${f.name} ${f.detail}`))
  process.exit(1)
}
console.log('PART 2 VERIFIED — report analysis + scorecard persist through RESOLVED ✅')
