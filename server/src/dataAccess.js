// dataAccess.js — single normalized view of the 11 documented Sansys read
// endpoints. This is the ONLY module that knows raw Sansys field names.
// Identifier inconsistencies handled here:
//   - demographics (#1): GET /patientHome/load-demographics/:dfn?userId=1  -> takes dfn
//   - clinical notes (#2): POST /clinical-notes/list                       -> body patient_dfn (dfn), duz
//   - lab orders (#4): POST /lab/list                                      -> body dfn, visit_id
//   - radiology (#5): POST /rad/cpoe-list                                  -> body dfn, visit_id
//   - vitals (#6): GET /vitals/dash/load/:dfn?admissionId=&range=1         -> takes dfn + admissionId query
//   - problems (#7): POST /problems/dash-list                              -> body dfn, visit_id
//   - diagnosis (#8): POST /diagnosis/dash/list                            -> body dfn, visit_id, duz
//   - chief complaints (#9): GET /chiefcomplaint/dash-list/:patientIen?status=1&admissionIen=1
//                                                                           -> takes patientIen (NOT dfn) + admissionIen query
//   - allergies (#10): GET /allergies/dashboard-list/:patientIen           -> takes patientIen (NOT dfn)
//   - medications (#11): POST /med/list?dfn=...                            -> dfn in query AND body
// Clinical note detail (#3, GET /clinical-notes/view/:note_ien) is not part
// of the normalized contract; content/patient_objects are usually empty in
// test data, so the list metadata is all we surface. It is still one of the
// 11 documented reads we never mutate.
// visit_id for this patient in the test system is "2-4"; the complaint
// endpoints use patientIen "1" / admissionIen "1" as in the documented samples.
//
// Every live response is wrapped in { success, data } with the list nested one
// level down (see sansys-api.md). A failed or malformed call throws; there is
// no fallback data anymore.
import { config } from './config.js';
import { setGlobalDispatcher, Agent } from 'undici';

// The Sansys test server is flaky: intermittent resets and connect timeouts.
// undici's default 10s *connect* timeout kills slow-but-successful connections
// (UND_ERR_CONNECT_TIMEOUT) long before our own request timeout fires. Raise it
// to match the overall request timeout and allow enough sockets for the ten
// parallel patient calls without queueing.
setGlobalDispatcher(new Agent({
  connect: { timeout: config.sansysTimeoutMs },
  connections: 20,
}));

const DFN = 'PAT123456';
const PATIENT_IEN = '1';
const VISIT_ID = '2-4';
const ADMISSION_IEN = '1';
const DUZ = '1';
const LIMIT = 50;

