// server.test.js — API contract tests (node:test + supertest).
// Env overrides MUST be set before any config-dependent module is imported,
// hence the dynamic imports below.
process.env.DB_FILE = `${process.env.TMPDIR || '/tmp'}/sansys-test-${process.pid}-${Date.now()}.db`;
process.env.LLM_PROVIDER = 'test';

import assert from 'node:assert/strict';
import { after } from 'node:test';
import { test } from 'node:test';
import { rmSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import patientFixture from '../test/fixtures/patient.js';

const { apiRouter } = await import('./routes.js');
const { listSpecialties, loadSpecialty } = await import('./specialties/index.js');
const { initStore } = await import('./store.js');
const { registerProvider } = await import('./llm/index.js');
const { buildDraftUserPrompt } = await import('./llm/prompts.js');
const { filterProblemsForEpisode } = await import('./dataAccess.js');
const { formatSectionText } = await import('./llm/format.js');

initStore();
const app = express();
app.use(express.json({ limit: '2mb' }));
app.use('/api', apiRouter);

const DFN = 'PAT123456';

// ---- Test doubles: no production mock data is involved ----
// LLM: register a deterministic stub under the LLM_PROVIDER name used above.
registerProvider('test', {
  async generateDraft(patientData, specialtyConfig) {
    const sections = {};
    for (const s of specialtyConfig.sections) {
      sections[s.id] = s.source === null ? '' : s.id === 'history-present-illness' ? 'first line\\nsecond line' : `draft-${s.id}`;
    }
    return { sections, provider: 'test' };
  },
  async regenerateSection(sectionId, patientData, specialtyConfig, existingDraft) {
    const section = specialtyConfig.sections.find((s) => s.id === sectionId);
    if (!section || section.source === null) return { text: '', provider: 'test' };
    return { text: `regen-${sectionId}`, provider: 'test' };
  },
});

// Sansys test API: stub global fetch with the live-shaped fixture. The vitals
// endpoint advertises an admission with empty readings first, then returns
// readings once called with an admissionId — exercising the fetchVitals retry.
const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });
let vitalsCalls = 0;
let problemsNetworkFails = 0;
let clinicalNoteDetailCalls = 0;
globalThis.fetch = async (input, options = {}) => {
  const url = String(input);
  let requestBody = {};
  try {
    requestBody = options.body ? JSON.parse(options.body) : {};
  } catch {}
  if (url.includes('/vitals/dash/load/')) {
    vitalsCalls += 1;
    return jsonRes(
      vitalsCalls === 1
        ? { success: true, data: { vitals: [], admissions: patientFixture.vitals.data.admissions } }
        : patientFixture.vitals,
    );
  }
  if (url.includes('/clinical-notes/view/')) {
    clinicalNoteDetailCalls += 1;
    return jsonRes({
      success: true,
      data: {
        content: [],
        patient_objects: {
          medications: [{ medication_name: 'NOTE-ONLY INJECTION', entry_datetime: '2026-08-02', status: 'ACTIVE', schedule: 'STAT' }],
        },
      },
    });
  }
  if (url.includes('/problems/dash-list')) {
    // Simulate one transient network reset (ECONNRESET) — dataAccess must
    // retry this call rather than fail the whole patient load.
    if (problemsNetworkFails < 1) {
      problemsNetworkFails += 1;
      throw Object.assign(new Error('fetch failed'), {
        cause: Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
      });
    }
    return jsonRes(patientFixture.problems);
  }
  if (url.includes('/patientHome/load-demographics/')) return jsonRes(patientFixture.demographics);
  if (url.includes('/clinical-notes/list')) return jsonRes(patientFixture.clinicalNotes);
  if (url.includes('/lab/list')) return jsonRes(patientFixture.labs);
  if (url.includes('/rad/cpoe-list')) return jsonRes(patientFixture.radiology);
  if (url.includes('/problems/dash-list')) return jsonRes(patientFixture.problems);
  if (url.includes('/diagnosis/dash/list')) return jsonRes(patientFixture.diagnosis);
  if (url.includes('/chiefcomplaint/dash-list/')) return jsonRes(patientFixture.chiefComplaints);
  if (url.includes('/allergies/dashboard-list/')) return jsonRes(patientFixture.allergies);
  if (url.includes('/med/list')) {
    if (requestBody.visit_id === 'empty-medication-episode') {
      return jsonRes({ success: true, data: { orders: [] } });
    }
    return jsonRes(patientFixture.medications);
  }
  throw new Error(`test stub: unexpected Sansys URL ${url}`);
};

// supertest convenience wrappers
const GET = (path) => request(app).get(path);
const POST = (path, body) => request(app).post(path).send(body ?? {});

