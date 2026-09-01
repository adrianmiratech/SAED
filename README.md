# SAED - Gestión de Postulaciones

Web para gestionar las postulaciones a los departamentos de emergencia de San Andreas, coordinados por el SAED
(San Andreas Emergency Departments): **SAMS** (San Andreas Medical Services) y **Bomberos**.

- `/` — formulario público de postulación, con selección de departamento (SAMS o Bomberos).
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

## Crear el usuario admin

```bash
node scripts/seed-admin.js admin "tu-contraseña-segura"
```

Podés correr este comando de nuevo con el mismo usuario para cambiarle la contraseña, o con otro usuario para crear más cuentas de staff.

## Correr la web

```bash
npm start
```

Por defecto queda disponible en http://localhost:3000

## Publicarla gratis en Fly.io

El repo ya incluye `Dockerfile` y `fly.toml` listos para desplegar. Fly.io construye la imagen en la nube, así que no
hace falta tener Docker instalado localmente.

1. Instalá flyctl (PowerShell):
   ```powershell
   iwr https://fly.io/install.ps1 -useb | iex
   ```
   Cerrá y volvé a abrir la terminal para que quede en el PATH.

2. Iniciá sesión (abre el navegador, es gratis, puede pedir una tarjeta solo para verificar que no sos un bot, no cobra nada en el plan free):
   ```bash
   fly auth login
   ```

3. Creá la app (elegí un nombre único, por ejemplo `saed-postulaciones-tuservidor`) y el volumen donde vive la SQLite:
   ```bash
   fly apps create saed-postulaciones-tuservidor
   fly volumes create sams_data --region eze --size 1 -a saed-postulaciones-tuservidor
   ```
   Editá `fly.toml` y descomentá/completá la línea `app = "..."` con el mismo nombre.

4. Cargá los secretos (no van en el repo):
   ```bash
   fly secrets set SESSION_SECRET="un-texto-largo-y-aleatorio" DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..." -a saed-postulaciones-tuservidor
   ```

5. Desplegá:
   ```bash
   fly deploy -a saed-postulaciones-tuservidor
   ```

6. Creá el usuario admin dentro del contenedor ya desplegado:
   ```bash
   fly ssh console -a saed-postulaciones-tuservidor -C "node scripts/seed-admin.js admin tu-contraseña-segura"
   ```

Tu web queda disponible en `https://saed-postulaciones-tuservidor.fly.dev`. El free tier de Fly.io incluye hasta 3
VMs compartidas y 3GB de volumen persistente, así que la base SQLite sobrevive redeploys y reinicios.
