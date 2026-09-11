// Crea o actualiza un usuario de staff (login unificado: la misma cuenta
// sirve para el panel de gestión y para fichar), opcionalmente asignado a
// un departamento.
// Uso: node scripts/seed-admin.js <usuario> <contraseña> [departamento]
//   departamento: "sams" o "safd" (opcional). Sin departamento, el usuario es
//   superadmin: ve y gestiona todo (ambos departamentos, staff, tarifas, roles).
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
  const explicitDepartment = process.argv.length > 4;

  const existing = await db.prepare('SELECT id, department FROM employees WHERE username = ?').get(username);
  const department = explicitDepartment
    ? (departmentArg || 'sams')
    : (existing ? existing.department : 'sams');
  const isSuperadmin = explicitDepartment ? (departmentArg ? 0 : 1) : (existing ? existing.is_superadmin : 1);

  if (existing) {
    await db.prepare(`
      UPDATE employees SET password_hash = ?, department = ?, is_staff = 1, is_superadmin = ?, active = 1
      WHERE username = ?
    `).run(hash, department, isSuperadmin, username);
    console.log(`Contraseña actualizada para "${username}". Departamento: ${departmentArg || (isSuperadmin ? 'todos' : department)}.`);
  } else {
    const genericRank = await db.prepare('SELECT id FROM ranks WHERE level = 8 AND department IS NULL').get();
    await db.prepare(`
      INSERT INTO employees
        (full_name, department, rank_id, active, is_staff, is_superadmin, hr_access, username, password_hash, created_by)
      VALUES (?, ?, ?, 1, 1, ?, 1, ?, ?, 'seed-admin.js')
    `).run(username, department, genericRank.id, isSuperadmin, username, hash);
    console.log(`Usuario "${username}" creado. Departamento: ${departmentArg || (isSuperadmin ? 'todos' : department)}.`);
  }
})();
