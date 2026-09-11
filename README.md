# SAED - Gestión Sanitaria y de Emergencias Integral

Sistema de gestión para los departamentos de emergencia de San Andreas, coordinados por el SAED
(San Andreas Emergency Departments): **SAMS** (San Andreas Medical Services) y **SAFD** (San Andreas Fire Department).

- `/` — formulario público de postulación, con selección de departamento (SAMS o SAFD).
- `/login.html` — **login único** para todo el mundo: la misma cuenta sirve para fichar y, si tiene permisos, para
  entrar al panel de gestión. No hay logins separados.
- `/admin.html` — panel único al que entra cualquier persona logueada. Qué ve depende de su nivel de acceso:
  - **Mi Fichaje** (todos): marcar la propia entrada/salida y ver el propio historial.
  - **Postulaciones** (staff): ver, filtrar (por departamento y estado), aprobar/rechazar/marcar en revisión, anotar y exportar a CSV.
  - **Personal** (staff): roster de empleados por rango (tablero Kanban), **roles/divisiones** (ej: RTD, Recursos Humanos, Dirección, Estudiantes) como etiqueta adicional al rango, la cuenta de acceso de cada empleado (usuario/contraseña) y su **nivel de acceso** (staff / superadmin / RRHH-Dirección), y nómina.
  - **Fichajes** (superadmin o con el permiso de RRHH/Dirección): control de entrada/salida de todo el personal.
  - **Inventario** (staff): stock de insumos y medicamentos por departamento, con umbral de stock mínimo y registro de movimientos.
  - **Atenciones** (staff): fichas de pacientes atendidos por SAMS e informes de intervención de SAFD, con responsable, estado (abierta/cerrada) e insumos utilizados.

Cada postulación se guarda en una base de datos (Turso/SQLite) junto con el departamento elegido, y además se sigue
enviando como embed al webhook de Discord configurado. Al aprobar una postulación, la persona pasa automáticamente
al roster de Personal con el rango asignado; desde ahí se le puede dar de alta una cuenta (usuario/contraseña) para
que entre a `/login.html` y ficha su entrada/salida. Si además necesita entrar al panel de gestión, un superadmin le
marca "Staff" (y opcionalmente "Superadmin" o "Acceso a Fichajes") desde su ficha en Personal.

## Instalación

```bash
npm install
copy .env.example .env    # en PowerShell: Copy-Item .env.example .env
```

Editá `.env` y completá `SESSION_SECRET` con un texto largo aleatorio. `DISCORD_WEBHOOK_URL` ya viene con el webhook actual.

## Crear el primer superadmin

```bash
node scripts/seed-admin.js admin "tu-contraseña-segura"
```

Este comando crea (o actualiza) directamente un empleado con acceso de staff. Sin departamento, el usuario es
**superadmin**: ve y gestiona todo (ambos departamentos, staff, tarifas, roles). Para uno restringido a un solo
departamento (por ejemplo, un coordinador de SAMS que no debería ver nada de SAFD), agregá el departamento como
tercer argumento:

```bash
node scripts/seed-admin.js coord-sams "otra-contraseña-segura" sams
node scripts/seed-admin.js coord-safd "otra-contraseña-segura" safd
```

Podés correr el comando de nuevo con el mismo usuario para cambiarle la contraseña o el departamento asignado. Una
vez que hay un superadmin, el resto del staff se da de alta desde el propio panel (Personal → editar empleado →
Nivel de acceso), sin necesitar la consola.

## Correr la web

```bash
npm start
```

Por defecto queda disponible en http://localhost:3000

## Publicarla gratis en Fly.io

El repo incluye `Dockerfile` y `fly.toml` listos para desplegar desde el dashboard de Fly.io ("Launch an App from
GitHub"), sin necesitar Docker ni flyctl instalados localmente.

**Nota:** esta configuración guarda la SQLite dentro del propio contenedor, sin volumen persistente. Es decir, los
datos sobreviven mientras la máquina esté corriendo o solo detenida, pero **se pierden en cada redeploy** (cada
`git push`). Es la opción elegida para un despliegue temporal / de prueba. Si más adelante se necesita que las
postulaciones no se pierdan entre redeploys, hay que volver a agregar un volumen persistente (`fly volumes create`)
y montar `DB_PATH` sobre él.

Pasos:

1. En https://fly.io/dashboard → "Launch an App" → "Deploy from GitHub" → elegí este repo.
2. Dejá "Managed Postgres" sin marcar.
3. En "Config path" escribí `fly.toml` (no lo dejes vacío ni en `./`).
4. Lanzá. Una vez creada la app, cargá los secrets en la pestaña **Secrets**: `SESSION_SECRET` y `DISCORD_WEBHOOK_URL`.
5. Creá los usuarios de staff desde la consola web de la app (pestaña **Console** en el dashboard):
   ```bash
   node scripts/seed-admin.js admin tu-contraseña-segura
   node scripts/seed-admin.js coord-sams otra-contraseña sams
   ```
   Como no hay volumen persistente, hay que repetir este paso después de cada redeploy.
