// Crea o actualiza un usuario de staff, opcionalmente asignado a un departamento.
// Uso: node scripts/seed-admin.js <usuario> <contraseña> [departamento]
//   departamento: "sams" o "safd" (opcional). Sin departamento, el usuario ve
//   y gestiona postulaciones de todos los departamentos (staff del SAED).
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

const VALID_DEPARTMENTS = ['sams', 'safd'];

const username = process.argv[2] || process.env.ADMIN_USER;
const password = process.argv[3];
const departmentArg = process.argv[4];

if (!username || !password) {
  console.error('Uso: node scripts/seed-admin.js <usuario> <contraseña> [departamento: sams|safd]');
  process.exit(1);
}

if (departmentArg && !VALID_DEPARTMENTS.includes(departmentArg)) {
  console.error(`Departamento inválido: "${departmentArg}". Usá "sams" o "safd", o dejalo vacío para acceso total.`);
  process.exit(1);
}

(async () => {
  const hash = bcrypt.hashSync(password, 10);

  const existing = await db.prepare('SELECT id, department FROM admins WHERE username = ?').get(username);
  const department = departmentArg !== undefined && process.argv.length > 4
    ? (departmentArg || null)
    : (existing ? existing.department : null);

  if (existing) {
    await db.prepare('UPDATE admins SET password_hash = ?, department = ? WHERE username = ?').run(hash, department, username);
    console.log(`Contraseña actualizada para "${username}". Departamento: ${department || 'todos'}.`);
  } else {
    await db.prepare('INSERT INTO admins (username, password_hash, department) VALUES (?, ?, ?)').run(username, hash, department);
    console.log(`Usuario "${username}" creado. Departamento: ${department || 'todos'}.`);
  }
})();
