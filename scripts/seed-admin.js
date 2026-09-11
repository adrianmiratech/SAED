// Crea o actualiza una cuenta de acceso (login unificado: la misma sirve
// para fichar y, si pertenece a alguna división con permisos, para entrar
// al panel de gestión).
// Uso: node scripts/seed-admin.js <usuario> <contraseña> [departamento]
//   Sin departamento: además se le asigna la división "Dirección" (acceso
//   total a ambos departamentos), pensado para el primer arranque.
//   Con departamento: solo se crea el login scoped a ese departamento — el
//   acceso al panel hay que dárselo después desde Personal, asignándole
//   una división (Recursos Humanos, Dirección, etc.).
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
  const grantFullAccess = !explicitDepartment || !departmentArg;

  const existing = await db.prepare('SELECT id, department FROM employees WHERE username = ?').get(username);
  const department = explicitDepartment ? (departmentArg || 'sams') : (existing ? existing.department : 'sams');

  let employeeId;
  if (existing) {
    await db.prepare('UPDATE employees SET password_hash = ?, department = ?, active = 1 WHERE username = ?').run(hash, department, username);
    employeeId = existing.id;
    console.log(`Contraseña actualizada para "${username}". Departamento: ${department}.`);
  } else {
    const genericRank = await db.prepare('SELECT id FROM ranks WHERE level = 8 AND department IS NULL').get();
    const info = await db.prepare(`
      INSERT INTO employees (full_name, department, rank_id, active, username, password_hash, created_by)
      VALUES (?, ?, ?, 1, ?, ?, 'seed-admin.js')
    `).run(username, department, genericRank.id, username, hash);
    employeeId = info.lastInsertRowid;
    console.log(`Usuario "${username}" creado. Departamento: ${department}.`);
  }

  if (grantFullAccess) {
    const direccionRole = await db.prepare("SELECT id FROM employee_roles WHERE name = 'Dirección' AND department IS NULL").get();
    if (direccionRole) {
      await db.prepare('INSERT OR IGNORE INTO employee_role_links (employee_id, role_id) VALUES (?, ?)').run(employeeId, direccionRole.id);
      console.log('Se le asignó la división "Dirección" (acceso total al panel).');
    }
  } else {
    console.log('No se le asignó ninguna división todavía: para que entre al panel, asignale una desde Personal → editar empleado.');
  }
})();
