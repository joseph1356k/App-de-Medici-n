# Diccionario de datos

Lo mismo que viaja dentro de cada exportación como `_leeme` y que sirve `/api/export/esquema.json`
(fuente: [`plataforma/lib/diccionario.ts`](../plataforma/lib/diccionario.ts)). Escrito para que una
persona o una IA entienda cada campo sin más contexto.

## Reglas generales

- **Unidades.** Todo lo que termina en `_ms` son milisegundos (60 000 = 1 minuto). Los instantes `_at`
  son ISO 8601 en UTC. `dia_operativo` es la fecha del día operativo del hospital (corte a las 06:00
  hora de Bogotá): una guardia nocturna que cruza medianoche pertenece al día en que empezó.
- **Privacidad.** No hay contenido clínico ni texto tecleado en ningún campo. Los pacientes aparecen
  solo como `encounter_key` (huella HMAC irreversible; misma persona = misma huella dentro del mismo día
  operativo). Las pantallas SAP son identidades técnicas, nunca títulos ni valores. Del tecleo solo hay
  cantidades. El único dato de persona es `sap_user`, el login de SAP del médico.
- **Cómo comparar.** La unidad es el **consultorio** y su **jornada** (consultorio × día operativo). Solo
  jornadas con `calidad_ok = true`. Medianas por jornada, no promedios. Para comparaciones pareadas,
  agrupar por `consultorio_id` y `phase`. El médico (`sap_users`, `medico_id`) es una anotación para
  explicar una jornada, no para agrupar el estudio.

## Definiciones

| Término | Definición |
|---|---|
| jornada | Todo lo que un consultorio hizo en un día operativo. El medidor graba de forma continua: no hay turnos. |
| estados | Cada cubeta de 15 s está en uno de cuatro estados: **activo** (clic, tecla o scroll en los últimos 60 s), **inactivo** (PC encendido y desbloqueado sin nadie tocándolo), **bloqueado** (sesión de Windows bloqueada) o **sin datos** (no llegó cubeta: PC apagado, suspendido o medidor caído). |
| activo | Tiempo en primer plano con algún clic, tecla o scroll en los últimos 60 s. `foreground_ms` es el tiempo en primer plano sin exigir input. |
| `his_ms` | Tiempo activo con SAP (el sistema clínico) en primer plano. |
| tramo | Isla de actividad: cubetas activas separadas por menos de 15 minutos sin actividad. Las horas «en tramos» son el denominador de `pacientes_por_hora`. |
| `post_atencion_ms` | Tiempo activo atribuido a un paciente **después** de que se abrió otro paciente distinto: lo que se hace sobre A cuando ya se está con B. |
| `ready_ms` | Time-to-ready: de la llegada a una pantalla SAP al primer fin de round-trip sin estar ocupado. Nulo (no cero) si nunca llegó. |
| `sap_wait_ms` | Suma de round-trips al servidor SAP (StartRequest → EndRequest): tiempo esperando al sistema. |
| `cobertura_pct` | Porcentaje de la ventana de actividad (de la primera a la última cubeta activa del día) que tiene cubetas. Baja si el PC se apaga o suspende o el medidor muere en medio del día. |
| `calidad_ok` | `spool_dropped = 0` y `clock_jumps <= 2` y `cobertura_pct >= 80` (y hubo actividad). `calidad_motivos` dice por qué no. |
| `encounter_key` | Huella HMAC-SHA256 (32 hex) del identificador del paciente, calculada en el PC con una clave por día operativo. |
| `surface` | `sapgui://SISTEMA/TRANSACCION/PROGRAMA/DYNPRO[/subpantalla]`, `web://dominio`, o nulo. |
| `app` | `sap`, `miracle_web`, `chrome`, `edge`, `firefox`, `office`, `uexe`, `explorador`, `otro`; más `bloqueado`, que es el estado del PC, no una app. |
| `procesos` | Cuántas veces arrancó el medidor ese día en ese PC (1 = nunca se cayó). |

