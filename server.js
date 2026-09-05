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

const VALID_STATUSES = ['pendiente', 'aprobado', 'rechazado'];
const VALID_DEPARTMENTS = ['sams', 'safd'];
const DEPARTMENT_LABELS = { sams: 'SAMS', safd: 'SAFD' };

// ---------- Auth ----------

app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son requeridos' });
  }

  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
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

app.get('/api/admins', requireAuth, requireSuperAdmin, (req, res) => {
  const rows = db.prepare('SELECT id, username, department, created_at FROM admins ORDER BY created_at ASC').all();
  res.json(rows);
});

app.post('/api/admins', requireAuth, requireSuperAdmin, (req, res) => {
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

  const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username.trim());
  if (existing) {
    return res.status(409).json({ error: 'Ya existe un usuario con ese nombre' });
  }

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO admins (username, password_hash, department) VALUES (?, ?, ?)')
    .run(username.trim(), hash, department || null);

  res.status(201).json({ id: info.lastInsertRowid, username: username.trim(), department: department || null });
});

app.delete('/api/admins/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const target = db.prepare('SELECT * FROM admins WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'No encontrado' });

  if (target.username === req.session.adminUser) {
    return res.status(400).json({ error: 'No podés eliminar tu propia cuenta' });
  }

  if (!target.department) {
    const superAdminCount = db.prepare('SELECT COUNT(*) AS c FROM admins WHERE department IS NULL').get().c;
    if (superAdminCount <= 1) {
      return res.status(400).json({ error: 'No podés eliminar el único usuario con acceso a todos los departamentos' });
    }
  }

  db.prepare('DELETE FROM admins WHERE id = ?').run(req.params.id);
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
  const info = insert.run(
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

app.get('/api/applications', requireAuth, (req, res) => {
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
  const rows = db.prepare(`SELECT * FROM applications ${where} ORDER BY created_at DESC`).all(...params);
  res.json(rows);
});

app.get('/api/applications/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;
  res.json(row);
});

app.patch('/api/applications/:id', requireAuth, (req, res) => {
  const { status, reviewNotes } = req.body || {};
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: 'Estado inválido' });
  }

  db.prepare(`
    UPDATE applications
    SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = datetime('now')
    WHERE id = ?
  `).run(
    status || row.status,
    reviewNotes !== undefined ? reviewNotes : row.review_notes,
    req.session.adminUser,
    req.params.id,
  );

  res.json({ ok: true });
});

