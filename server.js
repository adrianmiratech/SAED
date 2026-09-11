require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

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

function requireAuth(req, res, next) {
  if (req.session && req.session.adminUser) return next();
  return res.status(401).json({ error: 'No autenticado' });
}

// Solo el staff sin departamento asignado (ve todo, nivel SAED) puede
// crear o borrar otras cuentas de staff.
function requireSuperAdmin(req, res, next) {
  if (req.session && req.session.adminUser && !req.session.adminDepartment) return next();
  return res.status(403).json({ error: 'No autorizado' });
}

const VALID_STATUSES = ['pendiente', 'en_revision', 'aprobado', 'rechazado'];
const VALID_DEPARTMENTS = ['sams', 'safd'];
const DEPARTMENT_LABELS = { sams: 'SAMS', safd: 'SAFD' };
const VALID_CASE_STATUSES = ['abierta', 'cerrada'];
const VALID_MOVEMENT_TYPES = ['entrada', 'salida'];

function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ---------- Auth ----------

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  const admin = await db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Credenciales inválidas' });
  }

  req.session.adminUser = admin.username;
  req.session.adminDepartment = admin.department || null;
  res.json({ ok: true, username: admin.username, department: admin.department || null });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({
    authenticated: !!(req.session && req.session.adminUser),
    username: req.session?.adminUser || null,
    department: req.session?.adminDepartment || null,
  });
});

// ---------- Staff ----------

app.get('/api/admins', requireAuth, requireSuperAdmin, async (req, res) => {
  const rows = await db.prepare('SELECT id, username, department, created_at FROM admins ORDER BY created_at ASC').all();
  res.json(rows);
});

app.post('/api/admins', requireAuth, requireSuperAdmin, async (req, res) => {
  const { username, password, department } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
  }
  if (department && !VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }

  const existing = await db.prepare('SELECT id FROM admins WHERE username = ?').get(username.trim());
  if (existing) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = await db.prepare('INSERT INTO admins (username, password_hash, department) VALUES (?, ?, ?)')
    .run(username.trim(), hash, department || null);

  res.status(201).json({ id: info.lastInsertRowid, username: username.trim(), department: department || null });
});

app.delete('/api/admins/:id', requireAuth, requireSuperAdmin, async (req, res) => {
  const target = await db.prepare('SELECT * FROM admins WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'No encontrado' });

  if (target.username === req.session.adminUser) {
    return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });
  }

  if (!target.department) {
    const superAdminCount = (await db.prepare('SELECT COUNT(*) AS c FROM admins WHERE department IS NULL').get()).c;
    if (superAdminCount <= 1) {
      return res.status(400).json({ error: 'No podés eliminar el único usuario con acceso a todos los departamentos' });
    }
  }

  await db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
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
  const scopedDept = req.session.adminDepartment;
  if (scopedDept && row.department !== scopedDept) {
    res.status(404).json({ error: 'No encontrada' });
    return false;
  }
  return true;
}

