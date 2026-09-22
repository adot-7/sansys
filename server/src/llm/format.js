// Formatting for source-backed sections. Factual lists should not depend on
// whether a model decides to use bullets, commas, or escaped newlines.

export function normalizeGeneratedText(value) {
  let text = String(value ?? '');
  for (let i = 0; i < 3; i += 1) {
    text = text
      .replaceAll('\\r\\n', '\n')
      .replaceAll('\\n', '\n')
      .replaceAll('\\r', '\r')
      .replaceAll('\\t', '\t');
  }
  return text.replace(/\r\n?/g, '\n').trim();
}

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function listText(items, emptyText, formatItem) {
  if (!items.length) return emptyText;
  return items.map((item) => `- ${formatItem(item)}`).join('\n');
}

function formatComplaints(complaints) {
  const groups = new Map();
  for (const complaint of Array.isArray(complaints) ? complaints : []) {
    if (complaint.type !== 'Chief Complaint') continue;
    const name = clean(complaint.name);
    if (!name) continue;
    const key = name.toLocaleLowerCase();
    const group = groups.get(key) || { name, dates: [] };
    const date = clean(complaint.date);
    if (date && !group.dates.includes(date)) group.dates.push(date);
    groups.set(key, group);
  }
  return listText([...groups.values()], 'No presenting complaint is recorded for this episode.', (item) => (
    item.dates.length ? `${item.name} - ${item.dates.join('; ')}` : item.name
  ));
}

function formatProblems(problems) {
  const distinct = [];
  const seen = new Set();
  for (const problem of Array.isArray(problems) ? problems : []) {
    const name = clean(problem.problem);
    const key = name.toLocaleLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    distinct.push(problem);
  }
  return listText(distinct, 'No past medical problem is recorded for this episode.', (item) => {
    const details = [
      item.status ? `status: ${clean(item.status)}` : '',
      item.dateOnset ? `onset: ${clean(item.dateOnset)}` : '',
    ].filter(Boolean);
    return details.length ? `${clean(item.problem)} (${details.join('; ')})` : clean(item.problem);
  });
}

function formatDiagnoses(diagnoses) {
  return listText(diagnoses || [], 'No diagnosis is recorded for this episode.', (item) => {
    const label = clean(item.diagnosis);
    return item.isPrimary ? `${label} (primary)` : label;
  });
}

function formatAllergies(allergies) {
  const items = allergies?.items || [];
  if (!items.length) return clean(allergies?.status) || 'No allergy is recorded.';
  return listText(items, '', (item) => [
    clean(item.allergy),
    item.reaction ? `reaction: ${clean(item.reaction)}` : '',
    item.symptoms ? `symptoms: ${clean(item.symptoms)}` : '',
    item.date ? `date: ${clean(item.date)}` : '',
  ].filter(Boolean).join('; '));
}

function formatMedications(medications, emptyText) {
  return listText(medications || [], emptyText, (item) => [
    clean(item.medication),
    formatMedicationSchedule(item),
    item.route ? `route: ${clean(item.route)}` : '',
    `start: ${clean(item.startDate) || 'not recorded'}`,
    `stop: ${clean(item.stopDate) || 'ongoing'}`,
    item.needsVerification ? 'source: clinical note; verify order' : '',
  ].filter(Boolean).join('; '));
}

function formatMedicationSchedule(item) {
  const schedule = clean(item.schedule);
  const scheduleType = clean(item.scheduleType);
  if (!schedule && !scheduleType) return 'schedule: not recorded';
  if (!schedule || !scheduleType || schedule.toLocaleLowerCase() === scheduleType.toLocaleLowerCase()) {
    return `schedule: ${schedule || scheduleType}`;
  }
  return `schedule: ${schedule} (type: ${scheduleType})`;
}

function normalizeNarrative(text) {
  return normalizeGeneratedText(text)
    .replace(/[ \t]*[•●]\s*/g, '\n- ')
    .replace(/[ \t]*\n[ \t]*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function diagnosisLabels(patientData) {
  return (patientData?.diagnoses || []).map((diagnosis) => clean(diagnosis.diagnosis)).filter(Boolean);
}

function fallbackAdvice(patientData) {
  const diagnoses = diagnosisLabels(patientData);
  return diagnoses.length
    ? `- Review the recorded diagnoses (${diagnoses.join('; ')}) and follow the explicit progress-note instructions before discharge; doctor to finalize.`
    : '- No diagnosis-based advice can be drafted from the recorded data; doctor to complete.';
}

function fallbackFollowUp(patientData) {
  const diagnoses = diagnosisLabels(patientData);
  return diagnoses.length
    ? `- Arrange treating-specialty review for the recorded diagnosis (${diagnoses.join('; ')}); the doctor should set the interval, tests, and treatment plan.`
    : '- No diagnosis-based follow-up draft can be generated from the recorded data; doctor to complete.';
}

export function formatSectionText(sectionId, text, patientData) {
  switch (sectionId) {
    case 'presenting-complaints':
      return formatComplaints(patientData?.complaints);
    case 'diagnosis':
      return formatDiagnoses(patientData?.diagnoses);
    case 'past-medical-history':
      return formatProblems(patientData?.problems);
    case 'allergies':
      return formatAllergies(patientData?.allergies);
    case 'current-medication':
      return formatMedications(patientData?.activeMedications, 'No active medication order is recorded for this episode.');
    case 'medications-during-stay':
      return formatMedications(patientData?.medications, 'No medication order is recorded for this episode.');
    case 'medications-on-discharge':
      return formatMedications(patientData?.dischargeMedications, 'No discharge-suitable active medication order is recorded for this episode.');
    case 'history-present-illness':
    case 'course-in-hospital':
    case 'on-examination':
    case 'condition-at-discharge':
      return normalizeNarrative(text);
    case 'advice':
      return normalizeNarrative(text) || fallbackAdvice(patientData);
    case 'follow-up-advice':
      return normalizeNarrative(text) || fallbackFollowUp(patientData);
    default:
      return normalizeGeneratedText(text);
  }
}
