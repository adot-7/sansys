// Specialty config registry. general.json is the fallback for unknown keys.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILES = ['general', 'dermatology', 'ctvs'];

const configs = new Map(
  FILES.map((key) => {
    const raw = readFileSync(path.join(__dirname, `${key}.json`), 'utf8');
    return [key, JSON.parse(raw)];
  }),
);

export function listSpecialties() {
  return [...configs.values()].map((c) => ({
    key: c.key,
    label: c.label,
    sectionCount: c.sections.length,
  }));
}

export function loadSpecialty(key) {
  return configs.get(key) ?? configs.get('general');
}
