# App de Medición — el medidor del trabajo clínico, por consultorio

Mide **cuánto trabajo operativo cuesta la atención en el PC de cada consultorio** —tiempo activo, tiempo
en el sistema clínico (SAP), escritura, clics, pantallas recorridas, esperas del sistema, trabajo posterior
a la atención— **de forma continua, por jornada (consultorio × día) y por paciente**, con el mismo
instrumento en las tres fases del estudio:

| Fase | Qué hay | Qué se compara |
|---|---|---|
| `baseline` | el consultorio trabaja como siempre, sin Miracle | la vara |
| `notes` | con Miracle Notes | cuánto baja la escritura y el tiempo en SAP |
| `notes_ops` | Notes + Operations | cuánto baja además la navegación y el post-atención |

**Principio: medir el trabajo, no vigilar al médico.** No sale del PC ni una letra tecleada, ni un
título de ventana, ni un dato de paciente. El paciente es una huella irreversible calculada en el PC
(ver [`docs/PRIVACIDAD.md`](docs/PRIVACIDAD.md)). El médico no es la unidad del estudio: queda como
anotación derivada del usuario de SAP visto.

## Las tres piezas

```
PC del consultorio ─── Medidor.exe ─── cada minuto (HTTPS) ───►  plataforma (Vercel)  ───►  Postgres (Supabase)
icono siempre visible · graba siempre · se vigila a sí mismo      API + panel web + exportación IA-friendly
```

