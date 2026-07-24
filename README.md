# SEGTEC — Lista de precios pública

Registro con aprobación manual + verificación de email, catálogo con comparador,
solicitud de presupuesto por mail a `ventas02@segtec.com.ar`, y panel de administración.

## Qué incluye

```
netlify.toml                 → config de Netlify (rutas /api/* y carpeta publish)
package.json                 → dependencias (pg, bcryptjs, jsonwebtoken, nodemailer)
schema.sql                   → esquema de base de datos (Postgres)
scripts/seed-admin.js        → crea tu primer usuario administrador
tests/run_tests.js           → batería de 25 pruebas (ya corrida y verificada)
netlify/functions/           → todo el backend (16 funciones)
public/
  register.html                → formulario de solicitud de acceso
  verificar.html                → confirma el email tras registrarse
  login.html                     → login del cliente aprobado
  olvide-contrasena.html          → pedir link de recupero
  restablecer.html                 → elegir nueva contraseña
  catalog.html                      → el catálogo con comparador y pedido de presupuesto
  admin.html                         → tu panel: aprobar/rechazar accesos, ver presupuestos
  robots.txt                          → bloquea la indexación en buscadores
```

## Paso 1 — Crear el sitio en Netlify

Igual que hicimos con `segtec-interna`: subís esta carpeta a un repositorio de GitHub
(sin la carpeta `node_modules`) y la conectás desde **Add new site → Import an existing project**.
Netlify va a leer `netlify.toml` solo — no hace falta tocar nada en "Build settings".

## Paso 2 — Crear la base en Neon

Mismo procedimiento que ya hicimos: entrá a [neon.com](https://neon.com), creá un
proyecto nuevo (puede ser el mismo que usás para `segtec-interna` con una base
distinta, o uno aparte — cualquiera de las dos formas funciona), copiá la
**connection string**.

## Paso 3 — Variables de entorno en Netlify

En **Site configuration → Environment variables**, cargá:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | la connection string que copiaste de Neon |
| `JWT_SECRET` | una clave larga y random (generá una distinta a la de `segtec-interna`) |
| `ADMIN_NOTIFY_EMAIL` | tu mail, donde querés que te avisen las nuevas solicitudes |
| `QUOTES_EMAIL` | `ventas02@segtec.com.ar` |
| `SITE_URL` | `https://listadeprecios.segtec.com.ar` (o la URL de Netlify mientras no conectes el dominio) |
| `SMTP_HOST` | `smtp.gmail.com` |
| `SMTP_PORT` | `587` |
| `SMTP_USER` | `ventas02@segtec.com.ar` |
| `SMTP_PASS` | ver Paso 4 — **no es la contraseña normal de la cuenta** |
| `FROM_EMAIL` | `ventas02@segtec.com.ar` |

## Paso 4 — Generar la "Contraseña de aplicación" de Google

Como `ventas02@segtec.com.ar` es una casilla de Google Workspace, no podés usar la
contraseña normal para que el sistema mande mails — Google lo bloquea por seguridad.
Hay que generar una **contraseña de aplicación** específica para esto:

1. Entrá a la cuenta de Google de `ventas02@segtec.com.ar`
2. Andá a [myaccount.google.com/security](https://myaccount.google.com/security)
3. Activá la **verificación en dos pasos** si todavía no la tiene activada (es requisito para el paso siguiente)
4. Buscá **"Contraseñas de aplicaciones"** (a veces está en myaccount.google.com/apppasswords)
5. Creá una nueva, ponele un nombre como "SEGTEC Lista Precios"
6. Te da un código de 16 letras — **ese** es el valor que va en `SMTP_PASS` (sin espacios)

Si tu administrador de Google Workspace tiene restringido el acceso a contraseñas de
aplicaciones para la organización, va a tener que habilitarlo para esa casilla puntual,
o alternativamente puedo adaptar el envío para usar la API de Gmail con OAuth (más
seguro pero más largo de configurar) — avisame si es el caso.

## Paso 5 — Cargar el esquema de la base

Igual que con el otro sitio: entrá al **SQL Editor** de Neon, pegá el contenido
completo de `schema.sql` y ejecutalo.

## Paso 6 — Crear tu usuario administrador

```bash
cd segtec-publica
npm install
export DATABASE_URL="LA_URL_DE_NEON"
npm run seed-admin -- "Rafa" "rafa@segtec.com.ar" "tu-contraseña-segura"
```

## Paso 7 — Deploy

```bash
git push
```

## Paso 8 — Probar el flujo completo

1. `https://tu-sitio.netlify.app/register.html` — registrate con un mail tuyo de prueba
2. Revisá que te llegue el mail de confirmación (si no configuraste SMTP todavía, el
   sistema no rompe pero tampoco manda nada — vas a necesitar sacar el token directo
   de la base para probar, o completar el Paso 4 primero)
3. Confirmá el email, andá a `/admin.html`, logueate con tu usuario admin y aprobá esa
   solicitud de prueba
4. Con esa cuenta aprobada, entrá a `/login.html`, después a `/catalog.html`
5. Seleccioná un par de productos y pedí un presupuesto — confirmá que llega el mail a
   `ventas02@segtec.com.ar`
6. Volvé a `/admin.html`, pestaña "Presupuestos", y confirmá que aparece

## Dominio propio

Mismo procedimiento que con `segtec-interna`: **Domain management → Add a domain**,
`listadeprecios.segtec.com.ar`, cargar los registros DNS que te da Netlify.

## Sobre `robots.txt`

Ya viene bloqueando toda indexación (`Disallow: /`), como pediste. Si en algún momento
querés que el sitio sí aparezca en buscadores, hay que editar ese archivo.

## Si algo falla

- **Los mails no llegan** → revisá que las 5 variables `SMTP_*` estén bien cargadas y
  que la contraseña de aplicación sea la de 16 letras, no la contraseña normal
- **"Falta configurar DATABASE_URL"** → falta cargar esa variable en Netlify
- **Un cliente dice que no le llegó el mail de confirmación** → puede estar en spam;
  también podés revisar directo en la base (tabla `email_verification_tokens`) si el
  token se generó

## Actualizar el catálogo (ya construido)

Desde `/admin.html`, pestaña **Catálogo**: subís el Excel, el sistema te muestra
qué cambió (productos nuevos, eliminados, precios, fotos) comparado con lo que
está publicado ahora, y con un botón confirmás y se publica al instante — sin
necesidad de tocar código ni volver a desplegar.

**Detalle técnico importante:** como tus archivos pesan 24-40MB por las fotos
incluidas, y Netlify limita a ~4.5MB lo que se puede mandar de una sola vez a
una función, la subida se hace **en partes** (unos 3MB cada una) que se van
juntando en la base de datos hasta tener el archivo completo, recién ahí se
procesa. Esto ya está probado con tus archivos reales — uno de 40MB se parte en
13 pedazos, sube sin problema y tarda unos segundos en analizarse. No tenés que
hacer nada distinto vos: elegís el archivo y el sistema se encarga del resto,
solo vas a ver una barra de progreso ("Subiendo parte 4 de 13...").