## `jornadas` — una fila por consultorio (PC) y día operativo (la tabla principal)

| Campo | Qué es |
|---|---|
| `device_id`, `pc` | el PC |
| `consultorio_id`, `consultorio` | el consultorio asignado (nulo si el PC no estaba asignado ese día) |
| `dia_operativo` | día operativo (YYYY-MM-DD) |
| `phase` | `baseline` · `notes` · `notes_ops` (derivada del calendario por fecha) |
| `primera_actividad`, `ultima_actividad`, `ventana_ms` | la ventana de actividad del día |
| `foreground_ms`, `activo_ms` | primer plano medido; activo |
| `his_ms`, `miracle_ms` | activo en SAP; activo en Miracle |
| `typing_ms`, `keystrokes`, `clicks`, `scroll_ticks`, `context_switches` | escritura por ráfagas; teclas; clics; scroll; cambios de app/pantalla/paciente |
| `tabs`, `enters`, `correcciones`, `copias`, `pegados`, `guardados` | teclas de control (las únicas seis que se distinguen) |
| `pacientes`, `consulta_ms_mediana`, `activo_por_paciente_mediana`, `entre_consultas_ms_mediana` | pacientes distintos; duración de consulta en reloj de pared; activo por paciente; tiempo entre consultas |
| `post_atencion_ms`, `interrupciones` | ver definiciones |
| `pacientes_por_hora` | pacientes por hora en tramos de actividad |
| `visitas`, `pantallas_distintas`, `revisitas_sap` | estadías en pantallas SAP; pantallas distintas; idas y vueltas |
| `sap_wait_ms`, `sap_roundtrips`, `ready_ms_p50`, `ready_ms_p95` | esperas y time-to-ready de SAP |
| `bloqueado_ms`, `inactivo_ms`, `sin_datos_ms` | los otros tres estados del día |
| `cobertura_pct`, `carga_admin_pct` | calidad; % del activo que fue en SAP |
| `tramos`, `tramos_ms` | islas de actividad |
| `pre_atencion_ms`, `cola_post_jornada_ms` | activo antes de abrir al primer paciente (arranque); activo en SAP después de abrir al último (cola de documentación) |
| `consulta_ms_p25`, `consulta_ms_p75` | percentiles de la duración de consulta |
| `por_app`, `por_hora` | `{app: {activo_ms, foreground_ms, typing_ms, keystrokes, clicks}}`; `{"07": ms activos, …}` por hora de Bogotá |
| `procesos`, `app_version` | arranques del medidor; versión |
| `activo_por_app`, `sap_users` | `{app: ms}`; `{login SAP: ms}` |
| `calidad`, `calidad_ok`, `calidad_motivos` | los contadores del instrumento (`huecos_ms`, `clock_jumps`, `spool_dropped`, `hooks_degradados`, `hooks_rearmados`, `ticks_sap_saltados_busy`, `sap_scripting`, `sap_eventos_com`, `procesos`), el veredicto y sus motivos |
| `algo_version`, `resumido_en` | versión del algoritmo de resumen; cuándo se calculó |

## `pacientes` — una fila por paciente y jornada (lo que costó cada consulta)

`device_id`, `consultorio_id`, `consultorio`, `dia_operativo`, `phase`, `orden` (P1, P2… por primera
aparición), `encounter_key`, `sap_user`, `medico_id`, `medico`, `primera_vez`, `ultima_vez`, `consulta_ms`
(reloj de pared, incluye interrupciones), `activo_ms`, `his_ms`, `miracle_ms`, `typing_ms`, `keystrokes`,
`clicks`, `tabs`, `enters`, `correcciones`, `copias`, `pegados`, `guardados`, `tramos` (rachas: A→B→A da 2),
`post_atencion_ms`, `siguiente_ms` (del último toque al primero del siguiente paciente; nulo si fue el
último), `visitas`, `pantallas_distintas`, `sap_wait_ms`, `ready_ms_p50`. Se regenera con el resumen de
la jornada (tabla `encuentros`).

