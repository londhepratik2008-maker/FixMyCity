import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-key-for-jwt-signing-only';

const { app } = await import('../index.js');
const { default: request } = await import('supertest');
const mongoose = (await import('mongoose')).default;
const { MongoMemoryServer } = await import('mongodb-memory-server');
const { User, Complaint, Notification, RepairSubmission, VerificationResult } = await import('../models/index.js');
const { buildAnalysisResult } = await import('../routes/ai.js');
const { isGeminiConfigured } = await import('../services/gemini.js');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const POTH_IMAGE = [path.join(__dirname, '../../../POTH1.jpg'), path.join(__dirname, '../../../test-artifacts/POTH1.jpg')].find((p) => fs.existsSync(p)) || path.join(__dirname, '../../../POTH1.jpg');
const NOPOTH_IMAGE = [path.join(__dirname, '../../../NOPOTH4.png'), path.join(__dirname, '../../../test-artifacts/NOPOTH4.png')].find((p) => fs.existsSync(p)) || path.join(__dirname, '../../../NOPOTH4.png');
const hasPothImage = fs.existsSync(POTH_IMAGE);
const hasNopothImage = fs.existsSync(NOPOTH_IMAGE);
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

let mongod;
let token;
let citizenId;
let contractorId;
let municipalId;
let complaintId;

test.before(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  await Promise.all([
    User.deleteMany({}),
    Complaint.deleteMany({}),
    Notification.deleteMany({}),
    RepairSubmission.deleteMany({}),
    VerificationResult.deleteMany({})
  ]);

  const password = 'password123';
  const citizen = await User.create({ name: 'Aarav Sharma', email: 'citizen@test.com', password, role: 'citizen' });
  const contractor = await User.create({ name: 'Ramesh Gupta', email: 'contractor@test.com', password, role: 'contractor' });
  const municipal = await User.create({ name: 'TMC Ward Officer', email: 'municipal@test.com', password, role: 'municipal' });
  citizenId = citizen._id.toString();
  contractorId = contractor._id.toString();
  municipalId = municipal._id.toString();
});

test.after(async () => {
  try {
    if (mongoose.connection.readyState) {
      await mongoose.disconnect();
    }
  } finally {
    if (mongod) {
      await mongod.stop();
    }
  }
});

test('health endpoint', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'ok');
});

test('ai status endpoint', async () => {
  const res = await request(app).get('/api/ai/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.service, 'fixmycity-ai-brain');
  assert.equal(typeof res.body.geminiConfigured, 'boolean');
});

test('login as citizen', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'citizen@test.com', password: 'password123' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.role, 'citizen');
  assert.ok(res.body.token);
  token = res.body.token;
});

test('reject invalid credentials', async () => {
  const res = await request(app)
    .post('/api/auth/login')
    .send({ email: 'citizen@test.com', password: 'wrong' });
  assert.equal(res.status, 401);
});

test('me returns user', async () => {
  const res = await request(app)
    .get('/api/auth/me')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.user.email, 'citizen@test.com');
});

