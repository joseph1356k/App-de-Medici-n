# Instalar y poner en marcha

## 1. Base de datos (Supabase, gratis)

1. [supabase.com](https://supabase.com) → *New project*. Anota la contraseña de la base.
2. *SQL Editor* → pega el contenido de [`plataforma/supabase/schema.sql`](../plataforma/supabase/schema.sql) → *Run*.
   Se puede volver a correr cuando se quiera: es idempotente.
3. *Project Settings → Database → Connection string* → pestaña **Transaction pooler** (puerto 6543). Esa es
   `DATABASE_URL`. Sustituye `[YOUR-PASSWORD]` por la contraseña.

Vale cualquier otro Postgres (Neon, Vercel Postgres, uno propio): el esquema es Postgres estándar. En
local: `PGHOST=... npm run db:aplicar`.

**Opción B — sin proyecto nuevo (el plan gratis de Supabase permite 2 activos):** el medidor vive en
un **esquema aparte** (`medicion`) dentro de un proyecto que ya exista, con su propio usuario. Nada
del proyecto original se toca: distinto esquema, distinto rol, y la API pública de Supabase no expone
ese esquema. En el SQL Editor del proyecto:

```sql
create role medicion_app with login password 'UNA-CLAVE-LARGA' nosuperuser nocreatedb nocreaterole noinherit;
grant medicion_app to postgres;
create schema medicion authorization medicion_app;
grant usage on schema extensions to medicion_app;
alter role medicion_app set search_path = medicion, public, extensions;
```

Después, `set search_path to medicion, public, extensions;` + el contenido de `schema.sql` + al final
el bloque de dueño (está en `supabase/migracion-esquema-aparte.sql`, listo para pegar). La
`DATABASE_URL` queda `postgres://medicion_app.<ref>:<clave>@aws-0-<region>.pooler.supabase.com:6543/postgres`
(si el proyecto está en el pooler `aws-1-…`, la plataforma lo prueba sola).

## 2. Plataforma (Vercel)

1. [vercel.com](https://vercel.com) → *Add New → Project* → importa este repositorio.
2. **Root Directory: `plataforma`** (importante).
3. *Environment Variables*:
   - `DATABASE_URL` — la del paso 1.
   - `MEDIDOR_API_KEY` — inventa una clave larga (p. ej. 40 caracteres aleatorios). La pondrás en los PCs.
   - `PANEL_PASSWORD` — la contraseña del panel.
   - `CRON_SECRET` — opcional; Vercel lo usa para el cron diario (06:00 UTC) que recalcula resúmenes rezagados.
4. *Deploy*. Abre la URL → `/entrar` → contraseña.
5. **Configuración** → escribe los médicos, uno por línea: `Dra. Ana Gómez | AGOMEZ` (después de `|`, sus
   usuarios de SAP; opcional pero con ellos el turno se asigna solo).
6. **Configuración → Fases**: por defecto hay un `baseline` desde el día en que se aplicó el esquema.
   Cuando entre Miracle, fija `notes` desde esa fecha (y después `notes_ops`). Los turnos se re-etiquetan
   solos según el calendario.

## 3. El `.exe` en cada PC

### Conseguir `Medidor.exe`

- **Desde GitHub Actions**: en la pestaña *Actions* del repo, la última corrida verde tiene el artefacto
  **`Medidor-win-x64`** (un zip con `Medidor.exe`, `instalar.ps1` y `desinstalar.ps1`).
- **O compilarlo** (en Windows, Linux o Mac con el SDK de .NET 8):
  ```
  dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o out medidor/App/App.csproj
  ```
  Sale `out/Medidor.exe` (~70 MB: lleva el runtime dentro, el PC no necesita .NET).

### Instalar (sin administrador)

En el PC, en PowerShell, en la carpeta con `Medidor.exe` e `instalar.ps1`:

```powershell
.\instalar.ps1 -Servidor "https://TU-PROYECTO.vercel.app" -Clave "LA_MEDIDOR_API_KEY"
```

Si PowerShell bloquea el script: `powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -Servidor ... -Clave ...`.

Qué hace: copia el .exe a `%LOCALAPPDATA%\Programs\Medidor`, escribe `%APPDATA%\Medidor\medidor.json`
con servidor y clave, lo registra para arrancar con la sesión de Windows y lo arranca. El PC se registra
solo en el servidor en el primer arranque (por nombre de máquina; reinstalar no duplica).

Quitar: `.\desinstalar.ps1`.

### El icono

| Color | Significa | Qué hacer |
|---|---|---|
| ámbar | midiendo, sin médico elegido | clic → elige tu nombre |
| verde | midiendo el turno de X | nada |
| gris | pausado | clic → *Reanudar* |
| oscuro | sin conexión con el servidor (se guarda en el PC y se sube después) | revisar red / la clave |

Menú (clic en el icono): nombres del roster · *Cerrar mi turno* · *Pausar* · *¿Qué mide esto?* · *Ver el
panel* · *Salir*.

## Requisito para ver las pantallas de SAP

El medidor lee la identidad de la pantalla por **SAP GUI Scripting**. Hace falta:

1. En el servidor SAP: parámetro `sapgui/user_scripting = TRUE` (lo pone Basis, transacción RZ11).
2. En el SAP GUI del PC: *Opciones → Accessibility & Scripting → Scripting* → habilitado; conviene desmarcar
   «Notificar cuando un script se conecte» para que no salga el aviso a cada rato.

**Sin esto el medidor sigue midiendo** el tiempo en SAP como aplicación, clics y tecleo, pero no las
pantallas, ni las esperas, ni los pacientes. En el panel se nota porque el turno tiene `visitas = 0`.

## Verificar en el primer PC (la lista de lo que solo se puede probar allí)

Pega el resultado (con horas) donde se lleve el registro del despliegue.

1. **Arranca y se ve**: tras `instalar.ps1`, el círculo aparece en la bandeja. Log en
   `%LOCALAPPDATA%\Medidor\logs\medidor-AAAAMMDD.log`: debe decir `registro: ok · config vN · roster N`.
2. **Llega al servidor**: en *Dispositivos* aparece el PC «activo» en ≤ 2 min.
3. **Ganchos**: el log dice `ganchos=ok`. Si dice `degradado`, el antivirus bloqueó `SetWindowsHookEx`: el
   medidor sigue (activo/inactivo por último input) pero sin contar clics ni teclas, y el turno lo marca.
4. **SAP**: con SAP delante, el log dice `sap: enganchado al motor de scripting`. Abre una pantalla de
   paciente: en ≤ 2 min el turno en el panel muestra visitas SAP y un paciente (huella).
5. **La regla del paciente**: si hay visitas pero `pacientes = 0`, el título de la ventana SAP no
   contiene el identificador con la forma que espera la regla (`reglas_identidad` en Configuración).
   Mira el título de SAP con el paciente abierto y ajusta la regex; los PCs la reciben al minuto.
6. **Selector y usuario SAP**: elige tu nombre en el icono → el turno del panel muestra el médico. Si en
   Configuración pusiste el usuario SAP, al abrir SAP el turno se asigna solo.
7. **Convive con U.exe**: si el asistente Ü está instalado, los dos hablan con SAP por scripting; el
   medidor salta el tick cuando SAP está ocupado (`ticks_sap_saltados_busy` en la calidad del turno).
8. **Sobrevive a un kill**: cierra el proceso desde el Administrador de tareas a mitad de turno y vuelve
   a abrirlo: no se duplican muestras (idempotencia por clave natural) y el turno anterior queda cerrado
   como `apagado`.

## Diagnóstico

El log es la fuente de verdad. Líneas útiles:

| Línea | Significa |
|---|---|
| `ajustes: leídos de …` | de dónde tomó servidor y clave |
| `registro: sin red o servidor caído` / `rechazado (401)` | no llega al servidor / clave mal |
| `registro: ok · config vN · roster N · hmac vN` | registrado |
| `ganchos: degradado a GetLastInputInfo…` | el antivirus no dejó los ganchos |
| `sap: enganchado al motor de scripting` | ve pantallas SAP |
| `sap: se soltó el motor (…)` | SAP se cerró; reintenta solo |
| `turno: abierto … / cerrado … causa=…` | el ciclo del turno |
| `subidor: subido: N turnos · N muestras …` | lo que salió en cada latido |
| `subidor: veneno sacado: …` | una fila que el servidor rechazó (ver `rejected` en el servidor) |

En el servidor: *Dispositivos* muestra «callado» si un PC lleva > 20 min sin latir (el latido sale cada
minuto aunque el PC esté quieto: silencio = medidor muerto o PC apagado).

## Actualizar el `.exe`

Volver a correr `instalar.ps1` con el nuevo `Medidor.exe`: cierra el proceso, reemplaza y arranca. La
identidad, el secreto y el spool se conservan.
