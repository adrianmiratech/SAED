require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const multer = require('multer');
const db = require('./db');

// Los materiales de curso (presentaciones, PDFs, etc.) se guardan como
// base64 directo en la base (Turso), no en el filesystem: en Vercel las
// funciones serverless no tienen disco persistente. El límite de 3MB
// (~4MB ya en base64) queda con margen por debajo tanto del tope de
// tamaño de request de las funciones serverless de Vercel (4.5MB) como
// de cualquier límite propio que tenga la API HTTP de Turso para un
// solo parámetro de sentencia SQL.
const MATERIAL_MAX_BYTES = 3 * 1024 * 1024;
const uploadMaterial = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MATERIAL_MAX_BYTES },
});

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const DISCORD_PAYROLL_WEBHOOK_URL = process.env.DISCORD_PAYROLL_WEBHOOK_URL;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Sesión firmada en la propia cookie (sin estado en el servidor), para que
// funcione igual en un servidor tradicional (Fly) o en funciones serverless
// con múltiples instancias que no comparten memoria (Vercel).
app.use(cookieSession({
  name: 'session',
  secret: process.env.SESSION_SECRET || 'dev-secret-cambiame',
  maxAge: 8 * 60 * 60 * 1000, // 8 horas
  httpOnly: true,
  sameSite: 'lax',
}));

// Login único: toda persona (empleado o staff) entra con la misma cuenta
// de la tabla employees. requireLoggedIn alcanza para fichar la propia
// entrada/salida; requireAuth exige además ser staff (o superadmin) para
// entrar a los módulos de gestión.
function requireLoggedIn(req, res, next) {
  if (req.session && req.session.employeeId) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

// Los estudiantes (cadetes) tienen su propia cuenta para el portal
// simplificado, aparte de la de empleado: no fichan ni gestionan nada,
// así que quedan afuera de requireLoggedIn/requireAuth a propósito.
function requireCadetLoggedIn(req, res, next) {
  if (req.session && req.session.cadetId) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

// Para endpoints que comparte el staff de la Academia y los estudiantes
// (como ver/descargar materiales de un curso), sin importar cuál de las
// dos cuentas sea.
function requireAnyLogin(req, res, next) {
  if (req.session && (req.session.employeeId || req.session.cadetId)) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

function requireAuth(req, res, next) {
  if (req.session && req.session.employeeId && (req.session.isStaff || req.session.isSuperadmin)) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

// El superadmin (nivel SAED) ve ambos departamentos y es el único que
// puede dar de alta staff, tocar tarifas, gestionar roles o borrar gente.
function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.employeeId && req.session.isSuperadmin) return next();
  return res.status(403).json({ error: 'No autorizado' });
}

// null = ve todo (superadmin); si no, queda atado al departamento del
// propio empleado, sin importar qué mande el cliente en query/body.
function scopedDepartment(req) {
  return req.session.isSuperadmin ? null : req.session.department;
}

const VALID_STATUSES = ['pendiente', 'en_revision', 'aprobado', 'rechazado'];
const VALID_DEPARTMENTS = ['sams', 'safd'];
const DEPARTMENT_LABELS = { sams: 'SAMS', safd: 'SAFD' };
const VALID_CASE_STATUSES = ['abierta', 'cerrada'];
const VALID_MOVEMENT_TYPES = ['entrada', 'salida'];
const VALID_CADET_STATUSES = ['activo', 'graduado', 'expulsado', 'baja'];

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// El acceso (staff / superadmin / ver Fichajes) no es un casillero suelto
// por empleado: lo otorga la división (o divisiones) a la que pertenece.
// Alguien sin ninguna división otorgante simplemente no tiene ese acceso.
async function computeGrants(employeeId) {
  const row = await db.prepare(`
    SELECT
      MAX(r.grants_staff) AS staff,
      MAX(r.grants_superadmin) AS superadmin,
      MAX(r.grants_hr_access) AS hr,
      MAX(r.grants_academy_access) AS academy
    FROM employee_role_links l
    JOIN employee_roles r ON r.id = l.role_id
    WHERE l.employee_id = ?
  `).get(employeeId);
  return {
    isStaff: !!(row && row.staff),
    isSuperadmin: !!(row && row.superadmin),
    hrAccess: !!(row && row.hr),
    academyAccess: !!(row && row.academy),
  };
}

async function countDistinctSuperadmins() {
  const row = await db.prepare(`
    SELECT COUNT(DISTINCT l.employee_id) AS c
    FROM employee_role_links l
    JOIN employee_roles r ON r.id = l.role_id
    WHERE r.grants_superadmin = 1
  `).get();
  return row ? row.c : 0;
}

function sessionSnapshot(req) {
  const isCadet = !!(req.session && req.session.cadetId);
  return {
    authenticated: !!(req.session && (req.session.employeeId || req.session.cadetId)),
    role: isCadet ? 'cadet' : (req.session?.employeeId ? 'employee' : null),
    username: req.session?.username || null,
    fullName: req.session?.fullName || null,
    department: req.session?.department || null,
    isStaff: !!(req.session?.isStaff),
    isSuperadmin: !!(req.session?.isSuperadmin),
    hrAccess: !!(req.session?.hrAccess),
    academyAccess: !!(req.session?.academyAccess),
  };
}

// ---------- Auth ----------

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }
  const trimmedUsername = username.trim();

  const employee = await db.prepare('SELECT * FROM employees WHERE username = ?').get(trimmedUsername);
  if (employee && employee.password_hash && bcrypt.compareSync(password, employee.password_hash)) {
    if (!employee.active) {
      return res.status(403).json({ error: 'Tu cuenta está inactiva. Consultá con tu departamento.' });
    }
    const grants = await computeGrants(employee.id);

    req.session.role = 'employee';
    req.session.employeeId = employee.id;
    req.session.cadetId = undefined;
    req.session.username = employee.username;
    req.session.fullName = employee.full_name;
    req.session.department = employee.department;
    req.session.isStaff = grants.isStaff;
    req.session.isSuperadmin = grants.isSuperadmin;
    req.session.hrAccess = grants.hrAccess;
    req.session.academyAccess = grants.academyAccess;

    return res.json({ ok: true, ...sessionSnapshot(req) });
  }

  // Los estudiantes (cadetes) entran con la misma pantalla de login, pero
  // su cuenta vive en la tabla cadets, no employees: es un portal aparte,
  // sin ningún acceso al panel de staff.
  const cadet = await db.prepare('SELECT * FROM cadets WHERE username = ?').get(trimmedUsername);
  if (cadet && cadet.password_hash && bcrypt.compareSync(password, cadet.password_hash)) {
    if (cadet.status !== 'activo') {
      return res.status(403).json({ error: 'Tu cuenta de estudiante no está activa.' });
    }

    req.session.role = 'cadet';
    req.session.employeeId = undefined;
    req.session.cadetId = cadet.id;
    req.session.username = cadet.username;
    req.session.fullName = cadet.full_name;
    req.session.department = cadet.department;
    req.session.isStaff = false;
    req.session.isSuperadmin = false;
    req.session.hrAccess = false;
    req.session.academyAccess = false;

    return res.json({ ok: true, ...sessionSnapshot(req) });
  }

  return res.status(401).json({ error: 'Credenciales inválidas' });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json(sessionSnapshot(req));
});

// ---------- Postulaciones (publico) ----------