app.delete('/api/applications/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  if (!requireDepartmentAccess(req, res, row)) return;

  db.prepare('DELETE FROM applications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Rangos ----------

app.get('/api/ranks', requireAuth, (req, res) => {
  const scopedDept = req.session.adminDepartment;
  const rows = scopedDept
    ? db.prepare('SELECT * FROM ranks WHERE department IS NULL OR department = ? ORDER BY level DESC').all(scopedDept)
    : db.prepare('SELECT * FROM ranks ORDER BY level DESC').all();
  res.json(rows);
});

app.patch('/api/ranks/:id', requireAuth, requireSuperAdmin, (req, res) => {
  const { hourlyRate } = req.body || {};
  const rateNum = Number(hourlyRate);
  if (!Number.isFinite(rateNum) || rateNum < 0) {
    return res.status(400).json({ error: 'Tarifa por hora inválida' });
  }

  const rank = db.prepare('SELECT id FROM ranks WHERE id = ?').get(req.params.id);
  if (!rank) return res.status(404).json({ error: 'Rango no encontrado' });

  db.prepare('UPDATE ranks SET hourly_rate = ? WHERE id = ?').run(rateNum, req.params.id);
  res.json({ ok: true });
});

// ---------- Empleados ----------

app.get('/api/employees', requireAuth, (req, res) => {
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
  const rows = db.prepare(`
    SELECT e.*, r.level AS rank_level, r.name AS rank_name, r.hourly_rate AS rank_hourly_rate
    FROM employees e
    JOIN ranks r ON r.id = e.rank_id
    ${where}
    ORDER BY e.active DESC, r.level DESC, e.full_name ASC
  `).all(...params);
  res.json(rows);
});

function validateRankForDepartment(rankId, department) {
  const rank = db.prepare('SELECT * FROM ranks WHERE id = ?').get(rankId);
  if (!rank) return null;
  if (rank.department && rank.department !== department) return null;
  return rank;
}

app.post('/api/employees', requireAuth, (req, res) => {
  const { fullName, phone, discordInfo, rankId } = req.body || {};
  const scopedDept = req.session.adminDepartment;
  const department = scopedDept || req.body?.department;

  if (!fullName || !phone || !department || !rankId) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }
  if (!VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }
  const rank = validateRankForDepartment(rankId, department);
  if (!rank) {
    return res.status(400).json({ error: 'Rango inválido para ese departamento' });
  }

  const info = db.prepare(`
    INSERT INTO employees (full_name, phone, discord_info, department, rank_id, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(fullName.trim(), phone.trim(), (discordInfo || '').trim() || null, department, rank.id, req.session.adminUser);

  res.status(201).json({ id: info.lastInsertRowid });
});

app.patch('/api/employees/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  const { fullName, phone, discordInfo, rankId, active } = req.body || {};
  let rank_id = row.rank_id;
  if (rankId !== undefined) {
    const rank = validateRankForDepartment(rankId, row.department);
    if (!rank) return res.status(400).json({ error: 'Rango inválido para ese departamento' });
    rank_id = rank.id;
  }

  db.prepare(`
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

app.delete('/api/employees/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM employees WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrado' });
  if (!requireDepartmentAccess(req, res, row)) return;

  db.prepare('DELETE FROM payroll WHERE employee_id = ?').run(req.params.id);
  db.prepare('DELETE FROM employees WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

// ---------- Nómina ----------

function getEmployeeWithAccess(req, res, employeeId) {
  const employee = db.prepare('SELECT * FROM employees WHERE id = ?').get(employeeId);
  if (!employee) {
    res.status(404).json({ error: 'Empleado no encontrado' });
    return null;
  }
  if (!requireDepartmentAccess(req, res, employee)) return null;
  return employee;
}

app.get('/api/payroll', requireAuth, (req, res) => {
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
  const rows = db.prepare(`
    SELECT p.*, e.full_name AS employee_name, e.department AS employee_department
    FROM payroll p
    JOIN employees e ON e.id = p.employee_id
    ${where}
    ORDER BY p.created_at DESC
  `).all(...params);
  res.json(rows);
});

app.post('/api/payroll', requireAuth, (req, res) => {
  const { employeeId, hours, periodLabel } = req.body || {};
  const hoursNum = Number(hours);
  if (!employeeId || !Number.isFinite(hoursNum) || hoursNum <= 0) {
    return res.status(400).json({ error: 'Empleado y cantidad de horas (mayor a 0) son requeridos' });
  }

  const employee = getEmployeeWithAccess(req, res, employeeId);
  if (!employee) return;

  const rank = db.prepare('SELECT * FROM ranks WHERE id = ?').get(employee.rank_id);
  const rate = rank ? rank.hourly_rate : 0;
  const total = Math.round(hoursNum * rate * 100) / 100;

  const info = db.prepare(`
    INSERT INTO payroll (employee_id, hours, hourly_rate, total_amount, period_label, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(employee.id, hoursNum, rate, total, (periodLabel || '').trim() || null, req.session.adminUser);

  res.status(201).json({ id: info.lastInsertRowid, total });
});

app.patch('/api/payroll/:id', requireAuth, async (req, res) => {
  const row = db.prepare('SELECT * FROM payroll WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  const employee = getEmployeeWithAccess(req, res, row.employee_id);
  if (!employee) return;

  const { paid } = req.body || {};
  const paidAt = paid ? new Date().toISOString() : null;
  db.prepare(`
    UPDATE payroll SET paid = ?, paid_at = ? WHERE id = ?
  `).run(paid ? 1 : 0, paidAt, req.params.id);

  // El pago recién se notifica al pasar de pendiente a pagada (no en cada
  // reconfirmación ni al volver a marcarla pendiente). Se espera a que
  // termine ANTES de responder para no dejarlo como tarea de fondo que
  // puede cortarse si el proceso se reinicia justo después de responder.
  if (paid && !row.paid) {
    const rank = db.prepare('SELECT * FROM ranks WHERE id = ?').get(employee.rank_id);
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

app.delete('/api/payroll/:id', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM payroll WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });
  const employee = getEmployeeWithAccess(req, res, row.employee_id);
  if (!employee) return;

  db.prepare('DELETE FROM payroll WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SAED - Gestión de postulaciones corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