## `muestras` — la serie de 15 s

`device_id`, `consultorio_id`, `dia_operativo`, `phase`, `bucket_start` (inicio de la cubeta, alineada al
reloj), `bucket_ms` (lo que cubre la fila: 15000 lo normal, o el tramo entero cuando el medidor fundió
cubetas seguidas en las que no pasaba nada, hasta 5 min), `seq` (segmento dentro de la cubeta al
cambiar el contexto; los segmentos se reparten ese ancho en proporción a su `foreground_ms`),
`app` (o `bloqueado`), `surface`, `encounter_key`,
`sap_user`, `medico_id`, `medico`, `foreground_ms`, `active_ms`, `typing_ms`, `keystrokes`, `clicks`,
`scroll_ticks`, `context_switches`, `sap_roundtrips`, `sap_wait_ms`, `tabs`, `enters`, `correcciones`,
`copias`, `pegados`, `guardados`.

## `visitas_sap` — el recorrido por SAP

`device_id`, `consultorio_id`, `dia_operativo`, `phase`, `encounter_key`, `sap_user`, `medico_id`, `sid`,
`tcode`, `dynpro`, `surface`, `entered_at`, `left_at`, `dwell_ms` (estadía), `ready_ms`, `sap_wait_ms`,
`roundtrips`, `exit_to` (transacción siguiente, o nulo si salió de SAP).

## `eventos`

`device_id`, `consultorio_id`, `dia_operativo`, `occurred_at`, `kind`, `encounter_key`, `detail` (objeto
con claves de una lista cerrada: `reason`, `ms`, `count`, `user`, `rule`, `version`…; nunca texto libre).

`kind`: `jornada_inicio` · `jornada_fin` · `encounter_enter` · `encounter_exit` · `encounter_unknown` ·
`lock` · `unlock` · `suspend` · `resume` · `medidor_start` (con `reason`: `arranque`, `relanzado`,
`vigilante`) · `medidor_stop` · `sap_attach` · `sap_detach` · `sap_user_seen` ·
`sap_scripting_no_disponible` · `clock_jump` · `spool_drop` · `spool_reset` · `hooks_degradados` ·
`hooks_rearmados` · `config_applied` · `consultorio_asignado` · `ops_run` · `calidad`.

## Catálogos

- `consultorios`: `id`, `nombre`, `orden`, `activo`.
- `medicos`: `id`, `display_name`, `sap_users`, `active` (anotación opcional).
- `dispositivos`: `id`, `machine_name`, `consultorio_id`, `consultorio`, `status`, `app_version`, `registered_at`, `last_seen_at`.
- `fases`: `phase`, `starts_on`, `ends_on`.

## Endpoints de exportación

| URL | Qué |
|---|---|
| `/api/export/dataset.json?rango=30d` | todo junto, con `_leeme` (`&muestras=1` incluye la serie) |
| `/api/export/jornadas.csv` · `.json` · `.ndjson` | jornadas |
| `/api/export/pacientes.csv` · `.json` · `.ndjson` | pacientes (consultas) |
| `/api/export/muestras.ndjson` · `.csv` · `.json` | serie de 15 s (streaming) |
| `/api/export/visitas.csv` · … | visitas SAP |
| `/api/export/eventos.csv` · … | eventos |
| `/api/export/esquema.json` | este diccionario |

Filtros en la URL: `rango=hoy|7d|30d|90d|todo` o `desde=YYYY-MM-DD&hasta=YYYY-MM-DD`, `fase=`,
`consultorio=<uuid>`, `dispositivo=<uuid>`, `incluir_mala=1`. Sin credenciales: el panel y sus exportaciones
son públicos.