app.post('/api/applications', async (req, res) => {
  const {
    department, fullName, age, country,
    discordInfo, experience, motivation, criminalRecord,
    previousSaedExperience, previousSaedDetails,
  } = req.body || {};

  if (!VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }

  if (!fullName || !age || !country || !discordInfo || !experience || !motivation || !criminalRecord || !previousSaedExperience) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const ageNum = Number(age);
  if (!Number.isInteger(ageNum) || ageNum <= 0) {
    return res.status(400).json({ error: 'Edad inválida' });
  }

  const insert = db.prepare(`
    INSERT INTO applications
      (department, full_name, age, country, discord_info, experience, motivation, criminal_record,
       previous_saed_experience, previous_saed_details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = await insert.run(
    department, fullName.trim(), ageNum, country.trim(), discordInfo.trim(),
    experience.trim(), motivation.trim(), criminalRecord,
    previousSaedExperience, (previousSaedDetails || '').trim() || null,
  );

  try {
    await notifyDiscord({
      department, fullName, age: ageNum, country, discordInfo, experience, motivation, criminalRecord,
      previousSaedExperience, previousSaedDetails,
    });
  } catch (err) {
    console.error('Error enviando a Discord:', err.message);
  }

  res.status(201).json({ ok: true, id: info.lastInsertRowid });
});

async function notifyDiscord(app_) {
  if (!DISCORD_WEBHOOK_URL) return;

  const deptLabel = DEPARTMENT_LABELS[app_.department] || app_.department;

  const embed = {
    title: `SAED — Postulación a ${deptLabel}`,
    description: `Nueva postulación recibida a través de la web de gestión del SAED para el departamento de ${deptLabel}.`,
    color: app_.department === 'safd' ? 0xe05a2b : 0x2b6cb0,
    fields: [
      { name: 'Departamento', value: deptLabel, inline: true },
      { name: 'Nombre y Apellido', value: app_.fullName, inline: true },
      { name: 'Edad', value: String(app_.age), inline: true },
      { name: 'País de Nacimiento', value: app_.country, inline: true },
      { name: 'Usuario de Discord', value: app_.discordInfo, inline: true },
      { name: 'Experiencia Previa', value: app_.experience.slice(0, 1024) },
      { name: 'Motivación', value: app_.motivation.slice(0, 1024) },
      { name: '¿Tiene antecedentes penales?', value: app_.criminalRecord },
      {
        name: '¿Ha roleado antes en SAED (HiddenRP u otras versiones)?',
        value: app_.previousSaedExperience === 'Sí' && app_.previousSaedDetails
          ? `Sí — ${app_.previousSaedDetails.slice(0, 900)}`
          : app_.previousSaedExperience,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  await fetch(DISCORD_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

async function notifyPayrollPaid(p) {
  if (!DISCORD_PAYROLL_WEBHOOK_URL) return;

  const deptLabel = DEPARTMENT_LABELS[p.department] || p.department;

  const embed = {
    title: `SAED — Nómina pagada (${deptLabel})`,
    description: `Se registró el pago de nómina de un integrante del departamento de ${deptLabel}.`,
    color: p.department === 'safd' ? 0xe05a2b : 0x2b6cb0,
    fields: [
      { name: 'Departamento', value: deptLabel, inline: true },
      { name: 'Empleado', value: p.employeeName, inline: true },
      { name: 'Rango', value: p.rankName, inline: true },
      { name: 'Horas trabajadas', value: String(p.hours), inline: true },
      { name: 'Tarifa por hora', value: `$${Number(p.hourlyRate).toFixed(2)}`, inline: true },
      { name: 'Total pagado', value: `$${Number(p.total).toFixed(2)}`, inline: true },
      ...(p.periodLabel ? [{ name: 'Período', value: p.periodLabel, inline: true }] : []),
      { name: 'Pagado por', value: p.paidBy },
    ],
    timestamp: p.paidAt,
  };

  await fetch(DISCORD_PAYROLL_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });
}

// ---------- Postulaciones (admin) ----------

// Si el admin tiene un departamento asignado, solo puede ver/gestionar
// postulaciones de ese departamento (staff sin departamento asignado ve todo).
function requireDepartmentAccess(req, res, row) {
  const scopedDept = scopedDepartment(req);
  if (scopedDept && row.department !== scopedDept) {
    res.status(404).json({ error: 'No encontrada' });
    return false;
  }
  return true;
}

app.get('/api/applications', requireAuth, async (req, res) => {
  const { status, department } = req.query;
  const scopedDept = scopedDepartment(req);
  const conditions = [];
  const params = [];

  if (status && VALID_STATUSES.includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (scopedDept) {
    conditions.push('department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('department = ?');
    params.push(department);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`SELECT * FROM applications ${where} ORDER BY created_at DESC`).all(...params);
  res.json(rows);
});

// Tiene que ir antes de la ruta con :id para que Express no interprete
// "export.csv" como un id de postulación.
app.get('/api/applications/export.csv', requireAuth, async (req, res) => {
  const { status, department } = req.query;
  const scopedDept = scopedDepartment(req);
  const conditions = [];
  const params = [];

  if (status && VALID_STATUSES.includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (scopedDept) {
    conditions.push('department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('department = ?');
    params.push(department);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`SELECT * FROM applications ${where} ORDER BY created_at DESC`).all(...params);

  const headers = ['ID', 'Departamento', 'Nombre', 'Edad', 'País', 'Discord', 'Estado', 'Fecha', 'Revisado por'];
  const csvRows = [headers.join(',')];
  for (const r of rows) {
    csvRows.push([
      r.id, DEPARTMENT_LABELS[r.department] || r.department, csvEscape(r.full_name), r.age,
      csvEscape(r.country), csvEscape(r.discord_info), r.status, r.created_at, csvEscape(r.reviewed_by || ''),
    ].join(','));
  }

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="postulaciones.csv"');
  res.send(`﻿${csvRows.join('\n')}`);
});

app.get('/api/applications/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;
  res.json(row);
});

app.patch('/api/applications/:id', requireAuth, async (req, res) => {
  const { status, reviewNotes } = req.body || {};
  const row = await db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  await db.prepare(`
    UPDATE applications
    SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(
    status || row.status,
    reviewNotes !== undefined ? reviewNotes : row.review_notes,
    req.session.username,
    req.params.id,
  );

  if (status === 'aprobado') {
    // Aprobar no da de alta un empleado directamente: el postulante entra
    // a la Academia como cadete, y solo se convierte en empleado cuando
    // RTD lo gradúa (con el rango de entrada de su departamento). Si ya
    // existe un cadete con el mismo nombre y departamento (por ejemplo,
    // porque esta postulación se había aprobado antes), no se duplica.
    const existing = await db.prepare(
      'SELECT id FROM cadets WHERE department = ? AND full_name = ?',
    ).get(row.department, row.full_name);

    if (!existing) {
      await db.prepare(`
        INSERT INTO cadets (full_name, discord_info, department, created_by)
        VALUES (?, ?, ?, ?)
      `).run(row.full_name, row.discord_info, row.department, req.session.username);
    }
  }

  res.json({ ok: true });
});

app.delete('/api/applications/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  await db.prepare('DELETE FROM applications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Rangos ----------

app.get('/api/ranks', requireAuth, async (req, res) => {
  const scopedDept = scopedDepartment(req);
  const rows = scopedDept
    ? await db.prepare('SELECT * FROM ranks WHERE department IS NULL OR department = ? ORDER BY level DESC').all(scopedDept)
    : await db.prepare('SELECT * FROM ranks ORDER BY level DESC').all();
  res.json(rows);
});

app.patch('/api/ranks/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const { hourlyRate } = req.body || {};
  const rateNum = Number(hourlyRate);
  if (!Number.isFinite(rateNum) || rateNum < 0) {
    return res.status(400).json({ error: 'Tarifa por hora inválida' });
  }

  const rank = await db.prepare('SELECT id FROM ranks WHERE id = ?').get(req.params.id);
  if (!rank) return res.status(404).json({ error: 'Rango no encontrado' });

  await db.prepare('UPDATE ranks SET hourly_rate = ? WHERE id = ?').run(rateNum, req.params.id);
  res.json({ ok: true });
});

// ---------- Roles / divisiones ----------

// A diferencia de los rangos (que definen jerarquía y tarifa por hora),
// las divisiones son una etiqueta organizativa: un mismo empleado puede
// pertenecer a varias a la vez (ej. "RTD" y "Recursos Humanos" juntas).
// El acceso al panel (staff / superadmin / ver Fichajes) no es un
// casillero aparte: lo otorga automáticamente la división en sí.
app.get('/api/employee-roles', requireAuth, async (req, res) => {
  const scopedDept = scopedDepartment(req);
  const rows = scopedDept
    ? await db.prepare('SELECT * FROM employee_roles WHERE department IS NULL OR department = ? ORDER BY name ASC').all(scopedDept)
    : await db.prepare('SELECT * FROM employee_roles ORDER BY name ASC').all();
  res.json(rows);
});

app.post('/api/employee-roles', requireAuth, requireSuperAdmin, async (req, res) => {
  const { name, department, grantsStaff, grantsSuperadmin, grantsHrAccess } = req.body || {};
  if (!name) return res.status(400).json({ error: 'El nombre de la división es requerido' });
  if (department && !VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }

  const info = await db.prepare(`
    INSERT INTO employee_roles (name, department, grants_staff, grants_superadmin, grants_hr_access)
    VALUES (?, ?, ?, ?, ?)
  `).run(name.trim(), department || null, grantsStaff ? 1 : 0, grantsSuperadmin ? 1 : 0, grantsHrAccess ? 1 : 0);
  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/employee-roles/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const role = await db.prepare('SELECT * FROM employee_roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'División no encontrada' });

  const { name, department, grantsStaff, grantsSuperadmin, grantsHrAccess } = req.body || {};
  if (department !== undefined && department && !VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }

  await db.prepare(`
    UPDATE employee_roles SET name = ?, department = ?, grants_staff = ?, grants_superadmin = ?, grants_hr_access = ?
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : role.name,
    department !== undefined ? (department || null) : role.department,
    grantsStaff !== undefined ? (grantsStaff ? 1 : 0) : role.grants_staff,
    grantsSuperadmin !== undefined ? (grantsSuperadmin ? 1 : 0) : role.grants_superadmin,
    grantsHrAccess !== undefined ? (grantsHrAccess ? 1 : 0) : role.grants_hr_access,
    req.params.id,
  );
  res.json({ ok: true });
});

app.delete('/api/employee-roles/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const role = await db.prepare('SELECT * FROM employee_roles WHERE id = ?').get(req.params.id);
  if (!role) return res.status(404).json({ error: 'División no encontrada' });

  await db.prepare('DELETE FROM employee_role_links WHERE role_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM employee_roles WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Valida una lista de ids de división contra un departamento; devuelve
// null si alguno no existe o no corresponde a ese departamento.
async function validateRolesForDepartment(roleIds, department) {
  const uniqueIds = [...new Set(roleIds)];
  if (uniqueIds.length === 0) return [];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const roles = await db.prepare(`SELECT * FROM employee_roles WHERE id IN (${placeholders})`).all(...uniqueIds);
  if (roles.length !== uniqueIds.length) return null;
  for (const r of roles) {
    if (r.department && r.department !== department) return null;
  }
  return roles;
}

// ---------- Empleados ----------

// Columnas explícitas (nunca "e.*") para no exponer password_hash del
// login de fichaje en las respuestas de la API.
const EMPLOYEE_COLUMNS = `
  e.id, e.full_name, e.phone, e.discord_info, e.department, e.rank_id, e.active,
  e.created_by, e.created_at, e.username,
  (e.username IS NOT NULL) AS has_login
`;

app.get('/api/employees', requireAuth, async (req, res) => {
  const { department } = req.query;
  const scopedDept = scopedDepartment(req);
  const conditions = [];
  const params = [];

  if (scopedDept) {
    conditions.push('e.department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('e.department = ?');
    params.push(department);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`
    SELECT ${EMPLOYEE_COLUMNS},
      r.level AS rank_level, r.name AS rank_name, r.hourly_rate AS rank_hourly_rate,
      COALESCE(MAX(er.grants_staff), 0) AS is_staff,
      COALESCE(MAX(er.grants_superadmin), 0) AS is_superadmin,
      COALESCE(MAX(er.grants_hr_access), 0) AS hr_access,
      GROUP_CONCAT(er.id) AS role_ids_concat,
      GROUP_CONCAT(er.name, '||') AS role_names_concat
    FROM employees e
    JOIN ranks r ON r.id = e.rank_id
    LEFT JOIN employee_role_links erl ON erl.employee_id = e.id
    LEFT JOIN employee_roles er ON er.id = erl.role_id
    ${where}
    GROUP BY e.id
    ORDER BY e.active DESC, r.level DESC, e.full_name ASC
  `).all(...params);

  res.json(rows.map((r) => ({
    ...r,
    role_ids: r.role_ids_concat ? r.role_ids_concat.split(',').map(Number) : [],
    role_names: r.role_names_concat ? r.role_names_concat.split('||') : [],
    role_ids_concat: undefined,
    role_names_concat: undefined,
  })));
});

async function validateRankForDepartment(rankId, department) {
  const rank = await db.prepare('SELECT * FROM ranks WHERE id = ?').get(rankId);
  if (!rank) return null;
  if (rank.department && rank.department !== department) return null;
  return rank;
}

app.post('/api/employees', requireAuth, async (req, res) => {
  const { fullName, phone, discordInfo, rankId, roleIds } = req.body || {};
  const scopedDept = scopedDepartment(req);
  const department = scopedDept || req.body?.department;

  if (!fullName || !phone || !department || !rankId) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  if (!VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }
  const rank = await validateRankForDepartment(rankId, department);
  if (!rank) {
    return res.status(400).json({ error: 'Rango inválido para ese departamento' });
  }

  let roles = [];
  if (roleIds && roleIds.length > 0) {
    if (!req.session.isSuperadmin) {
      return res.status(403).json({ error: 'Solo un superadmin puede asignar divisiones' });
    }
    roles = await validateRolesForDepartment(roleIds, department);
    if (roles === null) return res.status(400).json({ error: 'Alguna división elegida no es válida para ese departamento' });
  }

  const info = await db.prepare(`
    INSERT INTO employees (full_name, phone, discord_info, department, rank_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fullName.trim(), phone.trim(), (discordInfo || '').trim() || null, department, rank.id, req.session.username);

  for (const r of roles) {
    await db.prepare('INSERT INTO employee_role_links (employee_id, role_id) VALUES (?, ?)').run(info.lastInsertRowid, r.id);
  }

  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/employees/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  const {
    fullName, phone, discordInfo, rankId, active, roleIds, fichajeUsername, fichajePassword,
  } = req.body || {};

  let rank_id = row.rank_id;
  if (rankId !== undefined) {
    const rank = await validateRankForDepartment(rankId, row.department);
    if (!rank) return res.status(400).json({ error: 'Rango inválido para ese departamento' });
    rank_id = rank.id;
  }

  if (roleIds !== undefined) {
    // Las divisiones otorgan acceso automáticamente, así que solo un
    // superadmin puede reasignarlas (nunca desde una cuenta scoped).
    if (!req.session.isSuperadmin) {
      return res.status(403).json({ error: 'Solo un superadmin puede cambiar las divisiones de un empleado' });
    }
    const roles = roleIds.length > 0 ? await validateRolesForDepartment(roleIds, row.department) : [];
    if (roles === null) return res.status(400).json({ error: 'Alguna división elegida no es válida para ese departamento' });

    const willKeepSuperadmin = roles.some((r) => r.grants_superadmin);
    if (!willKeepSuperadmin) {
      const currentGrants = await computeGrants(row.id);
      if (currentGrants.isSuperadmin) {
        const superadminCount = await countDistinctSuperadmins();
        if (superadminCount <= 1) {
          return res.status(400).json({ error: 'No podés quitarle el acceso al único superadmin' });
        }
      }
    }

    await db.prepare('DELETE FROM employee_role_links WHERE employee_id = ?').run(row.id);
    for (const r of roles) {
      await db.prepare('INSERT INTO employee_role_links (employee_id, role_id) VALUES (?, ?)').run(row.id, r.id);
    }
  }

  // El acceso de fichaje es opcional: se define/cambia desde acá mismo.
  // Vaciar el usuario borra también la contraseña (deshabilita el acceso).
  let username = row.username;
  let password_hash = row.password_hash;
  if (fichajeUsername !== undefined) {
    const trimmed = (fichajeUsername || '').trim();
    if (trimmed) {
      const existingUsername = await db.prepare('SELECT id FROM employees WHERE username = ? AND id != ?').get(trimmed, req.params.id);
      const existingCadetUsername = await db.prepare('SELECT id FROM cadets WHERE username = ?').get(trimmed);
      if (existingUsername || existingCadetUsername) return res.status(409).json({ error: 'Ya hay una cuenta con ese usuario' });
      username = trimmed;
    } else {
      username = null;
      password_hash = null;
    }
  }
  if (fichajePassword) {
    if (fichajePassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña de fichaje debe tener al menos 6 caracteres' });
    }
    if (!username) {
      return res.status(400).json({ error: 'Definí primero un usuario de fichaje' });
    }
    password_hash = bcrypt.hashSync(fichajePassword, 10);
  }

  await db.prepare(`
    UPDATE employees
    SET full_name = ?, phone = ?, discord_info = ?, rank_id = ?, active = ?, username = ?, password_hash = ?
    WHERE id = ?
  `).run(
    fullName !== undefined ? fullName.trim() : row.full_name,
    phone !== undefined ? phone.trim() : row.phone,
    discordInfo !== undefined ? ((discordInfo || '').trim() || null) : row.discord_info,
    rank_id,
    active !== undefined ? (active ? 1 : 0) : row.active,
    username,
    password_hash,
    req.params.id,
  );

  res.json({ ok: true });
});

app.delete('/api/employees/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  if (row.id === req.session.employeeId) {
    return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });
  }
  const grants = await computeGrants(row.id);
  if (grants.isSuperadmin) {
    const superadminCount = await countDistinctSuperadmins();
    if (superadminCount <= 1) {
      return res.status(400).json({ error: 'No podés eliminar al único superadmin' });
    }
  }

  await db.prepare('DELETE FROM employee_role_links WHERE employee_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM payroll WHERE employee_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM attendance WHERE employee_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Nómina ----------

async function getEmployeeWithAccess(req, res, employeeId) {
  const employee = await db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!employee) {
    res.status(404).json({ error: 'Empleado no encontrado' });
    return null;
  }
  if (!requireDepartmentAccess(req, res, employee)) return null;
  return employee;
}

app.get('/api/payroll', requireAuth, async (req, res) => {
  const { employeeId, paid, department } = req.query;
  const scopedDept = scopedDepartment(req);
  const conditions = [];
  const params = [];

  if (employeeId) {
    conditions.push('p.employee_id = ?');
    params.push(employeeId);
  }
  if (scopedDept) {
    conditions.push('e.department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('e.department = ?');
    params.push(department);
  }
  if (paid === '0' || paid === '1') {
    conditions.push('p.paid = ?');
    params.push(Number(paid));
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`
    SELECT p.*, e.full_name AS employee_name, e.department AS employee_department
    FROM payroll p
    JOIN employees e ON e.id = p.employee_id
    ${where}
    ORDER BY p.created_at DESC
  `).all(...params);
  res.json(rows);
});

app.post('/api/payroll', requireAuth, async (req, res) => {
  const { employeeId, hours, periodLabel } = req.body || {};
  const hoursNum = Number(hours);
  if (!employeeId || !Number.isFinite(hoursNum) || hoursNum <= 0) {
    return res.status(400).json({ error: 'Empleado y cantidad de horas (mayor a 0) son requeridos' });
  }

  const employee = await getEmployeeWithAccess(req, res, employeeId);
  if (!employee) return;

  const rank = await db.prepare('SELECT * FROM ranks WHERE id = ?').get(employee.rank_id);
  const rate = rank ? rank.hourly_rate : 0;
  const total = Math.round(hoursNum * rate * 100) / 100;

  const info = await db.prepare(`
    INSERT INTO payroll (employee_id, hours, hourly_rate, total_amount, period_label, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(employee.id, hoursNum, rate, total, (periodLabel || '').trim() || null, req.session.username);

  res.status(201).json({ id: info.lastInsertRowid, total });
});

app.patch('/api/payroll/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM payroll WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  const employee = await getEmployeeWithAccess(req, res, row.employee_id);
  if (!employee) return;

  const { paid } = req.body || {};
  const paidAt = paid ? new Date().toISOString() : null;
  await db.prepare(`
    UPDATE payroll SET paid = ?, paid_at = ? WHERE id = ?
  `).run(paid ? 1 : 0, paidAt, req.params.id);

  // El pago recién se notifica al pasar de pendiente a pagada (no en cada
  // reconfirmación ni al volver a marcarla pendiente). Se espera a que
  // termine ANTES de responder para no dejarlo como tarea de fondo que
  // puede cortarse si el proceso se reinicia justo después de responder.
  if (paid && !row.paid) {
    const rank = await db.prepare('SELECT * FROM ranks WHERE id = ?').get(employee.rank_id);
    try {
      await notifyPayrollPaid({
        department: employee.department,
        employeeName: employee.full_name,
        rankName: rank ? rank.name : 'Sin rango',
        hours: row.hours,
        hourlyRate: row.hourly_rate,
        total: row.total_amount,
        periodLabel: row.period_label,
        paidBy: req.session.username,
        paidAt,
      });
    } catch (err) {
      console.error('Error enviando notificación de nómina a Discord:', err.message);
    }
  }

  res.json({ ok: true });
});

app.delete('/api/payroll/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM payroll WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  const employee = await getEmployeeWithAccess(req, res, row.employee_id);
  if (!employee) return;

  await db.prepare('DELETE FROM payroll WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Fichaje (acceso propio, con la misma cuenta unificada) ----------

app.get('/api/attendance/me/status', requireLoggedIn, async (req, res) => {
  const open = await db.prepare(
    'SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
  ).get(req.session.employeeId);
  res.json({ clockedIn: !!open, since: open ? open.clock_in : null });
});

app.post('/api/attendance/me/clock', requireLoggedIn, async (req, res) => {
  const open = await db.prepare(
    'SELECT * FROM attendance WHERE employee_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1',
  ).get(req.session.employeeId);

  if (open) {
    await db.prepare(`UPDATE attendance SET clock_out = datetime('now') WHERE id = ?`).run(open.id);
    return res.json({ ok: true, clockedIn: false });
  }

  await db.prepare('INSERT INTO attendance (employee_id, department) VALUES (?, ?)')
    .run(req.session.employeeId, req.session.department);
  res.json({ ok: true, clockedIn: true });
});

app.get('/api/attendance/me/history', requireLoggedIn, async (req, res) => {
  const rows = await db.prepare(
    'SELECT * FROM attendance WHERE employee_id = ? ORDER BY clock_in DESC LIMIT 60',
  ).all(req.session.employeeId);
  res.json(rows);
});

// ---------- Fichajes (vista de RRHH / Dirección sobre todo el personal) ----------

function requireAttendanceAccess(req, res, next) {
  if (req.session && req.session.employeeId && (req.session.isSuperadmin || req.session.hrAccess)) return next();
  return res.status(403).json({ error: 'No autorizado' });
}

// La Academia (cadetes, cursos, evaluaciones) la administra la división
// RTD (o el superadmin); el resto del staff no ve estos datos aunque
// tenga acceso a otros módulos de gestión.
function requireAcademyAccess(req, res, next) {
  if (req.session && req.session.employeeId && (req.session.isSuperadmin || req.session.academyAccess)) return next();
  return res.status(403).json({ error: 'No autorizado' });
}

app.get('/api/attendance', requireAuth, requireAttendanceAccess, async (req, res) => {
  const { department, employeeId, from, to } = req.query;
  const scopedDept = scopedDepartment(req);
  const conditions = [];
  const params = [];

  if (scopedDept) {
    conditions.push('a.department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('a.department = ?');
    params.push(department);
  }
  if (employeeId) {
    conditions.push('a.employee_id = ?');
    params.push(employeeId);
  }
  if (from) {
    conditions.push('a.clock_in >= ?');
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push('a.clock_in <= ?');
    params.push(`${to} 23:59:59`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`
    SELECT a.*, e.full_name AS employee_name
    FROM attendance a
    JOIN employees e ON e.id = a.employee_id
    ${where}
    ORDER BY a.clock_in DESC
    LIMIT 500
  `).all(...params);
  res.json(rows);
});

app.patch('/api/attendance/:id', requireAuth, requireAttendanceAccess, async (req, res) => {
  const row = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  const { clockIn, clockOut } = req.body || {};
  await db.prepare('UPDATE attendance SET clock_in = ?, clock_out = ? WHERE id = ?').run(
    clockIn || row.clock_in,
    clockOut !== undefined ? (clockOut || null) : row.clock_out,
    req.params.id,
  );
  res.json({ ok: true });
});

app.delete('/api/attendance/:id', requireAuth, requireAttendanceAccess, async (req, res) => {
  const row = await db.prepare('SELECT * FROM attendance WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  await db.prepare('DELETE FROM attendance WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Inventario ----------

app.get('/api/inventory', requireAuth, async (req, res) => {
  const { department } = req.query;
  const scopedDept = scopedDepartment(req);
  const conditions = [];
  const params = [];

  if (scopedDept) {
    conditions.push('department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('department = ?');
    params.push(department);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`SELECT * FROM inventory_items ${where} ORDER BY name ASC`).all(...params);
  res.json(rows);
});

app.post('/api/inventory', requireAuth, async (req, res) => {
  const { name, category, unit } = req.body || {};
  const scopedDept = scopedDepartment(req);
  const department = scopedDept || req.body?.department;

  if (!name || !department) {
    return res.status(400).json({ error: 'Nombre y departamento son requeridos' });
  }
  if (!VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }

  const minQty = Number(req.body?.minQuantity) || 0;

  const info = await db.prepare(`
    INSERT INTO inventory_items (department, name, category, unit, quantity, min_quantity, created_by)
    VALUES (?, ?, ?, ?, 0, ?, ?)
  `).run(department, name.trim(), (category || '').trim() || null, (unit || 'unidad').trim(), minQty, req.session.username);

  res.status(201).json({ id: info.lastInsertRowid });
});

async function getInventoryItemWithAccess(req, res, itemId) {
  const item = await db.prepare('SELECT * FROM inventory_items WHERE id = ?').get(itemId);
  if (!item) {
    res.status(404).json({ error: 'Insumo no encontrado' });
    return null;
  }
  if (!requireDepartmentAccess(req, res, item)) return null;
  return item;
}

app.patch('/api/inventory/:id', requireAuth, async (req, res) => {
  const item = await getInventoryItemWithAccess(req, res, req.params.id);
  if (!item) return;

  const { name, category, unit, minQuantity } = req.body || {};
  await db.prepare(`
    UPDATE inventory_items SET name = ?, category = ?, unit = ?, min_quantity = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : item.name,
    category !== undefined ? ((category || '').trim() || null) : item.category,
    unit !== undefined ? unit.trim() : item.unit,
    minQuantity !== undefined ? Number(minQuantity) : item.min_quantity,
    req.params.id,
  );

  res.json({ ok: true });
});

app.delete('/api/inventory/:id', requireAuth, async (req, res) => {
  const item = await getInventoryItemWithAccess(req, res, req.params.id);
  if (!item) return;

  await db.prepare('DELETE FROM inventory_movements WHERE item_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM inventory_items WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/inventory/:id/movements', requireAuth, async (req, res) => {
  const item = await getInventoryItemWithAccess(req, res, req.params.id);
  if (!item) return;

  const rows = await db.prepare('SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows);
});

app.post('/api/inventory/:id/movements', requireAuth, async (req, res) => {
  const item = await getInventoryItemWithAccess(req, res, req.params.id);
  if (!item) return;

  const { type, quantity, reason, caseId } = req.body || {};
  const qty = Number(quantity);
  if (!VALID_MOVEMENT_TYPES.includes(type) || !Number.isFinite(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Tipo de movimiento y cantidad (mayor a 0) son requeridos' });
  }

  let linkedCaseId = null;
  if (caseId) {
    const caseRow = await db.prepare('SELECT * FROM cases WHERE id = ?').get(caseId);
    if (!caseRow || caseRow.department !== item.department) {
      return res.status(400).json({ error: 'Atención inválida para ese departamento' });
    }
    linkedCaseId = caseRow.id;
  }

  const newQuantity = type === 'entrada' ? item.quantity + qty : item.quantity - qty;
  if (newQuantity < 0) {
    return res.status(400).json({ error: 'No hay suficiente stock para esa salida' });
  }

  const wasLow = item.quantity <= item.min_quantity;
  const isLow = newQuantity <= item.min_quantity;

  await db.prepare(`
    INSERT INTO inventory_movements (item_id, type, quantity, reason, case_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(item.id, type, qty, (reason || '').trim() || null, linkedCaseId, req.session.username);

  await db.prepare(`UPDATE inventory_items SET quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(newQuantity, item.id);

  res.status(201).json({ ok: true, quantity: newQuantity, justWentLow: isLow && !wasLow });
});

// ---------- Atenciones (fichas clínicas / informes de intervención) ----------

app.get('/api/cases', requireAuth, async (req, res) => {
  const { department, status, from, to, subject } = req.query;
  const scopedDept = scopedDepartment(req);
  const conditions = [];
  const params = [];

  if (scopedDept) {
    conditions.push('c.department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('c.department = ?');
    params.push(department);
  }
  if (status && VALID_CASE_STATUSES.includes(status)) {
    conditions.push('c.status = ?');
    params.push(status);
  }
  if (from) {
    conditions.push("c.created_at >= ?");
    params.push(`${from} 00:00:00`);
  }
  if (to) {
    conditions.push("c.created_at <= ?");
    params.push(`${to} 23:59:59`);
  }
  if (subject) {
    conditions.push('c.subject_name LIKE ?');
    params.push(`%${subject}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`
    SELECT c.*, e.full_name AS responsible_name
    FROM cases c
    LEFT JOIN employees e ON e.id = c.responsible_employee_id
    ${where}
    ORDER BY c.created_at DESC
  `).all(...params);
  res.json(rows);
});

app.post('/api/cases', requireAuth, async (req, res) => {
  const { subjectName, age, location, summary, treatment, responsibleEmployeeId } = req.body || {};
  const scopedDept = scopedDepartment(req);
  const department = scopedDept || req.body?.department;

  if (!subjectName || !summary || !department) {
    return res.status(400).json({ error: 'Nombre del sujeto, resumen y departamento son requeridos' });
  }
  if (!VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }

  let responsibleId = null;
  if (responsibleEmployeeId) {
    const employee = await db.prepare('SELECT * FROM employees WHERE id = ?').get(responsibleEmployeeId);
    if (!employee || employee.department !== department) {
      return res.status(400).json({ error: 'Responsable inválido para ese departamento' });
    }
    responsibleId = employee.id;
  }

  const info = await db.prepare(`
    INSERT INTO cases (department, subject_name, age, location, summary, treatment, responsible_employee_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    department, subjectName.trim(), age ? Number(age) : null, (location || '').trim() || null,
    summary.trim(), (treatment || '').trim() || null, responsibleId, req.session.username,
  );

  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/cases/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  const { subjectName, age, location, summary, treatment, status, responsibleEmployeeId } = req.body || {};

  if (status && !VALID_CASE_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  let responsibleId = row.responsible_employee_id;
  if (responsibleEmployeeId !== undefined) {
    if (responsibleEmployeeId) {
      const employee = await db.prepare('SELECT * FROM employees WHERE id = ?').get(responsibleEmployeeId);
      if (!employee || employee.department !== row.department) {
        return res.status(400).json({ error: 'Responsable inválido para ese departamento' });
      }
      responsibleId = employee.id;
    } else {
      responsibleId = null;
    }
  }

  await db.prepare(`
    UPDATE cases
    SET subject_name = ?, age = ?, location = ?, summary = ?, treatment = ?, status = ?, responsible_employee_id = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    subjectName !== undefined ? subjectName.trim() : row.subject_name,
    age !== undefined ? (age ? Number(age) : null) : row.age,
    location !== undefined ? ((location || '').trim() || null) : row.location,
    summary !== undefined ? summary.trim() : row.summary,
    treatment !== undefined ? ((treatment || '').trim() || null) : row.treatment,
    status || row.status,
    responsibleId,
    req.params.id,
  );

  res.json({ ok: true });
});

app.delete('/api/cases/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  await db.prepare('DELETE FROM inventory_movements WHERE case_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM cases WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Insumos que se descontaron del inventario para una atención puntual
// (movimientos de inventory_movements vinculados por case_id).
app.get('/api/cases/:id/movements', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM cases WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  const rows = await db.prepare(`
    SELECT m.*, i.name AS item_name, i.unit AS item_unit
    FROM inventory_movements m
    JOIN inventory_items i ON i.id = m.item_id
    WHERE m.case_id = ?
    ORDER BY m.created_at DESC
  `).all(req.params.id);
  res.json(rows);
});

// ---------- Academia (cadetes, cursos y evaluaciones, a cargo de RTD) ----------

app.get('/api/cadets', requireAuth, requireAcademyAccess, async (req, res) => {
  const { department, status, search } = req.query;
  const scopedDept = scopedDepartment(req);
  const conditions = [];
  const params = [];

  if (scopedDept) {
    conditions.push('c.department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('c.department = ?');
    params.push(department);
  }
  if (status && VALID_CADET_STATUSES.includes(status)) {
    conditions.push('c.status = ?');
    params.push(status);
  }
  if (search) {
    conditions.push('c.full_name LIKE ?');
    params.push(`%${search}%`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`
    SELECT c.*, e.full_name AS employee_name
    FROM cadets c
    LEFT JOIN employees e ON e.id = c.employee_id
    ${where}
    ORDER BY c.created_at DESC
  `).all(...params);
  res.json(rows);
});

app.post('/api/cadets', requireAuth, requireAcademyAccess, async (req, res) => {
  const { fullName, phone, discordInfo, notes } = req.body || {};
  const scopedDept = scopedDepartment(req);
  const department = scopedDept || req.body?.department;

  if (!fullName || !department) {
    return res.status(400).json({ error: 'Nombre y departamento son requeridos' });
  }
  if (!VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }

  const info = await db.prepare(`
    INSERT INTO cadets (full_name, phone, discord_info, department, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    fullName.trim(), (phone || '').trim() || null, (discordInfo || '').trim() || null,
    department, (notes || '').trim() || null, req.session.username,
  );

  res.status(201).json({ id: info.lastInsertRowid });
});

async function getCadetWithAccess(req, res, id) {
  const row = await db.prepare('SELECT * FROM cadets WHERE id = ?').get(id);
  if (!row) {
    res.status(404).json({ error: 'Estudiante no encontrado' });
    return null;
  }
  if (!requireDepartmentAccess(req, res, row)) return null;
  return row;
}

app.patch('/api/cadets/:id', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCadetWithAccess(req, res, req.params.id);
  if (!row) return;

  const {
    fullName, phone, discordInfo, notes, status, studentUsername, studentPassword,
  } = req.body || {};
  if (status && !VALID_CADET_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }
  const nextStatus = status || row.status;

  // El acceso al portal de estudiante es opcional, igual que el de
  // fichaje de los empleados: se puede definir/cambiar desde acá mismo.
  // Vaciar el usuario borra también la contraseña (deshabilita el acceso).
  let username = row.username;
  let password_hash = row.password_hash;
  if (studentUsername !== undefined) {
    const trimmed = (studentUsername || '').trim();
    if (trimmed) {
      const existingCadetUsername = await db.prepare('SELECT id FROM cadets WHERE username = ? AND id != ?').get(trimmed, req.params.id);
      const existingEmployeeUsername = await db.prepare('SELECT id FROM employees WHERE username = ?').get(trimmed);
      if (existingCadetUsername || existingEmployeeUsername) return res.status(409).json({ error: 'Ya hay una cuenta con ese usuario' });
      username = trimmed;
    } else {
      username = null;
      password_hash = null;
    }
  }
  if (studentPassword) {
    if (studentPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }
    if (!username) {
      return res.status(400).json({ error: 'Definí primero un usuario para el estudiante' });
    }
    password_hash = bcrypt.hashSync(studentPassword, 10);
  }

  await db.prepare(`
    UPDATE cadets
    SET full_name = ?, phone = ?, discord_info = ?, notes = ?, status = ?, username = ?, password_hash = ?,
        graduated_at = CASE WHEN ? = 'graduado' AND status != 'graduado' THEN datetime('now') ELSE graduated_at END
    WHERE id = ?
  `).run(
    fullName !== undefined ? fullName.trim() : row.full_name,
    phone !== undefined ? ((phone || '').trim() || null) : row.phone,
    discordInfo !== undefined ? ((discordInfo || '').trim() || null) : row.discord_info,
    notes !== undefined ? ((notes || '').trim() || null) : row.notes,
    nextStatus,
    username,
    password_hash,
    nextStatus,
    req.params.id,
  );

  res.json({ ok: true });
});

app.delete('/api/cadets/:id', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCadetWithAccess(req, res, req.params.id);
  if (!row) return;

  await db.prepare('DELETE FROM academy_evaluations WHERE cadet_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM cadet_notes WHERE cadet_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM cadets WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// Convierte al cadete en un empleado real (rango de entrada de su
// departamento) sin borrar su historial de formación, que queda
// vinculado vía cadets.employee_id.
app.post('/api/cadets/:id/graduate', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCadetWithAccess(req, res, req.params.id);
  if (!row) return;
  if (row.employee_id) {
    return res.status(400).json({ error: 'Este estudiante ya tiene una cuenta de empleado vinculada' });
  }

  const entryRank = await db.prepare(
    'SELECT id FROM ranks WHERE level = 1 AND department = ? ORDER BY id LIMIT 1',
  ).get(row.department);
  if (!entryRank) {
    return res.status(400).json({ error: 'No hay un rango de entrada configurado para ese departamento' });
  }

  const info = await db.prepare(`
    INSERT INTO employees (full_name, phone, discord_info, department, rank_id, active, created_by)
    VALUES (?, ?, ?, ?, ?, 1, ?)
  `).run(row.full_name, row.phone, row.discord_info, row.department, entryRank.id, req.session.username);

  await db.prepare(`
    UPDATE cadets SET status = 'graduado', graduated_at = COALESCE(graduated_at, datetime('now')), employee_id = ?
    WHERE id = ?
  `).run(info.lastInsertRowid, req.params.id);

  res.status(201).json({ ok: true, employeeId: info.lastInsertRowid });
});

function courseDepartmentAllowed(req, res, courseDepartment) {
  const scopedDept = scopedDepartment(req);
  if (scopedDept && courseDepartment && courseDepartment !== scopedDept) {
    res.status(404).json({ error: 'Curso no encontrado' });
    return false;
  }
  return true;
}

app.get('/api/academy-courses', requireAuth, requireAcademyAccess, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM academy_courses ORDER BY name ASC').all();
  const scopedDept = scopedDepartment(req);
  const filtered = scopedDept ? rows.filter((r) => !r.department || r.department === scopedDept) : rows;
  res.json(filtered);
});

app.post('/api/academy-courses', requireAuth, requireAcademyAccess, async (req, res) => {
  const { name, department, description } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: 'El nombre es requerido' });
  if (department && !VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }
  const scopedDept = scopedDepartment(req);
  const finalDepartment = scopedDept || department || null;

  const info = await db.prepare(`
    INSERT INTO academy_courses (name, department, description, created_by)
    VALUES (?, ?, ?, ?)
  `).run(name.trim(), finalDepartment, (description || '').trim() || null, req.session.username);

  res.status(201).json({ id: info.lastInsertRowid });
});

async function getCourseWithAccess(req, res, id) {
  const row = await db.prepare('SELECT * FROM academy_courses WHERE id = ?').get(id);
  if (!row) {
    res.status(404).json({ error: 'Curso no encontrado' });
    return null;
  }
  if (!courseDepartmentAllowed(req, res, row.department)) return null;
  return row;
}

app.patch('/api/academy-courses/:id', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCourseWithAccess(req, res, req.params.id);
  if (!row) return;

  const { name, description, active } = req.body || {};
  await db.prepare(`
    UPDATE academy_courses SET name = ?, description = ?, active = ? WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : row.name,
    description !== undefined ? ((description || '').trim() || null) : row.description,
    active !== undefined ? (active ? 1 : 0) : row.active,
    req.params.id,
  );

  res.json({ ok: true });
});

app.delete('/api/academy-courses/:id', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCourseWithAccess(req, res, req.params.id);
  if (!row) return;

  await db.prepare('DELETE FROM academy_classes WHERE course_id = ?').run(req.params.id);
  await db.prepare('UPDATE academy_evaluations SET course_id = NULL WHERE course_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM academy_courses WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/academy-courses/:id/classes', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCourseWithAccess(req, res, req.params.id);
  if (!row) return;

  const rows = await db.prepare(`
    SELECT cl.*, e.full_name AS instructor_name
    FROM academy_classes cl
    LEFT JOIN employees e ON e.id = cl.instructor_employee_id
    WHERE cl.course_id = ?
    ORDER BY cl.scheduled_at ASC, cl.id ASC
  `).all(req.params.id);
  res.json(rows);
});

app.post('/api/academy-courses/:id/classes', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCourseWithAccess(req, res, req.params.id);
  if (!row) return;

  const { title, scheduledAt, instructorEmployeeId, notes } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'El título es requerido' });

  let instructorId = null;
  if (instructorEmployeeId) {
    const employee = await db.prepare('SELECT id FROM employees WHERE id = ?').get(instructorEmployeeId);
    if (!employee) return res.status(400).json({ error: 'Instructor inválido' });
    instructorId = employee.id;
  }

  const info = await db.prepare(`
    INSERT INTO academy_classes (course_id, title, scheduled_at, instructor_employee_id, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(row.id, title.trim(), scheduledAt || null, instructorId, (notes || '').trim() || null);

  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/academy-classes/:id', requireAuth, requireAcademyAccess, async (req, res) => {
  const cls = await db.prepare('SELECT * FROM academy_classes WHERE id = ?').get(req.params.id);
  if (!cls) return res.status(404).json({ error: 'No encontrada' });
  const course = await db.prepare('SELECT * FROM academy_courses WHERE id = ?').get(cls.course_id);
  if (course && !courseDepartmentAllowed(req, res, course.department)) return;

  await db.prepare('DELETE FROM academy_classes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---- Materiales del curso (presentaciones, PDFs, etc.) ----

// Un estudiante puede ver/descargar los materiales de los cursos de su
// propio departamento (o compartidos); el staff de RTD ve todo lo suyo
// como siempre a través de requireAcademyAccess.
function canAccessCourseMaterials(req, courseDepartment) {
  if (req.session.employeeId) {
    return req.session.isSuperadmin || (req.session.academyAccess
      && (!scopedDepartment(req) || !courseDepartment || courseDepartment === scopedDepartment(req)));
  }
  if (req.session.cadetId) {
    return !courseDepartment || courseDepartment === req.session.department;
  }
  return false;
}

app.get('/api/academy-courses/:id/materials', requireAnyLogin, async (req, res) => {
  try {
    const course = await db.prepare('SELECT * FROM academy_courses WHERE id = ?').get(req.params.id);
    if (!course) return res.status(404).json({ error: 'Curso no encontrado' });
    if (!canAccessCourseMaterials(req, course.department)) return res.status(403).json({ error: 'No autorizado' });

    const rows = await db.prepare(`
      SELECT id, course_id, file_name, mime_type, file_size, uploaded_by, created_at
      FROM academy_materials WHERE course_id = ? ORDER BY created_at DESC
    `).all(req.params.id);
    res.json(rows);
  } catch (err) {
    console.error('Error listando materiales', req.params.id, err);
    res.status(500).json({ error: 'No se pudieron cargar los materiales' });
  }
});

// uploadMaterial.single('file') puede tirar (ej: MulterError si el
// archivo supera el límite) antes de que el handler de abajo arranque;
// por eso ese error también se maneja acá y no solo en el catch del
// handler, para que en cualquier caso llegue una respuesta JSON legible
// en vez de dejar la request colgada para siempre (sin esto, un error acá
// -incluyendo uno de Turso al insertar un parámetro muy grande- no
// devuelve nada y en el navegador se ve como "no me deja subir archivos").
app.post('/api/academy-courses/:id/materials', requireAuth, requireAcademyAccess, (req, res, next) => {
  uploadMaterial.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `El archivo supera el máximo permitido (${Math.floor(MATERIAL_MAX_BYTES / (1024 * 1024))}MB)` });
    }
    if (err) {
      console.error('Error subiendo material (multer)', req.params.id, err);
      return res.status(400).json({ error: 'No se pudo procesar el archivo' });
    }
    next();
  });
}, async (req, res) => {
  try {
    const course = await getCourseWithAccess(req, res, req.params.id);
    if (!course) return;
    if (!req.file) return res.status(400).json({ error: 'Elegí un archivo' });

    const info = await db.prepare(`
      INSERT INTO academy_materials (course_id, file_name, mime_type, file_size, data_base64, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      course.id, req.file.originalname, req.file.mimetype || 'application/octet-stream',
      req.file.size, req.file.buffer.toString('base64'), req.session.username,
    );

    res.status(201).json({ id: info.lastInsertRowid });
  } catch (err) {
    console.error('Error subiendo material', req.params.id, err);
    res.status(500).json({ error: 'No se pudo subir el archivo. Probá con uno más chico.' });
  }
});

app.get('/api/academy-materials/:id/download', requireAnyLogin, async (req, res) => {
  try {
    const material = await db.prepare('SELECT * FROM academy_materials WHERE id = ?').get(req.params.id);
    if (!material) return res.status(404).json({ error: 'No encontrado' });
    const course = await db.prepare('SELECT * FROM academy_courses WHERE id = ?').get(material.course_id);
    if (!canAccessCourseMaterials(req, course ? course.department : null)) return res.status(403).json({ error: 'No autorizado' });

    const buffer = Buffer.from(material.data_base64, 'base64');
    res.setHeader('Content-Type', material.mime_type);
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(material.file_name)}"`);
    res.send(buffer);
  } catch (err) {
    console.error('Error descargando material', req.params.id, err);
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo descargar el archivo' });
  }
});

app.delete('/api/academy-materials/:id', requireAuth, requireAcademyAccess, async (req, res) => {
  try {
    const material = await db.prepare('SELECT * FROM academy_materials WHERE id = ?').get(req.params.id);
    if (!material) return res.status(404).json({ error: 'No encontrado' });
    const course = await db.prepare('SELECT * FROM academy_courses WHERE id = ?').get(material.course_id);
    if (course && !courseDepartmentAllowed(req, res, course.department)) return;

    await db.prepare('DELETE FROM academy_materials WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('Error eliminando material', req.params.id, err);
    res.status(500).json({ error: 'No se pudo eliminar el material' });
  }
});

// Listado de evaluaciones de todos los cadetes en un solo lugar (no una
// por una entrando a cada cadete), para poder revisarlas como una
// sección propia de la Academia.
app.get('/api/academy-evaluations', requireAuth, requireAcademyAccess, async (req, res) => {
  const { department } = req.query;
  const scopedDept = scopedDepartment(req);
  const conditions = [];
  const params = [];
  if (scopedDept) {
    conditions.push('c.department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('c.department = ?');
    params.push(department);
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = await db.prepare(`
    SELECT ev.*, co.name AS course_name, c.full_name AS cadet_name, c.department AS cadet_department
    FROM academy_evaluations ev
    JOIN cadets c ON c.id = ev.cadet_id
    LEFT JOIN academy_courses co ON co.id = ev.course_id
    ${where}
    ORDER BY ev.created_at DESC
  `).all(...params);
  res.json(rows);
});

app.get('/api/cadets/:id/evaluations', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCadetWithAccess(req, res, req.params.id);
  if (!row) return;

  const rows = await db.prepare(`
    SELECT ev.*, co.name AS course_name
    FROM academy_evaluations ev
    LEFT JOIN academy_courses co ON co.id = ev.course_id
    WHERE ev.cadet_id = ?
    ORDER BY ev.created_at DESC
  `).all(req.params.id);
  res.json(rows);
});

app.post('/api/cadets/:id/evaluations', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCadetWithAccess(req, res, req.params.id);
  if (!row) return;

  const { title, courseId, score, maxScore, passed, notes } = req.body || {};
  if (!title || !title.trim()) return res.status(400).json({ error: 'El título es requerido' });

  let course = null;
  if (courseId) {
    course = await db.prepare('SELECT id FROM academy_courses WHERE id = ?').get(courseId);
    if (!course) return res.status(400).json({ error: 'Curso inválido' });
  }

  const info = await db.prepare(`
    INSERT INTO academy_evaluations (cadet_id, course_id, title, score, max_score, passed, notes, evaluator_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    course ? course.id : null,
    title.trim(),
    score !== undefined && score !== null && score !== '' ? Number(score) : null,
    maxScore !== undefined && maxScore !== null && maxScore !== '' ? Number(maxScore) : 100,
    passed === undefined || passed === null || passed === '' ? null : (passed ? 1 : 0),
    (notes || '').trim() || null,
    req.session.username,
  );

  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/academy-evaluations/:id', requireAuth, requireAcademyAccess, async (req, res) => {
  const ev = await db.prepare('SELECT * FROM academy_evaluations WHERE id = ?').get(req.params.id);
  if (!ev) return res.status(404).json({ error: 'No encontrada' });
  const cadet = await db.prepare('SELECT * FROM cadets WHERE id = ?').get(ev.cadet_id);
  if (cadet && !requireDepartmentAccess(req, res, cadet)) return;

  await db.prepare('DELETE FROM academy_evaluations WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.get('/api/cadets/:id/notes', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCadetWithAccess(req, res, req.params.id);
  if (!row) return;

  const rows = await db.prepare('SELECT * FROM cadet_notes WHERE cadet_id = ? ORDER BY created_at DESC').all(req.params.id);
  res.json(rows);
});

app.post('/api/cadets/:id/notes', requireAuth, requireAcademyAccess, async (req, res) => {
  const row = await getCadetWithAccess(req, res, req.params.id);
  if (!row) return;

  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'El informe no puede estar vacío' });

  const info = await db.prepare(`
    INSERT INTO cadet_notes (cadet_id, author_name, body)
    VALUES (?, ?, ?)
  `).run(row.id, req.session.fullName || req.session.username, body.trim());

  res.status(201).json({ id: info.lastInsertRowid });
});

app.delete('/api/cadet-notes/:id', requireAuth, requireAcademyAccess, async (req, res) => {
  const note = await db.prepare('SELECT * FROM cadet_notes WHERE id = ?').get(req.params.id);
  if (!note) return res.status(404).json({ error: 'No encontrada' });
  const cadet = await db.prepare('SELECT * FROM cadets WHERE id = ?').get(note.cadet_id);
  if (cadet && !requireDepartmentAccess(req, res, cadet)) return;

  await db.prepare('DELETE FROM cadet_notes WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Informes (plantillas por departamento) ----------

// "heading" no es un campo de respuesta: es un título visual para separar
// en secciones un formulario largo (ej: "Datos del paciente", "Diagnóstico").
// No pide dato al agente ni se guarda en data_json.
const VALID_FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'select', 'heading'];

function validateReportFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) return 'La plantilla necesita al menos un campo';
  const keys = new Set();
  for (const f of fields) {
    if (!f || typeof f.label !== 'string' || !f.label.trim()) return 'Cada campo necesita una etiqueta';
    if (!VALID_FIELD_TYPES.includes(f.type)) return `Tipo de campo inválido: ${f.type}`;
    if (f.type === 'select' && (!Array.isArray(f.options) || f.options.filter((o) => o && String(o).trim()).length === 0)) {
      return `El campo "${f.label}" necesita al menos una opción`;
    }
    if (!f.key) return 'Cada campo necesita una clave interna';
    if (keys.has(f.key)) return `Clave de campo repetida: ${f.key}`;
    keys.add(f.key);
  }
  return null;
}

function normalizeReportFields(fields) {
  return fields.map((f) => ({
    key: String(f.key).trim(),
    label: String(f.label).trim(),
    type: f.type,
    required: f.type === 'heading' ? false : !!f.required,
    ...(f.type === 'select' ? { options: f.options.map((o) => String(o).trim()).filter(Boolean) } : {}),
  }));
}

function parseTemplateRow(r) {
  return { ...r, fields: JSON.parse(r.fields_json) };
}

app.get('/api/report-templates', requireLoggedIn, async (req, res) => {
  const { department } = req.query;
  const scopedDept = scopedDepartment(req);
  const targetDept = scopedDept || (department && VALID_DEPARTMENTS.includes(department) ? department : req.session.department);
  if (!VALID_DEPARTMENTS.includes(targetDept)) return res.status(400).json({ error: 'Departamento inválido' });

  const canManageDept = req.session.isSuperadmin || (req.session.isStaff && req.session.department === targetDept);
  const where = canManageDept ? 'WHERE department = ?' : 'WHERE department = ? AND active = 1';
  const rows = await db.prepare(`SELECT * FROM report_templates ${where} ORDER BY created_at DESC`).all(targetDept);
  res.json(rows.map(parseTemplateRow));
});

app.post('/api/report-templates', requireAuth, async (req, res) => {
  const { name, description, fields } = req.body || {};
  const scopedDept = scopedDepartment(req);
  const department = scopedDept || req.body?.department;

  if (!name || !department) return res.status(400).json({ error: 'Nombre y departamento son requeridos' });
  if (!VALID_DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Departamento inválido' });

  const fieldsError = validateReportFields(fields);
  if (fieldsError) return res.status(400).json({ error: fieldsError });

  const info = await db.prepare(`
    INSERT INTO report_templates (department, name, description, fields_json, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(department, name.trim(), (description || '').trim() || null, JSON.stringify(normalizeReportFields(fields)), req.session.username);

  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/report-templates/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM report_templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  const { name, description, fields, active } = req.body || {};
  let fieldsJson = row.fields_json;
  if (fields !== undefined) {
    const fieldsError = validateReportFields(fields);
    if (fieldsError) return res.status(400).json({ error: fieldsError });
    fieldsJson = JSON.stringify(normalizeReportFields(fields));
  }

  await db.prepare(`
    UPDATE report_templates SET name = ?, description = ?, fields_json = ?, active = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    name !== undefined ? name.trim() : row.name,
    description !== undefined ? ((description || '').trim() || null) : row.description,
    fieldsJson,
    active !== undefined ? (active ? 1 : 0) : row.active,
    req.params.id,
  );
  res.json({ ok: true });
});

app.delete('/api/report-templates/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM report_templates WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  await db.prepare('DELETE FROM report_submissions WHERE template_id = ?').run(req.params.id);
  await db.prepare('DELETE FROM report_templates WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/report-templates/:id/submissions', requireLoggedIn, async (req, res) => {
  const template = await db.prepare('SELECT * FROM report_templates WHERE id = ?').get(req.params.id);
  if (!template || !template.active) return res.status(404).json({ error: 'No encontrada' });

  const canAccess = req.session.isSuperadmin || req.session.department === template.department;
  if (!canAccess) return res.status(403).json({ error: 'Esa plantilla no es de tu departamento' });

  const { title, data } = req.body || {};
  if (!title || !title.trim()) {
    return res.status(400).json({ error: 'Ponele un título al informe' });
  }
  const fields = JSON.parse(template.fields_json);
  for (const f of fields) {
    const value = data?.[f.key];
    if (f.required && (value === undefined || value === null || value === '')) {
      return res.status(400).json({ error: `Falta completar "${f.label}"` });
    }
  }

  const info = await db.prepare(`
    INSERT INTO report_submissions (template_id, department, employee_id, title, data_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(template.id, template.department, req.session.employeeId, title.trim(), JSON.stringify(data || {}));

  res.status(201).json({ id: info.lastInsertRowid });
});

// Todo informe entra "pendiente" y queda así hasta que el staff de ese
// departamento (quien gestiona las plantillas) lo aprueba o lo rechaza.
const VALID_REPORT_STATUSES = ['pendiente', 'aprobado', 'rechazado'];

// Bandeja de revisión: todos los informes pendientes de todas las
// plantillas del departamento del staff, en un solo lugar (antes solo se
// veían entrando plantilla por plantilla a "Gestionar plantillas → Ver
// respuestas", lo que los dejaba escondidos).
app.get('/api/report-submissions/pending', requireAuth, async (req, res) => {
  const scopedDept = scopedDepartment(req);
  const conditions = ["s.status = 'pendiente'"];
  const params = [];
  if (scopedDept) {
    conditions.push('s.department = ?');
    params.push(scopedDept);
  }
  const rows = await db.prepare(`
    SELECT s.*, e.full_name AS employee_name, t.name AS template_name
    FROM report_submissions s
    JOIN employees e ON e.id = s.employee_id
    JOIN report_templates t ON t.id = s.template_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY s.created_at ASC
  `).all(...params);
  res.json(rows.map((r) => ({ ...r, data: JSON.parse(r.data_json) })));
});

app.patch('/api/report-submissions/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM report_submissions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  const { status, reviewNotes } = req.body || {};
  if (status && !VALID_REPORT_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  await db.prepare(`
    UPDATE report_submissions
    SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(
    status || row.status,
    reviewNotes !== undefined ? ((reviewNotes || '').trim() || null) : row.review_notes,
    req.session.username,
    req.params.id,
  );

  res.json({ ok: true });
});

app.get('/api/report-templates/:id/submissions', requireAuth, async (req, res) => {
  const template = await db.prepare('SELECT * FROM report_templates WHERE id = ?').get(req.params.id);
  if (!template) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, template)) return;

  const rows = await db.prepare(`
    SELECT s.*, e.full_name AS employee_name
    FROM report_submissions s
    JOIN employees e ON e.id = s.employee_id
    WHERE s.template_id = ?
    ORDER BY s.created_at DESC
  `).all(req.params.id);
  res.json(rows.map((r) => ({ ...r, data: JSON.parse(r.data_json) })));
});

app.get('/api/report-submissions/mine', requireLoggedIn, async (req, res) => {
  const rows = await db.prepare(`
    SELECT s.*, t.name AS template_name
    FROM report_submissions s
    JOIN report_templates t ON t.id = s.template_id
    WHERE s.employee_id = ?
    ORDER BY s.created_at DESC
    LIMIT 100
  `).all(req.session.employeeId);
  res.json(rows.map((r) => ({ ...r, data: JSON.parse(r.data_json) })));
});

app.delete('/api/report-submissions/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM report_submissions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  await db.prepare('DELETE FROM report_submissions WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

const REPORT_STATUS_LABELS = { pendiente: 'Pendiente', aprobado: 'Aprobado', rechazado: 'Rechazado' };

// Arma el PDF a mano con pdfkit (no HTML-a-PDF) para poder controlar bien
// el estilo y meter saltos de página propios antes de cada campo en vez
// de dejar que corte cualquier bloque de texto a la mitad.
function writeSubmissionPdf(res, { template, submission, employeeName }) {
  const doc = new PDFDocument({ size: 'A4', margin: 56 });
  doc.pipe(res);

  const accent = '#0c8790';
  const muted = '#5b7387';
  const text = '#101c29';

  doc.fillColor(accent).fontSize(20).text(submission.title || template.name, { align: 'left' });
  if (submission.title) {
    doc.fillColor(muted).fontSize(10).text(template.name);
  }
  if (template.description) {
    doc.moveDown(0.2);
    doc.fillColor(muted).fontSize(10).text(template.description);
  }
  doc.moveDown(0.8);

  doc.fillColor(muted).fontSize(9);
  doc.text(`Departamento: ${DEPARTMENT_LABELS[submission.department] || submission.department}`);
  doc.text(`Completado por: ${employeeName}`);
  doc.text(`Fecha de envío: ${submission.created_at}`);
  doc.text(`Estado: ${REPORT_STATUS_LABELS[submission.status] || submission.status}`);
  if (submission.reviewed_by) {
    doc.text(`Revisado por: ${submission.reviewed_by} (${submission.reviewed_at || ''})`);
  }
  if (submission.review_notes) {
    doc.text(`Notas de revisión: ${submission.review_notes}`);
  }

  doc.moveDown(0.6);
  doc.moveTo(doc.page.margins.left, doc.y)
    .lineTo(doc.page.width - doc.page.margins.right, doc.y)
    .strokeColor('#d8e0e6')
    .stroke();
  doc.moveDown(1);

  const data = JSON.parse(submission.data_json);
  const bottomLimit = doc.page.height - doc.page.margins.bottom;

  for (const f of template.fields) {
    // Salto de página propio antes de cada campo si ya no entra un bloque
    // mínimo razonable, para no cortar una etiqueta sola al final de la hoja.
    if (doc.y > bottomLimit - 60) doc.addPage();

    if (f.type === 'heading') {
      if (doc.y > doc.page.margins.top) doc.moveDown(0.3);
      doc.fillColor(accent).fontSize(13).font('Helvetica-Bold').text(f.label);
      doc.moveTo(doc.page.margins.left, doc.y + 2)
        .lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
        .strokeColor('#d8e0e6')
        .stroke();
      doc.moveDown(0.5);
      continue;
    }

    doc.fillColor(accent).fontSize(9).font('Helvetica-Bold').text(f.label.toUpperCase());
    doc.moveDown(0.15);
    const value = data[f.key];
    doc.fillColor(text).fontSize(11).font('Helvetica').text(value === undefined || value === null || value === '' ? '—' : String(value), {
      width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
    });
    doc.moveDown(0.7);
  }

  doc.end();
}

app.get('/api/report-submissions/:id/pdf', requireLoggedIn, async (req, res) => {
  const row = await db.prepare('SELECT * FROM report_submissions WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });

  const isOwner = row.employee_id === req.session.employeeId;
  const isDeptStaff = (req.session.isStaff || req.session.isSuperadmin)
    && (req.session.isSuperadmin || req.session.department === row.department);
  if (!isOwner && !isDeptStaff) return res.status(403).json({ error: 'No autorizado' });

  const template = await db.prepare('SELECT * FROM report_templates WHERE id = ?').get(row.template_id);
  if (!template) return res.status(404).json({ error: 'Plantilla no encontrada' });
  const employee = await db.prepare('SELECT full_name FROM employees WHERE id = ?').get(row.employee_id);

  const download = req.query.download === '1';

  // writeSubmissionPdf escribe de forma síncrona (pdfkit tira si le falta
  // algún recurso de fuente estándar): si algo falla ahí adentro, sin este
  // try/catch la respuesta queda colgada para siempre (headers puestos,
  // cuerpo nunca escrito) en vez de devolver un error legible.
  try {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="informe-${row.id}.pdf"`);
    writeSubmissionPdf(res, {
      template: { ...template, fields: JSON.parse(template.fields_json) },
      submission: row,
      employeeName: employee ? employee.full_name : 'Empleado',
    });
  } catch (err) {
    console.error('Error generando el PDF del informe', req.params.id, err);
    if (!res.headersSent) {
      res.status(500).json({ error: 'No se pudo generar el PDF' });
    } else {
      res.end();
    }
  }
});

// ---------- Portal de estudiantes (cadetes) ----------
//
// Cuenta y sesión completamente aparte de la de empleado: sin fichaje,
// sin informes, sin acceso a ningún módulo de gestión. Solo pueden ver
// su propio perfil, los cursos de su departamento (con los materiales
// que suba RTD) y sus propias evaluaciones.

app.get('/api/student/me', requireCadetLoggedIn, async (req, res) => {
  const cadet = await db.prepare('SELECT * FROM cadets WHERE id = ?').get(req.session.cadetId);
  if (!cadet) return res.status(404).json({ error: 'No encontrado' });
  res.json({
    id: cadet.id,
    fullName: cadet.full_name,
    department: cadet.department,
    status: cadet.status,
    createdAt: cadet.created_at,
    graduatedAt: cadet.graduated_at,
  });
});

app.get('/api/student/courses', requireCadetLoggedIn, async (req, res) => {
  const rows = await db.prepare(`
    SELECT * FROM academy_courses
    WHERE active = 1 AND (department IS NULL OR department = ?)
    ORDER BY name ASC
  `).all(req.session.department);
  res.json(rows);
});

app.get('/api/student/evaluations', requireCadetLoggedIn, async (req, res) => {
  const rows = await db.prepare(`
    SELECT ev.*, co.name AS course_name
    FROM academy_evaluations ev
    LEFT JOIN academy_courses co ON co.id = ev.course_id
    WHERE ev.cadet_id = ?
    ORDER BY ev.created_at DESC
  `).all(req.session.cadetId);
  res.json(rows);
});

// Manejo del error de multer (archivo demasiado grande) para que llegue
// como un JSON legible en vez de tumbar la request con un stack trace.
// Tiene que ir después de todas las rutas para que le lleguen los
// errores que salten en cualquiera de ellas (acá, la subida de materiales).
app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `El archivo supera el máximo permitido (${Math.floor(MATERIAL_MAX_BYTES / (1024 * 1024))}MB)` });
  }
  next(err);
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SAED - Gestión de postulaciones corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
