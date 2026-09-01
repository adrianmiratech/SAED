// Crea o actualiza la contraseña de un usuario admin.
// Uso: node scripts/seed-admin.js <usuario> <contraseña>
require('dotenv').config();
const bcrypt = require('bcryptjs');
const db = require('../db');

const username = process.argv[2] || process.env.ADMIN_USER;
const password = process.argv[3];

if (!username || !password) {
  console.error('Uso: node scripts/seed-admin.js <usuario> <contraseña>');
  process.exit(1);
}

const hash = bcrypt.hashSync(password, 10);

const existing = db.prepare('SELECT id FROM admins WHERE username = ?').get(username);
if (existing) {
  db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(hash, username);
  console.log(`Contraseña actualizada para el usuario "${username}".`);
} else {
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(username, hash);
  console.log(`Usuario admin "${username}" creado.`);
}