test('contractors endpoint requires municipal', async () => {
  const asCitizen = await request(app)
    .get('/api/complaints/contractors')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(asCitizen.status, 403);

  const municipalLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'municipal@test.com', password: 'password123' });
  const mToken = municipalLogin.body.token;

  const res = await request(app)
    .get('/api/complaints/contractors')
    .set('Authorization', `Bearer ${mToken}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.contractors));
  assert.ok(res.body.contractors.some(c => c.email === 'contractor@test.com'));
});

test('notifications list works with auth', async () => {
  const res = await request(app)
    .get('/api/notifications')
    .set('Authorization', `Bearer ${token}`);
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.notifications));
  assert.equal(typeof res.body.unreadCount, 'number');
});

test('unauthenticated complaints my rejected', async () => {
  const res = await request(app).get('/api/complaints/my');
  assert.equal(res.status, 401);
});

test('municipal stats endpoint', async () => {
  const municipalLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'municipal@test.com', password: 'password123' });
  const res = await request(app)
    .get('/api/complaints/stats')
    .set('Authorization', `Bearer ${municipalLogin.body.token}`);
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.totalComplaints, 'number');
});

test('validate-image: missing file returns 400', async () => {
  const res = await request(app).post('/api/ai/validate-image');
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, 'NO_IMAGE');
});

test('validate-image: invalid file type returns 400', async () => {
  const res = await request(app)
    .post('/api/ai/validate-image')
    .attach('image', Buffer.from('%PDF-1.4 fake'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, 'INVALID_TYPE');
});

test('validate-image: oversized file returns 400', async () => {
  const big = Buffer.alloc(11 * 1024 * 1024, 0);
  const res = await request(app)
    .post('/api/ai/validate-image')
    .attach('image', big, { filename: 'big.png', contentType: 'image/png' });
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, 'UPLOAD_ERROR');
});

test('validate-image: unconfigured key returns 503 config error, never fake scores', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  const prevKeyFile = process.env.GEMINI_KEY_FILE;
  process.env.GEMINI_API_KEY = '';
  process.env.GEMINI_KEY_FILE = path.join(__dirname, 'definitely-missing-key-file');
  try {
    const res = await request(app)
      .post('/api/ai/validate-image')
      .attach('image', TINY_PNG, { filename: 't.png', contentType: 'image/png' });
    assert.equal(res.status, 503);
    assert.equal(res.body.errorCode, 'GEMINI_NOT_CONFIGURED');
    assert.equal(res.body.confidence, undefined);
    assert.equal(res.body.valid, undefined);
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
    if (prevKeyFile === undefined) delete process.env.GEMINI_KEY_FILE;
    else process.env.GEMINI_KEY_FILE = prevKeyFile;
  }
});

test('check-repair-photo: missing file returns 400', async () => {
  const res = await request(app).post('/api/ai/check-repair-photo');
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, 'NO_IMAGE');
});

test('check-repair-photo: invalid file type returns 400', async () => {
  const res = await request(app)
    .post('/api/ai/check-repair-photo')
    .attach('image', Buffer.from('%PDF-1.4 fake'), { filename: 'doc.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, 'INVALID_TYPE');
});

test('check-repair-photo: oversized file returns 400', async () => {
  const big = Buffer.alloc(11 * 1024 * 1024, 0);
  const res = await request(app)
    .post('/api/ai/check-repair-photo')
    .attach('image', big, { filename: 'big.png', contentType: 'image/png' });
  assert.equal(res.status, 400);
  assert.equal(res.body.errorCode, 'UPLOAD_ERROR');
});

test('check-repair-photo: unconfigured key returns 503, never fake verdict', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  const prevKeyFile = process.env.GEMINI_KEY_FILE;
  process.env.GEMINI_API_KEY = '';
  process.env.GEMINI_KEY_FILE = path.join(__dirname, 'definitely-missing-key-file');
  try {
    const res = await request(app)
      .post('/api/ai/check-repair-photo')
      .attach('image', TINY_PNG, { filename: 'repair.png', contentType: 'image/png' });
    assert.equal(res.status, 503);
    assert.equal(res.body.errorCode, 'GEMINI_NOT_CONFIGURED');
    assert.equal(res.body.verdict, undefined);
    assert.equal(res.body.confidence, undefined);
    assert.equal(res.body.blocksSubmission, undefined);
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
    if (prevKeyFile === undefined) delete process.env.GEMINI_KEY_FILE;
    else process.env.GEMINI_KEY_FILE = prevKeyFile;
  }
});

test('buildAnalysisResult: confident pothole → ACCEPTED', () => {
  const r = buildAnalysisResult({
    isPothole: true,
    confidence: 87,
    severity: 'HIGH',
    defectType: 'Pothole',
    description: 'Large water-filled pothole in cracked asphalt.',
    environment: 'Urban road surface close-up.',
    evidenceQuality: 'GOOD'
  });
  assert.ok(r);
  assert.equal(r.valid, true);
  assert.equal(r.status, 'POTHOLE_DETECTED');
  assert.equal(r.evidenceStatus, 'ACCEPTED');
  assert.equal(r.confidence, 87);
  assert.equal(r.severity, 'HIGH');
});

test('buildAnalysisResult: confident non-pothole → INVALID_EVIDENCE', () => {
  const r = buildAnalysisResult({
    isPothole: false,
    confidence: 92,
    severity: null,
    defectType: 'None',
    description: 'Normal intact road surface, no defect visible.',
    environment: 'Rural road with utility covers.',
    evidenceQuality: 'GOOD'
  });
  assert.ok(r);
  assert.equal(r.valid, false);
  assert.equal(r.status, 'NO_POTHOLE');
  assert.equal(r.evidenceStatus, 'INVALID_EVIDENCE');
  assert.equal(r.severity, null);
});

test('buildAnalysisResult: low-confidence pothole → MANUAL_REVIEW', () => {
  const r = buildAnalysisResult({
    isPothole: true,
    confidence: 55,
    severity: 'MEDIUM',
    defectType: 'Pothole',
    description: 'Possible shallow defect.',
    environment: 'Road surface.',
    evidenceQuality: 'FAIR'
  });
  assert.ok(r);
  assert.equal(r.valid, true);
  assert.equal(r.evidenceStatus, 'MANUAL_REVIEW');
});

test('buildAnalysisResult: missing/malformed fields → null (never fabricated)', () => {
  assert.equal(buildAnalysisResult(null), null);
  assert.equal(buildAnalysisResult({ isPothole: true }), null);
  assert.equal(buildAnalysisResult({ isPothole: true, confidence: 'high', description: 'x', environment: 'y', evidenceQuality: 'GOOD' }), null);
});

test('buildAnalysisResult: INSUFFICIENT evidence downgrades ACCEPTED → MANUAL_REVIEW', () => {
  const r = buildAnalysisResult({
    isPothole: true,
    confidence: 80,
    severity: 'HIGH',
    defectType: 'Pothole',
    description: 'Blurry possible defect.',
    environment: 'Unknown.',
    evidenceQuality: 'INSUFFICIENT'
  });
  assert.ok(r);
  assert.equal(r.evidenceStatus, 'MANUAL_REVIEW');
});

test('validate-image LIVE: POTH1 detected as pothole', { skip: !isGeminiConfigured() || !hasPothImage }, async () => {
  const res = await request(app)
    .post('/api/ai/validate-image')
    .attach('image', POTH_IMAGE, { filename: 'POTH1.jpg', contentType: 'image/jpeg' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.isPothole, true);
  assert.equal(res.body.status, 'POTHOLE_DETECTED');
  assert.ok(res.body.confidence >= 0 && res.body.confidence <= 100);
  assert.ok(res.body.description && res.body.description.length > 10);
});

test('validate-image LIVE: NOPOTH4 rejected as non-pothole', { skip: !isGeminiConfigured() || !hasNopothImage }, async () => {
  await new Promise((r) => setTimeout(r, 60000));
  const res = await request(app)
    .post('/api/ai/validate-image')
    .attach('image', NOPOTH_IMAGE, { filename: 'NOPOTH4.png', contentType: 'image/png' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.isPothole, false);
  assert.equal(res.body.status, 'NO_POTHOLE');
  assert.equal(res.body.valid, false);
  assert.equal(res.body.evidenceStatus, 'INVALID_EVIDENCE');
});

test('verification scorecard persists after status → RESOLVED (Part 1 regression)', async () => {
  const municipalLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'municipal@test.com', password: 'password123' });
  const mToken = municipalLogin.body.token;

  const citizenLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'citizen@test.com', password: 'password123' });
  const cToken = citizenLogin.body.token;

  const contractorLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'contractor@test.com', password: 'password123' });
  const kToken = contractorLogin.body.token;

  const createRes = await request(app)
    .post('/api/complaints')
    .set('Authorization', `Bearer ${cToken}`)
    .field('title', 'Scorecard persistence test')
    .field('description', 'Verifying score survives RESOLVED status')
    .field('severity', 'medium')
    .field('latitude', '19.2183')
    .field('longitude', '72.9781')
    .attach('image', TINY_PNG, { filename: 't.png', contentType: 'image/png' });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  const id = createRes.body.complaint._id;

  const assignRes = await request(app)
    .post(`/api/complaints/${id}/assign`)
    .set('Authorization', `Bearer ${mToken}`)
    .send({ contractorId });
  assert.equal(assignRes.status, 200, JSON.stringify(assignRes.body));

  const startRes = await request(app)
    .post(`/api/contractor/${id}/start-repair`)
    .set('Authorization', `Bearer ${kToken}`);
  assert.equal(startRes.status, 200, JSON.stringify(startRes.body));

  const submitRes = await request(app)
    .post(`/api/contractor/${id}/repair-submission`)
    .set('Authorization', `Bearer ${kToken}`)
    .field('latitude', '19.2183')
    .field('longitude', '72.9781')
    .attach('image', TINY_PNG, { filename: 'after.png', contentType: 'image/png' });
  assert.equal(submitRes.status, 200, JSON.stringify(submitRes.body));

  const subComplaint = submitRes.body.complaint;
  assert.ok(subComplaint.verificationResultId, 'verification linked at submission');
  assert.equal(typeof subComplaint.verificationResultId.totalScore, 'number');
  assert.equal(typeof subComplaint.verificationResultId.decision, 'string');
  assert.ok(Array.isArray(subComplaint.verificationResultId.explanation));
  const scoreAtSubmit = subComplaint.verificationResultId.totalScore;
  const decisionAtSubmit = subComplaint.verificationResultId.decision;

  const statusRes = await request(app)
    .patch(`/api/complaints/${id}/status`)
    .set('Authorization', `Bearer ${mToken}`)
    .send({ status: 'RESOLVED' });
  assert.equal(statusRes.status, 200, JSON.stringify(statusRes.body));
  assert.equal(statusRes.body.complaint.status, 'RESOLVED');
  assert.ok(statusRes.body.complaint.verificationResultId, 'status update returns populated verification');
  assert.equal(statusRes.body.complaint.verificationResultId.totalScore, scoreAtSubmit);

  const reloadRes = await request(app)
    .get(`/api/complaints/${id}`)
    .set('Authorization', `Bearer ${cToken}`);
  assert.equal(reloadRes.status, 200, JSON.stringify(reloadRes.body));
  const reloaded = reloadRes.body.complaint;
  assert.equal(reloaded.status, 'RESOLVED');
  assert.ok(reloaded.verificationResultId, 'score still linked after RESOLVED + reload');
  assert.equal(reloaded.verificationResultId.totalScore, scoreAtSubmit);
  assert.equal(reloaded.verificationResultId.decision, decisionAtSubmit);
  assert.ok(reloaded.verificationResultId.explanation?.length > 0);

  const contractReload = await request(app)
    .get(`/api/contractor/${id}`)
    .set('Authorization', `Bearer ${kToken}`);
  assert.equal(contractReload.status, 200, JSON.stringify(contractReload.body));
  assert.ok(contractReload.body.complaint.verificationResultId, 'contractor GET returns score after RESOLVED');
  assert.equal(contractReload.body.complaint.verificationResultId.totalScore, scoreAtSubmit);
});

test('report analysis persists permanently through RESOLVED (Part 2 regression)', async () => {
  const citizenLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'citizen@test.com', password: 'password123' });
  const cToken = citizenLogin.body.token;

  const municipalLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'municipal@test.com', password: 'password123' });
  const mToken = municipalLogin.body.token;

  const contractorLogin = await request(app)
    .post('/api/auth/login')
    .send({ email: 'contractor@test.com', password: 'password123' });
  const kToken = contractorLogin.body.token;

  const reportAnalysis = {
    evidenceStatus: 'ACCEPTED',
    status: 'POTHOLE_DETECTED',
    isPothole: true,
    confidence: 91,
    severity: 'HIGH',
    defectType: 'Pothole',
    description: 'Deep pothole with exposed aggregate near lane marking.',
    environment: 'Urban arterial road, daytime, dry surface.',
    evidenceQuality: 'GOOD',
    message: 'Pothole detected with 91% confidence. Evidence accepted.',
    analyzedAt: new Date().toISOString()
  };

  const createRes = await request(app)
    .post('/api/complaints')
    .set('Authorization', `Bearer ${cToken}`)
    .field('title', 'Part2 permanent report analysis')
    .field('description', 'Verifying report-time AI analysis is stored and survives RESOLVED.')
    .field('severity', 'high')
    .field('latitude', '19.2183')
    .field('longitude', '72.9781')
    .field('reportAnalysis', JSON.stringify(reportAnalysis))
    .attach('image', TINY_PNG, { filename: 't.png', contentType: 'image/png' });
  assert.equal(createRes.status, 201, JSON.stringify(createRes.body));
  const id = createRes.body.complaint._id;

  assert.ok(createRes.body.complaint.reportAnalysis, 'reportAnalysis stored at create');
  assert.equal(createRes.body.complaint.reportAnalysis.evidenceStatus, 'ACCEPTED');
  assert.equal(createRes.body.complaint.reportAnalysis.confidence, 91);
  assert.equal(createRes.body.complaint.reportAnalysis.isPothole, true);
  assert.ok(createRes.body.complaint.reportAnalysis.description.includes('pothole'));
  assert.ok(createRes.body.complaint.reportAnalysis.message);

  // Reject invalid reportAnalysis payloads without failing create
  const badRes = await request(app)
    .post('/api/complaints')
    .set('Authorization', `Bearer ${cToken}`)
    .field('title', 'Part2 bad analysis payload')
    .field('description', 'Invalid reportAnalysis JSON should be ignored, not crash.')
    .field('severity', 'medium')
    .field('latitude', '19.2183')
    .field('longitude', '72.9781')
    .field('reportAnalysis', 'not-json{{{')
    .attach('image', TINY_PNG, { filename: 't2.png', contentType: 'image/png' });
  assert.equal(badRes.status, 201, JSON.stringify(badRes.body));
  assert.equal(badRes.body.complaint.reportAnalysis, undefined);

  // Full lifecycle: assign → start → repair → RESOLVED
  const contractorsRes = await request(app)
    .get('/api/complaints/contractors')
    .set('Authorization', `Bearer ${mToken}`);
  const targetContractor = contractorsRes.body.contractors.find((c) => c.email === 'contractor@test.com')
    || contractorsRes.body.contractors[0];
  assert.ok(targetContractor, 'contractor available');

  await request(app)
    .post(`/api/complaints/${id}/assign`)
    .set('Authorization', `Bearer ${mToken}`)
    .send({ contractorId: targetContractor._id })
    .expect(200);

  await request(app)
    .post(`/api/contractor/${id}/start-repair`)
    .set('Authorization', `Bearer ${kToken}`)
    .expect(200);

  const submitRes = await request(app)
    .post(`/api/contractor/${id}/repair-submission`)
    .set('Authorization', `Bearer ${kToken}`)
    .field('latitude', '19.2183')
    .field('longitude', '72.9781')
    .attach('image', TINY_PNG, { filename: 'after.png', contentType: 'image/png' });
  assert.equal(submitRes.status, 200, JSON.stringify(submitRes.body));

  const statusRes = await request(app)
    .patch(`/api/complaints/${id}/status`)
    .set('Authorization', `Bearer ${mToken}`)
    .send({ status: 'RESOLVED' });
  assert.equal(statusRes.status, 200, JSON.stringify(statusRes.body));

  const resolved = statusRes.body.complaint;
  assert.equal(resolved.status, 'RESOLVED');
  assert.ok(resolved.reportAnalysis, 'reportAnalysis still present on status update response');
  assert.equal(resolved.reportAnalysis.evidenceStatus, 'ACCEPTED');
  assert.equal(resolved.reportAnalysis.confidence, 91);
  assert.ok(resolved.verificationResultId, 'repair verification also present on RESOLVED');
  assert.equal(typeof resolved.verificationResultId.totalScore, 'number');

  const citizenReload = await request(app)
    .get(`/api/complaints/${id}`)
    .set('Authorization', `Bearer ${cToken}`);
  assert.equal(citizenReload.status, 200, JSON.stringify(citizenReload.body));
  const citizenView = citizenReload.body.complaint;
  assert.equal(citizenView.status, 'RESOLVED');
  assert.ok(citizenView.reportAnalysis, 'citizen GET keeps permanent report analysis after RESOLVED');
  assert.equal(citizenView.reportAnalysis.confidence, 91);
  assert.ok(citizenView.reportAnalysis.description.length > 10);
  assert.ok(citizenView.verificationResultId, 'citizen GET keeps repair scorecard after RESOLVED');

  const municipalReload = await request(app)
    .get(`/api/complaints/${id}`)
    .set('Authorization', `Bearer ${mToken}`);
  assert.equal(municipalReload.status, 200);
  assert.ok(municipalReload.body.complaint.reportAnalysis, 'municipal GET keeps report analysis');
  assert.ok(municipalReload.body.complaint.verificationResultId, 'municipal GET keeps scorecard');

  const contractorReload = await request(app)
    .get(`/api/contractor/${id}`)
    .set('Authorization', `Bearer ${kToken}`);
  assert.equal(contractorReload.status, 200);
  assert.ok(contractorReload.body.complaint.reportAnalysis, 'contractor GET keeps report analysis');
  assert.ok(contractorReload.body.complaint.verificationResultId, 'contractor GET keeps scorecard');
});
