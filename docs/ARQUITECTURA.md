# Arquitectura

## El problema que resuelve

Demostrar con datos propios cuánto trabajo operativo elimina Miracle en urgencias, midiendo **antes**
(baseline) y **después** (Notes; Notes + Operations) con el **mismo instrumento**. Las métricas: tiempo
activo en el PC y en el HIS (SAP), escritura, clics, cambios de contexto, pantallas SAP recorridas, espera
de SAP, time-to-ready, trabajo post-atención, por jornada de consultorio y por consulta. Sin contenido
clínico. En PCs compartidos de tres consultorios, con Windows, con el asistente Ü ya instalado al lado.

## Las piezas y el flujo

```
┌─ PC del consultorio ──────────────────────────────────────────┐   HTTPS, X-API-Key, 1 lote/min
│  Medidor.exe (net8.0-windows, Win32 puro, sin WPF)             │ ─────────────────────────────►  plataforma/ (Next.js 15, Vercel)
│   ├ Vigilante: mutex + latido + relanzo tras colapso           │                                  ├ /api/medidor/registro   identidad + secreto + config + consultorio
│   ├ VentanaOculta: bomba de mensajes, relojes, bandeja, WTS    │                                  ├ /api/medidor/config     refresco versionado
│   ├ Ganchos LL: clics/scroll/instantes de tecla (jamás la tecla)│                                  ├ /api/medidor/lote       ingesta idempotente, rechazadas[] y no_procesadas[]
│   │   con salud y rearme si Windows los quita                  │                                  │                         por fila, resumen de la jornada al instante
│   ├ SondaPrimerPlano: proceso delante (+ host del navegador)   │                                  ├ /api/export/*           CSV · JSON · NDJSON · dataset con _leeme
│   ├ HiloSap (STA): identidad SAP por COM, disciplina Busy      │                                  └ panel (público): inicio · día del consultorio · jornadas ·
│   ├ Orquestador (1 s): SIEMPRE registra → normaliza → encounter│                                     comparación · SAP · dispositivos · configuración · exportar
│   │   → cubetas 15 s (bloqueado incluido)                      │                                              │
│   ├ Dominio (puro, 32 promesas): Reloj, Actividad, Escritura,  │                                              ▼
│   │   Cubetas, Huella HMAC, Jornada, Continuidad, Viaje SAP,   │                                  Postgres (Supabase): settings · roster · study_phases · consultorios ·
│   │   Calidad, SaludDeGanchos, GuardiaDeRelanzos               │                                  devices · jornadas · samples · events · sap_visits · jornada_summary
│   ├ SpoolSqlite: durable, ack antes de borrar, tope 200 MB,    │
│   │   se recupera de un archivo corrupto                       │        Tarea programada «Medidor-Vigilante» (por usuario, sin admin):
│   └ Subidor (1 min, hilo de fondo)                             │        al iniciar sesión y cada 5 min lanza el .exe; si ya corre, no hace nada
└────────────────────────────────────────────────────────────────┘
```

## Decisiones, y por qué

**El consultorio es la unidad, no el médico (v2, 2026-09-02).** Los PCs son compartidos y el estudio
compara consultorios entre fases. Cada PC se asigna a su consultorio **desde el panel**; el .exe no
pregunta nada. El médico queda como anotación: el login de SAP visto viaja en cada cubeta y el roster le
pone nombre. Un turno que dependía de que alguien eligiera su nombre en un icono era un turno que casi
nunca existía.

**Grabación continua: no hay turnos.** La v1 solo medía con un turno abierto y dejaba de grabar al
bloquear el PC o tras 4 h sin input; entre medias no había datos y nadie sabía si el PC estaba apagado o
el medidor muerto. Ahora cada cubeta de 15 s sale siempre: con la sesión bloqueada la app es
`bloqueado`; sin input, activo 0. Lo único que corta es el **día operativo** (06:00 Bogotá), y lo corta
solo. La unidad de agregación es la **jornada** = consultorio × día operativo. Un hueco entre cubetas es
«sin datos» y se cuenta como tal.

**Nunca se apaga.** Sin *Salir* ni *Pausar* en el icono (decisión del hospital; la política de privacidad
lo dice así). Cuatro capas, de la más rápida a la más lenta: el manejador de excepciones vuelca lo que
tiene y relanza el proceso (como mucho 5 veces en 10 minutos); `RegisterApplicationRestart` cubre los
cuelgues nativos; una tarea programada por usuario (`schtasks`, sin administrador) lo lanza al iniciar
sesión y cada 5 minutos (inofensivo si ya corre: instancia única por mutex, y si la instancia no late
hace 15 min la releva); y la clave `Run` del usuario. Un spool corrupto se aparta y se recrea en vez de
impedir el arranque.

**Un `.exe` aparte de U.exe.** El asistente es producto; esto es el instrumento del estudio. Conviven
en el mismo PC y no comparten código: este repo es autocontenido.

**Win32 puro, sin WPF ni WinForms.** Es lo que hace que el `.exe` **compile y se publique desde
Linux** (CI incluido). La UI es un icono de bandeja (`Shell_NotifyIcon`), un menú (`TrackPopupMenu`) y
cuadros de mensaje. Nada más hace falta.

