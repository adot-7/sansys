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

function formatMedications(medications, emptyText, { includeStatus = false } = {}) {
  const groups = groupMedications(medications);
  return listText(groups, emptyText, (item) => [
    clean(item.medication),
    formatMedicationSchedules(item.schedules),
    item.routes.length ? `route: ${item.routes.join(', ')}` : '',
    formatMedicationDates('start', item.starts),
    formatMedicationDates('stop', item.stops),
    includeStatus && item.statuses.length ? formatMedicationStatuses(item.statuses) : '',
  ].filter(Boolean).join('; '));
}

function groupMedications(medications) {
  const groups = new Map();
  for (const medication of Array.isArray(medications) ? medications : []) {
    const name = clean(medication.medication);
    if (!name) continue;
    const key = `${name.toLocaleLowerCase()}|${clean(medication.route).toLocaleLowerCase()}`;
    const group = groups.get(key) || {
      medication: name,
      schedules: [],
      routes: [],
      starts: [],
      stops: [],
      statuses: [],
    };
    const schedule = formatMedicationSchedule(medication);
    if (schedule && !group.schedules.includes(schedule)) group.schedules.push(schedule);
    const route = clean(medication.route);
    if (route && !group.routes.includes(route)) group.routes.push(route);
    const start = clean(medication.startDate);
    if (start && !group.starts.includes(start)) group.starts.push(start);
    const stop = clean(medication.stopDate) || 'ongoing';
    if (!group.stops.includes(stop)) group.stops.push(stop);
    const statuses = Array.isArray(medication.statuses) ? medication.statuses : [medication.statuses];
    for (const status of [medication.status, ...statuses].map(clean).filter(Boolean)) {
      if (!group.statuses.includes(status)) group.statuses.push(status);
    }
    groups.set(key, group);
  }
  return [...groups.values()];
}

function formatMedicationSchedules(schedules) {
  if (!schedules.length) return 'schedule: not recorded';
  return `${schedules.length > 1 ? 'schedules' : 'schedule'}: ${schedules.join(', ')}`;
}

function formatMedicationDates(label, dates) {
  if (!dates.length) return `${label}: not recorded`;
  return `${dates.length > 1 ? `${label}s` : label}: ${dates.join(', ')}`;
}

function formatMedicationStatuses(statuses) {
  return `${statuses.length > 1 ? 'statuses' : 'status'}: ${statuses.join(', ')}`;
}

function formatMedicationSchedule(item) {
  const schedule = clean(item.schedule);
  const scheduleType = clean(item.scheduleType);
  if (!schedule && !scheduleType) return 'not recorded';
  if (!schedule || !scheduleType || schedule.toLocaleLowerCase() === scheduleType.toLocaleLowerCase()) {
    return schedule || scheduleType;
  }
  return `${schedule} (type: ${scheduleType})`;
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

function hasExplicitFollowUp(patientData) {
  const noteLines = (patientData?.notes || []).flatMap((note) => [
    ...(Array.isArray(note.content) ? note.content : [note.content].filter(Boolean)),
    JSON.stringify(note.patientObjects || {}),
  ]);
  const explicitInstruction = /(?:follow[\s_-]?up\s+(?:in|after|with|at|on|for|as needed)|return\s+(?:in|after|to|for)|revisit|re-?evaluate|come back\s+(?:in|after|to|for)|(?:schedule|book|arrange)\s+(?:a\s+)?(?:follow[\s_-]?up|review|appointment)|appointment\s+(?:in|on|at|with|scheduled)|review\s+(?:in|after|with|at|on|as needed)|see\s+(?:the\s+)?(?:clinic|doctor|specialist)|(?:clinic|outpatient|OPD)\s+(?:follow|review|appointment|visit))/i;
  return noteLines.some((line) => explicitInstruction.test(String(line || '')));
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
      return formatMedications(patientData?.medications, 'No medication order is recorded for this episode.', { includeStatus: true });
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
      return hasExplicitFollowUp(patientData) ? normalizeNarrative(text) : '';
    default:
      return normalizeGeneratedText(text);
  }
}
