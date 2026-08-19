// Local persistence for approved discharge summaries (better-sqlite3).
// One row per patient_dfn: approving again overwrites the previous summary.
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db = null;

export function initStore() {
  mkdirSync(path.dirname(config.dbFile), { recursive: true });
  db = new Database(config.dbFile);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_dfn TEXT NOT NULL UNIQUE,
      specialty TEXT NOT NULL,
      sections TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      approved_by TEXT NOT NULL
    )
  `);
  return db;
}

function getDb() {
  if (!db) initStore();
  return db;
}

export function getSummary(patientDfn) {
  const row = getDb()
    .prepare('SELECT patient_dfn, specialty, sections, approved_at, approved_by FROM summaries WHERE patient_dfn = ?')
    .get(patientDfn);
  if (!row) return null;
  return {
    patientDfn: row.patient_dfn,
    specialty: row.specialty,
    sections: JSON.parse(row.sections),
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
  };
}

export function saveSummary({ patientDfn, specialty, sections, approvedBy }) {
  const approvedAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO summaries (patient_dfn, specialty, sections, approved_at, approved_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(patient_dfn) DO UPDATE SET
         specialty = excluded.specialty,
         sections = excluded.sections,
         approved_at = excluded.approved_at,
         approved_by = excluded.approved_by`,
    )
    .run(patientDfn, specialty, JSON.stringify(sections ?? {}), approvedAt, approvedBy ?? '');
  return { approvedAt };
}