test('GET /api/patients/:dfn returns the normalized patient from live-shaped responses', async () => {
  const res = await GET(`/api/patients/${DFN}`);
  assert.equal(res.status, 200);
  const p = res.body;
  assert.equal(p.dfn, DFN);
  assert.equal(p.demographics.firstName, 'Rohit');
  assert.equal(p.demographics.lastName, 'Sharma');
  assert.ok(Array.isArray(p.diagnoses) && p.diagnoses.length > 0);
  assert.equal(p.diagnoses[0].diagnosis, 'Erythrodermic psoriasis flare');
  assert.ok(p.allergies && Array.isArray(p.allergies.items) && p.allergies.items.length === 2);
  // newest vitals last
  const times = p.vitals.map((v) => v.dateTime);
  assert.deepEqual(times, [...times].sort());
  // the retry path ran: one empty + one populated vitals call
  assert.equal(vitalsCalls, 2);
  // the injected ECONNRESET on problems was retried, not fatal
  assert.equal(problemsNetworkFails, 1);
  assert.equal(clinicalNoteDetailCalls, 0, 'patient data load should defer note details');
});

test('patient shell is available before full clinical data and note details', async () => {
  const res = await GET(`/api/patients/${DFN}/shell`);
  assert.equal(res.status, 200);
  assert.equal(res.body.dfn, DFN);
  assert.ok(Array.isArray(res.body.episodes));
  assert.deepEqual(res.body.notes, []);
  assert.deepEqual(res.body.diagnoses, []);
  assert.equal(clinicalNoteDetailCalls, 0);
});

test('complaint prompt groups repeated records by type and name', () => {
  const prompt = buildDraftUserPrompt(
    {
      complaints: [
        { name: ' ABDOMINAL PAIN ', type: 'Chief Complaint', date: '10 JUL 2026', remark: '' },
        { name: 'ABDOMINAL PAIN', type: 'Chief Complaint', date: '09 JUL 2026', remark: '' },
        { name: 'Nausea', type: 'Associated Complaint', date: '09 JUL 2026', remark: 'Two days' },
      ],
    },
    {
      label: 'General',
      sections: [{ id: 'presenting-complaints', title: 'Presenting Complaints', source: 'complaints', promptHint: '' }],
    },
  );
  assert.equal((prompt.match(/"name": "ABDOMINAL PAIN"/g) || []).length, 1);
  assert.match(prompt, /recordedDates/);
  assert.match(prompt, /recordedRemarks/);
});

test('future problem records are excluded from an older episode', () => {
  const problems = filterProblemsForEpisode([
    { problem: 'Recorded during episode', status: 'ACTIVE', dateEntered: '09 JUL 2026', dateOnset: '09 JUL 2026', comorbidity: '1' },
    { problem: 'Recorded after episode', status: 'ACTIVE', dateEntered: '03 AUG 2026', dateOnset: '03 AUG 2026', comorbidity: '0' },
    { problem: 'Undated longstanding history', status: 'ACTIVE', dateOnset: '2015-01-01', comorbidity: '1' },
  ], { dateFrom: '2025-05-25', dateTo: '2026-07-22' });
  assert.deepEqual(problems.map((problem) => problem.problem), ['Recorded during episode', 'Undated longstanding history']);
  assert.equal(problems[0].comorbidity, true);
});

test('medication formatting exposes schedule and dates without status', () => {
  const text = formatSectionText('current-medication', '', {
    activeMedications: [{ medication: 'Tablet A', schedule: 'Not Specified', scheduleType: 'R', startDate: '2026-08-01', stopDate: '' }],
  });
  assert.equal(text, '- Tablet A; schedule: Not Specified (type: R); start: 2026-08-01; stop: ongoing');
  assert.equal(text.includes('ACTIVE'), false);
});

test('empty advice sections receive concise diagnosis-grounded drafts', () => {
  const patient = { diagnoses: [{ diagnosis: 'Recorded diagnosis', isPrimary: true }] };
  assert.match(formatSectionText('advice', '', patient), /Recorded diagnosis/);
  assert.match(formatSectionText('follow-up-advice', '', patient), /Recorded diagnosis/);
});

test('draft text converts escaped line breaks to rendered line breaks', async () => {
  const res = await POST(`/api/patients/${DFN}/draft`, { specialty: 'general', episodeId: 'line-break-test' });
  assert.equal(res.status, 200);
  assert.equal(res.body.sections['history-present-illness'], 'first line\nsecond line');
  assert.match(res.body.sections['presenting-complaints'], /\n/);
  assert.ok(res.body.sourceData && res.body.sourceData.notes);
});

test('note-embedded medications do not enter canonical episode medication data', async () => {
  const res = await POST(`/api/patients/${DFN}/draft`, { specialty: 'general', episodeId: 'empty-medication-episode' });
  assert.equal(res.status, 200);
  assert.ok(res.body.sourceData && Array.isArray(res.body.sourceData.medications));
  assert.equal(res.body.sourceData.medications.length, 0);
  assert.equal(res.body.sourceData.activeMedications.length, 0);
  assert.equal(res.body.sourceData.dischargeMedications.length, 0);
  assert.equal(res.body.sourceData.medications.some((item) => item.medication === 'NOTE-ONLY INJECTION'), false);
  assert.equal(res.body.sourceData.activeMedications.some((item) => item.medication === 'NOTE-ONLY INJECTION'), false);
});

