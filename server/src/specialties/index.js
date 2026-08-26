// Specialty config registry. general.json is the fallback for unknown keys.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['general', 'dermatology', 'ctvs'];
const CUSTOM_FILE = path.join(__dirname, '../../data/custom-specialties.json');

const configs = new Map(
  FILES.map((key) => {
    const raw = readFileSync(path.join(__dirname, `${key}.json`), 'utf8');
    return [key, JSON.parse(raw)];
  }),
);

if (existsSync(CUSTOM_FILE)) {
  for (const config of JSON.parse(readFileSync(CUSTOM_FILE, 'utf8'))) {
    configs.set(config.key, config);
  }
}

export function listSpecialties() {
  return [...configs.values()].map((c) => ({
    key: c.key,
    label: c.label,
    sectionCount: c.sections.length,
    sections: c.sections,
  }));
}

export function loadSpecialty(key) {
  return configs.get(key) ?? configs.get('general');
}

function saveCustomSpecialties() {
  const custom = [...configs.values()].filter((config) => !FILES.includes(config.key));
  mkdirSync(path.dirname(CUSTOM_FILE), { recursive: true });
  writeFileSync(CUSTOM_FILE, JSON.stringify(custom, null, 2) + '\n');
}

export function createSpecialty({ key, label, sections }) {
  const normalizedKey = String(key || label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  if (!normalizedKey || normalizedKey === 'general') throw new Error('Choose a valid specialty name');
  if (configs.has(normalizedKey)) throw new Error(`Specialty "${normalizedKey}" already exists`);
  if (!Array.isArray(sections) || sections.length === 0) throw new Error('Add at least one section');

  const cleanSections = sections.map((section, index) => {
    const id = String(section.id || section.title || '').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const title = String(section.title || '').trim();
    if (!id || !title) throw new Error(`Section ${index + 1} needs a title`);
    const endpoint = section.endpoint ? String(section.endpoint).trim() : null;
    return {
      id,
      title,
      source: section.source ? String(section.source).trim() : (endpoint ? id : null),
      endpoint,
      promptHint: String(section.promptHint || 'Use only the available patient data; leave unsupported details blank.').trim(),
      requiredManual: Boolean(section.requiredManual),
      manualEntry: !section.source && !endpoint,
    };
  });
  if (new Set(cleanSections.map((section) => section.id)).size !== cleanSections.length) {
    throw new Error('Section titles must be unique');
  }
  const config = { key: normalizedKey, label: String(label || normalizedKey).trim(), sections: cleanSections };
  configs.set(normalizedKey, config);
  saveCustomSpecialties();
  return config;
}
