# App de Medición — el medidor del trabajo clínico

Mide **cuánto trabajo operativo cuesta la atención en el PC del médico** —tiempo activo, tiempo en el
sistema clínico (SAP), escritura, clics, pantallas recorridas, esperas del sistema, trabajo posterior a
la atención— **por turno y por paciente**, con el mismo instrumento en las tres fases del estudio:

| Fase | Qué hay | Qué se compara |
|---|---|---|
| `baseline` | el médico trabaja como siempre, sin Miracle | la vara |
| `notes` | con Miracle Notes | cuánto baja la escritura y el tiempo en SAP |
| `notes_ops` | Notes + Operations | cuánto baja además la navegación y el post-atención |

**Principio: medir el trabajo, no vigilar al médico.** No sale del PC ni una letra tecleada, ni un
título de ventana, ni un dato de paciente. El paciente es una huella irreversible calculada en el PC
(ver [`docs/PRIVACIDAD.md`](docs/PRIVACIDAD.md)).

## Las tres piezas

```
PC del médico ──── Medidor.exe ──── cada minuto (HTTPS) ────►  plataforma (Vercel)  ────►  Postgres (Supabase)
icono en bandeja · sin instalar .NET                          API + panel web + exportación IA-friendly
```

| Carpeta | Qué es | Cómo se comprueba |
|---|---|---|
| [`medidor/`](medidor/) | El `.exe` (C# .NET 8, Win32 puro). `Dominio/` es la lógica de medición sin pantalla; `Contrato/` son sus 22 promesas ejecutables; `App/` es el programa. | `dotnet run --project medidor/Contrato` → **22/22** · `dotnet publish` produce `Medidor.exe` **desde Linux o Windows** |
| [`plataforma/`](plataforma/) | Next.js 15: la API que recibe los datos, el panel con clave, la exportación en CSV/JSON/NDJSON. | `npm test` · `npm run build` |
| [`plataforma/supabase/schema.sql`](plataforma/supabase/schema.sql) | El esquema (un hospital) con las funciones de resumen. | `prueba-esquema.sql` en CI |
| [`docs/`](docs/) | Arquitectura, diccionario de datos, privacidad, instalación. | — |

## Ponerlo a andar en tres pasos

**1. La base de datos** (5 min). Crea un proyecto en [Supabase](https://supabase.com) (gratis) → SQL Editor →
pega [`plataforma/supabase/schema.sql`](plataforma/supabase/schema.sql) → Run. Copia la *connection string*
del **Transaction pooler** (Settings → Database, puerto 6543).

**2. La plataforma** (5 min). En [Vercel](https://vercel.com): *New Project* → importa este repo → *Root
Directory* = `plataforma` → variables de entorno:

| Variable | Valor |
|---|---|
| `DATABASE_URL` | la connection string del paso 1 |
| `MEDIDOR_API_KEY` | una clave larga y aleatoria (la usarán los PCs) |
| `PANEL_PASSWORD` | la contraseña del panel web |

Deploy. Abre la URL, entra con la contraseña, ve a **Configuración** y escribe los nombres de los
médicos (y sus usuarios de SAP si los sabes).

**3. Los PCs** (2 min por PC, sin administrador). Descarga `Medidor.exe` (artefacto `Medidor-win-x64` de
la última corrida de [Actions](../../actions), o `dotnet publish -c Release -r win-x64 --self-contained
-p:PublishSingleFile=true medidor/App/App.csproj`), ponlo junto a `medidor/instalar.ps1` y en PowerShell:

```powershell
.\instalar.ps1 -Servidor "https://TU-PROYECTO.vercel.app" -Clave "LA_MEDIDOR_API_KEY"
```

Aparece un círculo en la bandeja: **ámbar** = midiendo sin médico (clic → elige tu nombre), **verde** =
midiendo, **gris** = pausado. El PC aparece en **Dispositivos** en su primer latido (un minuto).

Detalles, requisitos de SAP y diagnóstico: [`docs/INSTALAR.md`](docs/INSTALAR.md).

## Qué se ve en el panel

- **Resumen**: cobertura (cuántos turnos se midieron bien), medianas por turno (activo, en SAP, escribiendo,
  clics, pacientes, tiempo por paciente, post-atención, espera de SAP, pantalla lista), serie diaria, por
  médico, por app, últimos turnos.
- **Turnos** y el **detalle de un turno**: línea de tiempo por app, pacientes (huellas), recorrido por SAP
  pantalla a pantalla con tiempos, eventos, calidad del instrumento.
- **Comparación de fases**: baseline vs Notes vs Notes+Ops, con la reducción en %, y pareado por médico.
- **Pantallas SAP**: transacciones más visitadas, tiempos por transacción, rutas frecuentes.
- **Dispositivos**, **Configuración** (roster, fases, config remota del .exe) y **Exportar**.

## Exportación lista para IA

`/api/export/dataset.json?rango=30d` devuelve un solo JSON con un bloque `_leeme` (qué es cada campo, unidades,
cómo comparar) + fases + médicos + dispositivos + turnos + visitas SAP + eventos. También CSV/JSON/NDJSON por
colección y `esquema.json` con el diccionario. Con `&clave=CONTRASEÑA` se puede pegar la URL en una
herramienta sin iniciar sesión. Diccionario en [`docs/DATOS.md`](docs/DATOS.md).

## Estado

- El contrato del instrumento corre verde (22/22) y la plataforma compila y pasa sus pruebas; el esquema se
  valida en un Postgres real; el `.exe` se publica desde CI.
- **Lo que solo se puede comprobar en un PC del hospital** (y está por hacer): que el icono aparece, que
  SAP GUI Scripting está habilitado (sin él se mide el tiempo en SAP como app, pero no las pantallas), que
  el antivirus deja instalar los ganchos de teclado/ratón, y que la regla de extracción del paciente
  encuentra el identificador en el título de la ventana SAP. Está detallado en
  [`docs/INSTALAR.md`](docs/INSTALAR.md) § *Verificar en el primer PC*.
