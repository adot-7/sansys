// dataAccess.js — single normalized view of the 11 documented Sansys read
// endpoints. This is the ONLY module that knows raw Sansys field names.
// Identifier inconsistencies handled here:
//   - demographics (#1): GET /patientHome/load-demographics/:dfn?userId=1  -> takes dfn
//   - clinical notes (#2): POST /clinical-notes/list                       -> body patient_dfn (dfn), duz, visit_id, date range
//   - clinical note detail (#3): GET /clinical-notes/view/:note_ien        -> structured note content/patient objects
//   - lab orders (#4): POST /lab/list                                      -> body dfn, visit_id
//   - radiology (#5): POST /rad/cpoe-list                                  -> body dfn, visit_id
//   - vitals (#6): GET /vitals/dash/load/:dfn?admissionId=&range=1         -> takes dfn + admissionId query
//   - problems (#7): POST /problems/dash-list                              -> body dfn, visit_id
//   - diagnosis (#8): POST /diagnosis/dash/list                            -> body dfn, visit_id, duz
//   - chief complaints (#9): GET /chiefcomplaint/dash-list/:patientIen?status=1&admissionIen=...
//                                                                           -> takes patientIen (dfn) + admissionIen query
//   - allergies (#10): GET /allergies/dashboard-list/:patientIen           -> takes patientIen (dfn), patient-level
//   - medications (#11): POST /med/list?dfn=...                            -> dfn in query AND body
// Episode IDs are discovered from the API's visits.ipVisits lists. A value
// such as "1-9013" is sent as visit_id; its numeric admission IEN (9013) is
// sent to vitals and complaints. The date window for notes is inferred from
// adjacent IP visit start dates and sent as a secondary safeguard.
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
const DUZ = 1;
const LIMIT = 25;
const PATIENT_CACHE_TTL_MS = 60_000;
const shellCache = new Map();
const patientCache = new Map();
const shellInflight = new Map();
const patientInflight = new Map();

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
async function fetchVitals(dfn, episode) {
  const first = await getJSON(
    `/vitals/dash/load/${encodeURIComponent(dfn)}?fromDate=&toDate=&admissionId=${encodeURIComponent(episode.admissionId)}&range=1`,
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

function extractVisits(raw) {
  return raw?.data?.visits ?? raw?.visits ?? {};
}

function parseEpisodeDate(label) {
  const match = String(label || '').match(/^(\d{1,2})\s+([A-Z]{3})[ ,]+(\d{4})/i);
  if (!match) return '';
  const months = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
  const month = months[match[2].toUpperCase()];
  if (month === undefined) return '';
  return new Date(Date.UTC(Number(match[3]), month, Number(match[1]))).toISOString().slice(0, 10);
}

function buildEpisodes(...responses) {
  const byId = new Map();
  for (const response of responses) {
    for (const visit of extractVisits(response).ipVisits || []) {
      const id = String(visit.id ?? '');
      if (!/^1-\d+$/.test(id)) continue;
      byId.set(id, {
        id,
        label: String(visit.name || visit.label || id),
        startDate: parseEpisodeDate(visit.name || visit.label),
        admissionId: id.slice(2),
        admissionIen: id.slice(2),
      });
    }
  }
  const episodes = [...byId.values()].sort((a, b) => String(b.startDate).localeCompare(String(a.startDate)));
  for (let i = 0; i < episodes.length; i++) {
    const previous = episodes[i - 1];
    episodes[i].dateFrom = episodes[i].startDate;
    episodes[i].dateTo = previous?.startDate ? addDays(previous.startDate, -1) : '';
  }
  return episodes;
}

function addDays(date, amount) {
  if (!date) return '';
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function parseLooseDate(value) {
  const text = String(value || '').replace(/SEPT/gi, 'SEP').replace(/,/g, '');
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function inEpisodeWindow(value, episode) {
  const date = parseLooseDate(value);
  if (!date || !episode.dateFrom) return true;
  return date >= episode.dateFrom && (!episode.dateTo || date <= episode.dateTo);
}

function cacheKey(dfn, episodeId = '') {
  return `${dfn}::${episodeId || '__default__'}`;
}

function clone(value) {
  return structuredClone(value);
}

function readCache(cache, key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function writeCache(cache, key, value, metadata = {}) {
  cache.set(key, {
    value,
    expiresAt: Date.now() + PATIENT_CACHE_TTL_MS,
    ...metadata,
  });
}

function remember(cache, dfn, requestedEpisodeId, value, metadata = {}) {
  writeCache(cache, cacheKey(dfn, value.episodeId), value, metadata);
  if (!requestedEpisodeId) writeCache(cache, cacheKey(dfn), value, metadata);
}

function chooseEpisode(episodes, requestedId, discovery) {
  const defaultId = discovery?.data?.default_visit || discovery?.default_visit || episodes[0]?.id || '';
  return episodes.find((episode) => episode.id === requestedId) || episodes.find((episode) => episode.id === defaultId) || episodes[0] || {
    id: requestedId || '2-4',
    label: requestedId || 'Current episode',
    startDate: '',
    dateFrom: '',
    dateTo: '',
    admissionId: String(requestedId || '2-4').split('-').pop(),
    admissionIen: String(requestedId || '2-4').split('-').pop(),
  };
}

async function fetchNoteList(dfn, episode) {
  const all = [];
  let offset = 0;
  let total = Infinity;
  while (offset < total) {
    const response = await postJSON('/clinical-notes/list', {
      patient_dfn: dfn,
      duz: DUZ,
      limit: LIMIT,
      offset,
      date_from: episode.dateFrom,
      date_to: episode.dateTo,
      search_text: '',
      status_filter: '',
      visit_id: episode.id,
    });
    const page = listOf(response, 'notes');
    all.push(...page);
    total = Number(response?.total_records ?? response?.data?.total_records ?? all.length);
    if (!page.length || all.length >= total) break;
    offset += page.length;
  }
  return all;
}

function flattenNoteContent(content, lines = []) {
  for (const group of content || []) {
    for (const question of group.questions || []) {
      if (str(question.question) || str(question.answer)) lines.push(`${str(question.question)}${question.question ? ': ' : ''}${str(question.answer)}`);
      flattenNoteContent(question.children, lines);
    }
  }
  return lines;
}

async function fetchNotes(dfn, episode, includeDetails = true) {
  const list = await fetchNoteList(dfn, episode);
  if (!includeDetails) {
    return {
      notes: list.map((note) => mapNote(note)),
      noteFacts: emptyNoteFacts(),
      detailsLoaded: false,
    };
  }

  const detailed = [];
  for (let i = 0; i < list.length; i += 8) {
    const batch = await Promise.all(list.slice(i, i + 8).map(async (note) => {
      try {
        return await getJSON(`/clinical-notes/view/${encodeURIComponent(note.note_ien)}`);
      } catch (err) {
        console.warn(`[sansys] note ${note.note_ien} detail unavailable: ${err.message}`);
        return null;
      }
    }));
    detailed.push(...batch);
  }
  const notes = list.map((note, index) => mapNote(note, detailed[index]));
  return {
    notes,
    noteFacts: mergeNoteFacts(list, detailed),
    detailsLoaded: true,
  };
}

async function fetchPatientShellUncached(dfn, requestedEpisodeId) {
  const [discoveryRaw, demographicsRaw, allergiesRaw] = await Promise.all([
    postJSON('/diagnosis/dash/list', { dfn, visit_id: '', duz: DUZ }),
    getJSON(`/patientHome/load-demographics/${encodeURIComponent(dfn)}?userId=1`),
    getJSON(`/allergies/dashboard-list/${encodeURIComponent(dfn)}`),
  ]);
  const episodes = buildEpisodes(discoveryRaw);
  const episode = chooseEpisode(episodes, requestedEpisodeId, discoveryRaw);
  return {
    dfn,
    demographics: normalizeDemographics(demographicsRaw),
    complaints: [],
    diagnoses: [],
    problems: [],
    allergies: mapAllergies(
      allergiesRaw,
      (index) => sansysProvenance('/allergies/dashboard-list/:patientIen', `data[${index}]`),
    ),
    medications: [],
    activeMedications: [],
    dischargeMedications: [],
    labOrders: [],
    radOrders: [],
    vitals: [],
    notes: [],
    episodes,
    episodeId: episode.id,
    episode,
  };
}

export async function fetchPatientShell(dfn, requestedEpisodeId) {
  dfn = dfn || DFN;
  const key = cacheKey(dfn, requestedEpisodeId);
  const cached = readCache(shellCache, key);
  if (cached) return clone(cached.value);
  const running = shellInflight.get(key);
  if (running) return clone(await running);

  const promise = fetchPatientShellUncached(dfn, requestedEpisodeId);
  shellInflight.set(key, promise);
  try {
    const shell = await promise;
    remember(shellCache, dfn, requestedEpisodeId, shell);
    return clone(shell);
  } finally {
    shellInflight.delete(key);
  }
}

async function fetchPatientUncached(dfn, requestedEpisodeId, includeNoteDetails) {
  const shell = await fetchPatientShell(dfn, requestedEpisodeId);
  const { episode } = shell;
  // Independent Sansys collections run in parallel. Note details are optional
  // so the shell/data response can arrive before the expensive detail fan-out.
  const [
    notesResult,
    labsRaw,
    radRaw,
    vitalsRaw,
    problemsRaw,
    diagnosisRaw,
    complaintsRaw,
    medsRaw,
  ] = await Promise.all([
    fetchNotes(dfn, episode, includeNoteDetails),
    postJSON('/lab/list',
      { dfn, status: '0', visit_id: episode.id, from_date: '', to_date: '' }),
    postJSON('/rad/cpoe-list',
      { dfn, status: '0', visit_id: episode.id, from_date: '', to_date: '' }),
    fetchVitals(dfn, episode),
    postJSON('/problems/dash-list',
      { dfn, status: '', visit_id: episode.id }),
    postJSON('/diagnosis/dash/list', { dfn, visit_id: episode.id, duz: DUZ }),
    getJSON(`/chiefcomplaint/dash-list/${encodeURIComponent(dfn)}?status=1&admissionIen=${encodeURIComponent(episode.admissionIen)}`),
    postJSON(`/med/list?dfn=${encodeURIComponent(dfn)}`,
      { dfn, status: '0', schedule_type: '0', visit_id: episode.id, from_date: '', to_date: '' }),
  ]);

  const medications = listOf(medsRaw, 'orders').map((item, index) => mapMedication(item, sansysProvenance(
    '/med/list', `data.orders[${index}]`, episode, item.medication_ien,
  )));
  const patient = applyNoteFacts({
    ...shell,
    complaints: mapUniqueComplaints(
      listOf(complaintsRaw, 'complaints'),
      (index) => sansysProvenance('/chiefcomplaint/dash-list/:patientIen', `data.complaints[${index}]`, episode),
    ),
    diagnoses: sortDiagnoses(listOf(diagnosisRaw, 'diagnoses').map((item, index) => mapDiagnosis(
      item,
      sansysProvenance('/diagnosis/dash/list', `data.diagnoses[${index}]`, episode, item.ien),
    ))),
    problems: filterProblemsForEpisode(
      listOf(problemsRaw, 'problems'),
      episode,
      (index) => sansysProvenance('/problems/dash-list', `data.problems[${index}]`, episode),
    ),
    medications,
    labOrders: listOf(labsRaw, 'orders').map((item, index) => mapLab(
      item,
      sansysProvenance('/lab/list', `data.orders[${index}]`, episode, item.order_ien),
    )),
    radOrders: listOf(radRaw, 'orders').map((item, index) => mapRad(
      item,
      sansysProvenance('/rad/cpoe-list', `data.orders[${index}]`, episode, item.order_ien),
    )),
    vitals: normalizeVitals(
      vitalsRaw,
      (index) => sansysProvenance('/vitals/dash/load/:dfn', `data.vitals[${index}]`, episode),
    ).filter((item) => inEpisodeWindow(item.dateTime, episode)),
    notes: notesResult.notes,
  }, notesResult.noteFacts);
  console.log(
    `[sansys] patient ${dfn} assembled (${patient.complaints.length} complaints, ` +
    `${patient.diagnoses.length} diagnoses, ${patient.problems.length} problems, ` +
    `${patient.allergies.items.length} allergies, ${patient.medications.length} meds, ` +
    `${patient.labOrders.length} labs, ${patient.radOrders.length} rad, ` +
    `${patient.vitals.length} vitals, ${patient.notes.length} notes, ` +
    `note details ${notesResult.detailsLoaded ? 'loaded' : 'deferred'})`,
  );
  return { patient, detailsLoaded: notesResult.detailsLoaded };
}

export async function fetchPatient(dfn, requestedEpisodeId, options = {}) {
  dfn = dfn || DFN;
  const includeNoteDetails = options.includeNoteDetails !== false;
  const key = cacheKey(dfn, requestedEpisodeId);
  const cached = readCache(patientCache, key);
  if (cached && (!includeNoteDetails || cached.detailsLoaded)) return clone(cached.value);

  const running = patientInflight.get(key);
  if (running) {
    const result = await running;
    if (!includeNoteDetails || result.detailsLoaded) return clone(result.patient);
    const notesResult = await fetchNotes(dfn, result.patient.episode, true);
    const patient = applyNoteFacts({ ...result.patient, notes: notesResult.notes }, notesResult.noteFacts);
    remember(patientCache, dfn, requestedEpisodeId, patient, { detailsLoaded: true });
    return clone(patient);
  }

  const promise = (async () => {
    const current = readCache(patientCache, key);
    if (current && includeNoteDetails && !current.detailsLoaded) {
      const notesResult = await fetchNotes(dfn, current.value.episode, true);
      const patient = applyNoteFacts({ ...current.value, notes: notesResult.notes }, notesResult.noteFacts);
      remember(patientCache, dfn, requestedEpisodeId, patient, { detailsLoaded: true });
      return { patient, detailsLoaded: true };
    }

    const result = await fetchPatientUncached(dfn, requestedEpisodeId, includeNoteDetails);
    remember(patientCache, dfn, requestedEpisodeId, result.patient, { detailsLoaded: result.detailsLoaded });
    return result;
  })();
  patientInflight.set(key, promise);
  try {
    const result = await promise;
    return clone(result.patient);
  } finally {
    patientInflight.delete(key);
  }
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
    { name: 'problems', method: 'POST', path: '/problems/dash-list', body: { dfn: DFN, status: '', visit_id: '' } },
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

function emptyNoteFacts() {
  return {
    complaints: [],
    diagnoses: [],
    problems: [],
    allergies: [],
    medications: [],
    labOrders: [],
    radOrders: [],
    vitals: [],
  };
}

function sansysProvenance(endpoint, path, episode, recordId) {
  return {
    sourceType: 'sansys-endpoint',
    endpoint,
    path,
    ...(episode?.id ? { visitId: episode.id } : {}),
    ...(recordId !== undefined && recordId !== null && str(recordId) ? { recordId: str(recordId) } : {}),
    needsVerification: false,
  };
}

function noteProvenance(note, path) {
  return {
    sourceType: 'clinical-note',
    endpoint: `/clinical-notes/view/${encodeURIComponent(str(note.note_ien))}`,
    path,
    noteIen: str(note.note_ien),
    noteTitle: str(note.note_title),
    noteDate: str(note.date_of_entry),
    needsVerification: true,
  };
}

function provenanceOf(record) {
  return Array.isArray(record?.provenance) ? record.provenance : [];
}

function uniqueProvenance(records) {
  const seen = new Set();
  return records.flatMap((record) => provenanceOf(record)).filter((item) => {
    const key = JSON.stringify(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isMissing(value) {
  return value === '' || value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

function mergeFactRecords(existing, incoming) {
  const merged = { ...existing };
  for (const [key, value] of Object.entries(incoming)) {
    if (key === 'provenance' || key === 'needsVerification' || key === 'statuses') continue;
    if (isMissing(merged[key]) && !isMissing(value)) merged[key] = value;
  }

  const statuses = [...new Set([
    ...(Array.isArray(existing.statuses) ? existing.statuses : []),
    existing.status,
    ...(Array.isArray(incoming.statuses) ? incoming.statuses : []),
    incoming.status,
  ].map(cleanText).filter(Boolean))];
  if (statuses.length > 1) merged.statuses = statuses;
  merged.provenance = uniqueProvenance([existing, incoming]);
  const hasEndpointSource = merged.provenance.some((item) => item.sourceType === 'sansys-endpoint');
  const hasNoteSource = merged.provenance.some((item) => item.sourceType === 'clinical-note');
  merged.needsVerification = hasNoteSource && !hasEndpointSource;
  return merged;
}

function mergeFactLists(primary, additional, keyOf) {
  const result = [];
  const indexes = new Map();
  const append = (record) => {
    const key = keyOf(record);
    if (!key || !indexes.has(key)) {
      if (key) indexes.set(key, result.length);
      result.push(record);
      return;
    }
    const index = indexes.get(key);
    result[index] = mergeFactRecords(result[index], record);
  };
  for (const record of [...(primary || []), ...(additional || [])]) append(record);
  return result;
}

function normalizedKey(...values) {
  return values.map((value) => cleanText(value).toLocaleLowerCase()).join('|');
}

function complaintKey(item) {
  return normalizedKey(item.type, item.name, item.date, item.remark);
}

function diagnosisKey(item) {
  return normalizedKey(item.diagnosis, item.type, item.dateEntered);
}

function problemKey(item) {
  return normalizedKey(item.problem, item.dateOnset);
}

function allergyKey(item) {
  return normalizedKey(item.allergy, item.reaction, item.symptoms, item.date);
}

function labKey(item) {
  return normalizedKey(item.name, item.orderDateTime);
}

function radKey(item) {
  return normalizedKey(item.procedure, item.dateTime);
}

function vitalKey(item) {
  return normalizedKey(item.dateTime, ...(item.measurements || []).map((measurement) => `${measurement.name}:${measurement.value}`));
}

function medicationIdentity(item) {
  return normalizedKey(item.medication, item.route);
}

function mergeMedicationLists(primary, additional) {
  const result = [...(primary || [])];
  for (const medication of additional || []) {
    const identity = medicationIdentity(medication);
    const candidates = result
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => medicationIdentity(item) === identity);
    const match = medication.startDate
      ? candidates.find(({ item }) => item.startDate === medication.startDate)
      : candidates.length === 1 ? candidates[0] : null;
    if (match) result[match.index] = mergeFactRecords(match.item, medication);
    else result.push(medication);
  }
  return result;
}

function applyNoteFacts(patient, noteFacts = emptyNoteFacts()) {
  const medications = mergeMedicationLists(patient.medications, noteFacts.medications);
  return {
    ...patient,
    complaints: mergeFactLists(patient.complaints, noteFacts.complaints, complaintKey),
    diagnoses: sortDiagnoses(mergeFactLists(patient.diagnoses, noteFacts.diagnoses, diagnosisKey)),
    problems: mergeFactLists(patient.problems, noteFacts.problems, problemKey),
    allergies: {
      ...patient.allergies,
      items: mergeFactLists(patient.allergies?.items, noteFacts.allergies, allergyKey),
    },
    medications,
    activeMedications: medications.filter(isActiveMedication),
    dischargeMedications: medications.filter(isDischargeMedication),
    labOrders: mergeFactLists(patient.labOrders, noteFacts.labOrders, labKey),
    radOrders: mergeFactLists(patient.radOrders, noteFacts.radOrders, radKey),
    vitals: mergeFactLists(patient.vitals, noteFacts.vitals, vitalKey)
      .sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime))),
  };
}

export function mergeExtractedFacts(patient, extractedFacts = {}) {
  const validNoteIens = new Set(
    (patient.notes || []).flatMap((note) => provenanceOf(note).map((item) => item.noteIen).filter(Boolean)),
  );
  const facts = emptyNoteFacts();
  const extracted = (key) => arrayOf(extractedFacts[key]);
  const provenanceFor = (fact) => {
    const source = arrayOf(fact.provenance).find((item) => item?.sourceType === 'clinical-note' && item.noteIen);
    if (!source || (validNoteIens.size && !validNoteIens.has(str(source.noteIen)))) return null;
    return {
      ...source,
      sourceType: 'clinical-note',
      endpoint: source.endpoint || `/clinical-notes/view/${encodeURIComponent(str(source.noteIen))}`,
      path: source.path || 'data.content',
      needsVerification: true,
    };
  };
  const withProvenance = (key, mapper) => extracted(key)
    .map((fact) => {
      const provenance = provenanceFor(fact);
      return provenance ? mapper(fact, provenance) : null;
    })
    .filter(Boolean);

  facts.complaints = withProvenance('complaints', mapComplaint);
  facts.diagnoses = withProvenance('diagnoses', mapDiagnosis);
  facts.problems = withProvenance('problems', mapProblem);
  facts.medications = withProvenance('medications', mapMedication);
  facts.labOrders = withProvenance('labOrders', mapLab);
  facts.radOrders = withProvenance('radOrders', mapRad);
  facts.vitals = withProvenance('vitals', (fact, provenance) => ({
    ...fact,
    provenance: [provenance],
    needsVerification: true,
  }));
  facts.allergies = withProvenance('allergies', (fact, provenance) => ({
    allergy: cleanText(fact.allergy ?? fact.allergy_name),
    reaction: str(fact.reaction ?? fact.natureOfReaction ?? fact.nature),
    symptoms: str(fact.symptoms),
    date: dateStr(fact.date ?? fact.entry_datetime),
    provenance: [provenance],
    needsVerification: true,
  }));
  return applyNoteFacts(patient, facts);
}

function mergeNoteFacts(notes, details) {
  const facts = emptyNoteFacts();
  for (let index = 0; index < notes.length; index += 1) {
    const noteFacts = mapNoteFacts(notes[index], details[index]);
    facts.complaints.push(...noteFacts.complaints);
    facts.diagnoses.push(...noteFacts.diagnoses);
    facts.problems.push(...noteFacts.problems);
    facts.allergies.push(...noteFacts.allergies);
    facts.medications.push(...noteFacts.medications);
    facts.labOrders.push(...noteFacts.labOrders);
    facts.radOrders.push(...noteFacts.radOrders);
    facts.vitals.push(...noteFacts.vitals);
  }
  return {
    complaints: mergeFactLists([], facts.complaints, complaintKey),
    diagnoses: sortDiagnoses(mergeFactLists([], facts.diagnoses, diagnosisKey)),
    problems: mergeFactLists([], facts.problems, problemKey),
    allergies: mergeFactLists([], facts.allergies, allergyKey),
    medications: mergeMedicationLists([], facts.medications),
    labOrders: mergeFactLists([], facts.labOrders, labKey),
    radOrders: mergeFactLists([], facts.radOrders, radKey),
    vitals: mergeFactLists([], facts.vitals, vitalKey),
  };
}

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

function cleanText(value) {
  return str(value).replace(/\s+/g, ' ').trim();
}

function mapComplaint(c, provenance) {
  const type = cleanText(c.complaint_type ?? c.type);
  return {
    name: cleanText(c.complaint_name ?? c.name),
    type: /^associated complaint$/i.test(type) ? 'Associated Complaint' : 'Chief Complaint',
    remark: cleanText(c.remark),
    date: cleanText(c.date ?? c.entry_datetime),
    ...(provenance ? { provenance: [provenance], needsVerification: Boolean(provenance.needsVerification) } : {}),
  };
}

function mapUniqueComplaints(list, provenanceFor = () => null) {
  return mergeFactLists(
    [],
    list.map((item, index) => mapComplaint(item, provenanceFor(index))).filter((complaint) => complaint.name),
    complaintKey,
  );
}

function mapDiagnosis(d, provenance) {
  return {
    diagnosis: cleanText(d.diagnosis ?? d.diagnosis_name_with_icd ?? d.master_name),
    isPrimary: d.isPrimary === true || /^primary$/i.test(str(d.isPrimarySecondary)),
    type: str(d.type || d.isPrimarySecondary),
    dateEntered: dateStr(d.dateEntered ?? d.diag_entered_date ?? d.entered_datetime),
    ...(provenance ? { provenance: [provenance], needsVerification: Boolean(provenance.needsVerification) } : {}),
  };
}

function sortDiagnoses(list) {
  // Primary diagnoses first, preserving API order within each group.
  return [
    ...list.filter((d) => d.isPrimary === true),
    ...list.filter((d) => d.isPrimary !== true),
  ];
}

export function filterProblemsForEpisode(list, episode, provenanceFor = () => null) {
  return list
    .map((problem, index) => ({ problem, index }))
    .filter(({ problem }) => {
      const dateEntered = dateStr(problem.dateEntered);
      // Undated problem records may be longstanding comorbidities; retain them
      // rather than dropping valid history when the upstream omits this field.
      return !dateEntered || inEpisodeWindow(dateEntered, episode);
    })
    .map(({ problem, index }) => mapProblem(problem, provenanceFor(index)));
}

function mapProblem(p, provenance) {
  const comorbidity = p.comorbidity;
  return {
    problem: cleanText(p.problem ?? p.problem_name_with_icd ?? p.problem_name),
    status: str(p.status),
    dateOnset: dateStr(p.dateOnset ?? p.date_of_onset),
    comorbidity: comorbidity === true || comorbidity === 1 || ['true', '1', 'yes', 'y'].includes(str(comorbidity).toLowerCase()),
    ...(provenance ? { provenance: [provenance], needsVerification: Boolean(provenance.needsVerification) } : {}),
  };
}

function mapAllergies(raw, provenanceFor = () => null) {
  // Live: { success, status, data: [...] }.
  return {
    status: str(raw?.status),
    items: listOf(raw, 'data').map((a, index) => ({
      allergy: cleanText(a.allergy ?? a.allergy_name),
      reaction: str(a.natureOfReaction ?? a.nature),
      symptoms: str(a.symptoms),
      date: dateStr(a.date ?? a.entry_datetime),
      ...(provenanceFor(index) ? { provenance: [provenanceFor(index)], needsVerification: Boolean(provenanceFor(index).needsVerification) } : {}),
    })),
  };
}

function mapMedication(m, provenance) {
  return {
    medication: cleanText(m.medication_name ?? m.medication),
    startDate: dateStr(m.start_date ?? m.startDate),
    stopDate: dateStr(m.stop_date ?? m.stopDate),
    status: str(m.status),
    schedule: str(m.schedule),
    scheduleType: str(m.schedule_type ?? m.scheduleType),
    route: str(m.route),
    service: str(m.service),
    ...(provenance ? { provenance: [provenance], needsVerification: Boolean(provenance.needsVerification) } : {}),
  };
}

function isActiveMedication(medication) {
  const statuses = [medication.status, ...(medication.statuses || [])]
    .map((status) => cleanText(status).toLowerCase());
  return statuses.includes('active');
}

function isDischargeMedication(medication) {
  if (!isActiveMedication(medication)) return false;
  const text = `${medication.medication} ${medication.service} ${medication.route}`.toLowerCase();
  return !/(infusion|injection|\binj\b|\biv\b|intraven|vial|ampoule|\bamp\b|dextrose|saline|chemotherapy|docetaxel|paclitaxel|carboplatin|dressing)/i.test(text);
}

function mapLab(l, provenance) {
  return {
    name: cleanText(l.itemOrdered ?? l.lab_name ?? l.name),
    section: str(l.section),
    orderDateTime: dateStr(l.orderDateTime ?? l.entry_datetime),
    status: str(l.status?.name ?? l.status ?? ''),
    ...(provenance ? { provenance: [provenance], needsVerification: Boolean(provenance.needsVerification) } : {}),
  };
}

function mapRad(r, provenance) {
  return {
    procedure: cleanText(r.imaging_procedure ?? r.radiology_name ?? r.procedure),
    imagingType: str(r.imaging_type),
    status: str(r.status?.name ?? r.status ?? ''),
    dateTime: dateStr(r.start_date_time ?? r.entry_datetime ?? r.dateTime),
    ...(provenance ? { provenance: [provenance], needsVerification: Boolean(provenance.needsVerification) } : {}),
  };
}

function mapNote(n, detail) {
  const objects = detail?.data?.patient_objects || {};
  const compactObjects = Object.fromEntries(
    Object.entries(objects)
      .filter(([key, value]) => key !== 'medications' && (Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : Boolean(value))),
  );
  return {
    noteIen: str(n.note_ien),
    title: str(n.note_title),
    dateOfEntry: str(n.date_of_entry),
    status: str(n.status_name),
    author: str(n.author_name),
    content: flattenNoteContent(detail?.data?.content),
    patientObjects: compactObjects,
    provenance: [noteProvenance(n, 'data')],
    needsVerification: true,
  };
}

function mapNoteFacts(note, detail) {
  const objects = detail?.data?.patient_objects || {};
  const noteFact = (field, index) => noteProvenance(note, `data.patient_objects.${field}[${index}]`);
  return {
    complaints: arrayOf(objects.complaints).map((item, index) => mapComplaint(item, noteFact('complaints', index))),
    diagnoses: arrayOf(objects.diagnoses).map((item, index) => mapDiagnosis(item, noteFact('diagnoses', index))),
    problems: arrayOf(objects.problems).map((item, index) => mapProblem(item, noteFact('problems', index))),
    allergies: arrayOf(objects.allergies).map((item, index) => ({
      allergy: cleanText(item.allergy ?? item.allergy_name),
      reaction: str(item.reaction ?? item.natureOfReaction ?? item.nature),
      symptoms: str(item.symptoms),
      date: dateStr(item.date ?? item.entry_datetime),
      provenance: [noteFact('allergies', index)],
      needsVerification: true,
    })),
    medications: arrayOf(objects.medications).map((item, index) => mapMedication(item, noteFact('medications', index))),
    labOrders: arrayOf(objects.labs).map((item, index) => mapLab(item, noteFact('labs', index))),
    radOrders: arrayOf(objects.radiology).map((item, index) => mapRad(item, noteFact('radiology', index))),
    vitals: arrayOf(objects.vitals).map((item, index) => ({
      dateTime: dateStr(item.date_time ?? item.entry_datetime),
      measurements: [{
        name: cleanText(item.name ?? item.vital_name),
        value: str(item.value ?? item.vital_value),
        unit: str(item.unit ?? item.vital_unit),
        isAbnormal: false,
      }],
      provenance: [noteFact('vitals', index)],
      needsVerification: true,
    })),
  };
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeVitals(raw, provenanceFor = () => null) {
  // Measurements can arrive as an array [{ name, value, is_abnormal }] or as
  // an object keyed by vital name. The upstream uses either is_abnormal or
  // bgColor to indicate an abnormal reading.
  return listOf(raw, 'vitals')
    .map((v, index) => {
      let ms = v.measurements ?? [];
      if (!Array.isArray(ms) && typeof ms === 'object') {
        ms = Object.entries(ms).map(([name, m]) => ({
          name,
          value: m?.value,
          is_abnormal: m?.is_abnormal ?? m?.isAbnormal ?? m?.bgColor != null,
        }));
      }
      return {
        dateTime: dateStr(v.date_time),
        measurements: ms
          .filter((m) => str(m.value) && str(m.value).toLowerCase() !== 'not entered')
          .map((m) => ({
            name: str(m.name),
            value: str(m.value),
            unit: str(m.unit),
            isAbnormal: m.is_abnormal === true || m.is_abnormal === 1 || ['true', '1', 'yes', 'y'].includes(str(m.is_abnormal).toLowerCase()),
          })),
        provenance: provenanceFor(index),
      };
    })
    .sort((a, b) => String(a.dateTime).localeCompare(String(b.dateTime)));
}
