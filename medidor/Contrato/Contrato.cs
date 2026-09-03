using Medidor;
using Microsoft.Data.Sqlite;

namespace Medidor.Pruebas;

/// <summary>
/// EL CONTRATO DEL MEDIDOR: 31 promesas — lo que promete el instrumento que mide el trabajo
/// clínico, escrito como pruebas que llaman al código real y corren sin pantalla, sin Windows y
/// sin red.
///
/// Las promesas 1-6 son de PRIVACIDAD y van primero a propósito: este medidor se instala en
/// consultorios y urgencias, donde las pantallas llevan nombres y diagnósticos. Mientras el arnés
/// no pueda demostrar que nada de eso sale en un lote, el resto del instrumento es cosmético.
///
/// Y las de conteo existen porque un medidor que cuenta mal no se nota: los números «se ven
/// normales». El repo ya pagó esa clase de fallo dos veces —el 29/30 con 19 pasos comidos, y el
/// promedio de 1.461 ms que era UNA muestra colgada— y aquí el precio sería peor: contaminar un
/// baseline que no se puede volver a medir. Las 24-31 son de la v2: grabación continua por
/// jornada, supervivencia del proceso y el cable v2 (contratos A–B del plan).
/// </summary>
internal static class Contrato
{
    private static int _fallos;

    private static int Main()
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.WriteLine("CONTRATO DEL MEDIDOR (el instrumento, aislado)\n");

        Prueba("1. un lote serializado jamás contiene el título de la ventana de entrada; el usuario SAP sí viaja", TituloJamasEnElLote);
        Prueba("2. una app fuera de la lista blanca sale como «otro», y una web solo sale como dominio permitido", FueraDeListaEsOtro);
        Prueba("3. la identidad SAP viaja sin el sufijo vista: y sin el título de la ventana", SapSinVistaNiTitulo);
        Prueba("4. del identificador de paciente solo sale la huella: el crudo no sobrevive, y normalizar quita los ceros de la izquierda", SoloSaleLaHuella);
        Prueba("5. la clave de la huella es la del día operativo que corta a las 06:00, y la jornada cambia ahí sola", LaClaveEsDelDiaOperativo);
        Prueba("6. la misma persona da la misma huella dentro del día operativo, y otra persona da otra", MismaPersonaMismaHuella);
        Prueba("7. un tick jamás aporta más de 2 000 ms: despertar de una suspensión no regala horas, y el salto queda contado", UnTickNoRegalaHoras);
        Prueba("8. activo es input en los últimos 60 s; sin input el tiempo es de primer plano, no activo", ActivoEsInputReciente);
        Prueba("9. la escritura se mide por ráfagas — huecos de hasta 1,5 s se unen — y del tecleo solo salen cantidades, jamás qué tecla fue", EscrituraPorRafagas);
        Prueba("10. una cubeta se parte cuando cambia la app, el encounter o el usuario SAP, y las partes suman el total sin doble conteo", LaCubetaSeParteSinDobleConteo);
        Prueba("11. cada milisegundo cae en exactamente una cubeta de 15 s alineada al reloj de pared, y bucket_ms es 15 000", CadaMsEnUnaCubeta);
        Prueba("12. la jornada es el único límite: a las 06:00 cambia sola, sin input ni turno, y entrega la cerrada", LaJornadaEsElUnicoLimite);
        Prueba("13. un PC bloqueado sigue emitiendo cubetas «bloqueado» con activo 0, sin paciente ni usuario SAP; sin foco es «otro»", BloqueadoSigueGrabando);
        Prueba("14. el spool no pierde ni duplica: lo tomado sin confirmación se vuelve a entregar idéntico, y la confirmación lo borra de una vez", ElSpoolNoPierdeNiDuplica);
        Prueba("15. el spool lleno descarta lo más viejo contando cada descarte — jamás en silencio — y sabe su formato", ElSpoolLlenoDescartaContando);
        Prueba("16. un lote respeta los topes por colección; una fila rechazada (veneno, por nombre del spool) sale, y una no procesada se reentrega", ElLoteRespetaTopesYVeneno);
        Prueba("17. cada evento lleva un uid monotónico por instalación que sobrevive al reinicio: el mismo evento no entra dos veces", ElUidSobreviveAlReinicio);
        Prueba("18. la calidad de la jornada cuenta lo que faltó: huecos, saltos, descartes, ganchos degradados y rearmados, SAP sin scripting, relanzos", LaCalidadCuentaLoQueFalto);
        Prueba("19. una visita SAP empieza al llegar a una identidad y termina al salir: su duración y su destino salen del stream, no de un cronómetro aparte", LaVisitaSaleDelStream);
        Prueba("20. la espera de SAP es la suma de sus round-trips: StartRequest abre, EndRequest cierra, y un cierre sin pareja no resta", LaEsperaEsLaSumaDeRoundtrips);
        Prueba("21. time-to-ready va de la llegada al primer EndRequest sin Busy; si nunca llega queda nulo, no cero", ReadyNuloNoCero);
        Prueba("22. el sobre v2 lleva jornadas y app_version, no shifts; cada fila abre con spool_seq y las muestras llevan dia_operativo y sap_user, no shift_id", ElSeqDelSpoolNoPisaElDeLaCubeta);
        Prueba("23. del teclado solo se distinguen Tab, Enter, borrar, copiar, pegar y guardar; una letra es indistinguible de otra, y al lote viajan cantidades, jamás códigos", SoloTeclasDeControl);
        Prueba("24. un reloj que se atasca 5 s aporta 2 s y cuenta 3 s de hueco", UnRelojAtascadoCuentaSuHueco);
        Prueba("25. ganchos ciegos mientras el sistema ve input se rearman al 3.er chequeo; en la pantalla de bloqueo no", GanchosCiegosSeRearman);
        Prueba("26. un colapso relanza como mucho 5 veces en 10 min; el sexto se deja al vigilante", UnColapsoRelanzaCincoVeces);
        Prueba("27. un spool corrupto se aparta con fecha y se recrea vacío sin tumbar el arranque", UnSpoolCorruptoSeAparta);
        Prueba("28. de una jornada solo viaja la última foto pendiente del proceso y del día; las de otro proceso o día no se tocan", SoloViajaLaUltimaFoto);
        Prueba("29. al pasar a formato 2 las filas v1 se purgan contando, una sola vez", LasFilasV1SePurganUnaVez);
        Prueba("30. la clave de la huella se deriva por tick del día operativo: a las 05:59 y 06:01 la misma persona da huellas distintas, sin turno", LaClaveSeDerivaPorTick);
        Prueba("31. la jornada lleva proceso_id: dos fotos del mismo día desde procesos distintos se distinguen", LaJornadaLlevaProcesoId);
        Prueba("32. un 403 de «no te conozco» vuelve a registrar; uno de pausa deliberada, no", LosDos403SeDistinguen);
        Prueba("33. si SAP no deja engancharse, el aviso al médico se espacia en vez de repetirse", ElEngancheNoAtosiga);
        Prueba("34. un tramo en el que no pasa nada viaja como UNA fila que cubre los mismos ms, ni uno más", LosTramosVaciosSeFunden);

        Console.WriteLine();
        Console.WriteLine(_fallos == 0
            ? $"MEDIDOR ÍNTEGRO: el instrumento promete lo que dice prometer ({_veredicto.Count}/{_veredicto.Count})."
            : $"MEDIDOR ROTO: {_fallos} promesa(s) incumplida(s) ({_veredicto.Count(v => v.Cumple)}/{_veredicto.Count}).");

