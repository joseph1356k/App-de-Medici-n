using Medidor;

namespace Medidor.Pruebas;

/// <summary>
/// EL CONTRATO DEL MEDIDOR: lo que promete el instrumento que mide el trabajo clínico, escrito como
/// pruebas que llaman al código real y corren sin pantalla, sin Windows y sin red.
///
/// Las promesas 1-6 son de PRIVACIDAD y van primero a propósito: este medidor se instala en
/// urgencias, donde las pantallas llevan nombres y diagnósticos. Mientras el arnés no pueda
/// demostrar que nada de eso sale en un lote, el resto del instrumento es cosmético.
///
/// Y las de conteo existen porque un medidor que cuenta mal no se nota: los números «se ven
/// normales». El repo ya pagó esa clase de fallo dos veces —el 29/30 con 19 pasos comidos, y el
/// promedio de 1.461 ms que era UNA muestra colgada— y aquí el precio sería peor: contaminar un
/// baseline que no se puede volver a medir. Spec: docs/specs/003-medidor-del-trabajo-clinico.md.
/// </summary>
internal static class Contrato
{
    private static int _fallos;

    private static int Main()
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Console.WriteLine("CONTRATO DEL MEDIDOR (el instrumento, aislado)\n");

        Prueba("1. un lote serializado jamás contiene el título de la ventana de entrada", TituloJamasEnElLote);
        Prueba("2. una app fuera de la lista blanca sale como «otro», y una web solo sale como dominio permitido", FueraDeListaEsOtro);
        Prueba("3. la identidad SAP viaja sin el sufijo vista: y sin el título de la ventana", SapSinVistaNiTitulo);
        Prueba("4. del identificador de paciente solo sale la huella: el crudo no sobrevive, y normalizar quita los ceros de la izquierda", SoloSaleLaHuella);
        Prueba("5. la clave de la huella es la del día operativo que corta a las 06:00, y el turno la fija al abrirse", LaClaveEsDelDiaOperativo);
        Prueba("6. la misma persona da la misma huella dentro del día operativo, y otra persona da otra", MismaPersonaMismaHuella);
        Prueba("7. un tick jamás aporta más de 2 000 ms: despertar de una suspensión no regala horas, y el salto queda contado", UnTickNoRegalaHoras);
        Prueba("8. activo es input en los últimos 60 s; sin input el tiempo es de primer plano, no activo", ActivoEsInputReciente);
        Prueba("9. la escritura se mide por ráfagas — huecos de hasta 1,5 s se unen — y del tecleo solo salen cantidades, jamás qué tecla fue", EscrituraPorRafagas);
        Prueba("10. una cubeta se parte cuando cambia la app o el encounter, y las partes suman el total sin doble conteo", LaCubetaSeParteSinDobleConteo);
        Prueba("11. cada milisegundo cae en exactamente una cubeta de 15 s alineada al reloj de pared", CadaMsEnUnaCubeta);
        Prueba("12. un turno se cierra solo por una causa escrita, y el cierre la dice", ElTurnoCierraConCausa);
        Prueba("13. un turno sin médico mide igual, y se puede reasignar a un médico mientras siga abierto — nunca después", SinMedicoMideIgual);
        Prueba("14. el spool no pierde ni duplica: lo tomado sin confirmación se vuelve a entregar idéntico, y la confirmación lo borra de una vez", ElSpoolNoPierdeNiDuplica);
        Prueba("15. el spool lleno descarta lo más viejo contando cada descarte — jamás en silencio", ElSpoolLlenoDescartaContando);
        Prueba("16. un lote respeta los topes por colección, y una fila que el servidor rechazó como veneno sale del spool en vez de reintentarse para siempre", ElLoteRespetaTopesYVeneno);
        Prueba("17. cada evento lleva un uid monotónico por instalación que sobrevive al reinicio: el mismo evento no entra dos veces", ElUidSobreviveAlReinicio);
        Prueba("18. la calidad del turno cuenta lo que faltó: huecos, saltos de reloj, descartes y ganchos degradados", LaCalidadCuentaLoQueFalto);
        Prueba("19. una visita SAP empieza al llegar a una identidad y termina al salir: su duración y su destino salen del stream, no de un cronómetro aparte", LaVisitaSaleDelStream);
        Prueba("20. la espera de SAP es la suma de sus round-trips: StartRequest abre, EndRequest cierra, y un cierre sin pareja no resta", LaEsperaEsLaSumaDeRoundtrips);
        Prueba("21. time-to-ready va de la llegada al primer EndRequest sin Busy; si nunca llega queda nulo, no cero", ReadyNuloNoCero);
        Prueba("22. cada fila del lote lleva el seq del spool con nombre propio (spool_seq), sin pisar el seq de la cubeta", ElSeqDelSpoolNoPisaElDeLaCubeta);
        Prueba("23. del teclado solo se distinguen Tab, Enter, borrar, copiar, pegar y guardar; una letra es indistinguible de otra, y al lote viajan cantidades, jamás códigos", SoloTeclasDeControl);

