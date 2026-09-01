# Diccionario de datos

Lo mismo que viaja dentro de cada exportación como `_leeme` y que sirve `/api/export/esquema.json`
(fuente: [`plataforma/lib/diccionario.ts`](../plataforma/lib/diccionario.ts)). Escrito para que una
persona o una IA entienda cada campo sin más contexto.

## Reglas generales

- **Unidades.** Todo lo que termina en `_ms` son milisegundos (60 000 = 1 minuto). Los instantes `_at`
  son ISO 8601 en UTC. `fecha_operativa` es la fecha del día operativo del hospital (corte a las 06:00
  hora de Bogotá): un turno nocturno que cruza medianoche pertenece al día en que empezó.
- **Privacidad.** No hay contenido clínico ni texto tecleado en ningún campo. Los pacientes aparecen
  solo como `encounter_key` (huella HMAC irreversible; misma persona = misma huella dentro del mismo día
  operativo). Las pantallas SAP son identidades técnicas, nunca títulos ni valores. Del tecleo solo hay
  cantidades.
- **Cómo comparar.** Solo turnos con `calidad_ok = true`. Medianas por turno, no promedios. Para
  comparaciones pareadas, agrupar por `doctor_id` y `phase`. Un turno sin `doctor_id` es anónimo: mide
  igual, pero no sirve para comparar por médico.

## Definiciones

| Término | Definición |
|---|---|
| turno | Desde que el medidor abre un turno en un PC (al arrancar, al elegir un médico, o cuando vuelve a haber actividad) hasta que se cierra (manual, 4 h sin actividad, 2 h bloqueado, otro médico, apagado). Un cambio de médico son dos turnos. |
| activo | Tiempo en primer plano con algún clic, tecla o scroll en los últimos 60 s. `foreground_ms` es el tiempo en primer plano sin exigir input. |
| `his_ms` | Tiempo activo con SAP (el sistema clínico) en primer plano. |
| `post_atencion_ms` | Tiempo activo atribuido a un paciente **después** de que se abrió otro paciente distinto: lo que se hace sobre A cuando ya se está con B. |
| `cola_post_turno_ms` | Tiempo activo en SAP después de abrir el último paciente del turno. |
| `ready_ms` | Time-to-ready: de la llegada a una pantalla SAP al primer fin de round-trip sin estar ocupado. Nulo (no cero) si nunca llegó. |
| `sap_wait_ms` | Suma de round-trips al servidor SAP (StartRequest → EndRequest): tiempo esperando al sistema. |
| `cobertura_pct` | Porcentaje del turno que el medidor vio. Baja si el PC se suspende, el medidor muere o el reloj salta. |
| `encounter_key` | Huella HMAC-SHA256 (32 hex) del identificador del paciente, calculada en el PC con una clave por día operativo. |
| `surface` | `sapgui://SISTEMA/TRANSACCION/PROGRAMA/DYNPRO[/subpantalla]`, `web://dominio`, o nulo. |
| `app` | `sap`, `miracle_web`, `chrome`, `edge`, `firefox`, `office`, `uexe`, `explorador`, `otro`. |

## `turnos` — una fila por turno (la tabla principal)