async function fetchWithTimeout(url, opts = {}, timeoutMs = config.sansysTimeoutMs) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (err) {
    if (err && err.name === 'AbortError') {
      const e = new Error(`Sansys request timed out after ${timeoutMs}ms: ${url}`);
      e.retryable = true;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

async function getJSON(url) {
  return withRetry(() => requestSansys('GET', url));
}

async function postJSON(url, body) {
  return withRetry(() => requestSansys('POST', url, body));
}

// Retry policy: the live Sansys test server is flaky from cloud hosts —
// intermittent ECONNRESET resets, occasional connect timeouts, and slow
// responses. A single transient failure among the ten parallel patient calls
// must not kill the whole load, so every call retries before giving up.
const RETRYABLE_CODES = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH',
  'ENETUNREACH', 'ENETDOWN', 'EAI_AGAIN', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function isRetryable(err) {
  if (!err) return false;
  if (err.name === 'AbortError') return true;
  if (err.retryable) return true;
  const code = err.cause?.code ?? err.code;
  return !!code && RETRYABLE_CODES.has(code);
}

async function withRetry(fn, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err)) throw err;
      if (attempt < attempts) {
        const delay = 200 * attempt + Math.floor(Math.random() * 150);
        console.warn(`[sansys] attempt ${attempt}/${attempts - 1} failed (${err.cause?.code ?? err.code ?? err.message}); retrying in ${delay}ms`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

async function requestSansys(method, url, body) {
  const t0 = performance.now();
  const opts = body !== undefined
    ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method };
  const res = await fetchWithTimeout(`${config.sansysBaseUrl}${url}`, opts);
  const ms = Math.round(performance.now() - t0);
  if (!res.ok) {
    console.error(`[sansys] ${method} ${url} -> HTTP ${res.status} (${ms}ms)`);
    const err = new Error(`Sansys ${method} ${url} failed: HTTP ${res.status}`);
    err.retryable = res.status >= 500;
    throw err;
  }
  console.log(`[sansys] ${method} ${url} -> 200 (${ms}ms)`);
  return res.json();
}

const str = (v) => (v === null || v === undefined ? '' : String(v));
// The live test server returns literal "Invalid date" for some date fields;
// blank them rather than showing garbage in the UI.
const dateStr = (v) => {
  const s = str(v);
  return /^(invalid date|n\/?a|null|undefined)$/i.test(s.trim()) ? '' : s;
};

// Pull a list out of a live response. Live shapes are
// { success, data: { [key]: [...] } } or { success, data: [...] }.
function listOf(raw, key) {
  if (!raw) return [];
  if (Array.isArray(raw[key])) return raw[key];
  const d = raw.data;
  if (Array.isArray(d)) return d;            // live: data IS the list
  if (d && Array.isArray(d[key])) return d[key]; // live: list nested under data
  return [];
}

// Vitals live responses include an admissions list and need the right
// admissionId to return readings. If the first call comes back empty but
// advertises admissions, retry once with the most recent admission.
async function fetchVitals(dfn) {
  const first = await getJSON(
    `/vitals/dash/load/${encodeURIComponent(dfn)}?fromDate=&toDate=&range=1`,
  );
  const vitals = listOf(first, 'vitals');
  const admissions = first?.data?.admissions ?? first?.admissions ?? [];
  if (vitals.length === 0 && admissions.length > 0) {
    const admId = admissions[0].id;
    const retry = await getJSON(
      `/vitals/dash/load/${encodeURIComponent(dfn)}?fromDate=&toDate=&admissionId=${encodeURIComponent(admId)}&range=1`,
    );
    if (listOf(retry, 'vitals').length > 0) return retry;
  }
  return first;
}

export async function fetchPatient(dfn) {
  dfn = dfn || DFN;
  // All ten calls run in parallel: the live API answers in seconds,
  // sequential fetches would stack.
  const [
    demographicsRaw,
    notesRaw,
    labsRaw,
    radRaw,
    vitalsRaw,
    problemsRaw,
    diagnosisRaw,
    complaintsRaw,
    allergiesRaw,
    medsRaw,
  ] = await Promise.all([
    getJSON(`/patientHome/load-demographics/${encodeURIComponent(dfn)}?userId=1`),
    postJSON('/clinical-notes/list',
      { patient_dfn: dfn, duz: DUZ, limit: LIMIT, offset: 0, date_from: '', date_to: '', search_text: '', status_filter: '' }),
    postJSON('/lab/list',
      { dfn, status: '', visit_id: VISIT_ID, from_date: '', to_date: '' }),
    postJSON('/rad/cpoe-list',
      { dfn, status: '', visit_id: VISIT_ID, from_date: '', to_date: '' }),
    fetchVitals(dfn),
    postJSON('/problems/dash-list',
      { dfn, status: '', visit_id: VISIT_ID }),
    postJSON('/diagnosis/dash/list',
      { dfn, visit_id: VISIT_ID, duz: DUZ }),
    getJSON(`/chiefcomplaint/dash-list/${encodeURIComponent(PATIENT_IEN)}?status=1&admissionIen=${encodeURIComponent(ADMISSION_IEN)}`),
    getJSON(`/allergies/dashboard-list/${encodeURIComponent(PATIENT_IEN)}`),
    postJSON(`/med/list?dfn=${encodeURIComponent(dfn)}`,
      { dfn, status: '', schedule_type: '', visit_id: VISIT_ID, from_date: '', to_date: '' }),
  ]);

  // ---- Normalization into the frozen contract shape (see contracts.md) ----
  const patient = {
    dfn,
    demographics: normalizeDemographics(demographicsRaw),
    complaints: listOf(complaintsRaw, 'complaints').map(mapComplaint),
    diagnoses: sortDiagnoses(listOf(diagnosisRaw, 'diagnoses')),
    problems: listOf(problemsRaw, 'problems').map(mapProblem),
    allergies: mapAllergies(allergiesRaw),
    medications: listOf(medsRaw, 'orders').map(mapMedication),
    labOrders: listOf(labsRaw, 'orders').map(mapLab),
    radOrders: listOf(radRaw, 'orders').map(mapRad),
    vitals: normalizeVitals(vitalsRaw),
    notes: listOf(notesRaw, 'notes').map(mapNote),
  };
  console.log(
    `[sansys] patient ${dfn} assembled (${patient.complaints.length} complaints, ` +
    `${patient.diagnoses.length} diagnoses, ${patient.problems.length} problems, ` +
    `${patient.allergies.items.length} allergies, ${patient.medications.length} meds, ` +
    `${patient.labOrders.length} labs, ${patient.radOrders.length} rad, ` +
    `${patient.vitals.length} vitals, ${patient.notes.length} notes)`,
  );
  return patient;
}

// ---- Connectivity diagnostics ----

// Probe a few Sansys endpoints straight from this host and report status,
// latency and — on failure — the OS-level error code (err.cause.code). Use
// this to tell apart "server is down" (reachable but HTTP 5xx), "connection
// refused" (ECONNREFUSED) and "firewalled / IP-blocked" (ETIMEDOUT, ENETUNREACH).
export async function diagSansysConnectivity() {
  const base = config.sansysBaseUrl;
  const probes = [
    { name: 'demographics', method: 'GET', path: `/patientHome/load-demographics/${encodeURIComponent(DFN)}?userId=1` },
    { name: 'vitals', method: 'GET', path: `/vitals/dash/load/${encodeURIComponent(DFN)}?fromDate=&toDate=&range=1` },
    { name: 'problems', method: 'POST', path: '/problems/dash-list', body: { dfn: DFN, status: '', visit_id: VISIT_ID } },
  ];
  const results = await Promise.all(
    probes.map(async (p) => {
      const t0 = performance.now();
      const url = `${base}${p.path}`;
      try {
        const res = await fetchWithTimeout(
          url,
          {
            method: p.method,
            headers: p.body ? { 'Content-Type': 'application/json' } : undefined,
            body: p.body ? JSON.stringify(p.body) : undefined,
          },
          5000,
        );
        return { name: p.name, method: p.method, url, ok: res.ok, status: res.status, ms: Math.round(performance.now() - t0) };
      } catch (err) {
        return {
          name: p.name,
          method: p.method,
          url,
          ok: false,
          error: err.message,
          cause: err.cause?.code ?? err.cause?.message ?? null,
          ms: Math.round(performance.now() - t0),
        };
      }
    }),
  );
  return { baseUrl: base, reachable: results.some((r) => r.ok), results };
}

// ---- shared field mappers (raw Sansys item -> normalized contract item) ----

function normalizeDemographics(raw) {
  const d = raw?.data && raw.data.lfname !== undefined ? raw.data : raw ?? {};
  return {
    firstName: str(d.lfname),
    lastName: str(d.llname),
    sex: str(d.lsex),
    dob: dateStr(d.dob),
    age: str(d.lage),
    uhid: str(d.cpPID),
    ipNo: str(d.cpIPNo),
    ward: str(d.ward),
    admitDate: dateStr(d.admdt),
    primaryPhysician: str(d.pphy),
    dischargeDate: dateStr(d.DisDate),
  };
}

function mapComplaint(c) {
  return {
    name: str(c.complaint_name),
    type: c.complaint_type === 'Associated Complaint' ? 'Associated Complaint' : 'Chief Complaint',
    remark: str(c.remark),
    date: str(c.date),
  };
}

function sortDiagnoses(list) {
  // Primary diagnoses first, preserving API order within each group.
  return [
    ...list.filter((d) => d.isPrimary === true),
    ...list.filter((d) => d.isPrimary !== true),
  ].map((d) => ({
    diagnosis: str(d.diagnosis),
    isPrimary: d.isPrimary === true,
    type: str(d.type),
    dateEntered: str(d.dateEntered),
  }));
}

function mapProblem(p) {
  return {
    problem: str(p.problem),
    status: str(p.status),
    dateOnset: str(p.dateOnset),
    comorbidity: p.comorbidity === true || p.comorbidity === 'true',
  };
}

function mapAllergies(raw) {
  // Live: { success, status, data: [...] }.
  return {
    status: str(raw?.status),
    items: listOf(raw, 'data').map((a) => ({
      allergy: str(a.allergy),
      reaction: str(a.natureOfReaction),
      symptoms: str(a.symptoms),
      date: str(a.date),
    })),
  };
}

function mapMedication(m) {
  return {
    medication: str(m.medication_name),
    startDate: str(m.start_date),
    stopDate: str(m.stop_date),
    status: str(m.status),
    scheduleType: str(m.schedule_type),
  };
}

function mapLab(l) {
  return {
    name: str(l.itemOrdered),
    section: str(l.section),
    orderDateTime: str(l.orderDateTime),
    status: str(l.status?.name ?? l.status ?? ''),
  };
}

function mapRad(r) {
  return {
    procedure: str(r.imaging_procedure),
    imagingType: str(r.imaging_type),
    status: str(r.status?.name ?? r.status ?? ''),
    dateTime: str(r.start_date_time),
  };
}

function mapNote(n) {
  return {
    title: str(n.note_title),
    dateOfEntry: str(n.date_of_entry),
    status: str(n.status_name),
    author: str(n.author_name),
  };
}

function normalizeVitals(raw) {
  // Measurements can arrive as an array [{ name, value, is_abnormal }] or, as
  // the live API returns, an object keyed by vital name whose values carry
  // { value, unit, bgColor, ... } (bgColor present ~ abnormal).
  return listOf(raw, 'vitals')
    .map((v) => {
      let ms = v.measurements ?? [];
      if (!Array.isArray(ms) && typeof ms === 'object') {
        ms = Object.entries(ms).map(([name, m]) => ({
          name,
          value: m?.value,
          is_abnormal: m?.bgColor != null,
        }));
      }
      return {
        dateTime: str(v.date_time),
        measurements: ms
          .filter((m) => str(m.value) && str(m.value).toLowerCase() !== 'not entered')
          .map((m) => ({
            name: str(m.name),
            value: str(m.value),
            isAbnormal: m.is_abnormal === true || m.is_abnormal === 'true',
          })),
      };
    })
    .sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)));
}