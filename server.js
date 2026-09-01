require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieSession = require('cookie-session');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

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
  res.json({ ok: true, username: admin.username });
});

app.post('/api/logout', (req, res) => {
  req.session = null;
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: !!(req.session && req.session.adminUser), username: req.session?.adminUser || null });
});

// ---------- Postulaciones (publico) ----------

app.post('/api/applications', async (req, res) => {
  const {
    department, fullName, age, country, phone, email,
    discordInfo, experience, motivation, criminalRecord,
    previousSaedExperience, previousSaedDetails,
  } = req.body || {};

  if (!VALID_DEPARTMENTS.includes(department)) {
    return res.status(400).json({ error: 'Departamento inválido' });
  }

  if (!fullName || !age || !country || !phone || !discordInfo || !experience || !motivation || !criminalRecord || !previousSaedExperience) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  const ageNum = Number(age);
  if (!Number.isInteger(ageNum) || ageNum <= 0) {
    return res.status(400).json({ error: 'Edad inválida' });
  }

  const insert = db.prepare(`
    INSERT INTO applications
      (department, full_name, age, country, phone, email, discord_info, experience, motivation, criminal_record,
       previous_saed_experience, previous_saed_details)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = insert.run(
    department, fullName.trim(), ageNum, country.trim(), phone.trim(),
    (email || '').trim() || null, discordInfo.trim(),
    experience.trim(), motivation.trim(), criminalRecord,
    previousSaedExperience, (previousSaedDetails || '').trim() || null,
  );

  try {
    await notifyDiscord({
      department, fullName, age: ageNum, country, phone, email, discordInfo, experience, motivation, criminalRecord,
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
      { name: 'Teléfono', value: app_.phone, inline: true },
      { name: 'Correo Electrónico', value: app_.email || 'N/A', inline: true },
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

// ---------- Postulaciones (admin) ----------

app.get('/api/applications', requireAuth, (req, res) => {
  const { status, department } = req.query;
  const conditions = [];
  const params = [];

  if (status && VALID_STATUSES.includes(status)) {
    conditions.push('status = ?');
    params.push(status);
  }
  if (department && VALID_DEPARTMENTS.includes(department)) {
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
  res.json(row);
});

app.patch('/api/applications/:id', requireAuth, (req, res) => {
  const { status, reviewNotes } = req.body || {};
  const row = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'No encontrada' });

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
  db.prepare('DELETE FROM applications WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`SAED - Gestión de postulaciones corriendo en http://localhost:${PORT}`);
  });
}

module.exports = app;