| Campo | Qué es |
|---|---|
| `shift_id` | uuid del turno |
| `fecha_operativa` | día operativo (YYYY-MM-DD) |
| `phase` | `baseline` · `notes` · `notes_ops` (derivada del calendario por fecha) |
| `doctor_id`, `medico` | médico del roster, o nulo si el turno fue anónimo |
| `device_id`, `pc`, `pc_etiqueta` | el PC |
| `started_at`, `ended_at`, `end_reason` | apertura, cierre y causa (`manual` · `timeout_inactividad` · `lock_prolongado` · `turno_nuevo` · `apagado` · `desconocido`) |
| `duracion_ms` | cierre − apertura (o hasta ahora) |
| `foreground_ms_total`, `active_ms_total` | primer plano medido; activo |
| `his_ms`, `miracle_ms` | activo en SAP; activo en Miracle |
| `typing_ms`, `keystrokes`, `clicks`, `scroll_ticks`, `context_switches` | escritura por ráfagas; teclas; clics; scroll; cambios de app/pantalla/paciente |
| `encounters`, `encounter_active_ms_mediana` | pacientes distintos; mediana de activo por paciente |
| `post_atencion_ms`, `cola_post_turno_ms` | ver definiciones |
| `sap_wait_ms_total`, `sap_roundtrips`, `ready_ms_p50`, `ready_ms_p95` | esperas y time-to-ready de SAP |
| `pantallas_distintas`, `visitas` | pantallas SAP distintas; estadías |
| `cobertura_pct`, `calidad_ok` | calidad; `true` = comparable |
| `active_ms_por_app` | `{app: ms}` |
| `sap_user_seen`, `app_version` | login SAP del médico visto; versión del medidor |
| `huecos_ms`, `clock_jumps`, `spool_dropped`, `hooks_degradados`, `ticks_sap_saltados_busy` | lo que el instrumento dejó de ver |
| `algo_version` | versión del algoritmo de resumen |

## `muestras` — la serie de 15 s

`shift_id`, `device_id`, `doctor_id`, `phase`, `bucket_start` (inicio de la cubeta, alineada al reloj),
`bucket_ms`, `seq` (segmento dentro de la cubeta al cambiar el contexto), `app`, `surface`,
`encounter_key`, `foreground_ms`, `active_ms`, `typing_ms`, `keystrokes`, `clicks`, `scroll_ticks`,
`context_switches`, `sap_roundtrips`, `sap_wait_ms`.

## `visitas_sap` — el recorrido por SAP

`shift_id`, `device_id`, `doctor_id`, `phase`, `encounter_key`, `sid`, `tcode`, `dynpro`, `surface`,
`entered_at`, `left_at`, `dwell_ms` (estadía), `ready_ms`, `sap_wait_ms`, `roundtrips`, `exit_to`
(transacción siguiente, o nulo si salió de SAP).

## `eventos`

`shift_id`, `device_id`, `occurred_at`, `kind`, `encounter_key`, `detail` (objeto con claves de una lista
cerrada: `reason`, `ms`, `count`, `user`, `rule`, `version`…; nunca texto libre).

`kind`: `shift_start` · `shift_end` · `doctor_prompted` · `encounter_enter` · `encounter_exit` ·
`encounter_unknown` · `lock` · `unlock` · `suspend` · `resume` · `medidor_start` · `medidor_stop` ·
`pausa_usuario` · `reanudar_usuario` · `sap_attach` · `sap_detach` · `sap_user_seen` · `clock_jump` ·
`spool_drop` · `hooks_degradados` · `config_applied` · `ops_run` · `calidad`.

## Catálogos

- `medicos`: `id`, `display_name`, `sap_users`, `active`.
- `dispositivos`: `id`, `machine_name`, `label`, `status`, `app_version`, `registered_at`, `last_seen_at`.
- `fases`: `phase`, `starts_on`, `ends_on`.

## Endpoints de exportación

| URL | Qué |
|---|---|
| `/api/export/dataset.json?rango=30d` | todo junto, con `_leeme` (`&muestras=1` incluye la serie) |
| `/api/export/turnos.csv` · `.json` · `.ndjson` | turnos |
| `/api/export/muestras.ndjson` · `.csv` · `.json` | serie de 15 s (streaming) |
| `/api/export/visitas.csv` · … | visitas SAP |
| `/api/export/eventos.csv` · … | eventos |
| `/api/export/esquema.json` | este diccionario |

Filtros en la URL: `rango=hoy|7d|30d|90d|todo` o `desde=YYYY-MM-DD&hasta=YYYY-MM-DD`, `fase=`, `medico=<uuid>`,
`dispositivo=<uuid>`, `incluir_mala=1`. Acceso: cookie del panel o `clave=CONTRASEÑA_DEL_PANEL`.
