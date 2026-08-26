const BASE = '/api';

async function request(path, options) {
  let res;
  try {
    res = await fetch(BASE + path, options);
  } catch (err) {
    // Let callers detect cancellation from a superseding request.
    if (err && err.name === 'AbortError') throw err;
    throw new Error('Network error — server unreachable');
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON response */
  }
  if (!res.ok) {
    const msg = body && body.error ? body.error : 'Request failed (' + res.status + ')';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return body;
}

function post(path, data, signal) {
  return request(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
    ...(signal ? { signal } : {}),
  });
}

export function fetchSpecialties() {
  return request('/specialties');
}

export function createSpecialty(data) {
  return post('/specialties', data);
}

export function fetchPatient(dfn, signal) {
  return request('/patients/' + encodeURIComponent(dfn), signal ? { signal } : {});
}

export function generateDraft(dfn, specialty, signal, sectionIds) {
  return post('/patients/' + encodeURIComponent(dfn) + '/draft', {
    specialty,
    ...(sectionIds ? { sectionIds } : {}),
  }, signal);
}

export function regenerateSection(dfn, sectionId, specialty, currentDraft, signal) {
  return post(
    '/patients/' + encodeURIComponent(dfn) + '/draft/' + encodeURIComponent(sectionId) + '/regenerate',
    { specialty, currentDraft },
    signal
  );
}

export function approveSummary(dfn, specialty, sections, approvedBy, signal) {
  return post('/patients/' + encodeURIComponent(dfn) + '/summary/approve', {
    specialty,
    sections,
    approvedBy,
  }, signal);
}

export function fetchSummary(dfn, signal) {
  return request('/patients/' + encodeURIComponent(dfn) + '/summary', signal ? { signal } : {});
}
