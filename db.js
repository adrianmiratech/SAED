const path = require('path');
const { createClient } = require('@libsql/client');

// Turso (libSQL alojado) en producción para que los datos persistan de
// verdad en Vercel (su filesystem es efímero); en desarrollo local, si no
// hay credenciales de Turso, se usa un archivo SQLite normal en el disco.
// Si no hay credenciales de Turso, se cae a un archivo local: en Vercel
// el bundle es de solo lectura, así que ahí el único directorio donde se
// puede escribir es /tmp (igual de efímero, pero al menos no falla).
const localFallbackPath = process.env.VERCEL ? '/tmp/data.sqlite' : path.join(__dirname, 'data.sqlite');
const url = process.env.TURSO_DATABASE_URL || `file:${localFallbackPath}`;
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

async function ensureColumn(table, columnDef) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
  }
}

let readyPromise = null;

// Todas las rutas esperan esto antes de tocar la base: crea las tablas si
// no existen y aplica migraciones. Se cachea la promesa para que solo
// corra una vez por instancia del proceso.
function ready() {
  if (!readyPromise) readyPromise = setup();
  return readyPromise;
}

// Se ejecuta en cada arranque en frío de la función serverless, así que se
// mantiene a lo mínimo posible: un solo viaje de ida y vuelta para crear las
// tablas (ya con el esquema final, sin las columnas viejas de teléfono/email)
// y otro para revisar si hay que sembrar los rangos. Las migraciones con
// ALTER TABLE que se necesitaron en su momento para llegar a este esquema ya
// se aplicaron contra la base real y se sacaron de acá para no pagar esos
// viajes de más (varios PRAGMA + ALTER) en cada login.
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

    CREATE TABLE IF NOT EXISTS employee_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      department TEXT NOT NULL,
      clock_in TEXT NOT NULL DEFAULT (datetime('now')),
      clock_out TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT,
      unit TEXT NOT NULL DEFAULT 'unidad',
      quantity REAL NOT NULL DEFAULT 0,
      min_quantity REAL NOT NULL DEFAULT 0,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_id INTEGER NOT NULL REFERENCES inventory_items(id),
      type TEXT NOT NULL,
      quantity REAL NOT NULL,
      reason TEXT,
      case_id INTEGER REFERENCES cases(id),
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department TEXT NOT NULL,
      subject_name TEXT NOT NULL,
      age INTEGER,
      location TEXT,
      summary TEXT NOT NULL,
      treatment TEXT,
      status TEXT NOT NULL DEFAULT 'abierta',
      responsible_employee_id INTEGER REFERENCES employees(id),
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );
  `);

  // employees y admins ya existían con datos reales antes de sumar estas
  // columnas, así que a diferencia de las tablas de arriba no alcanza con
  // "IF NOT EXISTS": hay que intentar el ALTER TABLE e ignorar el error si
  // la columna ya está (SQLite no tiene "ADD COLUMN IF NOT EXISTS").
  await ensureColumn('employees', 'username TEXT');
  await ensureColumn('employees', 'password_hash TEXT');
  await ensureColumn('employees', 'role_id INTEGER REFERENCES employee_roles(id)');
  await ensureColumn('employees', 'is_staff INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('employees', 'is_superadmin INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('employees', 'hr_access INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('admins', 'hr_access INTEGER NOT NULL DEFAULT 0');
  // Índice único parcial-friendly: SQLite trata cada NULL como distinto en
  // un UNIQUE INDEX, así que varios empleados sin usuario de fichaje conviven bien.
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_username ON employees(username)');

  // Siembra los roles/divisiones del SAED si la tabla está vacía. Son
  // compartidos por ambos departamentos (no van atados a SAMS o SAFD).
  const roleCount = (await prepare('SELECT COUNT(*) AS c FROM employee_roles').get()).c;
  if (roleCount === 0) {
    const seedRoles = ['RTD (Recruitment and Training Division)', 'Recursos Humanos', 'Dirección', 'Estudiantes'];
    for (const name of seedRoles) {
      await prepare('INSERT INTO employee_roles (name, department) VALUES (?, NULL)').run(name);
    }
  }

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

  // Migración única: el login de staff vivía separado en la tabla admins
  // (panel de gestión) del de fichaje (tabla employees). Ahora es una sola
  // cuenta, así que cada admin pasa a ser un empleado con is_staff = 1 la
  // primera vez que el server arranca con este código. No se borra la
  // tabla admins ni sus filas, solo se copian (si el username ya existe
  // como empleado, se lo deja como está para no pisar nada).
  const adminRows = await prepare('SELECT * FROM admins').all();
  if (adminRows.length > 0) {
    const genericRank = await prepare('SELECT id FROM ranks WHERE level = 8 AND department IS NULL').get();
    for (const a of adminRows) {
      const existing = await prepare('SELECT id FROM employees WHERE username = ?').get(a.username);
      if (existing) continue;
      await prepare(`
        INSERT INTO employees
          (full_name, department, rank_id, active, is_staff, is_superadmin, hr_access, username, password_hash, created_by)
        VALUES (?, ?, ?, 1, 1, ?, ?, ?, ?, 'migración')
      `).run(
        a.username, a.department || 'sams', genericRank.id,
        a.department ? 0 : 1, a.hr_access ? 1 : 0, a.username, a.password_hash,
      );
    }
  }

  // Re-siembra el superadmin desde variables de entorno si están
  // presentes, útil para el primer arranque contra una base nueva. Ahora
  // crea/actualiza directamente el empleado (login unificado), no la
  // vieja tabla admins.
  if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
    const department = process.env.ADMIN_DEPARTMENT || 'sams';
    const isSuperadmin = process.env.ADMIN_DEPARTMENT ? 0 : 1;
    const genericRank = await prepare('SELECT id FROM ranks WHERE level = 8 AND department IS NULL').get();

    const existing = await prepare('SELECT id FROM employees WHERE username = ?').get(process.env.ADMIN_USER);
    if (existing) {
      await prepare(`
        UPDATE employees
        SET password_hash = ?, department = ?, is_staff = 1, is_superadmin = ?, hr_access = 1, active = 1
        WHERE id = ?
      `).run(hash, department, isSuperadmin, existing.id);
    } else {
      await prepare(`
        INSERT INTO employees
          (full_name, department, rank_id, active, is_staff, is_superadmin, hr_access, username, password_hash, created_by)
        VALUES (?, ?, ?, 1, 1, ?, 1, ?, ?, 'seed')
      `).run(process.env.ADMIN_USER, department, genericRank.id, isSuperadmin, process.env.ADMIN_USER, hash);
    }
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