**Dominio puro con contrato.** Todo lo que se puede juzgar sin pantalla vive en `medidor/Dominio` y lo
juzgan las promesas de `medidor/Contrato`, que corren en menos de un segundo, en Linux. Las seis primeras
son de privacidad y van primero a propósito. Un medidor que cuenta mal no se nota (los números «se ven
normales»), y aquí contar mal contamina un baseline que no se puede volver a medir.

**Sin códigos de enrolamiento.** La clave de la API ya autentica la instalación; el PC se registra por
nombre de máquina y guarda su `device_id`. Reinstalar no duplica. Un PC se pausa o retira desde el panel.

**Cubetas de 15 s, deltas, nunca totales.** Cada milisegundo cae en exactamente una cubeta alineada al
reloj de pared; la cubeta se parte al cambiar app, pantalla, paciente o usuario SAP. Un tick jamás aporta
más de 2 s, y lo que un tick atascado no aporta se cuenta como hueco. Idempotencia por
`(device_id, bucket_start, seq)`: por eso el .exe no cosecha a mitad de cubeta al bloquear.

**El paciente es una huella.** Regla remota (regex sobre el título de SAP, o un campo por selector) →
normalizar → HMAC-SHA256 con clave por día operativo (derivada en cada tick, rota a las 06:00 sin que
nadie haga nada) → soltar el crudo. Pseudonimización, no anonimización. Ver `docs/PRIVACIDAD.md`.

**Spool durable, y la ingesta le habla en su idioma.** SQLite con WAL; lo tomado sin confirmar se vuelve a
entregar idéntico; se borra solo tras el 200. El servidor responde con los **nombres de colección del
spool** (`muestras/eventos/visitas/jornadas`): lo rechazado se saca (veneno), lo que sobró del tope se
reenvía (`no_procesadas`). La v1 respondía con los nombres de las tablas, el .exe no encontraba la fila y
la borraba igual: cualquier rechazo, hasta uno transitorio, destruía datos.

**Calidad por proceso, sumada por día.** Cada arranque del .exe manda su propia foto de `jornadas` con un
`proceso_id`; los contadores solo crecen dentro de un proceso y el resumen los suma. `procesos − 1` es
cuántas veces se relanzó ese día, sin que el .exe tenga que recordarlo.

**Un Postgres, sin service-role en el panel.** La API escribe con `DATABASE_URL`; RLS activado sin
políticas por si el Postgres es Supabase. **El panel es público, sin login** (decisión del dueño,
2026-09-02): no expone dato de paciente, pero sí permite escribir configuración. Lo que sigue protegido
con `X-API-Key` es la ingesta.

**Resumen al instante, con acelerador.** El lote recalcula `jornada_summary` de las jornadas tocadas como
mucho una vez cada 5 minutos por jornada; lo demás queda «sucio» y lo termina el cron diario (06:30
Bogotá, después del corte). `algo_version` permite recomputar todo si cambia una definición
(`/api/tareas/resumir?todo=1`).

**Calidad como filtro, no como nota al pie.** `calidad_ok` = nada descartado en el PC, reloj estable
(≤ 2 saltos) y cobertura ≥ 80 % de la ventana de actividad. `calidad_motivos` dice por qué una jornada
quedó fuera; el panel lo muestra como alerta y el bloque de cobertura dice cuántas se excluyeron.

## Lo que promete el contrato (`medidor/Contrato`)

1-6 privacidad (título jamás en el lote; apps fuera de lista = «otro»; SAP sin `vista:` ni título; solo la
huella; clave por día operativo; misma persona misma huella) · 7-9 reloj y actividad (tick ≤ 2 s; activo =
input en 60 s; escritura por ráfagas sin teclas) · 10-11 cubetas (partición sin doble conteo, también por
usuario SAP; cada ms en una cubeta de 15 s) · 12-13 continuidad (la jornada cambia sola a las 06:00; un PC
bloqueado sigue emitiendo cubetas `bloqueado`) · 14-17 spool (no pierde ni duplica; descarta contando;
topes y veneno por nombre del spool; uid sobrevive al reinicio) · 18 calidad · 19-21 viaje SAP · 22 cable
v2 · 23 teclas de control · 24-32 resiliencia (huecos de un reloj atascado, rearme de ganchos, guardia de
relanzos, spool corrupto, compactación de fotos, purga v1, clave por tick, `proceso_id`, los dos 403).

## Lo que queda por comprobar en un PC real

Está en `docs/INSTALAR.md` § *Verificar en el primer PC*: ganchos y tarea programada bajo el antivirus y
la política del hospital, scripting de SAP habilitado, la regex del paciente contra el título real, los
eventos COM de SAP, convivencia con U.exe, matar el proceso y verlo volver. Todo lo demás está juzgado
por máquina en este repo.

## Después (no bloquea)

- **Auto-actualización del `.exe`** desde el servidor: hoy cada versión nueva es un doble clic por PC.
- **Brazo Operations**: cuando U.exe ejecute workflows, un evento `ops_run` con `run_id`, `workflow_id`,
  `steps`, `total_ms`, `outcome` (claves ya permitidas por el vocabulario).
- **Rotación del secreto HMAC** desde el panel.
