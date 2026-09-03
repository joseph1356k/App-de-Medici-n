using System.Text.Json;

namespace Medidor;

/// <summary>
/// EL FORMATO DE CABLE v2: cómo viaja cada cosa hacia `POST /api/medidor/lote`. Los nombres de campo
/// son snake_case porque el servidor los mapea 1:1 a columnas tipadas — el contrato espejo vive en
/// `plataforma/lib/ingesta.ts` y cambiarlo aquí sin cambiarlo allá es la deriva de contrato que ya
/// pasó una vez (R17 del análisis de Operations).
///
/// SIN `shift_id`: la unidad es la jornada (device × día operativo) y cada fila lleva su
/// `dia_operativo`, calculado en el PC con la hora local del hospital (corte 06:00). Las muestras y
/// las visitas llevan además el `sap_user` visto: el login del médico, no del paciente.
///
/// El `detail` de un evento pasa por una LISTA BLANCA de claves aquí Y en el servidor: dos vallas
/// independientes, porque la fuga de PHI a un feed visible en el panel admin es el riesgo R4
/// documentado, y una valla que vive solo en un lado degrada en silencio.
/// </summary>
public static class Cable
{
    private static readonly HashSet<string> ClavesDeDetail = new(StringComparer.Ordinal)
    {
        "from", "to", "ms", "reason", "count", "user", "run_id", "workflow_id",
        "steps", "rule", "version", "total_ms", "align_ms", "outcome",
    };

    private const int TopeDeTextoEnDetail = 120;

    public static string Muestra(Muestra m) => JsonSerializer.Serialize(new Dictionary<string, object?>
    {
        ["dia_operativo"] = Dia(m.DiaOperativo),
        ["bucket_start"] = m.BucketStart.UtcDateTime,
        ["bucket_ms"] = m.BucketMs,
        ["seq"] = m.Seq,
        ["app"] = m.App,
        ["surface"] = m.Surface,
        ["encounter_key"] = m.EncounterKey,
        ["sap_user"] = m.SapUser,
        ["foreground_ms"] = m.ForegroundMs,
        ["active_ms"] = m.ActiveMs,
        ["typing_ms"] = m.TypingMs,
        ["keystrokes"] = m.Teclas,
        ["clicks"] = m.Clics,
        ["scroll_ticks"] = m.Scroll,
        ["context_switches"] = m.CambiosDeContexto,
        ["sap_roundtrips"] = m.SapRoundtrips,
        ["sap_wait_ms"] = m.SapEsperaMs,
        ["tabs"] = m.Tabs,
        ["enters"] = m.Enters,
        ["correcciones"] = m.Correcciones,
        ["copias"] = m.Copias,
        ["pegados"] = m.Pegados,
        ["guardados"] = m.Guardados,
    });

    /// <param name="occurredAtLocal">La hora LOCAL del hospital (con su offset): de ella sale el día
    /// operativo del evento. El instante viaja en UTC.</param>
    public static string Evento(string kind, DateTimeOffset occurredAtLocal, string? encounterKey,
        IReadOnlyDictionary<string, object?>? detail)
    {
        var limpio = new Dictionary<string, object?>();
        if (detail != null)
        {
            foreach (var (clave, valor) in detail)
            {
                if (!ClavesDeDetail.Contains(clave)) continue;
                limpio[clave] = valor switch
                {
                    string s => s.Length <= TopeDeTextoEnDetail ? s : s[..TopeDeTextoEnDetail],
                    bool or int or long or double or null => valor,
                    _ => null, // un objeto anidado no tiene nada que hacer en un detail
                };
            }
        }

        return JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["kind"] = kind,
            ["occurred_at"] = occurredAtLocal.UtcDateTime,
            ["dia_operativo"] = Dia(Huella.DiaOperativo(occurredAtLocal)),
            ["encounter_key"] = encounterKey,
            ["detail"] = limpio,
        });
    }

    public static string Visita(Visita v, string? encounterKey, string? sapUser)
        => JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["dia_operativo"] = Dia(Huella.DiaOperativo(v.EnteredAt)),
            ["encounter_key"] = encounterKey,
            ["sap_user"] = sapUser,
            ["sid"] = v.Sid,
            ["tcode"] = v.Tcode,
            ["dynpro"] = v.Dynpro,
            ["surface"] = v.Surface,
            ["entered_at"] = v.EnteredAt.UtcDateTime,
            ["left_at"] = v.LeftAt.UtcDateTime,
            ["dwell_ms"] = v.DwellMs,
            ["ready_ms"] = v.ReadyMs,
            ["sap_wait_ms"] = v.EsperaMs,
            ["roundtrips"] = v.Roundtrips,
            ["exit_to"] = v.ExitTo,
        });

    /// <summary>La foto de una jornada desde ESTE proceso (contrato 4). El servidor la guarda por
    /// (device, día, proceso_id) con GREATEST: mandarla cada 5 min es idempotente y monótono.</summary>
    public static string Jornada(Jornada j, Calidad calidad, string appVersion, int hmacVersion, Guid procesoId)
        => JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["dia_operativo"] = Dia(j.Dia),
            ["proceso_id"] = procesoId,
            ["primera_muestra_at"] = j.PrimeraMuestra.UtcDateTime,
            ["ultima_muestra_at"] = j.UltimaMuestra.UtcDateTime,
            ["app_version"] = appVersion,
            ["hmac_version"] = hmacVersion,
            ["huecos_ms"] = calidad.HuecosMs,
            ["clock_jumps"] = calidad.Saltos,
            ["spool_dropped"] = calidad.DescartesTotal,
            ["hooks_degradados"] = calidad.Degradados,
            ["hooks_rearmados"] = calidad.HooksRearmados,
            ["ticks_sap_saltados_busy"] = calidad.TicksSapSaltados,
            ["sap_scripting"] = calidad.SapScripting,
            ["sap_eventos_com"] = calidad.SapEventosCom,
            ["relanzos"] = calidad.Relanzos,
        });

    /// <summary>El servidor nombra las colecciones SIEMPRE con los nombres del spool del agente
    /// (`muestras|eventos|visitas|jornadas`); el espejo `rejected[]` de transición todavía usa los
    /// del cable (`samples|events|sap_visits`). Aquí se traducen los dos; un nombre desconocido es
    /// null y no borra nada (contrato 2).</summary>
    public static string? ColeccionDelSpool(string? nombre) => nombre switch
    {
        "samples" or "muestras" => "muestras",
        "events" or "eventos" => "eventos",
        "sap_visits" or "visitas" => "visitas",
        "jornadas" => "jornadas",
        _ => null,
    };

    /// <summary>
    /// UN 403 NO ES SIEMPRE EL MISMO 403. El servidor rechaza un lote por dos razones opuestas:
    ///   · «Dispositivo no encontrado. Vuelve a registrarte» — el device_id que guarda este PC ya
    ///     no existe (la base se recreó, o al equipo lo borraron). La cura es registrarse otra vez.
    ///   · «Dispositivo pausado o retirado» (trae `status`) — alguien lo apagó A PROPÓSITO desde el
    ///     panel. Registrarse otra vez lo resucitaría, que es justo lo contrario de lo que se pidió.
    /// Tratarlos igual deja al medidor midiendo para nadie hasta que alguien reinicie el proceso.
    /// </summary>
    public static bool IdentidadDesconocida(string? cuerpo)
    {
        if (string.IsNullOrWhiteSpace(cuerpo)) return false; // sin cuerpo no se adivina: se deja como está
        try
        {
            using var doc = JsonDocument.Parse(cuerpo);
            if (doc.RootElement.ValueKind != JsonValueKind.Object) return false;
            // `status` solo viaja cuando el equipo existe y está pausado o retirado.
            return !doc.RootElement.TryGetProperty("status", out _);
        }
        catch { return false; }
    }

    private static string Dia(DateOnly d) => d.ToString("yyyy-MM-dd");
}

