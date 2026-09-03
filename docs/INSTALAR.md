# Instalar y poner en marcha

## 1. Base de datos (Supabase, gratis)

1. [supabase.com](https://supabase.com) → *New project*. Anota la contraseña de la base.
2. *SQL Editor* → pega el contenido de [`plataforma/supabase/schema.sql`](../plataforma/supabase/schema.sql) → *Run*.
   Se puede volver a correr cuando se quiera: es idempotente.
3. *Project Settings → Database → Connection string* → pestaña **Transaction pooler** (puerto 6543). Esa es
   `DATABASE_URL`. Sustituye `[YOUR-PASSWORD]` por la contraseña.

Vale cualquier otro Postgres (Neon, Vercel Postgres, uno propio): el esquema es Postgres estándar. En
local: `PGHOST=... npm run db:aplicar`.

**Si ya tenías la versión anterior (turnos por médico):** el esquema v2 no convive con el v1. En el SQL
Editor corre primero [`reset-v1.sql`](../plataforma/supabase/reset-v1.sql) (borra turnos, muestras, eventos
y visitas v1; conserva la config del `.exe`, el secreto HMAC, el roster y las fases) y después
`schema.sql`. Los PCs se vuelven a registrar solos en su primer latido y quedan por asignar en Dispositivos.

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

Después, `set search_path to medicion, public, extensions;` + (`reset-v1.sql` si venías de la v1) + el
contenido de `schema.sql` + al final el bloque de dueño (está en `supabase/migracion-esquema-aparte.sql`,
listo para pegar). La `DATABASE_URL` queda
`postgres://medicion_app.<ref>:<clave>@aws-0-<region>.pooler.supabase.com:6543/postgres`
(si el proyecto está en el pooler `aws-1-…`, la plataforma lo prueba sola).

## 2. Plataforma (Vercel)

1. [vercel.com](https://vercel.com) → *Add New → Project* → importa este repositorio.
2. **Root Directory: `plataforma`** (importante).
3. *Environment Variables*:
   - `DATABASE_URL` — la del paso 1.
   - `MEDIDOR_API_KEY` — inventa una clave larga (p. ej. 40 caracteres aleatorios). La pondrás en los PCs.
   - `CRON_SECRET` — opcional; Vercel lo usa para el cron diario (06:30 Bogotá) que termina los resúmenes rezagados.
4. *Deploy*. Abre la URL. El panel **no pide contraseña**: quien tenga la dirección entra y puede
   editar la configuración. Si hace falta cerrarlo, se devuelve la barrera de `lib/acceso.ts`
   (está en el historial de git).
5. **Configuración → Consultorios**: vienen tres (`Consultorio 1/2/3`); renómbralos como los llama el
   hospital. **Fases**: por defecto hay un `baseline` desde el día en que se aplicó el esquema. Cuando entre
   Miracle, fija `notes` desde esa fecha (y después `notes_ops`). Las jornadas se re-etiquetan solas.
6. **Configuración → Nombres para usuarios SAP** (opcional): `Dra. Ana Gómez | AGOMEZ`, una por línea.
   Solo sirve para que el panel ponga nombre al usuario SAP visto en una jornada.

## 3. El `.exe` en cada PC

### Instalar: descargar y doble clic (30 segundos, sin administrador)

1. Descarga [`Medidor.exe`](../../releases/latest/download/Medidor.exe).
2. **Doble clic.**
3. Sale un aviso de que quedó instalado. Ya está midiendo (icono **ámbar**: le falta el consultorio).
4. En el panel, **Dispositivos** → el PC aparece por su nombre en ≤ 2 min → elige su consultorio → Guardar.
   El icono pasa a **verde** en el siguiente latido y muestra el nombre del consultorio.

El `.exe` se instala a sí mismo: se copia a `%LOCALAPPDATA%\Programs\Medidor`, se registra para
arrancar con la sesión de Windows, crea la tarea programada `Medidor-Vigilante` (por usuario, sin
administrador: lo lanza al iniciar sesión y cada 5 minutos; si ya corre no hace nada) y arranca. Trae
dentro la dirección del servidor y la clave, así que no hay nada que teclear. El que descargaste ya se
puede borrar.

Los PCs tienen **una sola cuenta de Windows compartida**: el arranque automático y la tarea son de esa
cuenta. Si un PC tuviera varias cuentas, habría que hacer el doble clic una vez con cada una.

Se registra solo en el servidor en su primer arranque, por nombre de máquina: reinstalar no duplica
el equipo en el panel ni pierde su consultorio.

**Actualizar** es lo mismo: descargar el nuevo y doble clic. Detiene la versión vieja, se reemplaza y
sigue. La identidad del equipo, el secreto y los datos pendientes de enviar se conservan.

**Quitar**: [`desinstalar.ps1`](../../releases/latest/download/desinstalar.ps1), clic derecho →
*Ejecutar con PowerShell*. Borra primero la tarea programada (si no, relanzaría el medidor a mitad).

### Casos que necesitan `instalar.ps1`

Solo dos: apuntar un PC a **otro servidor**, o usar un `.exe` **compilado desde el código** (que sale
sin clave a propósito).

```powershell
.\instalar.ps1 -Servidor "https://otro-servidor" -Clave "la-clave"
```

Si PowerShell bloquea el script: `powershell -ExecutionPolicy Bypass -File .\instalar.ps1 -Servidor ... -Clave ...`.

### Compilarlo tú mismo

```
dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true \
  -p:MedidorClavePorDefecto=LA_CLAVE -o salida medidor/App/App.csproj
```

Sale `salida/Medidor.exe` (~70 MB: lleva el runtime dentro, el PC no necesita .NET). Sin
`-p:MedidorClavePorDefecto` el `.exe` sale **sin clave**, a propósito — el repositorio no contiene
ninguna credencial. Ese `.exe` funciona igual, pero hay que dársela con `instalar.ps1`. Para probarlo desde
`bin/` sin que se instale ni registre la tarea: `MEDIDOR_SIN_INSTALAR=1`.

En GitHub la clave vive como secreto del repositorio (`MEDIDOR_CLAVE`, en *Settings → Secrets and
variables → Actions*) y el CI la inyecta al publicar cada versión.

### El icono

| Color | Significa | Qué hacer |
|---|---|---|
| ámbar | midiendo, pero el PC no tiene consultorio asignado | en el panel, Dispositivos → asignar |
| verde | midiendo en su consultorio | nada |
| oscuro | sin conexión con el servidor (se guarda en el PC y se sube después) | revisar red / la clave |

Menú (clic en el icono): el estado (p. ej. *Consultorio 2 · midiendo*) · *¿Qué mide esto?* · *Ver el
panel en el navegador*. **No hay Pausar ni Salir**: el medidor mide el consultorio de forma continua
durante el estudio; para detenerlo se pausa o retira el PC desde el panel, o se desinstala.

## Requisito para ver las pantallas de SAP

El medidor lee la identidad de la pantalla por **SAP GUI Scripting**. Hace falta:

1. En el servidor SAP: parámetro `sapgui/user_scripting = TRUE` (lo pone Basis, transacción RZ11).
2. En el SAP GUI del PC: *Opciones → Accessibility & Scripting → Scripting* → habilitado; conviene desmarcar
   «Notificar cuando un script se conecte» para que no salga el aviso a cada rato.

**Sin esto el medidor sigue midiendo** el tiempo en SAP como aplicación, clics y tecleo, pero no las
pantallas, ni las esperas, ni los pacientes. El panel lo dice como alerta («SAP GUI Scripting no
disponible») y la jornada lo lleva en su calidad (`sap_scripting = false`).

## Verificar en el primer PC (la lista de lo que solo se puede probar allí)

Pega el resultado (con horas) donde se lleve el registro del despliegue.

1. **Arranca y se ve**: tras el doble clic, el círculo aparece en la bandeja. Log en
   `%LOCALAPPDATA%\Medidor\logs\medidor-AAAAMMDD.log`: debe decir `registro: ok · config vN` y
   `instalador: tarea Medidor-Vigilante registrada`. `schtasks /Query /TN Medidor-Vigilante` la muestra.
   Si la política del hospital no deja crear tareas, el log lo dice y el medidor sigue con las otras
   tres capas (el latido dirá `vigilante=no`).
2. **Llega al servidor**: en *Dispositivos* aparece el PC «activo» en ≤ 2 min. Asígnale el consultorio: en
   ≤ 2 min el icono pasa a verde y el tooltip dice el nombre.
3. **Ganchos**: el latido del log (cada 5 min) dice `ganchos=ok`. Si dice `degradados`, el antivirus bloqueó
   `SetWindowsHookEx`: el medidor sigue (activo/inactivo por último input) pero sin contar clics ni
   teclas, y la jornada lo marca (alerta en Inicio).
4. **SAP**: con SAP delante, el log dice `sap: enganchado al motor de scripting`. Abre una pantalla de
   paciente: en ≤ 2 min el día del consultorio muestra visitas SAP y un paciente (huella). Si no hay
   `sap_eventos_com` en la calidad de la jornada, la espera y el time-to-ready de SAP quedarán en cero:
   avísalo, es lo único del instrumento que no se pudo comprobar sin un SAP real.
5. **La regla del paciente**: si hay visitas pero `pacientes = 0` y aparecen eventos `encounter_unknown`,
   el título de la ventana SAP no contiene el identificador con la forma que espera la regla
   (`reglas_identidad` en Configuración). Mira el título de SAP con el paciente abierto y ajusta la
   regex; los PCs la reciben al minuto.
6. **Bloqueo**: Win+L un minuto y desbloquea. La línea de tiempo del día pinta el tramo como bloqueado y los
   eventos `lock`/`unlock` aparecen. El medidor nunca dejó de grabar.
7. **Convive con U.exe**: si el asistente Ü está instalado, los dos hablan con SAP por scripting; el
   medidor salta el tick cuando SAP está ocupado (`ticks_sap_saltados_busy` en la calidad de la jornada).
8. **Vuelve solo**: cierra el proceso desde el Administrador de tareas. En ≤ 5 min el icono está de vuelta
   (log `arrancando … modo=Vigilante`), la jornada del panel dice `procesos = 2`, y no hay muestras
   duplicadas (idempotencia por clave natural).
9. **Reinicio del PC**: apaga y enciende. Al entrar a la sesión el icono aparece en ~1 minuto y la línea de
   tiempo muestra el hueco como «sin datos» (rayado), no como tiempo trabajado.

## Diagnóstico

El log es la fuente de verdad. Líneas útiles:

| Línea | Significa |
|---|---|
| `arrancando vN pid=… proceso=… modo=Normal|Vigilante|Relanzado` | quién lo arrancó |
| `ajustes: leídos de …` | de dónde tomó servidor y clave |
| `registro: sin red o servidor caído` / `rechazado (401)` | no llega al servidor / clave mal |
| `registro: ok · config vN · hmac vN` | registrado |
| `instalador: tarea Medidor-Vigilante registrada` / `no se pudo crear la tarea (…)` | el vigilante |
| `vivo · dia … · consultorio … · ganchos=ok(rearmados n) · sap=motor:sí eventos:no · spool=… · vigilante=sí` | el latido de cada 5 min |
| `ganchos: degradado a GetLastInputInfo…` / `ganchos: rearmados (n)` | el antivirus no dejó los ganchos / Windows los quitó y se volvieron a poner |
| `sap: enganchado al motor de scripting` / `sap: se soltó el motor (…)` | ve pantallas SAP / SAP se cerró; reintenta solo |
| `jornada: nueva AAAA-MM-DD` | el cambio de día a las 06:00 |
| `subidor: subido: N jornadas · N muestras …` | lo que salió en cada latido |
| `subidor: veneno sacado: muestras#N` | una fila que el servidor rechazó (ver `rechazadas` en el servidor) |
| `fatal: …` seguido de `arrancando … modo=Relanzado` | se cayó y volvió solo |
| `spool: archivo corrupto apartado a spool.corrupto-…` | la cola local se recreó |

En el servidor: *Inicio* muestra cada consultorio con su estado actual y alertas («PC callado hace N min»
si lleva > 20 min sin latir: silencio = medidor muerto o PC apagado, porque el latido sale cada minuto
aunque el PC esté quieto).

## Actualizar el `.exe`

Descargar el nuevo `Medidor.exe` y doble clic: cierra el proceso, reemplaza y arranca. La identidad, el
secreto, el consultorio y el spool se conservan.
