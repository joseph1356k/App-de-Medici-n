# Privacidad: qué se mide y qué no

El medidor se instala en consultorios de urgencias, donde las pantallas llevan nombres, documentos y
diagnósticos. La regla que manda es **medir el trabajo, no vigilar al médico**, y va escrita como promesas
ejecutables del contrato ([`medidor/Contrato/Contrato.cs`](../medidor/Contrato/Contrato.cs), promesas 1-6)
y como una segunda valla en el servidor ([`plataforma/lib/vocabulario.ts`](../plataforma/lib/vocabulario.ts)).

## Lo que NUNCA sale del PC

| | Cómo se garantiza |
|---|---|
| Texto tecleado | Los ganchos de teclado **no leen el código de tecla** salvo para distinguir seis teclas de control (Tab, Enter, borrar, copiar, pegar, guardar), y ni eso se guarda: solo anotan el instante. Del tecleo salen cantidades y tiempo en ráfagas. (Promesas 9 y 23) |
| Títulos de ventana | El normalizador recibe el título y lo **ignora a propósito**; lo único que se extrae de un título de navegador es el dominio, y solo si está en la lista permitida. La promesa 1 serializa un lote con un título hostil («Juan Pérez, CC 123456789») y exige que no aparezca ni un fragmento. |
| Identidad del paciente | El identificador visible en SAP se convierte en un **HMAC-SHA256 irreversible en el PC**, con una clave que cambia cada día operativo, y el crudo se suelta en el acto: no toca el log, ni el disco, ni la red. (Promesas 4-6 y 30) |
| Contenido de campos SAP | El medidor solo lee `Info.SystemName/Transaction/Program/ScreenNumber/User`, el título de `wnd[0]` y —por una regla remota— **un** campo por selector, únicamente para hashearlo. No recorre formularios ni lee valores. |
| Lo que pasa con el PC bloqueado | Nada: con la sesión bloqueada la cubeta dice solo `bloqueado`, sin pantalla, sin paciente, sin usuario y con actividad cero. |
| Capturas, audio, portapapeles | No existen en el código. |
| Contraseñas | Ídem. Las teclas no se leen. |

## Lo que SÍ sale, y por qué

| Dato | Para qué |
|---|---|
| Tiempo en primer plano y activo por app, cada 15 s, siempre (bloqueado incluido) | cuánto trabajo hay, dónde, y cuándo el PC estaba ocupado, quieto, bloqueado o apagado |
| Cantidad de teclas, clics, scroll; tiempo en ráfagas de tecleo; seis teclas de control | escritura y esfuerzo |
| Identidad técnica de la pantalla SAP (`sapgui://SID/TCODE/PROGRAMA/DYNPRO`) | el recorrido por el sistema |
| Round-trips y time-to-ready de SAP | cuánto se espera al sistema |
| Huella del paciente (32 hex) | saber que dos momentos son la misma consulta (A→B→A de urgencias) |
| Usuario SAP (login del médico) en cada cubeta | anotar qué médico estaba en el consultorio; el estudio agrupa por consultorio, no por médico |
| Nombre del PC, versión de Windows y del medidor, cuántas veces arrancó | operar la instalación y saber si el instrumento estuvo entero |

## Pseudonimización, no anonimización — dicho con claridad

La huella del paciente se calcula con un secreto que vive en el servidor (para que todos los PCs del
hospital deriven la misma huella del mismo paciente el mismo día). Quien tenga ese secreto Y el
identificador crudo puede re-derivar la huella; nadie puede hacer el camino inverso. Entre días la
clave cambia, así que las huellas de días distintos no se enlazan. Es una decisión consciente: el
estudio necesita distinguir consultas dentro de una jornada, no seguir a un paciente en el tiempo.

## El indicador permanente

Un medidor sin indicador es una cámara oculta. Por eso el icono de bandeja está **siempre**, dice el
estado (midiendo en tal consultorio / sin consultorio asignado / sin conexión), tiene **¿Qué mide esto?**,
y si el Explorador de Windows se reinicia el icono se vuelve a poner solo.

**No hay pausa ni salida desde el icono** (decisión del hospital, 2026-09-02): el instrumento mide el
consultorio de forma continua durante todo el estudio, igual que un contador de pasos en una puerta. La
única forma de detenerlo es desde el panel (pausar o retirar el PC) o desinstalarlo. Esto va en la
política que firma el hospital y en el texto que el propio programa muestra.

## Qué decirles a los médicos (borrador)

> Este computador mide **tiempos** de trabajo del consultorio, no contenido: cuánto tiempo se usa cada
> aplicación y el sistema clínico, cuántos clics y cuánto tecleo hay (nunca qué se escribe), y qué pantallas
> del sistema se recorren (nunca los datos del paciente). El nombre del paciente, su historia y lo que
> escribes no salen de este computador. Mide siempre, también cuando el PC está bloqueado o quieto, porque
> el estudio compara consultorios, no personas. Si quieres saber qué mide exactamente, haz clic en el
> círculo junto al reloj: «¿Qué mide esto?».

La política la firma el hospital; esto es el texto que ya está dentro del programa («¿Qué mide esto?»).