/// <summary>
/// Arma el cuerpo del lote (`POST /api/medidor/lote`) desde lo que el spool entregó:
/// `{device_id, batch_id, client_now, app_version, jornadas[], samples[], events[], sap_visits[]}`.
/// A cada fila se le inyecta su `spool_seq` PRIMERO — el servidor construye con él el uid de
/// idempotencia (`device:coleccion:spool_seq`) y lo devuelve en `rechazadas[]`/`no_procesadas[]`
/// para señalar la fila exacta.
///
/// Con NOMBRE PROPIO, no `seq`: una muestra ya trae `seq` (el segmento dentro de la cubeta), y dos
/// claves iguales en un objeto JSON son una trampa — el servidor se queda con la última, el uid
/// se construía con el seq de la cubeta, y un veneno reportado borraba otra fila del spool
/// (o ninguna). Promesa 22.
/// </summary>
public static class Lote
{
    public static string Serializar(string deviceId, string batchId, DateTimeOffset clientNow, string appVersion, LoteTomado lote)
    {
        var sb = new System.Text.StringBuilder(4096);
        sb.Append("{\"device_id\":").Append(JsonSerializer.Serialize(deviceId));
        sb.Append(",\"batch_id\":").Append(JsonSerializer.Serialize(batchId));
        sb.Append(",\"client_now\":").Append(JsonSerializer.Serialize(clientNow.UtcDateTime));
        sb.Append(",\"app_version\":").Append(JsonSerializer.Serialize(appVersion));
        Coleccion(sb, "jornadas", lote.Jornadas);
        Coleccion(sb, "samples", lote.Muestras);
        Coleccion(sb, "events", lote.Eventos);
        Coleccion(sb, "sap_visits", lote.Visitas);
        sb.Append('}');
        return sb.ToString();
    }

    /// <summary>Lo que se CONFIRMA (se borra del spool) tras un 200 = todo lo enviado − rechazadas
    /// (veneno: se sacan aparte) − no procesadas (se quedan y se reenvían). No hay campo `kept`
    /// (contrato 2). Las colecciones vienen ya con los nombres del spool.</summary>
    public static LoteTomado Confirmables(LoteTomado lote,
        IEnumerable<(string Coleccion, long Seq)> noProcesadas, IEnumerable<(string Coleccion, long Seq)> veneno)
    {
        var fuera = new HashSet<(string, long)>(noProcesadas.Concat(veneno));
        return new LoteTomado(
            Filtrar("jornadas", lote.Jornadas),
            Filtrar("muestras", lote.Muestras),
            Filtrar("eventos", lote.Eventos),
            Filtrar("visitas", lote.Visitas));

        IReadOnlyList<FilaDelSpool> Filtrar(string coleccion, IReadOnlyList<FilaDelSpool> filas)
            => fuera.Count == 0 ? filas : filas.Where(f => !fuera.Contains((coleccion, f.Seq))).ToList();
    }

    private static void Coleccion(System.Text.StringBuilder sb, string nombre, IReadOnlyList<FilaDelSpool> filas)
    {
        sb.Append(",\"").Append(nombre).Append("\":[");
        for (int i = 0; i < filas.Count; i++)
        {
            if (i > 0) sb.Append(',');
            var json = filas[i].Json;
            // {"a":1} → {"spool_seq":N,"a":1}   ·   {} → {"spool_seq":N}
            sb.Append("{\"spool_seq\":").Append(filas[i].Seq);
            if (json.Length > 2) sb.Append(',').Append(json, 1, json.Length - 1);
            else sb.Append('}');
        }
        sb.Append(']');
    }
}
