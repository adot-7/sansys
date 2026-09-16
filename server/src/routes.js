// routes.js — the REST API exactly as frozen in contracts.md. Mounted at /api.
import { Router } from 'express';
import { fetchPatient, fetchPatientShell, diagSansysConnectivity } from './dataAccess.js';
import { createSpecialty, listSpecialties, loadSpecialty } from './specialties/index.js';
import { generateDraft, regenerateSection } from './llm/index.js';
import { getSummary, saveSummary } from './store.js';

export const apiRouter = Router();

// Wrap async handlers so rejections reach the express error path (500 JSON).
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function addCustomEndpointData(patientData, sections, dfn) {
  const endpointSections = sections.filter((section) => section.endpoint);
  await Promise.all(endpointSections.map(async (section) => {
    const endpoint = section.endpoint.replaceAll('{dfn}', encodeURIComponent(dfn));
    if (!/^https?:\/\//i.test(endpoint)) throw new Error(`Custom endpoint for "${section.id}" must use http or https`);
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`Custom endpoint for "${section.id}" returned HTTP ${response.status}`);
    patientData[section.source || section.id] = await response.json();
  }));
}

apiRouter.get('/diag/sansys', wrap(async (req, res) => {
  res.json(await diagSansysConnectivity());
}));

apiRouter.get('/patients/:dfn', wrap(async (req, res) => {
  res.json(await fetchPatient(req.params.dfn, req.query.episodeId, { includeNoteDetails: false }));
}));

apiRouter.get('/patients/:dfn/shell', wrap(async (req, res) => {
  res.json(await fetchPatientShell(req.params.dfn, req.query.episodeId));
}));

apiRouter.get('/specialties', (req, res) => {
  res.json({ specialties: listSpecialties() });
});

apiRouter.post('/specialties', (req, res) => {
  try {
    res.status(201).json({ specialty: createSpecialty(req.body || {}) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/patients/:dfn/draft', wrap(async (req, res) => {
  const specialtyKey = req.body?.specialty || 'general';
  const specialtyConfig = loadSpecialty(specialtyKey); // unknown keys fall back to general
  const patientData = await fetchPatient(req.params.dfn, req.body?.episodeId, { includeNoteDetails: true });
  const selectedIds = Array.isArray(req.body?.sectionIds) ? req.body.sectionIds : null;
  const selectedConfig = selectedIds
    ? { ...specialtyConfig, sections: specialtyConfig.sections.filter((section) => selectedIds.includes(section.id)) }
    : specialtyConfig;
  await addCustomEndpointData(patientData, selectedConfig.sections, req.params.dfn);
  const { sections, provider } = await generateDraft(patientData, selectedConfig);
  for (const section of selectedConfig.sections) if (!(section.id in sections)) sections[section.id] = '';
  res.json({ specialty: specialtyConfig.key, sections, provider });
}));

apiRouter.post('/patients/:dfn/draft/:sectionId/regenerate', wrap(async (req, res) => {
  const specialtyKey = req.body?.specialty || 'general';
  const specialtyConfig = loadSpecialty(specialtyKey);
  const section = specialtyConfig.sections.find((s) => s.id === req.params.sectionId);
  if (!section) return res.status(404).json({ error: `Unknown section id "${req.params.sectionId}"` });
  const patientData = await fetchPatient(req.params.dfn, req.body?.episodeId, { includeNoteDetails: true });
  await addCustomEndpointData(patientData, [section], req.params.dfn);
  const { text, provider } = await regenerateSection(req.params.sectionId, patientData, specialtyConfig, req.body?.currentDraft ?? {});
  res.json({ text, provider });
}));

apiRouter.post('/patients/:dfn/summary/approve', wrap(async (req, res) => {
  const { specialty, sections, approvedBy, episodeId } = req.body ?? {};
  const specialtyConfig = loadSpecialty(specialty || 'general');
  const provided = sections ?? {};

  const emptyRequired = specialtyConfig.sections
    .filter((s) => s.requiredManual)
    .filter((s) => !String(provided[s.id] ?? '').trim())
    .map((s) => s.title || s.id);
  if (emptyRequired.length) {
    return res.status(400).json({
      error: `Cannot approve: required manual section(s) empty: ${emptyRequired.join(', ')}`,
      emptyRequired,
    });
  }

  const { approvedAt } = saveSummary({
    patientDfn: req.params.dfn,
    episodeId: episodeId ?? '',
    specialty: specialtyConfig.key,
    sections: provided,
    approvedBy: approvedBy ?? '',
  });
  res.json({ ok: true, approvedAt });
}));

apiRouter.get('/patients/:dfn/summary', (req, res) => {
  res.json({ summary: getSummary(req.params.dfn, req.query.episodeId ?? '') });
});

// JSON error path: provider/dataAccess failures surface as a plain 500 and are
// logged so real failures are visible in the server console.
apiRouter.use((err, req, res, next) => {
  const cause = err.cause?.code ?? err.cause?.message ?? '';
  console.error(`[api] ${req.method} ${req.originalUrl} -> ${err.status || 500}: ${err.message}${cause ? ` (${cause})` : ''}`);
  res.status(500).json({ error: err.message || 'Internal server error' });
});
