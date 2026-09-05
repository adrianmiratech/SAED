const path = require('path');
const { createClient } = require('@libsql/client');

// Turso (libSQL alojado) en producción para que los datos persistan de
// verdad en Vercel (su filesystem es efímero); en desarrollo local, si no
// hay credenciales de Turso, se usa un archivo SQLite normal en el disco.
const url = process.env.TURSO_DATABASE_URL || `file:${path.join(__dirname, 'data.sqlite')}`;
const authToken = process.env.TURSO_AUTH_TOKEN;
const client = createClient(authToken ? { url, authToken } : { url });

function prepare(sql) {
  return {
    async get(...args) {
      const result = await client.execute({ sql, args });
      return result.rows[0];
    },
    async all(...args) {
      const result = await client.execute({ sql, args });
      return result.rows;
    },
    async run(...args) {
      const result = await client.execute({ sql, args });
      return {
        lastInsertRowid: Number(result.lastInsertRowid),
        changes: result.rowsAffected,
      };
    },
  };
}

let readyPromise = null;

// Todas las rutas esperan esto antes de tocar la base: crea las tablas si
// no existen y aplica migraciones. Se cachea la promesa para que solo
// corra una vez por instancia del proceso.
function ready() {
  if (!readyPromise) readyPromise = setup();
  return readyPromise;
}

async function setup() {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department TEXT NOT NULL DEFAULT 'sams',
      full_name TEXT NOT NULL,
      age INTEGER NOT NULL,
      country TEXT NOT NULL,
      discord_info TEXT,
      experience TEXT NOT NULL,
      motivation TEXT NOT NULL,
      criminal_record TEXT NOT NULL,
      previous_saed_experience TEXT NOT NULL DEFAULT 'No',
      previous_saed_details TEXT,
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
      department TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      level INTEGER NOT NULL,
      department TEXT,
      name TEXT NOT NULL,
      hourly_rate REAL NOT NULL DEFAULT 0,
      UNIQUE(level, department)
    );

    CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT,
      discord_info TEXT,
      department TEXT NOT NULL,
      rank_id INTEGER NOT NULL REFERENCES ranks(id),
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS payroll (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      hours REAL NOT NULL,
      hourly_rate REAL NOT NULL,
      total_amount REAL NOT NULL,
      period_label TEXT,
      paid INTEGER NOT NULL DEFAULT 0,
      paid_at TEXT,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Siembra los rangos oficiales del SAED si la tabla está vacía. Los
  // niveles 9, 8 y 0 son compartidos por ambos departamentos; el resto
  // tiene una variante para SAMS y otra para SAFD.
  const rankCount = (await prepare('SELECT COUNT(*) AS c FROM ranks').get()).c;
  if (rankCount === 0) {
    const seedRanks = [
      [9, null, 'Jefe SAED'],
      [8, null, 'Supervisor SAED'],
      [7, 'sams', 'Director Médico'],
      [7, 'safd', 'Jefe de Batallón'],
      [6, 'sams', 'Subdirector Médico'],
      [6, 'safd', 'Capitán'],
      [5, 'sams', 'Cirujano'],
      [5, 'safd', 'Teniente'],
      [4, 'sams', 'Médico General'],
      [4, 'safd', 'Ingeniero II'],
      [3, 'sams', 'Jefe de Residentes'],
      [3, 'safd', 'Ingeniero I'],
      [2, 'sams', 'Residente'],
      [2, 'safd', 'Bombero'],
      [1, 'sams', 'Estudiante de Medicina'],
      [1, 'safd', 'Bombero en pruebas'],
      [0, null, 'Voluntario'],
    ];
    for (const [level, department, name] of seedRanks) {
      await prepare('INSERT INTO ranks (level, department, name, hourly_rate) VALUES (?, ?, ?, 0)').run(level, department, name);
    }
  }

  // Migración: agrega la columna department si la base ya existía sin ella
  // (todas las postulaciones previas eran de SAMS).
  const columns = await prepare('PRAGMA table_info(applications)').all();
  if (!columns.some((c) => c.name === 'department')) {
    await client.execute("ALTER TABLE applications ADD COLUMN department TEXT NOT NULL DEFAULT 'sams'");
  }
  if (!columns.some((c) => c.name === 'previous_saed_experience')) {
    await client.execute("ALTER TABLE applications ADD COLUMN previous_saed_experience TEXT NOT NULL DEFAULT 'No'");
  }
  if (!columns.some((c) => c.name === 'previous_saed_details')) {
    await client.execute('ALTER TABLE applications ADD COLUMN previous_saed_details TEXT');
  }

  // Renombra el departamento de bomberos a su clave actual (SAFD).
  await client.execute("UPDATE applications SET department = 'safd' WHERE department = 'bomberos'");

  // Se dejaron de pedir teléfono y correo electrónico: se quitan las
  // columnas si la base ya existía con ellas (silencioso si el motor no
  // soporta DROP COLUMN, la columna simplemente queda sin usarse).
  for (const col of ['phone', 'email']) {
    if (columns.some((c) => c.name === col)) {
      try {
        await client.execute(`ALTER TABLE applications DROP COLUMN ${col}`);
      } catch {
        // Motor sin soporte para DROP COLUMN: se ignora.
      }
    }
  }

  // Migración: agrega la columna department a admins si la base ya existía
  // sin ella (los admins previos quedan sin restricción, es decir, ven todo).
  const adminColumns = await prepare('PRAGMA table_info(admins)').all();
  if (!adminColumns.some((c) => c.name === 'department')) {
    await client.execute('ALTER TABLE admins ADD COLUMN department TEXT');
  }

  // Migración: agrega el teléfono a empleados si la tabla ya existía sin él.
  const employeeColumns = await prepare('PRAGMA table_info(employees)').all();
  if (!employeeColumns.some((c) => c.name === 'phone')) {
    await client.execute('ALTER TABLE employees ADD COLUMN phone TEXT');
  }

  // Re-siembra el admin desde variables de entorno si están presentes,
  // útil para el primer arranque contra una base nueva.
  if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
    await prepare(`
      INSERT INTO admins (username, password_hash, department) VALUES (?, ?, ?)
      ON CONFLICT(username) DO UPDATE SET password_hash = excluded.password_hash, department = excluded.department
    `).run(process.env.ADMIN_USER, hash, process.env.ADMIN_DEPARTMENT || null);
  }
}

module.exports = {
  ready,
  prepare(sql) {
    const stmt = prepare(sql);
    return {
      async get(...args) { await ready(); return stmt.get(...args); },
      async all(...args) { await ready(); return stmt.all(...args); },
      async run(...args) { await ready(); return stmt.run(...args); },
    };
  },
};
