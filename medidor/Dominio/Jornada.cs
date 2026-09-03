namespace Medidor;

/// <summary>
/// UNA JORNADA = un día operativo de un PC (corte a las 06:00, ver <see cref="Huella.DiaOperativo"/>).
/// Sustituye al turno del médico como unidad del estudio: el PC es del consultorio, graba siempre y
/// el único límite natural es el cambio de día. Guarda cuándo vio la primera y la última muestra; el
/// servidor combina las de varios procesos del mismo día con LEAST/GREATEST (contrato 1).
/// </summary>
public sealed record Jornada(DateOnly Dia, DateTimeOffset PrimeraMuestra, DateTimeOffset UltimaMuestra);

/// <summary>
/// La máquina de la jornada, y es minúscula a propósito: no hay causas de cierre, ni input, ni bloqueo
/// prolongado que la termine —el Sesionizador que hacía eso dejaba horas enteras sin grabar—. A las
/// 06:00 cambia sola y entrega la jornada CERRADA para que quien llama emita su última foto.
/// </summary>
public sealed class Jornadas
{
    public Jornada? Actual { get; private set; }

    /// <summary>Un latido con la hora LOCAL del hospital. Devuelve la jornada que se cerró si el día
    /// operativo cambió; null si sigue la misma (y le corre la última muestra).</summary>
    public Jornada? Avanzar(DateTimeOffset paredLocal)
    {
        var dia = Huella.DiaOperativo(paredLocal);
        if (Actual != null && Actual.Dia == dia)
        {
            Actual = Actual with { UltimaMuestra = paredLocal };
            return null;
        }
        var cerrada = Actual;
        Actual = new Jornada(dia, paredLocal, paredLocal);
        return cerrada;
    }
}
