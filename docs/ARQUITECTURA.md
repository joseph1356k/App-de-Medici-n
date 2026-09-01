# Arquitectura

## El problema que resuelve

Demostrar con datos propios cuánto trabajo operativo elimina Miracle en urgencias, midiendo **antes**
(baseline, esta semana) y **después** (Notes; Notes + Operations) con el **mismo instrumento**. Las
métricas: tiempo activo en el PC y en el HIS (SAP), escritura, clics, cambios de contexto, pantallas
SAP recorridas, espera de SAP, time-to-ready, trabajo post-atención, por turno y por consulta. Sin
contenido clínico. En PCs compartidos, con Windows, con el asistente Ü ya instalado al lado.

## Las piezas y el flujo

```
┌─ PC del médico ───────────────────────────────────────────────┐   HTTPS, X-API-Key, 1 lote/min
│  Medidor.exe (net8.0-windows, Win32 puro, sin WPF)             │ ─────────────────────────────►  plataforma/ (Next.js 15, Vercel)
│   ├ VentanaOculta: bomba de mensajes, relojes, bandeja, WTS    │                                  ├ /api/medidor/registro   identidad + secreto + config + roster
│   ├ Ganchos LL: clics/scroll/instantes de tecla (jamás la tecla)│                                  ├ /api/medidor/config     refresco versionado
│   ├ SondaPrimerPlano: proceso delante (+ host del navegador)   │                                  ├ /api/medidor/lote       ingesta idempotente, rejected[] por fila,
│   ├ HiloSap (STA): identidad SAP por COM, disciplina Busy      │                                  │                         resumen del turno al instante
│   ├ Orquestador (1 s): normaliza → encounter → cubetas 15 s    │                                  ├ /api/export/*           CSV · JSON · NDJSON · dataset con _leeme
│   ├ Dominio (puro, 21 promesas): Reloj, Actividad, Escritura,  │                                  └ panel (clave): resumen · turnos · turno · comparación ·
│   │   Cubetas, Huella HMAC, Sesionizador, Viaje SAP, Calidad   │                                     SAP · dispositivos · configuración · exportar
│   ├ SpoolSqlite: durable, ack antes de borrar, tope 200 MB     │                                              │
│   └ Subidor (1 min, hilo de fondo)                             │                                              ▼
└────────────────────────────────────────────────────────────────┘                                  Postgres (Supabase): settings · roster · study_phases ·
                                                                                                    devices · shifts · samples · events · sap_visits · shift_summary
```

## Decisiones, y por qué

**Un `.exe` aparte de U.exe.** El asistente es producto; esto es el instrumento del estudio. Conviven
en el mismo PC y no comparten código: este repo es autocontenido.

**Win32 puro, sin WPF ni WinForms.** Es lo que hace que el `.exe` **compile y se publique desde
Linux** (CI incluido): con WPF hacía falta una máquina Windows con el SDK de escritorio, y «no se pudo
compilar» era la excusa para que el instrumento nunca existiera. La UI es un icono de bandeja
(`Shell_NotifyIcon`), un menú (`TrackPopupMenu`) y cuadros de mensaje. Nada más hace falta.

**Dominio puro con contrato.** Todo lo que se puede juzgar sin pantalla vive en `medidor/Dominio` y lo
juzgan 21 promesas que corren en menos de un segundo, en Linux. Las seis primeras son de privacidad y
van primero a propósito. Un medidor que cuenta mal no se nota (los números «se ven normales»), y aquí
contar mal contamina un baseline que no se puede volver a medir.

**Sin códigos de enrolamiento.** La clave de la API ya autentica la instalación; el PC se registra por
nombre de máquina y guarda su `device_id`. Reinstalar no duplica. Un PC se pausa o retira desde el
panel.

**Turnos, no sesiones de Windows.** Los PCs son compartidos con sesión común. El médico elige su
nombre en el icono (o el medidor lo reconoce por su usuario de SAP, si está en el roster). Un turno sin
médico **mide igual**; se puede asignar mientras esté abierto, nunca después. Cierre por causa escrita:
manual, 4 h sin input, 2 h bloqueado, otro médico, apagado.

