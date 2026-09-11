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

// Devuelve true si la columna se acaba de agregar recién ahora (para poder
// aplicar un backfill de datos una sola vez, la primera vez que existe).
async function ensureColumn(table, columnDef) {
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
    return true;
  } catch (err) {
    if (!/duplicate column name/i.test(err.message)) throw err;
    return false;
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

    CREATE TABLE IF NOT EXISTS employee_role_links (
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      role_id INTEGER NOT NULL REFERENCES employee_roles(id),
      PRIMARY KEY (employee_id, role_id)
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

    CREATE TABLE IF NOT EXISTS report_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      department TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      fields_json TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS report_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL REFERENCES report_templates(id),
      department TEXT NOT NULL,
      employee_id INTEGER NOT NULL REFERENCES employees(id),
      data_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cadets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      phone TEXT,
      discord_info TEXT,
      department TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'activo',
      notes TEXT,
      employee_id INTEGER REFERENCES employees(id),
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      graduated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS academy_courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      department TEXT,
      description TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS academy_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES academy_courses(id),
      title TEXT NOT NULL,
      scheduled_at TEXT,
      instructor_employee_id INTEGER REFERENCES employees(id),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS academy_evaluations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cadet_id INTEGER NOT NULL REFERENCES cadets(id),
      course_id INTEGER REFERENCES academy_courses(id),
      title TEXT NOT NULL,
      score REAL,
      max_score REAL NOT NULL DEFAULT 100,
      passed INTEGER,
      notes TEXT,
      evaluator_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cadet_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cadet_id INTEGER NOT NULL REFERENCES cadets(id),
      author_name TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS academy_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      course_id INTEGER NOT NULL REFERENCES academy_courses(id),
      file_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      data_base64 TEXT NOT NULL,
      uploaded_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // employees y admins ya existían con datos reales antes de sumar estas
  // columnas, así que a diferencia de las tablas de arriba no alcanza con
  // "IF NOT EXISTS": hay que intentar el ALTER TABLE e ignorar el error si
  // la columna ya está (SQLite no tiene "ADD COLUMN IF NOT EXISTS").
  await ensureColumn('employees', 'username TEXT');
  await ensureColumn('employees', 'password_hash TEXT');
  await ensureColumn('admins', 'hr_access INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('report_submissions', "status TEXT NOT NULL DEFAULT 'pendiente'");
  await ensureColumn('report_submissions', 'review_notes TEXT');
  await ensureColumn('report_submissions', 'reviewed_by TEXT');
  await ensureColumn('report_submissions', 'reviewed_at TEXT');
  await ensureColumn('report_submissions', 'title TEXT');
  // Índice único parcial-friendly: SQLite trata cada NULL como distinto en
  // un UNIQUE INDEX, así que varios empleados sin usuario de fichaje conviven bien.
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_employees_username ON employees(username)');

  // Los estudiantes (cadetes) también pueden tener su propia cuenta para
  // entrar a un portal simplificado (ver materiales de sus cursos y sus
  // propias evaluaciones) sin acceso al panel de staff.
  await ensureColumn('cadets', 'username TEXT');
  await ensureColumn('cadets', 'password_hash TEXT');
  await client.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_cadets_username ON cadets(username)');

  // El acceso (staff / superadmin / RRHH-Fichajes) ya no son casilleros
  // sueltos por empleado: los otorga la división a la que pertenece. Un
  // empleado puede estar en varias divisiones a la vez y el acceso
  // efectivo es la unión de lo que otorga cada una.
  const addedGrantsColumns = await ensureColumn('employee_roles', 'grants_staff INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('employee_roles', 'grants_superadmin INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('employee_roles', 'grants_hr_access INTEGER NOT NULL DEFAULT 0');

  // El acceso a la Academia (cadetes, cursos, evaluaciones) sigue el mismo
  // patrón: lo otorga la división, no un casillero suelto. La primera vez
  // que esta columna aparece, se la activa (junto con "staff", para que
  // puedan entrar al panel) en la división "RTD" ya existente, sin esperar
  // a que alguien la reasigne a mano.
  const addedAcademyColumn = await ensureColumn('employee_roles', 'grants_academy_access INTEGER NOT NULL DEFAULT 0');
  if (addedAcademyColumn) {
    await client.execute(`
      UPDATE employee_roles SET grants_staff = 1, grants_academy_access = 1
      WHERE name = 'RTD (Recruitment and Training Division)' AND department IS NULL
    `);
  }

  // employees.role_id (una sola división) quedó reemplazado por la tabla
  // employee_role_links (varias). Si la columna vieja todavía existe en
  // esta base, se migra una sola vez; si no existe (bases nuevas), no hace
  // nada y sigue de largo.
  try {
    await client.execute(`
      INSERT OR IGNORE INTO employee_role_links (employee_id, role_id)
      SELECT id, role_id FROM employees WHERE role_id IS NOT NULL
    `);
  } catch (err) {
    if (!/no such column: role_id/i.test(err.message)) throw err;
  }

  // Limpieza única: si dos arranques en frío corrieron el sembrado de
  // roles casi al mismo tiempo (cold starts concurrentes en serverless),
  // el chequeo de "¿está vacía la tabla?" de abajo podía correr dos veces
  // antes de que ninguno terminara de insertar, dejando el mismo rol
  // duplicado. Acá se agrupan por nombre + departamento (tratando NULL
  // como un valor más, no como "distinto de sí mismo") y se dejan solo el
  // más viejo, reapuntando primero los vínculos que tenía el resto.
  const allRoles = await prepare('SELECT * FROM employee_roles ORDER BY id ASC').all();
  const seenRoleKeys = new Map();
  for (const r of allRoles) {
    const key = `${r.name}|${r.department || ''}`;
    if (!seenRoleKeys.has(key)) {
      seenRoleKeys.set(key, r.id);
    } else {
      const keepId = seenRoleKeys.get(key);
      await prepare('UPDATE OR IGNORE employee_role_links SET role_id = ? WHERE role_id = ?').run(keepId, r.id);
      await prepare('DELETE FROM employee_role_links WHERE role_id = ?').run(r.id);
      await prepare('DELETE FROM employee_roles WHERE id = ?').run(r.id);
    }
  }

  // Siembra los roles/divisiones del SAED (compartidos por ambos
  // departamentos) si todavía no existen, comprobando cada uno por
  // nombre en vez de "¿está vacía la tabla?" para que sea segura de
  // repetir sin volver a duplicar nada. "Dirección" y "Recursos Humanos"
  // ya vienen con el acceso correspondiente otorgado.
  const seedRoles = [
    ['RTD (Recruitment and Training Division)', 1, 0, 0, 1],
    ['Recursos Humanos', 1, 0, 1, 0],
    ['Dirección', 1, 1, 0, 0],
    ['Estudiantes', 0, 0, 0, 0],
  ];
  for (const [name, grantsStaff, grantsSuperadmin, grantsHrAccess, grantsAcademyAccess] of seedRoles) {
    const existingRole = await prepare('SELECT id FROM employee_roles WHERE name = ? AND department IS NULL').get(name);
    if (!existingRole) {
      await prepare(`
        INSERT INTO employee_roles (name, department, grants_staff, grants_superadmin, grants_hr_access, grants_academy_access)
        VALUES (?, NULL, ?, ?, ?, ?)
      `).run(name, grantsStaff, grantsSuperadmin, grantsHrAccess, grantsAcademyAccess);
    } else if (addedGrantsColumns) {
      // Backfill único: estos roles ya existían de antes de que existiera
      // el concepto de "otorgar acceso", así que la primera vez que la
      // columna aparece se les carga el valor por defecto que les
      // corresponde. Un superadmin puede cambiarlo después sin problema:
      // esto no se vuelve a pisar en arranques futuros.
      await prepare(`
        UPDATE employee_roles SET grants_staff = ?, grants_superadmin = ?, grants_hr_access = ? WHERE id = ?
      `).run(grantsStaff, grantsSuperadmin, grantsHrAccess, existingRole.id);
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
  // (panel de gestión) del de fichaje (tabla employees). Ahora es una
  // sola cuenta, y el acceso lo da la división a la que pertenece (no una
  // columna suelta), así que cada admin migrado pasa a la división
  // "Dirección" (que ya otorga staff + superadmin) para no perder acceso.
  // No se borra la tabla admins ni sus filas, solo se copian (si el
  // username ya existe como empleado, se lo deja como está).
  const adminRows = await prepare('SELECT * FROM admins').all();
  if (adminRows.length > 0) {
    const genericRank = await prepare('SELECT id FROM ranks WHERE level = 8 AND department IS NULL').get();
    const direccionRole = await prepare("SELECT id FROM employee_roles WHERE name = 'Dirección' AND department IS NULL").get();
    for (const a of adminRows) {
      const existing = await prepare('SELECT id FROM employees WHERE username = ?').get(a.username);
      if (existing) continue;
      const info = await prepare(`
        INSERT INTO employees (full_name, department, rank_id, active, username, password_hash, created_by)
        VALUES (?, ?, ?, 1, ?, ?, 'migración')
      `).run(a.username, a.department || 'sams', genericRank.id, a.username, a.password_hash);
      if (direccionRole) {
        await prepare('INSERT OR IGNORE INTO employee_role_links (employee_id, role_id) VALUES (?, ?)').run(info.lastInsertRowid, direccionRole.id);
      }
    }
  }

  // Re-siembra el superadmin desde variables de entorno si están
  // presentes, útil para el primer arranque contra una base nueva. Ahora
  // crea/actualiza directamente el empleado (login unificado) y lo suma a
  // la división "Dirección" para que tenga acceso total.
  if (process.env.ADMIN_USER && process.env.ADMIN_PASSWORD) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 10);
    const department = process.env.ADMIN_DEPARTMENT || 'sams';
    const genericRank = await prepare('SELECT id FROM ranks WHERE level = 8 AND department IS NULL').get();
    const direccionRole = await prepare("SELECT id FROM employee_roles WHERE name = 'Dirección' AND department IS NULL").get();

    const existing = await prepare('SELECT id FROM employees WHERE username = ?').get(process.env.ADMIN_USER);
    let employeeId;
    if (existing) {
      await prepare('UPDATE employees SET password_hash = ?, department = ?, active = 1 WHERE id = ?').run(hash, department, existing.id);
      employeeId = existing.id;
    } else {
      const info = await prepare(`
        INSERT INTO employees (full_name, department, rank_id, active, username, password_hash, created_by)
        VALUES (?, ?, ?, 1, ?, ?, 'seed')
      `).run(process.env.ADMIN_USER, department, genericRank.id, process.env.ADMIN_USER, hash);
      employeeId = info.lastInsertRowid;
    }
    if (direccionRole) {
      await prepare('INSERT OR IGNORE INTO employee_role_links (employee_id, role_id) VALUES (?, ?)').run(employeeId, direccionRole.id);
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