        Apuntar();
        return _fallos;
    }

    // ── Material común ───────────────────────────────────────────────────────

    /// <remarks>
    /// El título hostil lleva lo que una pantalla de urgencias lleva de verdad: nombre y documento.
    /// Si alguna vez un lote lo contiene, la promesa 1 tiene que ponerse roja — se comprobó
    /// saboteando el Normalizador a propósito antes de dar verde la fase (regla nº5 del ciclo).
    /// </remarks>
    private const string TituloHostil = "Historia clínica — Juan Pérez Gómez (CC 123456789) - Google Chrome";

    private const string VersionDePrueba = "2.0.0";

    private static ConfigDeNormalizacion Config() => new(
        AppsPorProceso: new Dictionary<string, string>
        {
            ["chrome.exe"] = "chrome",
            ["msedge.exe"] = "edge",
            ["saplogon.exe"] = Normalizador.AppSap,
            ["winword.exe"] = "office",
            ["u.exe"] = "uexe",
        },
        DominiosPermitidos: new HashSet<string> { "intranet.hgm.gov.co" },
        DominiosMiracle: new HashSet<string> { "itsmiracleai.com.co", "www.itsmiracleai.com.co" });

    private static string RutaTemporal(string nombre)
    {
        var dir = Path.Combine(Path.GetTempPath(), "contrato-medidor", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(dir);
        return Path.Combine(dir, nombre);
    }

    private static readonly TimeSpan Bogota = TimeSpan.FromHours(-5); // América/Bogotá no cambia de hora

    // ── Privacidad (1-6) ─────────────────────────────────────────────────────

    private static void TituloJamasEnElLote()
    {
        var cfg = Config();
        var cubetas = new Cubetas();
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero);

        // Una web hostil, una app desconocida hostil, y un SAP con sufijo vista: hostil.
        var web = Normalizador.Normalizar(new EntradaDeSuperficie("chrome.exe", TituloHostil, "https://itsmiracleai.com.co/app", null), cfg);
        var rara = Normalizador.Normalizar(new EntradaDeSuperficie("hcvieja.exe", TituloHostil, null, null), cfg);
        var sap = Normalizador.Normalizar(new EntradaDeSuperficie("saplogon.exe", TituloHostil, null,
            "sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100/vista:Pacientes de Juan Pérez"), cfg);

        var aporte = new Aportes(1000, 1000, 200, 5, 2, 1, 0, 0, 0);
        cubetas.Registrar(t0.AddSeconds(1), web, null, aporte);
        cubetas.Registrar(t0.AddSeconds(2), rara, null, aporte);
        cubetas.Registrar(t0.AddSeconds(3), sap, "a1b2c3", aporte, "MEDICO01"); // el login del médico sí viaja; el título no

        using var spool = new SpoolSqlite(RutaTemporal("lote.db"));
        foreach (var m in cubetas.CosecharTodo()) spool.Encolar("muestras", Cable.Muestra(m));
        spool.Encolar("eventos", Cable.Evento("encounter_enter", t0, "a1b2c3",
            new Dictionary<string, object?> { ["reason"] = "regla", ["titulo"] = TituloHostil }));
        spool.Encolar("visitas", Cable.Visita(
            new Visita("sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100", "QAS", "NWP1", "0100", t0, t0.AddSeconds(5), 5000, null, 0, 0, null),
            "a1b2c3", "MEDICO01"));
        spool.Encolar("jornadas", Cable.Jornada(new Jornada(new DateOnly(2026, 9, 1), t0, t0.AddSeconds(3)), new Calidad(), VersionDePrueba, 1, Guid.NewGuid()));

        var lote = Lote.Serializar("dev-1", Guid.NewGuid().ToString(), t0.AddMinutes(1), VersionDePrueba, spool.Tomar(new LimitesDeLote()));

        Debe(!lote.Contains("Juan"), "el nombre del título no aparece en el lote");
        Debe(!lote.Contains("Pérez") && !lote.Contains("Perez"), "el apellido tampoco");
        Debe(!lote.Contains("123456789"), "ni el documento del título");
        Debe(!lote.Contains("vista:"), "ni el sufijo vista: de la identidad SAP");
        Debe(!lote.Contains("Historia"), "ni ningún fragmento del título");
        Debe(lote.Contains("a1b2c3"), "la huella sí viaja: sin ella no hay encounter");
        Debe(lote.Contains("\"sap_user\":\"MEDICO01\""), "el usuario SAP (login del médico, no del paciente) sí viaja, por cubeta y por visita");
        Debe(lote.Contains("\"reason\":\"regla\""), "del detail sobrevive lo de la lista blanca");
    }

    private static void FueraDeListaEsOtro()
    {
        var cfg = Config();
        var rara = Normalizador.Normalizar(new EntradaDeSuperficie("hcvieja.exe", "lo que sea", null, null), cfg);
        Debe(rara.App == Normalizador.AppOtro, "una app desconocida es «otro»");
        Debe(rara.Surface == null, "y no lleva superficie");

        var noPermitido = Normalizador.Normalizar(new EntradaDeSuperficie("chrome.exe", "x", "https://facebook.com/algo", null), cfg);
        Debe(noPermitido.App == "chrome" && noPermitido.Surface == null, "una web fuera de la lista es el navegador a secas, sin dominio");

        var permitido = Normalizador.Normalizar(new EntradaDeSuperficie("chrome.exe", "x", "https://intranet.hgm.gov.co/turnos?med=juan", null), cfg);
        Debe(permitido.Surface == "web://intranet.hgm.gov.co", "una web permitida sale como dominio, sin ruta ni query");

        var miracle = Normalizador.Normalizar(new EntradaDeSuperficie("msedge.exe", "x", "https://itsmiracleai.com.co/app/consultas/123", null), cfg);
        Debe(miracle.App == Normalizador.AppMiracle, "el portal de Miracle es su propia app: es la métrica «tiempo en Miracle»");
        Debe(miracle.Surface == "web://itsmiracleai.com.co", "y también sale solo el dominio");
    }

    private static void SapSinVistaNiTitulo()
    {
        Debe(Normalizador.SinVista("sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100/vista:Triage de Juan")
             == "sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100",
            "el sufijo vista: (texto libre del árbol) se corta");
        Debe(Normalizador.SinVista("sapgui://QAS/NV2000/SAPMNPA10/0100/subPATEINST")
             == "sapgui://QAS/NV2000/SAPMNPA10/0100/subPATEINST",
            "el subdynpro NO es vista: y se conserva — sin él dos pantallas distintas parecen la misma");

        var cfg = Config();
        var sap = Normalizador.Normalizar(new EntradaDeSuperficie("saplogon.exe", TituloHostil, null,
            "sapgui://QAS/NV2000/SAPMNPA10/0100/subPATEINST/vista:Órdenes de Juan"), cfg);
        Debe(sap.App == Normalizador.AppSap, "SAP es SAP");
        Debe(sap.Surface == "sapgui://QAS/NV2000/SAPMNPA10/0100/subPATEINST", "y su superficie va limpia");

        var partes = Normalizador.PartesSap("sapgui://QAS/NV2000/SAPMNPA10/0100/subPATEINST");
        Debe(partes != null && partes.Value.Sid == "QAS" && partes.Value.Tcode == "NV2000" && partes.Value.Dynpro == "0100",
            "de la superficie salen SID, transacción y dynpro");
    }

    private static void SoloSaleLaHuella()
    {
        Debe(Huella.Normalizar("0012345", "digitos_sin_ceros") == "12345", "normalizar quita los ceros de la izquierda");
        Debe(Huella.Normalizar("CC 00998877", "digitos_sin_ceros") == "998877", "y se queda solo con los dígitos");
        Debe(Huella.Normalizar("sin números", "digitos_sin_ceros") == null, "sin dígitos no hay identificador — null, no cadena vacía");

        var clave = Huella.ClaveDelDia(System.Text.Encoding.UTF8.GetBytes("secreto-de-la-org"), new DateOnly(2026, 9, 1));
        var a = Huella.DeIdentificador(clave, Huella.Normalizar("0012345", "digitos_sin_ceros")!);
        var b = Huella.DeIdentificador(clave, Huella.Normalizar("12345", "digitos_sin_ceros")!);
        Debe(a == b, "con ceros o sin ellos, es el mismo paciente y la misma huella");
        Debe(a.Length == 32 && a.All(Uri.IsHexDigit), "la huella es hex de 32 — nada del crudo sobrevive en su forma");
    }

    /// <remarks>
    /// El corte a las 06:00 existe por las noches de urgencias: cruzan la medianoche, y si la clave
    /// rotara a las 00:00 el mismo paciente daría DOS huellas en la misma noche — el entrelazado
    /// A→B→A quedaría partido justo donde más importa. Ya no hay turno que «fije» la clave: la
    /// jornada cambia a las 06:00 y la clave con ella, sin que nadie toque nada.
    /// </remarks>
    private static void LaClaveEsDelDiaOperativo()
    {
        Debe(Huella.DiaOperativo(new DateTimeOffset(2026, 9, 1, 5, 59, 0, Bogota)) == new DateOnly(2026, 8, 31),
            "a las 05:59 todavía es el día operativo anterior");
        Debe(Huella.DiaOperativo(new DateTimeOffset(2026, 9, 1, 6, 1, 0, Bogota)) == new DateOnly(2026, 9, 1),
            "a las 06:01 ya es el nuevo");
        Debe(Huella.DiaOperativo(new DateTimeOffset(2026, 9, 2, 2, 0, 0, Bogota)) == new DateOnly(2026, 9, 1),
            "a las 02:00 de la madrugada sigue siendo el mismo día operativo — la noche no parte al paciente en dos");

        var secreto = System.Text.Encoding.UTF8.GetBytes("secreto-de-la-org");
        Debe(!Huella.ClaveDelDia(secreto, new DateOnly(2026, 8, 31)).SequenceEqual(Huella.ClaveDelDia(secreto, new DateOnly(2026, 9, 1))),
            "días operativos distintos, claves distintas: las huellas no se enlazan entre días");

        var j = new Jornadas();
        Debe(j.Avanzar(new DateTimeOffset(2026, 9, 1, 19, 0, 0, Bogota)) == null && j.Actual!.Dia == new DateOnly(2026, 9, 1),
            "la jornada de las 19:00 es la del día en que empezó");
        Debe(j.Avanzar(new DateTimeOffset(2026, 9, 2, 2, 0, 0, Bogota)) == null, "a las 02:00 sigue la misma jornada");
        Debe(j.Avanzar(new DateTimeOffset(2026, 9, 2, 5, 59, 0, Bogota)) == null, "y a las 05:59 también");
        var cerrada = j.Avanzar(new DateTimeOffset(2026, 9, 2, 6, 1, 0, Bogota));
        Debe(cerrada != null && cerrada.Dia == new DateOnly(2026, 9, 1), "a las 06:01 la jornada anterior se entrega cerrada");
        Debe(j.Actual!.Dia == new DateOnly(2026, 9, 2), "y la nueva es del día nuevo");
        Debe(!Huella.ClaveDelDia(secreto, cerrada!.Dia).SequenceEqual(Huella.ClaveDelDia(secreto, j.Actual.Dia)),
            "con claves distintas: de las 05:59 a las 06:01 la huella rota sola, sin turno");
    }

    private static void MismaPersonaMismaHuella()
    {
        var clave = Huella.ClaveDelDia(System.Text.Encoding.UTF8.GetBytes("secreto"), new DateOnly(2026, 9, 1));
        Debe(Huella.DeIdentificador(clave, "555001") == Huella.DeIdentificador(clave, "555001"), "la huella es determinista");
        Debe(Huella.DeIdentificador(clave, "555001") != Huella.DeIdentificador(clave, "555002"), "y dos personas no chocan");
    }

    // ── El reloj y la actividad (7-9) ────────────────────────────────────────

    /// <remarks>
    /// EL FALLO QUE ESTO IMPIDE: el PC se suspende a las 14:00 y despierta a las 17:00. Un reloj
    /// ingenuo suma 3 horas de «trabajo». El portal ya pagó esto y su respuesta (MAX_TICK_MS=2000)
    /// se hereda con el mismo umbral para que las fases del estudio midan con la misma vara.
    /// </remarks>
    private static void UnTickNoRegalaHoras()
    {
        var pared = new DateTimeOffset(2026, 9, 1, 14, 0, 0, TimeSpan.Zero);
        var r = new Reloj(1000, pared);

        var normal = r.Avanzar(2000, pared.AddSeconds(1));
        Debe(normal.AporteMs == 1000 && normal.HuecoMs == 0 && normal.DesfaseRelojMs == 0, "un tick normal aporta su delta");

        long tresHoras = 3L * 3600 * 1000;
        var despierto = r.Avanzar(2000 + tresHoras, pared.AddSeconds(1).AddMilliseconds(tresHoras));
        Debe(despierto.AporteMs <= Reloj.AporteMaxMs, "despertar de 3 h aporta como mucho 2 000 ms");
        Debe(despierto.HuecoMs >= tresHoras - Reloj.AporteMaxMs, "y el resto queda contado como hueco, no desaparece");

        long dosHoras = 2L * 3600 * 1000;
        var salto = r.Avanzar(3000 + tresHoras, pared.AddSeconds(2).AddMilliseconds(tresHoras + dosHoras));
        Debe(salto.DesfaseRelojMs != 0, "si la pared salta sin que el monotónico salte, el desfase se dice — alguien movió el reloj");

        var atascado = r.Avanzar(8000 + tresHoras, pared.AddSeconds(7).AddMilliseconds(tresHoras + dosHoras));
        Debe(atascado.AporteMs == 2000 && atascado.HuecoMs == 3000 && atascado.DesfaseRelojMs == 0,
            "un estancamiento de 5 s aporta 2 s y cuenta 3 s de hueco: antes esos 3 s desaparecían");
    }

    private static void ActivoEsInputReciente()
    {
        Debe(Actividad.DebeContar(100_000, 41_000), "input hace 59 s: cuenta");
        Debe(!Actividad.DebeContar(100_000, 39_000), "input hace 61 s: es primer plano, no actividad");
        Debe(Actividad.DebeContar(100_000, 100_000), "input ahora mismo: cuenta");
    }

    private static void EscrituraPorRafagas()
    {
        Debe(Escritura.MsDeRafagas(Array.Empty<long>()) == 0, "sin teclas no hay escritura");
        Debe(Escritura.MsDeRafagas(new long[] { 42 }) == Escritura.ColaDeRafagaMs, "una tecla suelta vale su cola, no cero");
        Debe(Escritura.MsDeRafagas(new long[] { 0, 300, 600 }) == 600 + Escritura.ColaDeRafagaMs, "una ráfaga es de la primera a la última más la cola");
        Debe(Escritura.MsDeRafagas(new long[] { 0, 300, 600, 5000, 5200 }) == (600 + 500) + (200 + 500),
            "un hueco mayor a 1,5 s parte la ráfaga: pensar no es teclear");
        Debe(Escritura.MsDeRafagas(new long[] { 0, 1400, 2800 }) == 2800 + Escritura.ColaDeRafagaMs,
            "huecos de hasta 1,5 s se unen: teclear lento sigue siendo teclear");
    }

    // ── Las cubetas (10-11) ──────────────────────────────────────────────────

    private static void LaCubetaSeParteSinDobleConteo()
    {
        var c = new Cubetas();
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero); // alineado a 15 s
        var chrome = new Superficie("chrome", null);
        var sap = new Superficie("sap", "sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100");

        Aportes mil = new(1000, 1000, 0, 0, 0, 0, 0, 0, 0);
        c.Registrar(t0.AddSeconds(1), chrome, null, mil);
        c.Registrar(t0.AddSeconds(2), sap, null, mil);
        c.Registrar(t0.AddSeconds(3), sap, "enc-1", mil);
        c.Registrar(t0.AddSeconds(4), chrome, null, mil);
        c.Registrar(t0.AddSeconds(5), sap, "enc-1", mil, "MED02"); // mismo SAP y paciente, otro usuario SAP: otra parte

        var filas = c.CosecharTodo();
        Debe(filas.Count == 4, "cuatro contextos distintos son cuatro partes, aunque uno vuelva");
        Debe(filas.All(f => f.BucketStart == t0), "todas de la misma cubeta");
        Debe(filas.Select(f => f.Seq).OrderBy(x => x).SequenceEqual(new[] { 0, 1, 2, 3 }), "con su orden de aparición");
        Debe(filas.Sum(f => f.ForegroundMs) == 5000, "y las partes suman el total: nada se cuenta dos veces ni se pierde");
        Debe(filas.Count(f => f.EncounterKey == "enc-1") == 2 && filas.Single(f => f.SapUser == "MED02").ForegroundMs == 1000,
            "el encounter parte la cubeta igual que la app, y el usuario SAP también");
        Debe(filas.All(f => f.DiaOperativo == new DateOnly(2026, 9, 1)), "y toda parte sabe su día operativo");
    }

    private static void CadaMsEnUnaCubeta()
    {
        var c = new Cubetas();
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero);
        var app = new Superficie("sap", null);
        // Con actividad a propósito: una cubeta sin nada dentro se funde con la siguiente (promesa 34),
        // y lo que aquí se juzga es la alineación al reloj y el tamaño de UNA cubeta.
        Aportes mil = new(1000, 1000, 0, 0, 1, 0, 0, 0, 0);

        c.Registrar(t0.AddSeconds(14.5), app, null, mil);
        c.Registrar(t0.AddSeconds(15.5), app, null, mil);

        var cerradas = c.Cosechar(t0.AddSeconds(15));
        Debe(cerradas.Count == 1 && cerradas[0].BucketStart == t0, "cosechar cierra solo las cubetas ya completas");

        var resto = c.CosecharTodo();
        Debe(resto.Count == 1 && resto[0].BucketStart == t0.AddSeconds(15), "lo que cayó tras el borde vive en la cubeta siguiente");
        Debe(cerradas.Concat(resto).All(f => f.BucketStart.ToUnixTimeMilliseconds() % Cubetas.TamanoMs == 0),
            "toda cubeta arranca en un múltiplo exacto de 15 s del reloj de pared");
        Debe(cerradas.Sum(f => f.ForegroundMs) + resto.Sum(f => f.ForegroundMs) == 2000, "y entre las dos está todo lo aportado");
        Debe(cerradas.Concat(resto).All(f => f.BucketMs == Cubetas.TamanoMs),
            "bucket_ms es el tamaño de la cubeta (15 000), no lo que se vio en ella — antes llevaba foreground_ms por un argumento mal pasado");
    }

    // ── La jornada y la grabación continua (12-13) ───────────────────────────

    /// <remarks>
    /// EL FALLO QUE ESTO IMPIDE: el turno se cerraba a las 4 h sin input o a las 2 h bloqueado y
    /// solo se reabría con input; mientras tanto no se grababa NADA y la línea de tiempo quedaba en
    /// blanco. La jornada no tiene causas de cierre: el único límite es el día operativo.
    /// </remarks>
    private static void LaJornadaEsElUnicoLimite()
    {
        var j = new Jornadas();
        var t0 = new DateTimeOffset(2026, 9, 1, 7, 0, 0, Bogota);
        Debe(j.Actual == null, "sin latidos no hay jornada");

        j.Avanzar(t0);
        Debe(j.Actual != null && j.Actual.PrimeraMuestra == t0 && j.Actual.UltimaMuestra == t0, "el primer latido abre la jornada");

        // 4 h sin input, 2 h bloqueado, 12 h de noche: nada de eso la cierra.
        Debe(j.Avanzar(t0.AddHours(11)) == null && j.Avanzar(t0.AddHours(19)) == null,
            "ni la inactividad ni la noche cierran nada: la jornada no depende de input ni de turno");
        Debe(j.Actual!.UltimaMuestra == t0.AddHours(19), "y la última muestra avanza con cada latido");

        var cerrada = j.Avanzar(new DateTimeOffset(2026, 9, 2, 6, 0, 0, Bogota));
        Debe(cerrada != null && cerrada.PrimeraMuestra == t0 && cerrada.UltimaMuestra == t0.AddHours(19),
            "a las 06:00 en punto se entrega la cerrada, con su primera y su última muestra");
        Debe(j.Actual!.Dia == new DateOnly(2026, 9, 2) && j.Actual.PrimeraMuestra == new DateTimeOffset(2026, 9, 2, 6, 0, 0, Bogota),
            "y la nueva arranca ahí mismo");
        Debe(j.Avanzar(new DateTimeOffset(2026, 9, 2, 6, 0, 1, Bogota)) == null, "un cierre por jornada, no uno por latido");
    }

    /// <remarks>
    /// Contrato 5 del plan: `app='bloqueado'`, `surface=null`, `encounter_key=null`, `sap_user=null`,
    /// `active_ms=0`, `foreground_ms=transcurrido`. Antes un PC bloqueado no producía ninguna cubeta
    /// y el panel no podía distinguir «bloqueado» de «el medidor murió».
    /// </remarks>
    private static void BloqueadoSigueGrabando()
    {
        var sap = new Superficie("sap", "sapgui://QAS/NWP1/P/0100");

        var bloqueado = Continuidad.Atribuir(true, sap, "enc-1", "MED01", true);
        Debe(bloqueado.Superficie.App == Continuidad.AppBloqueado && bloqueado.Superficie.Surface == null,
            "bloqueado es la app «bloqueado», sin superficie — aunque SAP siga abierto detrás");
        Debe(bloqueado.EncounterKey == null && bloqueado.SapUser == null && !bloqueado.Activo,
            "sin paciente, sin usuario SAP y nunca activo, aunque haya input (la contraseña no es trabajo)");

        var libre = Continuidad.Atribuir(false, sap, "enc-1", "MED01", true);
        Debe(libre.Superficie == sap && libre.EncounterKey == "enc-1" && libre.SapUser == "MED01" && libre.Activo,
            "desbloqueado, todo sigue como estaba");

        var sinFoco = Continuidad.Atribuir(false, null, "enc-1", "MED01", false);
        Debe(sinFoco.Superficie.App == Normalizador.AppOtro && sinFoco.Superficie.Surface == null && !sinFoco.Activo,
            "sin ventana delante es «otro» (con su paciente y usuario), no un tick perdido");

        var c = new Cubetas();
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero);
        for (int i = 0; i < 15; i++)
            c.Registrar(t0.AddSeconds(i), bloqueado.Superficie, bloqueado.EncounterKey,
                new Aportes(1000, bloqueado.Activo ? 1000 : 0, 0, 0, 0, 0, 0, 0, 0), bloqueado.SapUser);
        var m = c.CosecharTodo().Single();
        Debe(m.App == "bloqueado" && m.ForegroundMs == 15_000 && m.ActiveMs == 0,
            "quince segundos bloqueado son UNA cubeta «bloqueado» con 15 s de primer plano y 0 de activo");

        var json = Cable.Muestra(m);
        Debe(json.Contains("\"app\":\"bloqueado\"") && json.Contains("\"surface\":null") && json.Contains("\"encounter_key\":null")
             && json.Contains("\"sap_user\":null") && json.Contains("\"active_ms\":0") && json.Contains("\"foreground_ms\":15000"),
            "y así viaja al servidor");
    }

    // ── El spool (14-17) ─────────────────────────────────────────────────────

    private static void ElSpoolNoPierdeNiDuplica()
    {
        var ruta = RutaTemporal("spool.db");
        using (var spool = new SpoolSqlite(ruta))
        {
            spool.Encolar("eventos", "{\"kind\":\"a\"}");
            spool.Encolar("eventos", "{\"kind\":\"b\"}");
            spool.Encolar("eventos", "{\"kind\":\"c\"}");

            var primero = spool.Tomar(new LimitesDeLote());
            Debe(primero.Eventos.Count == 3, "lo encolado se entrega");

            var segundo = spool.Tomar(new LimitesDeLote());
            Debe(segundo.Eventos.Select(f => f.Seq).SequenceEqual(primero.Eventos.Select(f => f.Seq)),
                "sin confirmación, la re-entrega es IDÉNTICA — así un lote perdido en la red no pierde nada");

            spool.Confirmar(primero);
            Debe(spool.Tomar(new LimitesDeLote()).Vacio, "la confirmación borra de una vez: no hay re-envío de lo ya aceptado");

            spool.Encolar("muestras", "{\"n\":1}");
            spool.Encolar("muestras", "{\"n\":2}");
        }
        // El kill a mitad de jornada: se cerró el proceso sin confirmar. Nada se pierde.
        using (var renacido = new SpoolSqlite(ruta))
        {
            var pendiente = renacido.Tomar(new LimitesDeLote());
            Debe(pendiente.Muestras.Count == 2, "lo que quedó sin confirmar sobrevive al reinicio");
        }
    }

    private static void ElSpoolLlenoDescartaContando()
    {
        var ruta = RutaTemporal("lleno.db");
        var relleno = new string('x', 200);
        using (var spool = new SpoolSqlite(ruta, topeBytes: 8_000))
        {
            for (int i = 0; i < 100; i++) spool.Encolar("muestras", $"{{\"n\":{i},\"relleno\":\"{relleno}\"}}");

            Debe(spool.DescartesAcumulados > 0, "el tope descarta — el disco de un PC de consultorio no es infinito");
            var lote = spool.Tomar(new LimitesDeLote());
            Debe(!lote.Muestras.Any(f => f.Json.Contains("\"n\":0,")), "y lo descartado es lo más viejo, no lo recién medido");
            Debe(spool.BytesAproximados <= 8_000 + 500, "el spool queda alrededor de su tope");
        }
        using (var renacido = new SpoolSqlite(ruta, topeBytes: 8_000))
        {
            Debe(renacido.DescartesAcumulados > 0, "el conteo de descartes sobrevive al reinicio: el hueco no se olvida");
            Debe(renacido.FormatoEnDisco == SpoolSqlite.Formato && SpoolSqlite.Formato == 2, "y el spool sabe su formato: 2, y lo conserva al reabrir");
        }
    }

    private static void ElLoteRespetaTopesYVeneno()
    {
        using var spool = new SpoolSqlite(RutaTemporal("topes.db"));
        for (int i = 0; i < 1100; i++) spool.Encolar("muestras", $"{{\"n\":{i}}}");

        var lote = spool.Tomar(new LimitesDeLote());
        Debe(lote.Muestras.Count == 1000, "el lote corta en el tope: el drenaje tras días sin red no revienta al servidor");

        var envenenada = lote.Muestras[0];
        spool.Envenenar("muestras", envenenada.Seq);
        Debe(spool.VenenosAcumulados == 1, "el veneno se cuenta");
        var siguiente = spool.Tomar(new LimitesDeLote());
        Debe(siguiente.Muestras.All(f => f.Seq != envenenada.Seq),
            "y la fila que el servidor rechazó no vuelve: una fila mala no puede atascar la cola para siempre");

        // El servidor nombra la colección con el nombre del spool (v2) o con el del cable (espejo
        // v1): las dos se traducen al del spool; un nombre inventado no señala nada.
        Debe(Cable.ColeccionDelSpool("samples") == "muestras" && Cable.ColeccionDelSpool("events") == "eventos"
             && Cable.ColeccionDelSpool("sap_visits") == "visitas" && Cable.ColeccionDelSpool("jornadas") == "jornadas",
            "los nombres del cable se traducen al del spool");
        Debe(Cable.ColeccionDelSpool("muestras") == "muestras" && Cable.ColeccionDelSpool("eventos") == "eventos" && Cable.ColeccionDelSpool("visitas") == "visitas",
            "y los del spool se quedan como están");
        Debe(Cable.ColeccionDelSpool("shifts") == null && Cable.ColeccionDelSpool("turnos") == null && Cable.ColeccionDelSpool("") == null && Cable.ColeccionDelSpool(null) == null,
            "un nombre desconocido es null: un veneno con colección inventada no borra nada");

        // Contrato 2: confirmar = enviado − rechazadas − no_procesadas. La no procesada se queda y
        // encabeza el siguiente lote; la rechazada se saca aparte y no vuelve.
        var reentregar = siguiente.Muestras[1];
        var rechazada = siguiente.Muestras[2];
        var confirmables = Lote.Confirmables(siguiente,
            noProcesadas: new[] { ("muestras", reentregar.Seq) },
            veneno: new[] { ("muestras", rechazada.Seq) });
        Debe(confirmables.Muestras.Count == siguiente.Muestras.Count - 2
             && !confirmables.Muestras.Any(f => f.Seq == reentregar.Seq || f.Seq == rechazada.Seq),
            "lo confirmable es lo enviado menos la rechazada y la no procesada");
        spool.Envenenar("muestras", rechazada.Seq);
        spool.Confirmar(confirmables);
        var tercero = spool.Tomar(new LimitesDeLote());
        Debe(tercero.Muestras.Count > 0 && tercero.Muestras[0].Seq == reentregar.Seq, "la no procesada se queda y encabeza el siguiente lote");
        Debe(tercero.Muestras.All(f => f.Seq != rechazada.Seq), "y la rechazada no vuelve");
    }

    private static void ElUidSobreviveAlReinicio()
    {
        var ruta = RutaTemporal("uids.db");
        long ultimo;
        using (var spool = new SpoolSqlite(ruta))
        {
            var s1 = spool.Encolar("eventos", "{\"kind\":\"a\"}");
            var s2 = spool.Encolar("eventos", "{\"kind\":\"b\"}");
            Debe(s2 > s1, "el uid crece");
            var lote = spool.Tomar(new LimitesDeLote());
            spool.Confirmar(lote);
            ultimo = s2;
        }
        using (var renacido = new SpoolSqlite(ruta))
        {
            var s3 = renacido.Encolar("eventos", "{\"kind\":\"c\"}");
            Debe(s3 > ultimo,
                "tras reiniciar Y tras borrar lo confirmado, el uid sigue creciendo: el servidor puede desechar duplicados con confianza");
        }
    }

    private static void LaCalidadCuentaLoQueFalto()
    {
        var c = new Calidad();
        c.Hueco(5000);
        c.Hueco(2500);
        c.SaltoDeReloj();
        c.Descartes(3);
        c.GanchosDegradados();
        c.TickSapSaltado();
        c.TickSapSaltado();
        c.GanchoRearmado();
        c.GanchoRearmado();
        c.SapEnganchado();
        c.SapEventosEnganchados();
        c.Relanzo();

        Debe(c.HuecosMs == 7500 && c.Saltos == 1 && c.DescartesTotal == 3 && c.Degradados && c.TicksSapSaltados == 2,
            "cada carencia lleva su cuenta");
        Debe(c.HooksRearmados == 2 && c.SapScripting == true && c.SapEventosCom == true && c.Relanzos == 1,
            "también las de la v2: rearmes de ganchos, SAP con scripting y eventos COM, relanzos");
        var json = c.ComoJson();
        Debe(json.Contains("\"huecos_ms\":7500") && json.Contains("\"clock_jumps\":1")
             && json.Contains("\"spool_dropped\":3") && json.Contains("\"hooks_degradados\":true"),
            "y viaja con nombre: una jornada de mala calidad tiene que poder excluirse del estudio");
        Debe(json.Contains("\"hooks_rearmados\":2") && json.Contains("\"sap_scripting\":true")
             && json.Contains("\"sap_eventos_com\":true") && json.Contains("\"relanzos\":1"),
            "con las claves nuevas de la fila de jornada");

        var vacia = new Calidad();
        Debe(vacia.ComoJson().Contains("\"sap_scripting\":null") && vacia.ComoJson().Contains("\"sap_eventos_com\":null"),
            "sin SAP a la vista, sap_scripting y sap_eventos_com son nulos — no false: no se sabe, no se inventa");
        var sin = new Calidad();
        sin.SapSinScripting();
        Debe(sin.SapScripting == false, "SAP delante más de un minuto sin motor es un no");
        sin.SapEnganchado();
        sin.SapSinScripting();
        Debe(sin.SapScripting == true, "y si el motor entra alguna vez, el sí gana");
    }

    // ── El viaje SAP (19-21) ─────────────────────────────────────────────────

    private static (List<Visita> Visitas, Viaje Viaje) CorrerFixture()
    {
        var ruta = Path.Combine(AppContext.BaseDirectory, "bronce", "stream-sap.txt");
        var pared0 = new DateTimeOffset(2026, 9, 1, 8, 0, 0, Bogota);
        var viaje = new Viaje();
        var visitas = new List<Visita>();

        foreach (var linea in File.ReadAllLines(ruta))
        {
            if (string.IsNullOrWhiteSpace(linea) || linea.StartsWith('#')) continue;
            var partes = linea.Split('|');
            long ms = long.Parse(partes[0]);
            switch (partes[1])
            {
                case "superficie":
                    var cerrada = viaje.AlCambiarSuperficie(ms, pared0.AddMilliseconds(ms), partes[2]);
                    if (cerrada != null) visitas.Add(cerrada);
                    break;
                case "salida":
                    var pendiente = viaje.CerrarPendiente(ms, pared0.AddMilliseconds(ms));
                    if (pendiente != null) visitas.Add(pendiente);
                    break;
                case "start":
                    viaje.AlStartRequest(ms);
                    break;
                case "end":
                    viaje.AlEndRequest(ms, bool.Parse(partes[2]));
                    break;
            }
        }
        return (visitas, viaje);
    }

    private static void LaVisitaSaleDelStream()
    {
        var (visitas, _) = CorrerFixture();

        Debe(visitas.Count == 4, "el recorrido congelado tiene cuatro visitas — ni una más por releer la misma identidad");
        Debe(visitas[0].Tcode == "SESSION_MANAGER" && visitas[0].DwellMs == 5000, "la primera dura hasta que se llega a la segunda");
        Debe(visitas[0].ExitTo == "sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100", "y dice a dónde se fue: eso ES el journey");
        Debe(visitas[1].Tcode == "NWP1" && visitas[1].DwellMs == 25_000, "el puesto de trabajo acumula su tiempo");
        Debe(visitas[2].Tcode == "NV2000" && visitas[2].DwellMs == 60_000, "el triage el suyo");
        Debe(visitas[2].ExitTo == "sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100", "y la vuelta al puesto queda en la cadena");
        Debe(visitas[3].Tcode == "NWP1" && visitas[3].ExitTo == null && visitas[3].DwellMs == 2000,
            "salir de SAP cierra la última visita sin destino");
        Debe(visitas[1].Roundtrips == 2 && visitas[1].EsperaMs == 2700, "los round-trips pertenecen a la visita donde ocurrieron");
        Debe(visitas[2].Roundtrips == 2 && visitas[2].EsperaMs == 3200, "también en el triage");
    }

    private static void LaEsperaEsLaSumaDeRoundtrips()
    {
        var e = new EsperaSap();
        e.Start(1000);
        e.End(1600, busyDespues: false);
        Debe(e.EsperaMs == 600 && e.Roundtrips == 1, "un round-trip suma su duración");

        e.End(2000, busyDespues: false);
        Debe(e.EsperaMs == 600 && e.Roundtrips == 1, "un EndRequest sin StartRequest no suma ni resta — y tampoco cuenta como viaje");

        e.Start(3000);
        e.End(3400, busyDespues: true);
        Debe(e.EsperaMs == 1000 && e.Roundtrips == 2, "el que termina aún ocupado también fue una espera real");
    }

    /// <remarks>
    /// «Una caja que miente es peor que no tener caja» (aprendizaje nº4): un ready de 0 ms diría
    /// «la pantalla estuvo lista al instante», cuando la verdad es que nunca se midió. Nulo dice
    /// la verdad; cero la inventa.
    /// </remarks>
    private static void ReadyNuloNoCero()
    {
        var (visitas, _) = CorrerFixture();

        Debe(visitas[0].ReadyMs == 2600, "el ready de la primera visita es su primer EndRequest sin ocupado");
        Debe(visitas[1].ReadyMs == 2150, "en el puesto, el primer fin desocupado llega tras el encadenado — el ocupado de en medio no vale");
        Debe(visitas[2].ReadyMs == 3500, "el triage tarda lo que tarda");
        Debe(visitas[3].ReadyMs == null, "y la visita sin round-trip queda SIN ready — nulo, no cero");
    }

    // ── El cable (22) ────────────────────────────────────────────────────────

    /// <remarks>
    /// Antes el spool inyectaba su seq como «seq» y la muestra ya traía «seq» (el segmento de la
    /// cubeta): dos claves iguales en un objeto. Un lector JSON se queda con la última, así que el
    /// servidor construía el uid con el seq de la cubeta (0, 1, 2…) y, al rechazar una fila, el
    /// cliente envenenaba la fila 0/1/2 del spool — otra, o ninguna. Se vio revisando el cable
    /// contra la ingesta, no en producción (2026-09-01). El sobre v2 además cambió de forma: sin
    /// `shifts`, con `jornadas` y `app_version`, y cada muestra con su día operativo y su usuario SAP.
    /// Con <c>CONTRATO_MOSTRAR_LOTE=1</c> imprime el sobre entero: es la referencia para la ingesta.
    /// </remarks>
    private static void ElSeqDelSpoolNoPisaElDeLaCubeta()
    {
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero);
        var cubetas = new Cubetas();
        var aporte = new Aportes(1000, 1000, 0, 0, 1, 0, 0, 0, 0);
        // Dos contextos en la misma cubeta → dos muestras con seq de cubeta 0 y 1.
        cubetas.Registrar(t0.AddSeconds(1), new Superficie("sap", "sapgui://QAS/NWP1/P/0100"), null, aporte, "MED01");
        cubetas.Registrar(t0.AddSeconds(2), new Superficie("chrome", null), null, aporte);

        using var spool = new SpoolSqlite(RutaTemporal("cable.db"));
        foreach (var m in cubetas.CosecharTodo()) spool.Encolar("muestras", Cable.Muestra(m));
        spool.Encolar("eventos", Cable.Evento("lock", t0, null, null));
        var calidad = new Calidad();
        calidad.Hueco(1200);
        spool.Encolar("jornadas", Cable.Jornada(new Jornada(new DateOnly(2026, 9, 1), t0, t0.AddSeconds(2)), calidad, VersionDePrueba, 1,
            Guid.Parse("11111111-2222-3333-4444-555555555555")));

        var lote = Lote.Serializar("dev-1", "b1", t0, VersionDePrueba, spool.Tomar(new LimitesDeLote()));
        if (Environment.GetEnvironmentVariable("CONTRATO_MOSTRAR_LOTE") == "1") Console.WriteLine("   lote v2 → " + lote);

        using var doc = System.Text.Json.JsonDocument.Parse(lote);
        var raiz = doc.RootElement;
        var muestras = raiz.GetProperty("samples").EnumerateArray().ToList();
        var eventos = raiz.GetProperty("events").EnumerateArray().ToList();
        var jornadas = raiz.GetProperty("jornadas").EnumerateArray().ToList();

        Debe(raiz.GetProperty("app_version").GetString() == VersionDePrueba && raiz.TryGetProperty("client_now", out _) && raiz.TryGetProperty("batch_id", out _),
            "el sobre lleva app_version, client_now y batch_id");
        Debe(!raiz.TryGetProperty("shifts", out _) && raiz.TryGetProperty("sap_visits", out _), "sin shifts: la unidad es la jornada");
        Debe(jornadas.Count == 1 && jornadas[0].GetProperty("proceso_id").GetString() == "11111111-2222-3333-4444-555555555555"
             && jornadas[0].GetProperty("huecos_ms").GetInt64() == 1200, "la jornada viaja con su proceso_id y su calidad");
        Debe(muestras.Count == 2, "las dos muestras viajan");
        Debe(muestras.All(m => m.TryGetProperty("spool_seq", out _)), "cada muestra lleva su spool_seq");
        Debe(muestras.Select(m => m.GetProperty("spool_seq").GetInt64()).Distinct().Count() == 2, "los spool_seq son distintos entre filas");
        Debe(muestras.Select(m => m.GetProperty("seq").GetInt32()).OrderBy(x => x).SequenceEqual(new[] { 0, 1 }), "el seq de la cubeta (0 y 1) sigue intacto");
        Debe(muestras.All(m => m.GetProperty("dia_operativo").GetString() == "2026-09-01" && m.GetProperty("bucket_ms").GetInt32() == 15_000),
            "cada muestra lleva su dia_operativo y bucket_ms 15 000");
        Debe(muestras.Any(m => m.GetProperty("sap_user").GetString() == "MED01") && muestras.Any(m => m.GetProperty("sap_user").ValueKind == System.Text.Json.JsonValueKind.Null),
            "y su sap_user (o null si no lo hubo)");
        Debe(eventos.Count == 1 && eventos[0].TryGetProperty("spool_seq", out _) && eventos[0].GetProperty("dia_operativo").GetString() == "2026-09-01",
            "el evento lleva su spool_seq y su dia_operativo");
        Debe(!lote.Contains("shift_id"), "ninguna fila lleva shift_id");
        Debe(System.Text.RegularExpressions.Regex.Matches(lote, "\\{\"spool_seq\":").Count == 4, "las cuatro filas abren con spool_seq");
        Debe(!System.Text.RegularExpressions.Regex.IsMatch(lote, "\\{\"seq\":"), "ninguna fila abre con «seq»: el del spool ya no se llama así");
    }

    // ── El teclado (23) ──────────────────────────────────────────────────────

    private static void SoloTeclasDeControl()
    {
        // Ninguna letra, número ni símbolo se distingue de otro: todas caen en Ninguna.
        var letras = Enumerable.Range(0x30, 10).Concat(Enumerable.Range(0x41, 26)).Concat(new[] { 0x20, 0xBA, 0xBC, 0xBE, 0xBF, 0xDB, 0xDE });
        Debe(letras.All(vk => TeclasDeControl.Clasificar(vk, false, false) == TeclaDeControl.Ninguna), "sin Ctrl, letras, números y símbolos son «Ninguna»");
        Debe(letras.Where(vk => vk is not (TeclasDeControl.VK_C or TeclasDeControl.VK_V or TeclasDeControl.VK_S))
                 .All(vk => TeclasDeControl.Clasificar(vk, true, false) == TeclaDeControl.Ninguna), "con Ctrl, solo C, V y S significan algo");

        Debe(TeclasDeControl.Clasificar(TeclasDeControl.VK_TAB, false, false) == TeclaDeControl.Tab, "Tab");
        Debe(TeclasDeControl.Clasificar(TeclasDeControl.VK_RETURN, false, false) == TeclaDeControl.Enter, "Enter");
        Debe(TeclasDeControl.Clasificar(TeclasDeControl.VK_BACK, false, false) == TeclaDeControl.Correccion, "Backspace corrige");
        Debe(TeclasDeControl.Clasificar(TeclasDeControl.VK_DELETE, false, false) == TeclaDeControl.Correccion, "Supr corrige");
        Debe(TeclasDeControl.Clasificar(TeclasDeControl.VK_C, true, false) == TeclaDeControl.Copiar, "Ctrl+C copia");
        Debe(TeclasDeControl.Clasificar(TeclasDeControl.VK_V, true, false) == TeclaDeControl.Pegar, "Ctrl+V pega");
        Debe(TeclasDeControl.Clasificar(TeclasDeControl.VK_S, true, false) == TeclaDeControl.Guardar, "Ctrl+S guarda");
        Debe(TeclasDeControl.Clasificar(TeclasDeControl.VK_INSERT, false, true) == TeclaDeControl.Pegar, "Mayús+Ins pega");
        Debe(TeclasDeControl.Clasificar(TeclasDeControl.VK_C, false, false) == TeclaDeControl.Ninguna, "una C sola es una letra más");

        // Y al lote solo viajan las cantidades: una muestra con teclas de control serializada no
        // contiene ningún código de tecla ni ningún nombre de tecla.
        var cubetas = new Cubetas();
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero);
        cubetas.Registrar(t0, new Superficie("sap", "sapgui://QAS/NV2000/P/0100"), null,
            new Aportes(1000, 1000, 400, 12, 0, 0, 0, 0, 0, Tabs: 3, Enters: 1, Correcciones: 2, Copias: 1, Pegados: 1, Guardados: 1));
        var m = cubetas.CosecharTodo().Single();
        var json = Cable.Muestra(m);
        Debe(json.Contains("\"tabs\":3") && json.Contains("\"correcciones\":2") && json.Contains("\"pegados\":1") && json.Contains("\"guardados\":1"), "las cantidades viajan");
        Debe(!json.Contains("vk", StringComparison.OrdinalIgnoreCase) && !json.Contains("0x") && !json.Contains("VK_"), "ningún código de tecla viaja");
        Debe(m.Teclas == 12, "las teclas de control también cuentan como teclas");
    }

    // ── La v2: precisión y supervivencia (24-31) ─────────────────────────────

    /// <remarks>
    /// Antes solo los huecos mayores de 10 s contaban; un hilo principal atascado 2–10 s en COM o
    /// por un antivirus perdía esos segundos del tiempo y de la cobertura sin dejar rastro.
    /// </remarks>
    private static void UnRelojAtascadoCuentaSuHueco()
    {
        var pared = new DateTimeOffset(2026, 9, 1, 14, 0, 0, TimeSpan.Zero);
        var r = new Reloj(0, pared);

        var uno = r.Avanzar(1000, pared.AddSeconds(1));
        Debe(uno.AporteMs == 1000 && uno.HuecoMs == 0, "un tick de 1 s aporta 1 s y no deja hueco");
        var dos = r.Avanzar(3000, pared.AddSeconds(3));
        Debe(dos.AporteMs == 2000 && dos.HuecoMs == 0, "uno de 2 s aporta los 2 s justos");
        var cinco = r.Avanzar(8000, pared.AddSeconds(8));
        Debe(cinco.AporteMs == 2000 && cinco.HuecoMs == 3000, "uno de 5 s aporta 2 s y cuenta 3 s de hueco");
        var nueve = r.Avanzar(17_000, pared.AddSeconds(17));
        Debe(nueve.AporteMs == 2000 && nueve.HuecoMs == 7000, "y uno de 9 s cuenta 7 s: por debajo de 10 s ya no desaparece nada");
        Debe(uno.DesfaseRelojMs == 0 && cinco.DesfaseRelojMs == 0 && nueve.DesfaseRelojMs == 0, "un atasco no es un salto de reloj: la pared y el monotónico avanzaron igual");
    }

    /// <remarks>
    /// Windows quita un gancho de bajo nivel en silencio si su hilo tarda en contestar. El testigo es
    /// GetLastInputInfo: si el sistema vio input hace poco y los ganchos no, están ciegos. Tres
    /// chequeos (30 s) para no reaccionar a un tick raro; en la pantalla de bloqueo no se sospecha.
    /// </remarks>
    private static void GanchosCiegosSeRearman()
    {
        var s = new SaludDeGanchos();
        Debe(!s.Evaluar(500, 500, false), "sistema y ganchos ven input: sanos");
        Debe(!s.Evaluar(500, 20_000, false) && !s.Evaluar(500, 21_000, false), "dos chequeos ciegos todavía no rearman");
        Debe(s.Evaluar(500, 22_000, false), "el tercero seguido sí");
        Debe(!s.Evaluar(500, 23_000, false), "y el contador vuelve a cero tras rearmar");

        var b = new SaludDeGanchos();
        Debe(!b.Evaluar(500, 20_000, true) && !b.Evaluar(500, 21_000, true) && !b.Evaluar(500, 22_000, true),
            "en la pantalla de bloqueo los ganchos no ven nada con razón: nunca se rearman");
        Debe(!b.Evaluar(500, 23_000, false) && !b.Evaluar(500, 24_000, false), "y al desbloquear la cuenta empieza de cero (no arrastra las sospechas del bloqueo)");

        var q = new SaludDeGanchos();
        Debe(!q.Evaluar(500, 20_000, false) && !q.Evaluar(500, 21_000, false), "dos sospechas");
        Debe(!q.Evaluar(30_000, 40_000, false), "sin input del sistema no hay sospecha (nadie está usando el PC)");
        Debe(!q.Evaluar(500, 20_000, false), "y la racha se reinició: una sospecha nueva no completa las dos viejas");

        var v = new SaludDeGanchos();
        Debe(!v.Evaluar(500, 20_000, false) && !v.Evaluar(500, 500, false) && !v.Evaluar(500, 20_000, false) && !v.Evaluar(500, 20_000, false),
            "las sospechas tienen que ser SEGUIDAS: un chequeo sano en medio las borra");
    }

    private static void UnColapsoRelanzaCincoVeces()
    {
        var t0 = new DateTimeOffset(2026, 9, 1, 8, 0, 0, Bogota);
        IReadOnlyList<DateTimeOffset> historial = Array.Empty<DateTimeOffset>();
        for (int i = 0; i < GuardiaDeRelanzos.Maximo; i++)
        {
            var (relanzar, nuevo) = GuardiaDeRelanzos.Evaluar(historial, t0.AddMinutes(i));
            Debe(relanzar && nuevo.Count == i + 1, $"el colapso {i + 1} se relanza y queda en el historial");
            historial = nuevo;
        }
        var (sexto, tras) = GuardiaDeRelanzos.Evaluar(historial, t0.AddMinutes(5));
        Debe(!sexto && tras.Count == GuardiaDeRelanzos.Maximo, "el sexto en 10 min NO se relanza: se lo queda el vigilante, y no se apunta");

        var (masTarde, ventana) = GuardiaDeRelanzos.Evaluar(tras, t0.AddMinutes(10.5));
        Debe(masTarde && ventana.Count == GuardiaDeRelanzos.Maximo, "diez minutos y medio después el primero salió de la ventana y se vuelve a relanzar");
        Debe(ventana.All(t => t > t0), "el historial solo conserva los últimos 10 min: el primero ya no está");
    }

    /// <remarks>
    /// Era la excepción del arranque que dejaba el medidor apagado con un MessageBox que nadie veía
    /// (spool.db corrupto tras un corte de luz). Ahora se aparta y se sigue.
    /// </remarks>
    private static void UnSpoolCorruptoSeAparta()
    {
        var ruta = RutaTemporal("spool.db");
        File.WriteAllText(ruta, string.Concat(Enumerable.Repeat("esto no es una base de datos sqlite, es un archivo roto tras un corte de luz\n", 80)));

        using var spool = new SpoolSqlite(ruta);
        Debe(spool.ArchivoCorrupto != null, "el arranque no se cae: el archivo se dio por corrupto");
        Debe(spool.ArchivoCorrupto != null && File.Exists(spool.ArchivoCorrupto) && Path.GetFileName(spool.ArchivoCorrupto).StartsWith("spool.corrupto-"),
            "y se apartó con fecha junto al original, para el forense");
        Debe(File.Exists(ruta), "en su sitio hay una base nueva");
        var seq = spool.Encolar("eventos", "{\"kind\":\"medidor_start\"}");
        Debe(seq >= 1 && spool.Tomar(new LimitesDeLote()).Eventos.Count == 1, "que funciona desde el primer momento");
        Debe(spool.FormatoEnDisco == SpoolSqlite.Formato, "y ya nace en formato 2");

        using var sano = new SpoolSqlite(RutaTemporal("sano.db"));
        Debe(sano.ArchivoCorrupto == null, "un spool sano no aparta nada");
    }

    /// <remarks>
    /// Sin red, la foto de la jornada se encolaría cada 5 min y `jornadas` crecería sin decir nada
    /// nuevo: la última foto del proceso contiene a las anteriores (los contadores son monótonos).
    /// Las de otro proceso o de otro día son otras filas del servidor: no se tocan.
    /// </remarks>
    private static void SoloViajaLaUltimaFoto()
    {
        using var spool = new SpoolSqlite(RutaTemporal("fotos.db"));
        var t0 = new DateTimeOffset(2026, 9, 1, 8, 0, 0, Bogota);
        var p1 = Guid.NewGuid(); var p2 = Guid.NewGuid();
        var hoy = new Jornada(new DateOnly(2026, 9, 1), t0, t0);
        var ayer = new Jornada(new DateOnly(2026, 8, 31), t0.AddDays(-1), t0.AddDays(-1));
        var cal = new Calidad();

        spool.Encolar("jornadas", Cable.Jornada(hoy, cal, VersionDePrueba, 1, p1));
        var deAyer = spool.Encolar("jornadas", Cable.Jornada(ayer, cal, VersionDePrueba, 1, p1));
        var deOtroProceso = spool.Encolar("jornadas", Cable.Jornada(hoy, cal, VersionDePrueba, 1, p2));
        cal.Hueco(1000);
        spool.Encolar("jornadas", Cable.Jornada(hoy, cal, VersionDePrueba, 1, p1));
        cal.Hueco(1000);
        var ultima = spool.Encolar("jornadas", Cable.Jornada(hoy, cal, VersionDePrueba, 1, p1));

        Debe(spool.Compactar("jornadas", hoy.Dia, p1) == 2, "de tres fotos del mismo proceso y día sobran dos");
        var lote = spool.Tomar(new LimitesDeLote());
        Debe(lote.Jornadas.Count == 3, "quedan la última del proceso, la de ayer y la del otro proceso");
        Debe(lote.Jornadas.Any(f => f.Seq == ultima) && lote.Jornadas.Single(f => f.Seq == ultima).Json.Contains("\"huecos_ms\":2000"),
            "la que se conserva es la más nueva, con la calidad acumulada");
        Debe(lote.Jornadas.Any(f => f.Seq == deAyer) && lote.Jornadas.Any(f => f.Seq == deOtroProceso), "las ajenas no se tocan");
        Debe(spool.Compactar("jornadas", hoy.Dia, p1) == 0, "compactar otra vez no borra nada más");
        Debe(spool.Compactar("jornadas", hoy.Dia, Guid.NewGuid()) == 0, "ni un proceso que no tiene fotos");
    }

    /// <remarks>
    /// Un spool de la v1 tiene filas con shift_id que el servidor v2 rechazaría una a una (y cada
    /// rechazo es un veneno y una línea de log). Se purgan al abrir, se cuentan (spool_drop con
    /// reason formato_v1) y la marca de formato impide repetirlo.
    /// </remarks>
    private static void LasFilasV1SePurganUnaVez()
    {
        var ruta = RutaTemporal("v1.db");
        using (var db = new SqliteConnection($"Data Source={ruta};Pooling=False"))
        {
            db.Open();
            using var cmd = db.CreateCommand();
            cmd.CommandText = """
                CREATE TABLE filas(seq INTEGER PRIMARY KEY AUTOINCREMENT, coleccion TEXT NOT NULL, json TEXT NOT NULL, bytes INTEGER NOT NULL);
                CREATE TABLE meta(clave TEXT PRIMARY KEY, valor INTEGER NOT NULL);
                INSERT INTO meta(clave, valor) VALUES('descartes', 4);
                INSERT INTO filas(coleccion, json, bytes) VALUES
                  ('turnos',   '{"shift_id":"x"}', 16),
                  ('muestras', '{"shift_id":"x"}', 16),
                  ('eventos',  '{"shift_id":"x"}', 16);
                """;
            cmd.ExecuteNonQuery();
        }

        using (var spool = new SpoolSqlite(ruta))
        {
            Debe(spool.FilasV1Purgadas == 3, "las tres filas v1 se purgan contando");
            Debe(spool.Tomar(new LimitesDeLote()).Vacio, "y el spool queda vacío");
            Debe(spool.FormatoEnDisco == 2, "con la marca de formato 2");
            Debe(spool.DescartesAcumulados == 4, "los descartes históricos del spool se conservan (no son contadores de jornada)");
            spool.Encolar("muestras", "{\"app\":\"otro\"}");
        }
        using (var renacido = new SpoolSqlite(ruta))
        {
            Debe(renacido.FilasV1Purgadas == 0, "una sola vez: al reabrir no se purga nada");
            Debe(renacido.Tomar(new LimitesDeLote()).Muestras.Count == 1, "y lo encolado en formato 2 sigue ahí");
        }
    }

    /// <remarks>
    /// Antes el turno «fijaba» la clave al abrirse. Sin turno, la clave se deriva en cada tick del
    /// día operativo de la hora de pared: cruza las 06:00 sola, sin input.
    /// </remarks>
    private static void LaClaveSeDerivaPorTick()
    {
        var secreto = System.Text.Encoding.UTF8.GetBytes("secreto-de-la-org");
        byte[] ClaveEn(DateTimeOffset pared) => Huella.ClaveDelDia(secreto, Huella.DiaOperativo(pared));

        var a0559 = Huella.DeIdentificador(ClaveEn(new DateTimeOffset(2026, 9, 2, 5, 59, 0, Bogota)), "555001");
        var a0601 = Huella.DeIdentificador(ClaveEn(new DateTimeOffset(2026, 9, 2, 6, 1, 0, Bogota)), "555001");
        var a0200 = Huella.DeIdentificador(ClaveEn(new DateTimeOffset(2026, 9, 2, 2, 0, 0, Bogota)), "555001");
        var ayer1900 = Huella.DeIdentificador(ClaveEn(new DateTimeOffset(2026, 9, 1, 19, 0, 0, Bogota)), "555001");

        Debe(a0559 != a0601, "a las 05:59 y a las 06:01 la misma persona da huellas distintas: la clave rotó sola");
        Debe(a0559 == a0200 && a0200 == ayer1900, "y de las 19:00 a las 05:59 (cruzando la medianoche) da la misma");
        Debe(Huella.DeIdentificador(ClaveEn(new DateTimeOffset(2026, 9, 2, 6, 0, 0, Bogota)), "555001") == a0601,
            "el corte es exactamente a las 06:00:00");
    }

    /// <summary>
    /// PROMESA 32. El servidor rechaza un lote con 403 por dos razones opuestas y el medidor tiene
    /// que distinguirlas: si no conoce el equipo (la base se recreó) hay que volver a registrarse;
    /// si lo pausaron a propósito desde el panel, registrarse otra vez sería desobedecer.
    /// </summary>
    /// <summary>
    /// PROMESA 33. Engancharse al scripting saca un cuadro modal en la pantalla del médico. Si el
    /// enganche no entra, el medidor NO puede volver a pedirlo cada pocos segundos: mediría el
    /// trabajo estorbándolo. La espera crece y se reinicia solo cuando por fin engancha.
    /// </summary>
    /// <summary>
    /// PROMESA 34. Un PC encendido de noche, o bloqueado media tarde, produce una cubeta cada 15 s
    /// en la que no pasa nada: miles de filas idénticas que cuestan disco, red y base sin decir
    /// nada. Se funden en una sola fila cuyo `bucket_ms` cubre el tramo entero.
    ///
    /// Lo que NO puede pasar, y es lo que se juzga aquí: que fundir pierda o invente tiempo. La
    /// suma de los `bucket_ms` emitidos tiene que ser exactamente la del tramo medido, y el tramo
    /// tiene que cortarse en cuanto pasa algo, cambia el contexto o cambia el día operativo.
    /// </summary>
    private static void LosTramosVaciosSeFunden()
    {
        var app = new Superficie("sap", "sapgui://PRD/NV2000/P/0100");
        var quieto = new Aportes(Cubetas.TamanoMs, 0, 0, 0, 0, 0, 0, 0, 0);
        var activo = new Aportes(Cubetas.TamanoMs, 12000, 3000, 20, 3, 0, 0, 0, 0);
        int cubetasDelTope = Cubetas.TopeDelTramoTranquiloMs / Cubetas.TamanoMs;

        // 40 cubetas seguidas sin nada (10 min) con el tope en 5 min: dos filas, y entre las dos
        // cubren los 10 minutos exactos.
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero);
        var c = new Cubetas();
        for (int k = 0; k < 40; k++) c.Registrar(t0.AddSeconds(15 * k + 1), app, null, quieto);
        var filas = c.CosecharTodo();
        Debe(filas.Count == 40 / cubetasDelTope, $"40 cubetas vacías salen como {40 / cubetasDelTope} filas, no como 40");
        Debe(filas.Sum(f => (long)f.BucketMs) == 40L * Cubetas.TamanoMs, "y entre todas cubren exactamente los mismos milisegundos");
        Debe(filas.Sum(f => (long)f.ForegroundMs) == 40L * Cubetas.TamanoMs, "con todo el foreground dentro: no se pierde tiempo medido");
        Debe(filas.All(f => f.ActiveMs == 0 && f.Teclas == 0 && f.Clics == 0), "un tramo fundido es, por definición, tiempo sin actividad");
        Debe(filas[0].BucketStart == t0 && filas[0].BucketMs == Cubetas.TopeDelTramoTranquiloMs, "la primera arranca donde arrancó el tramo y llega al tope");
        Debe(filas.Zip(filas.Skip(1)).All(par => par.First.BucketStart.AddMilliseconds(par.First.BucketMs) == par.Second.BucketStart),
            "y las filas van pegadas: sin huecos inventados entre ellas");

        // Que pase algo corta el tramo, y sigue cuadrando el total.
        c = new Cubetas();
        for (int k = 0; k < 3; k++) c.Registrar(t0.AddSeconds(15 * k + 1), app, null, quieto);
        c.Registrar(t0.AddSeconds(15 * 3 + 1), app, null, activo);
        for (int k = 4; k < 6; k++) c.Registrar(t0.AddSeconds(15 * k + 1), app, null, quieto);
        filas = c.CosecharTodo();
        Debe(filas.Count == 3, "tres cubetas vacías, una con actividad y dos vacías son tres filas");
        Debe(filas[1].ActiveMs == 12000 && filas[1].BucketMs == Cubetas.TamanoMs, "la cubeta con actividad viaja entera y sin fundir");
        Debe(filas.Sum(f => (long)f.BucketMs) == 6L * Cubetas.TamanoMs, "y el total sigue siendo el tiempo real, ni un ms más");

        // Cambiar de app, de paciente o de usuario SAP también corta.
        c = new Cubetas();
        c.Registrar(t0.AddSeconds(1), app, null, quieto);
        c.Registrar(t0.AddSeconds(16), app, null, quieto);
        c.Registrar(t0.AddSeconds(31), new Superficie("chrome", null), null, quieto);
        c.Registrar(t0.AddSeconds(46), app, "a".PadRight(32, 'a'), quieto);
        c.Registrar(t0.AddSeconds(61), app, "a".PadRight(32, 'a'), quieto, "MED01");
        filas = c.CosecharTodo();
        Debe(filas.Count == 4, "el tramo se corta al cambiar la app, el paciente o el usuario SAP");
        Debe(filas[0].BucketMs == 2 * Cubetas.TamanoMs, "solo se funde lo que comparte contexto");
        Debe(filas.Sum(f => (long)f.BucketMs) == 5L * Cubetas.TamanoMs, "y el total, otra vez, es el tiempo real");

        // Y NUNCA cruza el día operativo: una fila pertenece a un día, no a dos.
        var antesDelCorte = new DateTimeOffset(2026, 9, 2, 5, 59, 45, TimeSpan.FromHours(-5));
        c = new Cubetas();
        c.Registrar(antesDelCorte.AddSeconds(1), app, null, quieto);
        c.Registrar(antesDelCorte.AddSeconds(16), app, null, quieto);
        filas = c.CosecharTodo();
        Debe(filas.Count == 2 && filas[0].DiaOperativo != filas[1].DiaOperativo,
            "a las 06:00 el tramo se corta: una fila fundida no puede pertenecer a dos días operativos");

        // Al cerrar no queda nada esperando en memoria.
        Debe(c.CosecharTodo().Count == 0, "y tras cerrar no queda ningún tramo colgado");
    }

    private static void ElEngancheNoAtosiga()
    {
        Debe(RitmoDeEnganche.EsperaTrasRechazoS(0) >= 60, "tras la primera negativa se espera al menos un minuto");
        var escalera = new[] { 0, 1, 2, 3, 4, 10 }.Select(RitmoDeEnganche.EsperaTrasRechazoS).ToArray();
        Debe(escalera.Zip(escalera.Skip(1)).All(p => p.Second >= p.First), "y la espera nunca se acorta al insistir");
        Debe(RitmoDeEnganche.EsperaTrasRechazoS(3) >= 1800 && RitmoDeEnganche.EsperaTrasRechazoS(99) == RitmoDeEnganche.EsperaTrasRechazoS(3),
            "llega a media hora y ahí se queda: no crece sin fin ni se rinde para siempre");

        // Lo que de verdad se prometió, contado en lo que ve una persona.
        Debe(RitmoDeEnganche.AvisosComoMuchoEn(60) <= 8, "como mucho ocho avisos en la primera hora de negativas");
        Debe(RitmoDeEnganche.AvisosComoMuchoEn(480) <= 20, "y unos pocos en una jornada entera, no cientos");

        // Que SAP no esté abierto no es una negativa: nadie vio un cuadro y reintentar es barato.
        Debe(RitmoDeEnganche.SinSapS <= 15, "sin SAP abierto se reintenta pronto, que eso no molesta a nadie");
        Debe(RitmoDeEnganche.TrasPerderElMotorS >= 30, "y perder el motor tampoco se reengancha al instante");

        // Perder el motor tras una mañana entera es SAP cerrándose: se reengancha pronto.
        Debe(RitmoDeEnganche.EsperaTrasPerderElMotorS(4 * 3600, 0) == RitmoDeEnganche.TrasPerderElMotorS,
            "un motor que aguantó horas se reengancha pronto: eso es SAP cerrándose, no un problema");
        // Pero un motor que se cae cada pocos segundos, en cadena, sí espacia el aviso.
        var caidas = new[] { 0, 1, 2, 3, 9 }.Select(n => RitmoDeEnganche.EsperaTrasPerderElMotorS(5, n)).ToArray();
        Debe(caidas.Zip(caidas.Skip(1)).All(p => p.Second >= p.First) && caidas[^1] >= 1800,
            "y uno que se cae en cadena espacia el reintento igual que una negativa");
    }

    private static void LosDos403SeDistinguen()
    {
        // Lo que responde el servidor cuando el device_id ya no existe (app/api/medidor/lote).
        Debe(Cable.IdentidadDesconocida("{\"error\":\"Dispositivo no encontrado. Vuelve a registrarte.\"}"),
            "un 403 sin `status` es identidad desconocida: hay que registrarse otra vez");
        // Y cuando alguien lo pausó o retiró desde el panel.
        Debe(!Cable.IdentidadDesconocida("{\"error\":\"Dispositivo pausado o retirado.\",\"status\":\"paused\"}"),
            "un 403 con `status` es una pausa deliberada: NO se vuelve a registrar");
        Debe(!Cable.IdentidadDesconocida("{\"error\":\"Dispositivo pausado o retirado.\",\"status\":\"retired\"}"),
            "un equipo retirado no se resucita solo");
        // Ante la duda, no se toca nada: un cuerpo vacío o ilegible no borra una identidad válida.
        Debe(!Cable.IdentidadDesconocida(""), "sin cuerpo no se adivina");
        Debe(!Cable.IdentidadDesconocida(null), "sin cuerpo no se adivina");
        Debe(!Cable.IdentidadDesconocida("no soy json"), "un cuerpo ilegible no borra la identidad");
        Debe(!Cable.IdentidadDesconocida("[1,2,3]"), "un cuerpo que no es objeto no borra la identidad");
    }

    private static void LaJornadaLlevaProcesoId()
    {
        var t0 = new DateTimeOffset(2026, 9, 1, 8, 0, 0, Bogota);
        var j = new Jornada(new DateOnly(2026, 9, 1), t0, t0.AddHours(3));
        var p1 = Guid.NewGuid(); var p2 = Guid.NewGuid();
        var c1 = new Calidad(); c1.Hueco(500); c1.Relanzo();
        var c2 = new Calidad();

        using var f1 = System.Text.Json.JsonDocument.Parse(Cable.Jornada(j, c1, VersionDePrueba, 3, p1));
        using var f2 = System.Text.Json.JsonDocument.Parse(Cable.Jornada(j, c2, VersionDePrueba, 3, p2));
        var a = f1.RootElement; var b = f2.RootElement;

        Debe(a.GetProperty("proceso_id").GetGuid() == p1 && b.GetProperty("proceso_id").GetGuid() == p2 && p1 != p2,
            "cada foto lleva el proceso que la tomó");
        Debe(a.GetProperty("dia_operativo").GetString() == "2026-09-01" && b.GetProperty("dia_operativo").GetString() == "2026-09-01",
            "del mismo día operativo");
        Debe(a.GetProperty("relanzos").GetInt32() == 1 && b.GetProperty("relanzos").GetInt32() == 0
             && a.GetProperty("huecos_ms").GetInt64() == 500 && b.GetProperty("huecos_ms").GetInt64() == 0,
            "con contadores propios de cada proceso: el servidor los suma, no los mezcla");

        string[] contrato4 = { "dia_operativo", "proceso_id", "primera_muestra_at", "ultima_muestra_at", "app_version", "hmac_version",
            "huecos_ms", "clock_jumps", "spool_dropped", "hooks_degradados", "hooks_rearmados", "ticks_sap_saltados_busy",
            "sap_scripting", "sap_eventos_com", "relanzos" };
        Debe(contrato4.All(k => a.TryGetProperty(k, out _)), "y con todas las claves del contrato 4 (spool_seq la pone el sobre)");
        Debe(a.GetProperty("app_version").GetString() == VersionDePrueba && a.GetProperty("hmac_version").GetInt32() == 3
             && a.GetProperty("primera_muestra_at").GetDateTime().ToUniversalTime() == t0.UtcDateTime,
            "versión, hmac y las marcas de tiempo en UTC");
    }

    // ── El arnés ─────────────────────────────────────────────────────────────

    private static void Prueba(string nombre, Action cuerpo)
    {
        int antes = _fallos;
        try { cuerpo(); }
        catch (Exception e)
        {
            _fallos++;
            for (var x = e; x != null; x = x.InnerException)
                Console.WriteLine($"   ✘ {x.GetType().Name}: {x.Message}");
        }
        bool cumple = _fallos == antes;
        _veredicto.Add((nombre, cumple));
        Console.WriteLine($"{(cumple ? "✔" : "✘")} {nombre}");
    }

    private static void Debe(bool condicion, string promesa)
    {
        if (condicion) return;
        _fallos++;
        Console.WriteLine($"   ✘ {promesa}");
    }

    private static readonly List<(string Nombre, bool Cumple)> _veredicto = new();

    /// <summary>
    /// Deja el veredicto junto a los del núcleo y el mapeador, para poder mirarlo sin correr nada.
    /// Misma carpeta y misma pestaña que aquellos: partir «¿qué está garantizado?» en varios
    /// sitios obliga a acordarse de mirar todos, y el que se olvida es siempre el que está en rojo.
    /// </summary>
    private static void Apuntar()
    {
        try
        {
            var dir = new DirectoryInfo(AppContext.BaseDirectory);
            while (dir != null && !Directory.Exists(Path.Combine(dir.FullName, "nucleo", "visor"))) dir = dir.Parent;
            if (dir == null) return;

            var filas = _veredicto.Select(v =>
                $"{{\"regla\":{Cita(v.Nombre)},\"cumple\":{(v.Cumple ? "true" : "false")}}}");
            File.WriteAllText(Path.Combine(dir.FullName, "nucleo", "visor", "reglas-medidor.json"),
                "{\"cuando\":" + Cita(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss"))
                + ",\"integro\":" + (_fallos == 0 ? "true" : "false")
                + ",\"reglas\":[" + string.Join(",", filas) + "]}",
                System.Text.Encoding.UTF8);
        }
        catch { }
    }

    private static string Cita(string s) => "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\"";
}