**Cubetas de 15 s, deltas, nunca totales.** Cada milisegundo cae en exactamente una cubeta alineada al
reloj de pared; la cubeta se parte al cambiar app, pantalla o paciente. Un tick jamás aporta más de
2 s (despertar de una suspensión no regala horas). Idempotencia por `(shift_id, bucket_start, seq)`.

**El paciente es una huella.** Regla remota (regex sobre el título de SAP, o un campo por selector) →
normalizar → HMAC-SHA256 con clave por día operativo (corte 06:00, fijada al abrir el turno) → soltar
el crudo. Pseudonimización, no anonimización: el secreto vive en el servidor para que todos los PCs
deriven la misma huella. Ver `docs/PRIVACIDAD.md`.

**Spool durable.** SQLite con WAL. Lo tomado sin confirmar se vuelve a entregar idéntico; se borra
solo tras el 200; el tope descarta lo más viejo **contando** cada descarte (y eso marca el turno como
no comparable). Una fila que el servidor rechaza sale del spool en vez de atascar la cola para siempre.

**Un Postgres, sin service-role en el panel.** La API escribe con `DATABASE_URL`; RLS activado sin
políticas por si el Postgres es Supabase (la REST pública no puede leer). El panel se protege con una
contraseña y una cookie HMAC; las exportaciones aceptan `?clave=` para pegarlas en una herramienta.

**Resumen al instante.** El lote recalcula `shift_summary` de los turnos tocados: el panel va a un
minuto del terreno sin cron. El cron diario solo recoge rezagados. `algo_version` permite recomputar
todo si cambia una definición (`/api/tareas/resumir?todo=1`).

**Calidad como filtro, no como nota al pie.** `calidad_ok` = cobertura ≥ 85 % y sin saltos de reloj y sin
descartes. Las comparaciones excluyen los demás por construcción; el bloque de cobertura del panel dice
cuántos se excluyeron antes de mostrar ningún número.

## Lo que promete el contrato (`medidor/Contrato`)

1-6 privacidad (título jamás en el lote; apps fuera de lista = «otro»; SAP sin `vista:` ni título; solo
la huella; clave por día operativo fijada al abrir; misma persona misma huella) · 7-9 reloj y actividad
(tick ≤ 2 s; activo = input en 60 s; escritura por ráfagas sin teclas) · 10-11 cubetas (partición sin
doble conteo; cada ms en una cubeta de 15 s) · 12-13 turnos (cierre con causa; sin médico mide igual,
reasignable solo abierto) · 14-17 spool (no pierde ni duplica; descarta contando; topes y veneno; uid
sobrevive al reinicio) · 18 calidad · 19-21 viaje SAP (visitas desde el stream; espera = suma de
round-trips; ready nulo, no cero) · 22 cable (el seq del spool con nombre propio, sin pisar el de la cubeta).

## Lo que queda por comprobar en un PC real

Está en `docs/INSTALAR.md` § *Verificar en el primer PC*: icono, ganchos bajo el antivirus, scripting
de SAP habilitado, la regex del paciente contra el título real, convivencia con U.exe, kill a mitad de
turno. Todo lo demás está juzgado por máquina en este repo.

## Fase 2 (no bloquea el baseline)

- **Eventos COM `StartRequest`/`EndRequest` de SAP** para la espera y el time-to-ready por visita. El
  dominio ya lo modela (`Viaje`, `EsperaSap`, promesas 19-21) y la tabla ya tiene las columnas; en la app
  las visitas se abren y cierran por identidad y las esperas quedan en 0 hasta enganchar el sink COM.
- **Brazo Operations**: cuando U.exe ejecute workflows, un evento `ops_run` con `run_id`, `workflow_id`,
  `steps`, `total_ms`, `outcome` (claves ya permitidas por el vocabulario).
- **Rotación del secreto HMAC** desde el panel (hoy: `update settings set hmac_secret = …, hmac_version
  = hmac_version + 1`; los PCs lo reciben en el siguiente refresco).
