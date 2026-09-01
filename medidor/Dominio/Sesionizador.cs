namespace Medidor;

/// <summary>Un turno abierto: quién (si se sabe), desde cuándo, y el día operativo que FIJA la
/// clave de la huella (promesa 5 — un turno nocturno no parte al paciente en dos).</summary>
public sealed record Turno(Guid ShiftId, string? DoctorId, string? DoctorNombre, DateTimeOffset AbiertoEn, DateOnly DiaOperativo, int HmacVersion);

public sealed record CierreDeTurno(Guid ShiftId, DateTimeOffset CerradoEn, string Causa);

/// <summary>Lo que el sesionizador necesita saber del PC en cada latido.</summary>
public sealed record EstadoDelPc(long UltimoInputHaceMs, long? BloqueadoHaceMs);

/// <summary>
/// LA MÁQUINA DEL TURNO. Las causas de cierre son un conjunto CERRADO y cada cierre dice la suya
/// (aprendizaje nº2: un mensaje que no distingue sus causas manda la investigación al lugar
/// equivocado): `manual` · `timeout_inactividad` (4 h sin input; el cierre se fecha en el último
/// input, no en el momento de darse cuenta) · `lock_prolongado` (2 h bloqueado; se fecha al
/// bloquearse) · `turno_nuevo` (abrir con uno abierto) · `apagado`.
///
/// Un turno SIN médico mide igual: el baseline no se pierde porque alguien ignore el selector.
/// Se reasigna mientras está abierto; nunca después — eso sería reescribir historia.
/// </summary>
public sealed class Sesionizador
{
    public const long TimeoutInactividadMs = 4L * 3600 * 1000;
    public const long LockProlongadoMs = 2L * 3600 * 1000;

    private Turno? _abierto;

    public Turno? Abierto => _abierto;

    public (Turno Nuevo, CierreDeTurno? CierreDelAnterior) Abrir(DateTimeOffset ahora, string? doctorId, string? doctorNombre, int hmacVersion)
    {
        CierreDeTurno? cierre = null;
        if (_abierto != null)
            cierre = new CierreDeTurno(_abierto.ShiftId, ahora, "turno_nuevo");

        _abierto = new Turno(Guid.NewGuid(), doctorId, doctorNombre, ahora, Huella.DiaOperativo(ahora), hmacVersion);
        return (_abierto, cierre);
    }

    public bool Reasignar(string doctorId, string doctorNombre)
    {
        if (_abierto == null) return false;
        _abierto = _abierto with { DoctorId = doctorId, DoctorNombre = doctorNombre };
        return true;
    }

    public CierreDeTurno? Avanzar(DateTimeOffset ahora, EstadoDelPc estado)
    {
        if (_abierto == null) return null;

        if (estado.BloqueadoHaceMs is long bloqueado && bloqueado >= LockProlongadoMs)
            return CerrarEn(ahora.AddMilliseconds(-bloqueado), "lock_prolongado");

        if (estado.UltimoInputHaceMs >= TimeoutInactividadMs)
            return CerrarEn(ahora.AddMilliseconds(-estado.UltimoInputHaceMs), "timeout_inactividad");

        return null;
    }

    public CierreDeTurno? Cerrar(DateTimeOffset ahora, string causa)
        => _abierto == null ? null : CerrarEn(ahora, causa);

    private CierreDeTurno CerrarEn(DateTimeOffset cuando, string causa)
    {
        var cierre = new CierreDeTurno(_abierto!.ShiftId, cuando, causa);
        _abierto = null;
        return cierre;
    }
}