        Console.WriteLine();
        Console.WriteLine(_fallos == 0
            ? "MEDIDOR ÍNTEGRO: el instrumento promete lo que dice prometer."
            : $"MEDIDOR ROTO: {_fallos} promesa(s) incumplida(s).");

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

    // ── Privacidad (1-6) ─────────────────────────────────────────────────────

    private static void TituloJamasEnElLote()
    {
        var cfg = Config();
        var cubetas = new Cubetas();
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero);
        var shift = Guid.NewGuid();

        // Una web hostil, una app desconocida hostil, y un SAP con sufijo vista: hostil.
        var web = Normalizador.Normalizar(new EntradaDeSuperficie("chrome.exe", TituloHostil, "https://itsmiracleai.com.co/app", null), cfg);
        var rara = Normalizador.Normalizar(new EntradaDeSuperficie("hcvieja.exe", TituloHostil, null, null), cfg);
        var sap = Normalizador.Normalizar(new EntradaDeSuperficie("saplogon.exe", TituloHostil, null,
            "sapgui://QAS/NWP1/SAPLN_WP_FRAMEWORK/0100/vista:Pacientes de Juan Pérez"), cfg);

        var aporte = new Aportes(1000, 1000, 200, 5, 2, 1, 0, 0, 0);
        cubetas.Registrar(t0.AddSeconds(1), web, null, aporte);
        cubetas.Registrar(t0.AddSeconds(2), rara, null, aporte);
        cubetas.Registrar(t0.AddSeconds(3), sap, "a1b2c3", aporte);

        using var spool = new SpoolSqlite(RutaTemporal("lote.db"));
        foreach (var m in cubetas.CosecharTodo()) spool.Encolar("muestras", Cable.Muestra(shift, m));
        spool.Encolar("eventos", Cable.Evento("encounter_enter", t0, shift, "a1b2c3",
            new Dictionary<string, object?> { ["reason"] = "regla", ["titulo"] = TituloHostil }));
        var calidad = new Calidad();
        spool.Encolar("turnos", Cable.Turno(new Turno(shift, null, null, t0, new DateOnly(2026, 9, 1), 1), null, "MEDICO01", calidad));

        var lote = Lote.Serializar("dev-1", Guid.NewGuid().ToString(), t0.AddMinutes(1), spool.Tomar(new LimitesDeLote()));