app.get('/api/applications', requireAuth, async (req, res) => {
  const { status, department } = req.query;
  const scopedDept = req.session.adminDepartment;
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
  const scopedDept = req.session.adminDepartment;
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
  const { status, reviewNotes, rankId } = req.body || {};
  const row = await db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  // Al aprobar, el encargado tiene que elegir el rango del roster de
  // Personal con el que ingresa el postulante.
  let rank = null;
  if (status === 'aprobado') {
    rank = await validateRankForDepartment(rankId, row.department);
    if (!rank) {
      return res.status(400).json({ error: 'Rango inválido para ese departamento' });
    }
  }

  await db.prepare(`
    UPDATE applications
    SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(
    status || row.status,
    reviewNotes !== undefined ? reviewNotes : row.review_notes,
    req.session.adminUser,
    req.params.id,
  );

  if (status === 'aprobado') {
    // Si ya existe un empleado con el mismo nombre y departamento (por
    // ejemplo, porque esta postulación se había aprobado antes), solo se
    // actualiza su rango en vez de duplicarlo.
    const existing = await db.prepare(
      'SELECT id FROM employees WHERE department = ? AND full_name = ?',
    ).get(row.department, row.full_name);

    if (existing) {
      await db.prepare('UPDATE employees SET rank_id = ?, active = 1 WHERE id = ?').run(rank.id, existing.id);
    } else {
      await db.prepare(`
        INSERT INTO employees (full_name, discord_info, department, rank_id, created_by)
        VALUES (?, ?, ?, ?, ?)
      `).run(row.full_name, row.discord_info, row.department, rank.id, req.session.adminUser);
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
  const scopedDept = req.session.adminDepartment;
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

// ---------- Empleados ----------

app.get('/api/employees', requireAuth, async (req, res) => {
  const { department } = req.query;
  const scopedDept = req.session.adminDepartment;
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
    SELECT e.*, r.level AS rank_level, r.name AS rank_name, r.hourly_rate AS rank_hourly_rate
    FROM employees e
    JOIN ranks r ON r.id = e.rank_id
    ${where}
    ORDER BY e.active DESC, r.level DESC, e.full_name ASC
  `).all(...params);
  res.json(rows);
});

async function validateRankForDepartment(rankId, department) {
  const rank = await db.prepare('SELECT * FROM ranks WHERE id = ?').get(rankId);
  if (!rank) return null;
  if (rank.department && rank.department !== department) return null;
  return rank;
}

