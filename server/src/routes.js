// routes.js — the REST API exactly as frozen in contracts.md. Mounted at /api.
import { Router } from 'express';
import { fetchPatient, diagSansysConnectivity } from './dataAccess.js';
import { listSpecialties, loadSpecialty } from './specialties/index.js';
import { generateDraft, regenerateSection } from './llm/index.js';
import { getSummary, saveSummary } from './store.js';

export const apiRouter = Router();

// Wrap async handlers so rejections reach the express error path (500 JSON).
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

apiRouter.get('/diag/sansys', wrap(async (req, res) => {
  res.json(await diagSansysConnectivity());
}));

apiRouter.get('/patients/:dfn', wrap(async (req, res) => {
  res.json(await fetchPatient(req.params.dfn));
}));

apiRouter.get('/specialties', (req, res) => {
  res.json({ specialties: listSpecialties() });
});

apiRouter.post('/patients/:dfn/draft', wrap(async (req, res) => {
  const specialtyKey = req.body?.specialty || 'general';
  const specialtyConfig = loadSpecialty(specialtyKey); // unknown keys fall back to general
  const patientData = await fetchPatient(req.params.dfn);
  const { sections, provider } = await generateDraft(patientData, specialtyConfig);
  res.json({ specialty: specialtyConfig.key, sections, provider });
}));

apiRouter.post('/patients/:dfn/draft/:sectionId/regenerate', wrap(async (req, res) => {
  const specialtyKey = req.body?.specialty || 'general';
  const specialtyConfig = loadSpecialty(specialtyKey);
  const section = specialtyConfig.sections.find((s) => s.id === req.params.sectionId);
  if (!section) return res.status(404).json({ error: `Unknown section id "${req.params.sectionId}"` });
  const patientData = await fetchPatient(req.params.dfn);
  const { text, provider } = await regenerateSection(req.params.sectionId, patientData, specialtyConfig, req.body?.currentDraft ?? {});
  res.json({ text, provider });
}));

apiRouter.post('/patients/:dfn/summary/approve', wrap(async (req, res) => {
  const { specialty, sections, approvedBy } = req.body ?? {};
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
    specialty: specialtyConfig.key,
    sections: provided,
    approvedBy: approvedBy ?? '',
  });
  res.json({ ok: true, approvedAt });
}));

apiRouter.get('/patients/:dfn/summary', (req, res) => {
  res.json({ summary: getSummary(req.params.dfn) });
});

// JSON error path: provider/dataAccess failures surface as a plain 500 and are
// logged so real failures are visible in the server console.
apiRouter.use((err, req, res, next) => {
  const cause = err.cause?.code ?? err.cause?.message ?? '';
  console.error(`[api] ${req.method} ${req.originalUrl} -> ${err.status || 500}: ${err.message}${cause ? ` (${cause})` : ''}`);
  res.status(500).json({ error: err.message || 'Internal server error' });
});