        Debe(!lote.Contains("Juan"), "el nombre del título no aparece en el lote");
        Debe(!lote.Contains("Pérez") && !lote.Contains("Perez"), "el apellido tampoco");
        Debe(!lote.Contains("123456789"), "ni el documento del título");
        Debe(!lote.Contains("vista:"), "ni el sufijo vista: de la identidad SAP");
        Debe(!lote.Contains("Historia"), "ni ningún fragmento del título");
        Debe(lote.Contains("a1b2c3"), "la huella sí viaja: sin ella no hay encounter");
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
    /// El corte a las 06:00 existe por los turnos nocturnos: uno que abre a las 19:00 cruza la
    /// medianoche, y si la clave rotara a las 00:00 el mismo paciente daría DOS huellas en el mismo
    /// turno — el entrelazado A→B→A de urgencias quedaría partido justo donde más importa.
    /// Y la clave se FIJA al abrir el turno: rotar a mitad de turno tendría el mismo efecto.
    /// </remarks>
    private static void LaClaveEsDelDiaOperativo()
    {
        var tz = TimeSpan.FromHours(-5); // América/Bogotá no cambia de hora
        Debe(Huella.DiaOperativo(new DateTimeOffset(2026, 9, 1, 5, 59, 0, tz)) == new DateOnly(2026, 8, 31),
            "a las 05:59 todavía es el día operativo anterior");
        Debe(Huella.DiaOperativo(new DateTimeOffset(2026, 9, 1, 6, 1, 0, tz)) == new DateOnly(2026, 9, 1),
            "a las 06:01 ya es el nuevo");

        var secreto = System.Text.Encoding.UTF8.GetBytes("secreto-de-la-org");
        Debe(!Huella.ClaveDelDia(secreto, new DateOnly(2026, 8, 31)).SequenceEqual(Huella.ClaveDelDia(secreto, new DateOnly(2026, 9, 1))),
            "días operativos distintos, claves distintas: las huellas no se enlazan entre días");

        var s = new Sesionizador();
        var (turno, _) = s.Abrir(new DateTimeOffset(2026, 9, 1, 19, 0, 0, tz), "d1", "Ana", 1);
        Debe(turno.DiaOperativo == new DateOnly(2026, 9, 1), "el turno de las 19:00 fija el día en que abrió");
        Debe(Huella.DiaOperativo(new DateTimeOffset(2026, 9, 2, 2, 0, 0, tz)) == new DateOnly(2026, 9, 1),
            "a las 02:00 de la madrugada sigue siendo el mismo día operativo — la noche no parte al paciente en dos");
        Debe(Huella.DiaOperativo(new DateTimeOffset(2026, 9, 2, 6, 30, 0, tz)) != turno.DiaOperativo,
            "a las 06:30 el día YA cambió: si el turno no fijara su clave, el mismo paciente daría otra huella antes del relevo");
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

        var filas = c.CosecharTodo();
        Debe(filas.Count == 3, "tres contextos distintos son tres partes, aunque uno vuelva");
        Debe(filas.All(f => f.BucketStart == t0), "todas de la misma cubeta");
        Debe(filas.Select(f => f.Seq).OrderBy(x => x).SequenceEqual(new[] { 0, 1, 2 }), "con su orden de aparición");
        Debe(filas.Sum(f => f.ForegroundMs) == 4000, "y las partes suman el total: nada se cuenta dos veces ni se pierde");
        Debe(filas.Single(f => f.EncounterKey == "enc-1").ForegroundMs == 1000, "el encounter parte la cubeta igual que la app");
    }

    private static void CadaMsEnUnaCubeta()
    {
        var c = new Cubetas();
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero);
        var app = new Superficie("sap", null);
        Aportes mil = new(1000, 0, 0, 0, 0, 0, 0, 0, 0);

        c.Registrar(t0.AddSeconds(14.5), app, null, mil);
        c.Registrar(t0.AddSeconds(15.5), app, null, mil);

        var cerradas = c.Cosechar(t0.AddSeconds(15));
        Debe(cerradas.Count == 1 && cerradas[0].BucketStart == t0, "cosechar cierra solo las cubetas ya completas");

