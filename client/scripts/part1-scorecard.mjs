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
const consoleErrors = []
function check(name, ok, detail = '') {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
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

try {
  // Seed a fresh complaint via API as citizen, assign, start, submit repair,
  // then municipal RESOLVED — finally check scorecard in UI for all roles.
  await login('citizen@fixmycity.com')
  const created = await page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` }
    const fd = new FormData()
    fd.append('title', 'Part1 scorecard RESOLVED check')
    fd.append('description', 'Manual verification that scorecard survives RESOLVED status.')
    fd.append('severity', 'high')
    fd.append('latitude', '19.2200')
    fd.append('longitude', '72.9800')
    const imgRes = await fetch('http://127.0.0.1:5000/uploads/sample-pothole-1.jpg')
    const blob = await imgRes.blob()
    fd.append('image', blob, 'before.jpg')
    const res = await fetch('http://127.0.0.1:5000/api/complaints', { method: 'POST', headers, body: fd, credentials: 'include' })
    return res.json()
  })
  const complaintId = created?.complaint?._id
  check('Created test complaint', Boolean(complaintId), complaintId || JSON.stringify(created).slice(0, 200))
  if (!complaintId) throw new Error('No complaint id')

  // Get contractor id
  await login('municipal@fixmycity.com')
  const contractors = await page.evaluate(async () => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` }
    const candidates = [
      'http://127.0.0.1:5000/api/complaints/contractors',
      'http://127.0.0.1:5000/api/complaints/contractors/list',
      'http://127.0.0.1:5000/api/users/contractors'
    ]
    for (const url of candidates) {
      try {
        const res = await fetch(url, { headers, credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          if (data.contractors || data.users || Array.isArray(data)) return data
        }
      } catch { /* try next */ }
    }
    return { contractors: [] }
  })
  const contractorList = contractors.contractors || contractors.users || (Array.isArray(contractors) ? contractors : [])
  const contractorId = contractorList.find((c) => c.role === 'contractor' || c.email?.includes('contractor'))?._id || contractorList[0]?._id
  check('Found contractor for assignment', Boolean(contractorId), contractorId || JSON.stringify(contractors).slice(0, 200))

  const assign = await page.evaluate(async ({ id, contractorId }) => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }
    const res = await fetch(`http://127.0.0.1:5000/api/complaints/${id}/assign`, {
      method: 'POST', headers, credentials: 'include', body: JSON.stringify({ contractorId })
    })
    return { status: res.status, body: await res.json() }
  }, { id: complaintId, contractorId })
  check('Assigned contractor', assign.status === 200, JSON.stringify(assign.body).slice(0, 200))

  // Contractor: start + submit repair with after image (sample-repair)
  await login('contractor@fixmycity.com')
  const start = await page.evaluate(async (id) => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` }
    const res = await fetch(`http://127.0.0.1:5000/api/contractor/${id}/start-repair`, { method: 'POST', headers, credentials: 'include' })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }, complaintId)
  check('Started repair', start.status === 200, JSON.stringify(start.body).slice(0, 200))

  const submit = await page.evaluate(async (id) => {
    const headers = { Authorization: `Bearer ${localStorage.getItem('token')}` }
    const imgRes = await fetch('http://127.0.0.1:5000/uploads/sample-repair-1.png')
    const blob = await imgRes.blob()
    const fd = new FormData()
    fd.append('image', blob, 'after.png')
    fd.append('latitude', '19.2201')
    fd.append('longitude', '72.9801')
    fd.append('notes', 'Part1 manual UI check')
    const res = await fetch(`http://127.0.0.1:5000/api/contractor/${id}/repair-submission`, { method: 'POST', headers, body: fd, credentials: 'include' })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }, complaintId)
  check('Submitted repair evidence', submit.status === 200, `status=${submit.status} ${JSON.stringify(submit.body).slice(0, 250)}`)
  const scoreAtSubmit = submit.body?.complaint?.verificationResultId?.totalScore
  const decisionAtSubmit = submit.body?.complaint?.verificationResultId?.decision
  check('Repair returned populated verification', typeof scoreAtSubmit === 'number', `score=${scoreAtSubmit} decision=${decisionAtSubmit}`)

  // Contractor UI: open detail — scorecard should show WITHOUT reload
  await page.goto(`${BASE}/contractor/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(SHOTS, 'p1-contractor-after-submit.png'), fullPage: true })
  let panelText = await page.textContent('body')
  check('Contractor scorecard visible right after submit (no reload)', panelText.includes('AI Proof-of-Repair Verification') && panelText.includes('Total Score'), '')
  check('Criteria bars non-zero (gps/viewpoint keys fixed)', /GPS Match/.test(panelText) && !/0\/30\s*GPS/s.test(panelText), '')

  // Navigate away + hard reload — scorecard must still be there
  await page.goto(`${BASE}/contractor/dashboard`, { waitUntil: 'networkidle' })
  await page.goto(`${BASE}/contractor/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  panelText = await page.textContent('body')
  check('Contractor scorecard survives navigate-away + reload', panelText.includes('AI Proof-of-Repair Verification') && panelText.includes(`${scoreAtSubmit}/100`), `looking for ${scoreAtSubmit}/100`)

  // Municipal: status → RESOLVED
  await login('municipal@fixmycity.com')
  const resolve = await page.evaluate(async (id) => {
    const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` }
    const res = await fetch(`http://127.0.0.1:5000/api/complaints/${id}/status`, {
      method: 'PATCH', headers, credentials: 'include', body: JSON.stringify({ status: 'RESOLVED' })
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  }, complaintId)
  check('Municipal set status RESOLVED', resolve.status === 200, JSON.stringify(resolve.body).slice(0, 250))
  const scoreAfterResolve = resolve.body?.complaint?.verificationResultId?.totalScore
  check('Status response still returns populated score', scoreAfterResolve === scoreAtSubmit, `score=${scoreAfterResolve}`)

  // Municipal detail UI — scorecard after RESOLVED
  await page.goto(`${BASE}/municipal/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(SHOTS, 'p1-municipal-resolved.png'), fullPage: true })
  panelText = await page.textContent('body')
  check('Municipal scorecard after RESOLVED', panelText.includes('AI Proof-of-Repair Verification') && panelText.includes('Total Score'), '')
  check('Municipal shows score after RESOLVED', panelText.includes(`${scoreAtSubmit}/100`), `looking for ${scoreAtSubmit}/100`)
  check('Timeline shows score on RESOLVED step', /Resolved[\s\S]{0,200}Score:\s*\d+\/100/.test(panelText) || panelText.includes('Score:'), '')

  // Citizen detail — scorecard after RESOLVED
  await login('citizen@fixmycity.com')
  await page.goto(`${BASE}/citizen/complaint/${complaintId}`, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(2000)
  await page.screenshot({ path: path.join(SHOTS, 'p1-citizen-resolved.png'), fullPage: true })
  panelText = await page.textContent('body')
  check('Citizen scorecard after RESOLVED', panelText.includes('AI Proof-of-Repair Verification') && panelText.includes(`${scoreAtSubmit}/100`), '')

  // Hard reload on citizen page — still there
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(1500)
  panelText = await page.textContent('body')
  check('Citizen scorecard survives hard reload after RESOLVED', panelText.includes('AI Proof-of-Repair Verification') && panelText.includes(`${scoreAtSubmit}/100`), '')

  check('No unexpected console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | ') || 'clean')
} catch (err) {
  check(`PART1 UI CRASH: ${err.message}`, false)
  await page.screenshot({ path: path.join(SHOTS, 'p1-crash.png') }).catch(() => {})
} finally {
  await browser.close()
}

const failed = results.filter((r) => !r.ok)
console.log('\n========== PART 1 SCORECARD VERIFICATION ==========')
console.log(`TOTAL: ${results.length}  PASS: ${results.length - failed.length}  FAIL: ${failed.length}`)
if (failed.length) {
  failed.forEach((f) => console.log(`  ✗ ${f.name} ${f.detail}`))
  process.exit(1)
}
console.log('PART 1 VERIFIED — scorecard persists through RESOLVED ✅')
