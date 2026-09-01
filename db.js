const path = require('path');
const Database = require('better-sqlite3');

const dbPath = process.env.DB_PATH || (process.env.VERCEL ? '/tmp/data.sqlite' : path.join(__dirname, 'data.sqlite'));
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    department TEXT NOT NULL DEFAULT 'sams',
    full_name TEXT NOT NULL,
    age INTEGER NOT NULL,
    country TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    discord_info TEXT,
    experience TEXT NOT NULL,
    motivation TEXT NOT NULL,
    criminal_record TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pendiente',
    review_notes TEXT,
    reviewed_by TEXT,
    reviewed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migración: agrega la columna department si la base ya existía sin ella
// (todas las postulaciones previas eran de SAMS).
const columns = db.prepare("PRAGMA table_info(applications)").all();
if (!columns.some((c) => c.name === 'department')) {
  db.exec("ALTER TABLE applications ADD COLUMN department TEXT NOT NULL DEFAULT 'sams'");
}

module.exports = db;