for (const spec of listSpecialties()) {
  test(`draft covers every section of ${spec.key} (${spec.sectionCount} sections)`, async () => {
    const res = await POST(`/api/patients/${DFN}/draft`, { specialty: spec.key });
    assert.equal(res.status, 200);
    assert.equal(res.body.specialty, spec.key);
    assert.equal(res.body.provider, 'test');
    const sections = res.body.sections;
    assert.equal(Object.keys(sections).length, spec.sectionCount);
    // sourced sections have text; manual/sourceless sections are empty strings
    const cfg = loadSpecialty(spec.key);
    for (const s of cfg.sections) {
      assert.ok(s.id in sections, `missing section ${s.id}`);
      if (s.source === null) assert.equal(sections[s.id], '', `${s.id} must be empty`);
      else if (!s.manualEntry) assert.ok(typeof sections[s.id] === 'string' && sections[s.id].length > 0, `${s.id} should have text`);
    }
  });
}

test('draft loads deferred note details once and reuses the patient cache', async () => {
  const before = clinicalNoteDetailCalls;
  const first = await POST(`/api/patients/${DFN}/draft`, { specialty: 'general', episodeId: 'test-episode' });
  assert.equal(first.status, 200);
  assert.ok(clinicalNoteDetailCalls > before);
  const after = clinicalNoteDetailCalls;
  const second = await POST(`/api/patients/${DFN}/draft`, { specialty: 'general', episodeId: 'test-episode' });
  assert.equal(second.status, 200);
  assert.equal(clinicalNoteDetailCalls, after);
});

test('draft with unknown specialty key falls back to general', async () => {
  const res = await POST(`/api/patients/${DFN}/draft`, { specialty: 'cardiology-does-not-exist' });
  assert.equal(res.status, 200);
  assert.equal(res.body.specialty, 'general');
});

test('dermatology lacks Procedure while ctvs marks it requiredManual', async () => {
  const derm = loadSpecialty('dermatology');
  const ctvs = loadSpecialty('ctvs');
  assert.ok(!derm.sections.some((s) => s.id === 'procedure'));
  const proc = ctvs.sections.find((s) => s.id === 'procedure');
  assert.ok(proc && proc.requiredManual === true && proc.source === null);
});

test('regenerate returns new text without needing other sections', async () => {
  const res = await POST(`/api/patients/${DFN}/draft/diagnosis/regenerate`, {
    specialty: 'general',
    currentDraft: { diagnosis: 'old text' },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.provider, 'test');
  assert.ok(typeof res.body.text === 'string' && res.body.text.length > 0);

  const noDraft = await POST(`/api/patients/${DFN}/draft/on-examination/regenerate`, { specialty: 'general' });
  assert.equal(noDraft.status, 200);
  assert.ok(noDraft.body.text.length > 0);
  // visibly different from the draft variant
  const draft = await POST(`/api/patients/${DFN}/draft`, { specialty: 'general' });
  assert.notEqual(noDraft.body.text, draft.body.sections['on-examination']);
});

test('approve blocked (400) while CTVS Procedure is empty', async () => {
  const draft = await POST(`/api/patients/${DFN}/draft`, { specialty: 'ctvs' });
  const res = await POST(`/api/patients/${DFN}/summary/approve`, {
    specialty: 'ctvs',
    sections: draft.body.sections,
    approvedBy: 'Dr. Test',
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.error);
});

test('approve succeeds once Procedure is filled, and GET summary round-trips', async () => {
  const draft = await POST(`/api/patients/${DFN}/draft`, { specialty: 'ctvs' });
  const sections = { ...draft.body.sections, procedure: 'CABG x2, on pump' };
  const res = await POST(`/api/patients/${DFN}/summary/approve`, {
    specialty: 'ctvs',
    sections,
    approvedBy: 'Dr. Test',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.ok(res.body.approvedAt);

  const got = await GET(`/api/patients/${DFN}/summary`);
  assert.equal(got.status, 200);
  const summary = got.body.summary;
  assert.equal(summary.patientDfn, DFN);
  assert.equal(summary.specialty, 'ctvs');
  assert.equal(summary.approvedBy, 'Dr. Test');
  assert.equal(summary.sections.procedure, 'CABG x2, on pump');
  assert.equal(summary.sections.diagnosis, sections.diagnosis);
});

test('GET summary for unknown patient returns { summary: null }', async () => {
  const res = await GET('/api/patients/UNKNOWN999/summary');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { summary: null });
});

after(() => {
  try {
    rmSync(process.env.DB_FILE, { force: true });
    rmSync(`${process.env.DB_FILE}-wal`, { force: true });
    rmSync(`${process.env.DB_FILE}-shm`, { force: true });
  } catch {}
});
