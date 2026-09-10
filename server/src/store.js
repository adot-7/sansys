// Local persistence for approved discharge summaries (better-sqlite3).
// One row per patient/episode pair: approving again overwrites that episode's summary.
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
      patient_dfn TEXT NOT NULL,
      episode_id TEXT NOT NULL DEFAULT '',
      specialty TEXT NOT NULL,
      sections TEXT NOT NULL,
      approved_at TEXT NOT NULL,
      approved_by TEXT NOT NULL,
      UNIQUE(patient_dfn, episode_id)
    )
  `);
  const columns = db.prepare('PRAGMA table_info(summaries)').all();
  if (!columns.some((column) => column.name === 'episode_id')) {
    db.exec(`
      CREATE TABLE summaries_episode (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        patient_dfn TEXT NOT NULL,
        episode_id TEXT NOT NULL DEFAULT '',
        specialty TEXT NOT NULL,
        sections TEXT NOT NULL,
        approved_at TEXT NOT NULL,
        approved_by TEXT NOT NULL,
        UNIQUE(patient_dfn, episode_id)
      );
      INSERT INTO summaries_episode (id, patient_dfn, episode_id, specialty, sections, approved_at, approved_by)
        SELECT id, patient_dfn, '', specialty, sections, approved_at, approved_by FROM summaries;
      DROP TABLE summaries;
      ALTER TABLE summaries_episode RENAME TO summaries;
    `);
  }
  return db;
}

function getDb() {
  if (!db) initStore();
  return db;
}

export function getSummary(patientDfn, episodeId = '') {
  const row = getDb()
    .prepare('SELECT patient_dfn, episode_id, specialty, sections, approved_at, approved_by FROM summaries WHERE patient_dfn = ? AND episode_id = ?')
    .get(patientDfn, episodeId);
  if (!row) return null;
  return {
    patientDfn: row.patient_dfn,
    episodeId: row.episode_id,
    specialty: row.specialty,
    sections: JSON.parse(row.sections),
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
  };
}

export function saveSummary({ patientDfn, episodeId = '', specialty, sections, approvedBy }) {
  const approvedAt = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO summaries (patient_dfn, episode_id, specialty, sections, approved_at, approved_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(patient_dfn, episode_id) DO UPDATE SET
         specialty = excluded.specialty,
         sections = excluded.sections,
         approved_at = excluded.approved_at,
         approved_by = excluded.approved_by`,
    )
    .run(patientDfn, episodeId, specialty, JSON.stringify(sections ?? {}), approvedAt, approvedBy ?? '');
  return { approvedAt };
}