app.post('/api/employees', requireAuth, async (req, res) => {
  const { fullName, phone, discordInfo, rankId } = req.body || {};
  const scopedDept = req.session.adminDepartment;
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

  const info = await db.prepare(`
    INSERT INTO employees (full_name, phone, discord_info, department, rank_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fullName.trim(), phone.trim(), (discordInfo || '').trim() || null, department, rank.id, req.session.adminUser);

  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/employees/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  const { fullName, phone, discordInfo, rankId, active } = req.body || {};
  let rank_id = row.rank_id;
  if (rankId !== undefined) {
    const rank = await validateRankForDepartment(rankId, row.department);
    if (!rank) return res.status(400).json({ error: 'Rango inválido para ese departamento' });
    rank_id = rank.id;
  }

  await db.prepare(`
    UPDATE employees SET full_name = ?, phone = ?, discord_info = ?, rank_id = ?, active = ?
    WHERE id = ?
  `).run(
    fullName !== undefined ? fullName.trim() : row.full_name,
    phone !== undefined ? phone.trim() : row.phone,
    discordInfo !== undefined ? ((discordInfo || '').trim() || null) : row.discord_info,
    rank_id,
    active !== undefined ? (active ? 1 : 0) : row.active,
    req.params.id,
  );

  res.json({ ok: true });
});

app.delete('/api/employees/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  await db.prepare('DELETE FROM payroll WHERE employee_id = ?').run(req.params.id);
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
  const scopedDept = req.session.adminDepartment;
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
  `).run(employee.id, hoursNum, rate, total, (periodLabel || '').trim() || null, req.session.adminUser);

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
        paidBy: req.session.adminUser,
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

// ---------- Turnos ----------

app.get('/api/shifts', requireAuth, async (req, res) => {
  const { department, employeeId, from, to } = req.query;
  const scopedDept = req.session.adminDepartment;
  const conditions = [];
  const params = [];

  if (scopedDept) {
    conditions.push('s.department = ?');
    params.push(scopedDept);
  } else if (department && VALID_DEPARTMENTS.includes(department)) {
    conditions.push('s.department = ?');
    params.push(department);
  }
  if (employeeId) {
    conditions.push('s.employee_id = ?');
    params.push(employeeId);
  }
  if (from) {
    conditions.push('s.shift_date >= ?');
    params.push(from);
  }
  if (to) {
    conditions.push('s.shift_date <= ?');
    params.push(to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.prepare(`
    SELECT s.*, e.full_name AS employee_name
    FROM shifts s
    JOIN employees e ON e.id = s.employee_id
    ${where}
    ORDER BY s.shift_date ASC, s.start_time ASC
  `).all(...params);
  res.json(rows);
});

// Dos horarios "HH:MM" en el mismo día se superponen si arranca uno
// antes de que termine el otro y viceversa. Al estar en formato de 24hs
// con cero a la izquierda, la comparación de strings ya da el orden
// cronológico correcto sin necesidad de parsear a Date.
async function hasShiftOverlap(employeeId, shiftDate, startTime, endTime, excludeId) {
  const rows = await db.prepare(
    'SELECT id, start_time, end_time FROM shifts WHERE employee_id = ? AND shift_date = ?',
  ).all(employeeId, shiftDate);
  return rows.some((r) => (
    (!excludeId || r.id !== Number(excludeId)) && startTime < r.end_time && r.start_time < endTime
  ));
}

app.post('/api/shifts', requireAuth, async (req, res) => {
  const { employeeId, shiftDate, startTime, endTime, notes } = req.body || {};
  if (!employeeId || !shiftDate || !startTime || !endTime) {
    return res.status(400).json({ error: 'Empleado, fecha y horario son requeridos' });
  }

  const employee = await getEmployeeWithAccess(req, res, employeeId);
  if (!employee) return;

  if (await hasShiftOverlap(employee.id, shiftDate, startTime, endTime)) {
    return res.status(409).json({ error: 'overlap', message: `${employee.full_name} ya tiene un turno asignado el ${shiftDate} que se superpone con ese horario` });
  }

  const info = await db.prepare(`
    INSERT INTO shifts (employee_id, department, shift_date, start_time, end_time, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(employee.id, employee.department, shiftDate, startTime, endTime, (notes || '').trim() || null, req.session.adminUser);

  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/shifts/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  const { shiftDate, startTime, endTime, notes } = req.body || {};
  const nextDate = shiftDate || row.shift_date;
  const nextStart = startTime || row.start_time;
  const nextEnd = endTime || row.end_time;

  if (await hasShiftOverlap(row.employee_id, nextDate, nextStart, nextEnd, row.id)) {
    return res.status(409).json({ error: 'overlap', message: 'Ese horario se superpone con otro turno ya asignado a este empleado' });
  }

  await db.prepare(`
    UPDATE shifts SET shift_date = ?, start_time = ?, end_time = ?, notes = ?
    WHERE id = ?
  `).run(
    nextDate,
    nextStart,
    nextEnd,
    notes !== undefined ? ((notes || '').trim() || null) : row.notes,
    req.params.id,
  );

  res.json({ ok: true });
});

app.delete('/api/shifts/:id', requireAuth, async (req, res) => {
  const row = await db.prepare('SELECT * FROM shifts WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  await db.prepare('DELETE FROM shifts WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Inventario ----------

app.get('/api/inventory', requireAuth, async (req, res) => {
  const { department } = req.query;
  const scopedDept = req.session.adminDepartment;
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
  const scopedDept = req.session.adminDepartment;
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
  `).run(department, name.trim(), (category || '').trim() || null, (unit || 'unidad').trim(), minQty, req.session.adminUser);

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
  `).run(item.id, type, qty, (reason || '').trim() || null, linkedCaseId, req.session.adminUser);

  await db.prepare(`UPDATE inventory_items SET quantity = ?, updated_at = datetime('now') WHERE id = ?`).run(newQuantity, item.id);

  res.status(201).json({ ok: true, quantity: newQuantity, justWentLow: isLow && !wasLow });
});

// ---------- Atenciones (fichas clínicas / informes de intervención) ----------

app.get('/api/cases', requireAuth, async (req, res) => {
  const { department, status, from, to, subject } = req.query;
  const scopedDept = req.session.adminDepartment;
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
  const scopedDept = req.session.adminDepartment;
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
    summary.trim(), (treatment || '').trim() || null, responsibleId, req.session.adminUser,
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

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SAED - Gestión de postulaciones corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
