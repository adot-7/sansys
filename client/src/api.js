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

export function fetchPatient(dfn, signal, episodeId) {
  const query = episodeId ? '?episodeId=' + encodeURIComponent(episodeId) : '';
  return request('/patients/' + encodeURIComponent(dfn) + query, signal ? { signal } : {});
}

export function fetchPatientShell(dfn, signal, episodeId) {
  const query = episodeId ? '?episodeId=' + encodeURIComponent(episodeId) : '';
  return request('/patients/' + encodeURIComponent(dfn) + '/shell' + query, signal ? { signal } : {});
}

export function generateDraft(dfn, specialty, signal, sectionIds, episodeId) {
  return post('/patients/' + encodeURIComponent(dfn) + '/draft', {
    specialty,
    ...(sectionIds ? { sectionIds } : {}),
    ...(episodeId ? { episodeId } : {}),
  }, signal);
}

export function regenerateSection(dfn, sectionId, specialty, currentDraft, signal, episodeId) {
  return post(
    '/patients/' + encodeURIComponent(dfn) + '/draft/' + encodeURIComponent(sectionId) + '/regenerate',
    { specialty, currentDraft, ...(episodeId ? { episodeId } : {}) },
    signal
  );
}

export function approveSummary(dfn, specialty, sections, approvedBy, signal, episodeId) {
  return post('/patients/' + encodeURIComponent(dfn) + '/summary/approve', {
    specialty,
    sections,
    approvedBy,
    ...(episodeId ? { episodeId } : {}),
  }, signal);
}

export function fetchSummary(dfn, signal, episodeId) {
  const query = episodeId ? '?episodeId=' + encodeURIComponent(episodeId) : '';
  return request('/patients/' + encodeURIComponent(dfn) + '/summary' + query, signal ? { signal } : {});
}
