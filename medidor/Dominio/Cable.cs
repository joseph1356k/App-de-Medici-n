using System.Text.Json;

namespace Medidor;

/// <summary>
/// EL FORMATO DE CABLE: cómo viaja cada cosa hacia `/api/v1/metrics/batch`. Los nombres de campo
/// son snake_case porque el servidor los mapea 1:1 a columnas tipadas — el contrato espejo vive en
/// `Graph/src/domain/metrics/vocabulario.js` y cambiarlo aquí sin cambiarlo allá es la deriva de
/// contrato que ya pasó una vez (R17 del análisis de Operations).
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

    public static string Muestra(Guid shiftId, Muestra m) => JsonSerializer.Serialize(new Dictionary<string, object?>
    {
        ["shift_id"] = shiftId,
        ["bucket_start"] = m.BucketStart.UtcDateTime,
        ["bucket_ms"] = m.BucketMs,
        ["seq"] = m.Seq,
        ["app"] = m.App,
        ["surface"] = m.Surface,
        ["encounter_key"] = m.EncounterKey,
        ["foreground_ms"] = m.ForegroundMs,
        ["active_ms"] = m.ActiveMs,
        ["typing_ms"] = m.TypingMs,
        ["keystrokes"] = m.Teclas,
        ["clicks"] = m.Clics,
        ["scroll_ticks"] = m.Scroll,
        ["context_switches"] = m.CambiosDeContexto,
        ["sap_roundtrips"] = m.SapRoundtrips,
        ["sap_wait_ms"] = m.SapEsperaMs,
    });

    public static string Evento(string kind, DateTimeOffset occurredAt, Guid? shiftId, string? encounterKey,
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
            ["occurred_at"] = occurredAt.UtcDateTime,
            ["shift_id"] = shiftId,
            ["encounter_key"] = encounterKey,
            ["detail"] = limpio,
        });
    }

    public static string Turno(Turno turno, CierreDeTurno? cierre, string? sapUserSeen, Calidad calidad)
        => JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["shift_id"] = turno.ShiftId,
            ["doctor_id"] = turno.DoctorId,
            ["doctor_display"] = turno.DoctorNombre,
            ["started_at"] = turno.AbiertoEn.UtcDateTime,
            ["ended_at"] = cierre?.CerradoEn.UtcDateTime,
            ["end_reason"] = cierre?.Causa,
            ["dia_operativo"] = turno.DiaOperativo.ToString("yyyy-MM-dd"),
            ["hmac_version"] = turno.HmacVersion,
            ["sap_user_seen"] = sapUserSeen,
            ["huecos_ms"] = calidad.HuecosMs,
            ["clock_jumps"] = calidad.Saltos,
            ["spool_dropped"] = calidad.DescartesTotal,
            ["hooks_degradados"] = calidad.Degradados,
            ["ticks_sap_saltados_busy"] = calidad.TicksSapSaltados,
        });

    public static string Visita(Guid shiftId, Visita v, string? encounterKey)
        => JsonSerializer.Serialize(new Dictionary<string, object?>
        {
            ["shift_id"] = shiftId,
            ["encounter_key"] = encounterKey,
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
}

/// <summary>
/// Arma el cuerpo del lote (`POST /api/medidor/lote`) desde lo que el spool entregó. A cada fila se
/// le inyecta su `spool_seq` — el servidor construye con él el uid de idempotencia
/// (`device:coleccion:spool_seq`) y lo devuelve en `rejected[]` para envenenar la fila exacta.
///
/// Con NOMBRE PROPIO, no `seq`: una muestra ya trae `seq` (el segmento dentro de la cubeta), y dos
/// claves iguales en un objeto JSON son una trampa — el servidor se queda con la última, el uid
/// se construía con el seq de la cubeta, y un veneno reportado borraba otra fila del spool
/// (o ninguna). Promesa 22.
/// </summary>
public static class Lote
{
    public static string Serializar(string deviceId, string batchId, DateTimeOffset clientNow, LoteTomado lote)
    {
        var sb = new System.Text.StringBuilder(4096);
        sb.Append("{\"device_id\":").Append(JsonSerializer.Serialize(deviceId));
        sb.Append(",\"batch_id\":").Append(JsonSerializer.Serialize(batchId));
        sb.Append(",\"client_now\":").Append(JsonSerializer.Serialize(clientNow.UtcDateTime));
        Coleccion(sb, "shifts", lote.Turnos);
        Coleccion(sb, "samples", lote.Muestras);
        Coleccion(sb, "events", lote.Eventos);
        Coleccion(sb, "sap_visits", lote.Visitas);
        sb.Append('}');
        return sb.ToString();
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
