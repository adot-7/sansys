// prompts.js — system + user prompt builders for the full-draft and
// single-section regeneration calls. Anti-fabrication rules are baked into
// the system prompt; sourceless sections are never part of any request.

const ANTI_FABRICATION_RULES = [
  'Never invent clinical detail. Every clinical statement must be traceable to the patient data provided in this request.',
  'If the data for a section is thin or partial, state plainly what the data shows (e.g. "Only vitals are recorded; no physical examination findings are available."). Do not fill gaps with plausible-sounding content.',
  'Use the exact clinical wording recorded in the data for diagnoses, allergies, and medication names; do not reclassify or add qualifiers that are not recorded.',
  'Reconcile the same clinical fact across endpoint data and clinical notes. Use the provenance on each fact to understand where it came from; do not silently discard a note-sourced fact just because the corresponding endpoint list is empty.',
  'Medication facts belong in medication sections. Use the normalized medications data, including note-sourced medications with their provenance. Note-only medication facts require doctor verification and must not be presented as a confirmed prescription.',
  'For advice and follow-up sections, provide a concise draft tied to the recorded diagnoses or explicit note instructions. Do not invent an appointment interval, test, dose, restriction, or treatment change.',
  'For sections built from proxy or indirect data, write the useful clinical synthesis first. If a caveat is needed, add at most one short sentence at the end stating that the doctor should verify it. Never use a generic disclaimer as the section content or lead with it.',
  'Output STRICT JSON only with the requested "sections" and "extractedFacts" keys. Section values are plain-text strings; simple hyphen-prefixed lines are allowed for lists. Do not use headings, code fences, commentary, or clinical keys beyond the requested output shape.',
].join('\n');

export function buildSystemPrompt() {
  return [
    'You are a clinical documentation assistant generating a draft discharge summary for a hospital doctor.',
    'You only restate and structure data that already exists in the hospital record.',
    'The doctor will review, edit, and approve everything before it becomes part of the record.',
    'Hard rules:',
    ANTI_FABRICATION_RULES,
  ].join('\n\n');
}

function compact(value) {
  return JSON.stringify(value ?? null);
}

function compactComplaintSource(value) {
  const groups = new Map();
  for (const item of Array.isArray(value) ? value : []) {
    const name = String(item?.name ?? '').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const type = item?.type === 'Associated Complaint' ? 'Associated Complaint' : 'Chief Complaint';
    const key = `${type}\u0000${name.toLocaleLowerCase()}`;
    const group = groups.get(key) || { name, type, recordedDates: [], recordedRemarks: [], provenance: [], needsVerification: false };
    if (item?.date && !group.recordedDates.includes(item.date)) group.recordedDates.push(item.date);
    if (item?.remark && !group.recordedRemarks.includes(item.remark)) group.recordedRemarks.push(item.remark);
    for (const provenance of item?.provenance || []) {
      if (!group.provenance.some((existing) => JSON.stringify(existing) === JSON.stringify(provenance))) group.provenance.push(provenance);
    }
    group.needsVerification = group.needsVerification || item?.needsVerification === true;
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({
    name: group.name,
    type: group.type,
    recordedDates: group.recordedDates,
    ...(group.recordedRemarks.length ? { recordedRemarks: group.recordedRemarks } : {}),
    provenance: group.provenance,
    ...(group.needsVerification ? { needsVerification: true } : {}),
  }));
}

function sourceValue(source, patientData) {
  return source === 'complaints'
    ? compactComplaintSource(patientData[source])
    : patientData[source] ?? null;
}

export function buildSourceData(patientData, specialtyConfig) {
  const sections = specialtyConfig.sections.filter((s) => s.source !== null || Array.isArray(s.sources));
  const sourceNames = [...new Set(sections.flatMap((s) => s.sources || [s.source]).filter(Boolean))];
  // Notes are also reconciliation evidence: a fact written only in a note can
  // be promoted into the canonical section source with note provenance.
  if (patientData.notes?.length && !sourceNames.includes('notes')) sourceNames.push('notes');
  return Object.fromEntries(sourceNames.map((source) => [source, sourceValue(source, patientData)]));
}

// Full-draft request: one JSON object keyed by section id. Only sections with
// a non-null `source` are included; sourceless sections never reach the model.
export function buildDraftUserPrompt(patientData, specialtyConfig) {
  const sections = specialtyConfig.sections.filter((s) => s.source !== null || Array.isArray(s.sources));
  const sourceData = buildSourceData(patientData, specialtyConfig);
  const sectionSpecs = sections.map((s) => ({
    id: s.id,
    title: s.title,
    promptHint: s.promptHint,
    sources: s.sources || [s.source],
  }));

  return [
    `Generate a draft discharge summary for specialty "${specialtyConfig.label}".`,
    'For each section below, use only the listed source keys from the shared `sourceData` object.',
    'Respond with one JSON object containing "sections" and "extractedFacts".',
    'The sections object maps each requested section id to its text.',
    'Use extractedFacts to promote explicit facts found in note content that are not already represented in the normalized source arrays. Never infer a fact. Every extracted fact must copy the exact provenance object from the note that supports it. If there are no additional facts, return empty arrays.',
    'Use this extractedFacts shape: { "medications": [], "diagnoses": [], "problems": [], "allergies": [], "complaints": [], "labOrders": [], "radOrders": [], "vitals": [] }.',
    'For extracted medication facts, include medication, status, schedule, scheduleType, route, startDate, and stopDate when explicitly recorded. Note-only medications are provisional and require doctor verification.',
    'Shared sourceData (each source is included once):',
    JSON.stringify(sourceData, null, 2),
    'Sections:',
    JSON.stringify(sectionSpecs, null, 2),
  ].join('\n\n');
}

// Regeneration request: one section's spec + its data, with the current draft
// of all sections as immutable context. The model returns only the new text
// for the target section.
export function buildRegenerateUserPrompt(sectionId, patientData, specialtyConfig, existingDraft) {
  const section = specialtyConfig.sections.find((s) => s.id === sectionId);
  if (!section) throw new Error(`Unknown section id "${sectionId}" for specialty "${specialtyConfig.key}"`);
  if (section.source === null && !Array.isArray(section.sources)) {
    throw new Error(`Section "${sectionId}" has no data source and is never regenerated by the model`);
  }

  return [
    `Regenerate ONLY the "${section.title}" section of the discharge summary (specialty "${specialtyConfig.label}").`,
    'Section spec:',
    JSON.stringify(
      {
        id: section.id,
        title: section.title,
        promptHint: section.promptHint,
        data: {
          ...(section.sources || [section.source]).reduce((all, source) => ({ ...all, [source]: sourceValue(source, patientData) }), {}),
          notes: sourceValue('notes', patientData),
        },
      },
      null,
      2,
    ),
    'Current draft of all sections (context only — do not change any section other than the target):',
    compact(existingDraft ?? {}),
    'Respond with a single JSON object: { "text": "<new text for this section only>", "extractedFacts": { "medications": [], "diagnoses": [], "problems": [], "allergies": [], "complaints": [], "labOrders": [], "radOrders": [], "vitals": [] } }.',
  ].join('\n\n');
}