        var resto = c.CosecharTodo();
        Debe(resto.Count == 1 && resto[0].BucketStart == t0.AddSeconds(15), "lo que cayó tras el borde vive en la cubeta siguiente");
        Debe(cerradas.Concat(resto).All(f => f.BucketStart.ToUnixTimeMilliseconds() % Cubetas.TamanoMs == 0),
            "toda cubeta arranca en un múltiplo exacto de 15 s del reloj de pared");
        Debe(cerradas.Sum(f => f.ForegroundMs) + resto.Sum(f => f.ForegroundMs) == 2000, "y entre las dos está todo lo aportado");
    }

    // ── El turno (12-13) ─────────────────────────────────────────────────────

    private static void ElTurnoCierraConCausa()
    {
        var t0 = new DateTimeOffset(2026, 9, 1, 7, 0, 0, TimeSpan.FromHours(-5));
        var s = new Sesionizador();
        s.Abrir(t0, "d1", "Ana", 1);

        Debe(s.Avanzar(t0.AddHours(1), new EstadoDelPc(30_000, null)) == null, "con input reciente el turno sigue");

        var porInactividad = s.Avanzar(t0.AddHours(5), new EstadoDelPc(Sesionizador.TimeoutInactividadMs + 1000, null));
        Debe(porInactividad != null && porInactividad.Causa == "timeout_inactividad", "cuatro horas sin input cierran el turno, y el cierre lo dice");
        Debe(s.Abierto == null, "cerrado es cerrado");

        s.Abrir(t0.AddHours(6), "d1", "Ana", 1);
        var porBloqueo = s.Avanzar(t0.AddHours(9), new EstadoDelPc(0, Sesionizador.LockProlongadoMs + 1000));
        Debe(porBloqueo != null && porBloqueo.Causa == "lock_prolongado", "dos horas bloqueado también cierran, con su propia causa");

        s.Abrir(t0.AddHours(10), "d1", "Ana", 1);
        var (_, cierreDelAnterior) = s.Abrir(t0.AddHours(11), "d2", "Luis", 1);
        Debe(cierreDelAnterior != null && cierreDelAnterior.Causa == "turno_nuevo", "abrir con uno abierto cierra el anterior como «turno_nuevo»");

        var manual = s.Cerrar(t0.AddHours(12), "manual");
        Debe(manual != null && manual.Causa == "manual", "el cierre a mano dice «manual»");
        Debe(s.Cerrar(t0.AddHours(13), "manual") == null, "cerrar lo cerrado no inventa un segundo cierre");
    }

    /// <remarks>
    /// EL FALLO QUE ESTO IMPIDE: el selector se ignora en el cambio de turno —va a pasar— y un
    /// medidor que exigiera médico dejaría de medir justo esos turnos. El baseline no se pierde por
    /// un selector: se mide anónimo y se reasigna cuando alguien lo toque. Pero nunca DESPUÉS del
    /// cierre: reatribuir un turno ya cerrado es reescribir historia.
    /// </remarks>
    private static void SinMedicoMideIgual()
    {
        var t0 = new DateTimeOffset(2026, 9, 1, 7, 0, 0, TimeSpan.FromHours(-5));
        var s = new Sesionizador();
        var (turno, _) = s.Abrir(t0, null, null, 1);
        Debe(turno.DoctorId == null, "el turno existe sin médico");

        Debe(s.Reasignar("d1", "Ana"), "y se le puede poner médico mientras está abierto");
        Debe(s.Abierto!.DoctorId == "d1" && s.Abierto.DoctorNombre == "Ana", "la reasignación queda");

        s.Cerrar(t0.AddHours(8), "manual");
        Debe(!s.Reasignar("d2", "Luis"), "cerrado ya no se reasigna: eso sería reescribir historia");
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
        // El kill a mitad de turno: se cerró el proceso sin confirmar. Nada se pierde.
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

            Debe(spool.DescartesAcumulados > 0, "el tope descarta — el disco de un PC de urgencias no es infinito");
            var lote = spool.Tomar(new LimitesDeLote());
            Debe(!lote.Muestras.Any(f => f.Json.Contains("\"n\":0,")), "y lo descartado es lo más viejo, no lo recién medido");
            Debe(spool.BytesAproximados <= 8_000 + 500, "el spool queda alrededor de su tope");
        }
        using (var renacido = new SpoolSqlite(ruta, topeBytes: 8_000))
        {
            Debe(renacido.DescartesAcumulados > 0, "el conteo de descartes sobrevive al reinicio: el hueco no se olvida");
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

        Debe(c.HuecosMs == 7500 && c.Saltos == 1 && c.DescartesTotal == 3 && c.Degradados && c.TicksSapSaltados == 2,
            "cada carencia lleva su cuenta");
        var json = c.ComoJson();
        Debe(json.Contains("\"huecos_ms\":7500") && json.Contains("\"clock_jumps\":1")
             && json.Contains("\"spool_dropped\":3") && json.Contains("\"hooks_degradados\":true"),
            "y viaja con nombre: una sesión de mala calidad tiene que poder excluirse del estudio");
    }

    // ── El viaje SAP (19-21) ─────────────────────────────────────────────────

    private static (List<Visita> Visitas, Viaje Viaje) CorrerFixture()
    {
        var ruta = Path.Combine(AppContext.BaseDirectory, "bronce", "stream-sap.txt");
        var pared0 = new DateTimeOffset(2026, 9, 1, 8, 0, 0, TimeSpan.FromHours(-5));
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
    /// contra la ingesta, no en producción (2026-09-01).
    /// </remarks>
    private static void ElSeqDelSpoolNoPisaElDeLaCubeta()
    {
        var t0 = new DateTimeOffset(2026, 9, 1, 13, 0, 0, TimeSpan.Zero);
        var shift = Guid.NewGuid();
        var cubetas = new Cubetas();
        var aporte = new Aportes(1000, 1000, 0, 0, 1, 0, 0, 0, 0);
        // Dos contextos en la misma cubeta → dos muestras con seq de cubeta 0 y 1.
        cubetas.Registrar(t0.AddSeconds(1), new Superficie("sap", "sapgui://QAS/NWP1/P/0100"), null, aporte);
        cubetas.Registrar(t0.AddSeconds(2), new Superficie("chrome", null), null, aporte);

        using var spool = new SpoolSqlite(RutaTemporal("cable.db"));
        foreach (var m in cubetas.CosecharTodo()) spool.Encolar("muestras", Cable.Muestra(shift, m));
        spool.Encolar("eventos", Cable.Evento("lock", t0, shift, null, null));

        var lote = Lote.Serializar("dev-1", "b1", t0, spool.Tomar(new LimitesDeLote()));
        using var doc = System.Text.Json.JsonDocument.Parse(lote);
        var muestras = doc.RootElement.GetProperty("samples").EnumerateArray().ToList();
        var eventos = doc.RootElement.GetProperty("events").EnumerateArray().ToList();

        Debe(muestras.Count == 2, "las dos muestras viajan");
        Debe(muestras.All(m => m.TryGetProperty("spool_seq", out _)), "cada muestra lleva su spool_seq");
        Debe(muestras.Select(m => m.GetProperty("spool_seq").GetInt64()).Distinct().Count() == 2, "los spool_seq son distintos entre filas");
        Debe(muestras.Select(m => m.GetProperty("seq").GetInt32()).OrderBy(x => x).SequenceEqual(new[] { 0, 1 }), "el seq de la cubeta (0 y 1) sigue intacto");
        Debe(eventos.Count == 1 && eventos[0].TryGetProperty("spool_seq", out _), "el evento lleva su spool_seq");
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
        var json = Cable.Muestra(Guid.NewGuid(), m);
        Debe(json.Contains("\"tabs\":3") && json.Contains("\"correcciones\":2") && json.Contains("\"pegados\":1") && json.Contains("\"guardados\":1"), "las cantidades viajan");
        Debe(!json.Contains("vk", StringComparison.OrdinalIgnoreCase) && !json.Contains("0x") && !json.Contains("VK_"), "ningún código de tecla viaja");
        Debe(m.Teclas == 12, "las teclas de control también cuentan como teclas");
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
