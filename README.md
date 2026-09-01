# SAED - Gestión de Postulaciones

Web para gestionar las postulaciones a los departamentos de emergencia de San Andreas, coordinados por el SAED
(San Andreas Emergency Departments): **SAMS** (San Andreas Medical Services) y **SAFD** (San Andreas Fire Department).

- `/` — formulario público de postulación, con selección de departamento (SAMS o SAFD).
- `/login.html` — login del staff.
- `/admin.html` — panel para ver, filtrar (por departamento y por estado), aprobar/rechazar y anotar postulaciones (requiere login).

Cada postulación se guarda en una base de datos local (SQLite) junto con el departamento elegido, y además se sigue
enviando como embed al webhook de Discord configurado.

## Instalación

```bash
npm install
copy .env.example .env    # en PowerShell: Copy-Item .env.example .env
```

Editá `.env` y completá `SESSION_SECRET` con un texto largo aleatorio. `DISCORD_WEBHOOK_URL` ya viene con el webhook actual.

## Crear usuarios de staff

```bash
node scripts/seed-admin.js admin "tu-contraseña-segura"
```

Ese usuario ve y gestiona postulaciones de **todos** los departamentos (staff del SAED). Para crear un usuario
restringido a un solo departamento (por ejemplo, un coordinador de SAMS que no debería ver las postulaciones de
SAFD), agregá el departamento como tercer argumento:

```bash
node scripts/seed-admin.js coord-sams "otra-contraseña-segura" sams
node scripts/seed-admin.js coord-safd "otra-contraseña-segura" safd
```

Podés correr el comando de nuevo con el mismo usuario para cambiarle la contraseña o el departamento asignado.

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