| Carpeta | Qué es | Cómo se comprueba |
|---|---|---|
| [`medidor/`](medidor/) | El `.exe` (C# .NET 8, Win32 puro). `Dominio/` es la lógica de medición sin pantalla; `Contrato/` son sus promesas ejecutables; `App/` es el programa. | `dotnet run --project medidor/Contrato` → todas en verde · `dotnet publish` produce `Medidor.exe` **desde Linux o Windows** |
| [`plataforma/`](plataforma/) | Next.js 15: la API que recibe los datos, el panel por consultorio con la línea de tiempo del día, la exportación en CSV/JSON/NDJSON. | `npm test` · `npm run typecheck` · `npm run build` |
| [`plataforma/supabase/schema.sql`](plataforma/supabase/schema.sql) | El esquema v2 (un hospital) con las funciones de resumen por jornada. | `prueba-esquema.sql` en CI, con aserciones |
| [`docs/`](docs/) | Arquitectura, diccionario de datos, privacidad, instalación. | — |

## Lo que hace distinto al medidor v2

- **Graba siempre.** Cada 15 segundos sale una cubeta, haya o no alguien en el PC. Bloqueado se graba
  como `bloqueado`; si no hay cubeta es que el PC estaba apagado o suspendido (o el medidor muerto), y
  eso se ve como «sin datos» en la línea de tiempo, no como un cero disfrazado.
- **No se apaga.** Sin botón de salir ni de pausar. Cuatro capas lo mantienen vivo: si se cae se
  relanza solo; si se cuelga, Windows lo reinicia; una tarea programada lo comprueba cada 5 minutos; y
  arranca con cada inicio de sesión. Nada de esto necesita administrador.
- **Por consultorio.** Cada PC se asigna a su consultorio desde el panel. El icono muestra el consultorio
  y el estado; nadie tiene que elegir nada en el PC.
- **Extrae bien.** La ingesta habla con el `.exe` en los nombres de su cola local: una fila rechazada se
  saca, una fila que sobra se reenvía, y nada se borra en silencio.

## Ponerlo a andar en tres pasos

**1. La base de datos** (5 min). Crea un proyecto en [Supabase](https://supabase.com) (gratis) → SQL Editor →
pega [`plataforma/supabase/schema.sql`](plataforma/supabase/schema.sql) → Run. Copia la *connection string*
del **Transaction pooler** (Settings → Database, puerto 6543). Si ya tenías la versión anterior (turnos por
médico), corre antes [`reset-v1.sql`](plataforma/supabase/reset-v1.sql): borra los datos v1. Sin cupo para
otro proyecto: un esquema aparte dentro de uno existente, ver [`docs/INSTALAR.md`](docs/INSTALAR.md) § Opción B.

**2. La plataforma** (5 min). En [Vercel](https://vercel.com): *New Project* → importa este repo → *Root
Directory* = `plataforma` → variables de entorno:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | la connection string del paso 1 |
| `MEDIDOR_API_KEY` | una clave larga y aleatoria (la usarán los PCs) |

Deploy. Abre la URL: el panel **no pide contraseña**; quien tenga la dirección entra y puede editar.
En **Configuración** están los tres consultorios (renómbralos si hace falta) y las fases del estudio.

**3. Los PCs** (30 segundos por PC, sin administrador). Descarga
[`Medidor.exe`](../../releases/latest/download/Medidor.exe) y **haz doble clic**. Se copia solo a su
sitio, queda arrancando con Windows, se registra su propio vigilante y empieza a medir. Luego, en
**Dispositivos**, asigna ese PC a su consultorio (en menos de dos minutos el icono lo muestra).

El círculo junto al reloj de Windows: **verde** = midiendo en su consultorio, **ámbar** = midiendo, falta
asignarle el consultorio en el panel, **oscuro** = sin conexión (se guarda en el PC y se sube después).

Para quitarlo, [`desinstalar.ps1`](../../releases/latest/download/desinstalar.ps1). Para apuntar un PC
a otro servidor, `instalar.ps1 -Servidor "https://otro" -Clave "otra"`.

Detalles, requisitos de SAP y diagnóstico: [`docs/INSTALAR.md`](docs/INSTALAR.md).

## Qué se ve en el panel

- **Inicio**: los tres consultorios ahora mismo (activo, inactivo, bloqueado o sin datos; qué app y qué
  pantalla de SAP; pacientes de hoy; alertas del instrumento) con la línea de tiempo del día en miniatura,
  y la rejilla de los últimos 7 días.
- **Día del consultorio**: la línea de tiempo completa (estado · app · SAP · pacientes · eventos), los
  indicadores de la jornada, los médicos vistos por su usuario SAP, los pacientes (huellas), el recorrido
  por SAP pantalla a pantalla, la calidad del instrumento.
- **Jornadas**: la tabla consultorio × día. **Comparación**: baseline vs Notes vs Notes+Ops por
  consultorio. **Pantallas SAP**: transacciones, tiempos y rutas. **Dispositivos**, **Configuración** y
  **Exportar**.

## Exportación lista para IA

`/api/export/dataset.json?rango=30d` devuelve un solo JSON con un bloque `_leeme` (qué es cada campo, unidades,
cómo comparar) + fases + consultorios + médicos + dispositivos + jornadas + visitas SAP + eventos. También
CSV/JSON/NDJSON por colección y `esquema.json` con el diccionario. Como el panel no tiene login, la URL se
pega tal cual en una herramienta. Diccionario en [`docs/DATOS.md`](docs/DATOS.md).

## Estado

- El contrato del instrumento corre en verde, la plataforma compila y pasa sus pruebas, el esquema se
  valida con aserciones en un Postgres real y el `.exe` se publica desde CI.
- **Lo que solo se puede comprobar en un PC del hospital**: que SAP GUI Scripting está habilitado (sin él
  se mide el tiempo en SAP como app, pero no las pantallas), que el antivirus deja instalar los ganchos de
  teclado/ratón y crear la tarea programada, que la regla de extracción del paciente encuentra el
  identificador en el título de la ventana SAP, y que los eventos COM de SAP (espera y time-to-ready) se
  enganchan. La jornada lo dice en su calidad (`sap_scripting`, `sap_eventos_com`, `hooks_degradados`) y
  el panel lo muestra como alerta. Está detallado en [`docs/INSTALAR.md`](docs/INSTALAR.md) § *Verificar
  en el primer PC*.
