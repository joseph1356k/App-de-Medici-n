namespace Medidor;

/// <summary>
/// CADA CUÁNTO SE PUEDE VOLVER A PEDIR EL ENGANCHE A SAP, y por qué esto es una regla y no un
/// número suelto en el código de COM.
///
/// Engancharse al scripting de SAP GUI hace que SAP muestre al médico, en mitad de su trabajo,
/// «Un script está intentando acceder a SAP GUI» con Aceptar y Cancelar. Es un cuadro modal: hasta
/// que no lo cierre, no puede seguir. Si el medidor reintenta cada pocos segundos, ese cuadro vuelve
/// una y otra vez — y entonces el instrumento dejó de medir el trabajo para estorbarlo. Pasó en el
/// HGM el 2026-09-03, con el reintento anterior de 5 y 15 segundos.
///
/// Por eso hay dos ritmos distintos, y la diferencia importa:
///   · SAP GUI NO está abierto: nadie vio ningún cuadro, el intento no le costó nada a nadie. Se
///     reintenta pronto (15 s) para engancharse en cuanto el médico abra SAP.
///   · SAP GUI está abierto y aun así no deja engancharse: o el médico dijo que no, o el scripting
///     está apagado en ese PC. En los dos casos insistir es inútil Y molesto, así que la espera
///     crece: 1 min, 5, 15 y 30, y ahí se queda. Como mucho ocho avisos en la primera hora y dos
///     por hora después, en vez de uno cada cinco segundos.
///
/// La cuenta se pone a cero en cuanto se consigue enganchar: un «no» de la mañana no penaliza a la
/// tarde, cuando el médico ya aceptó o alguien quitó el aviso en las opciones de SAP GUI.
/// </summary>
public static class RitmoDeEnganche
{
    /// <summary>Sin SAP GUI abierto: reintento barato, nadie ve nada.</summary>
    public const int SinSapS = 15;

    /// <summary>El motor murió (SAP se cerró o el proxy COM se cayó). Reenganchar saca OTRO aviso,
    /// así que tampoco es cosa de cinco segundos.</summary>
    public const int TrasPerderElMotorS = 30;

    /// <summary>La escalera tras cada negativa, en segundos. La última se repite para siempre.</summary>
    public static readonly int[] TrasRechazoS = { 60, 300, 900, 1800 };

    /// <summary>Cuánto esperar tras la negativa número <paramref name="rechazosPrevios"/> (0 = la
    /// primera). Nunca baja al crecer y nunca pasa del último escalón.</summary>
    public static int EsperaTrasRechazoS(int rechazosPrevios)
    {
        if (rechazosPrevios < 0) rechazosPrevios = 0;
        return TrasRechazoS[Math.Min(rechazosPrevios, TrasRechazoS.Length - 1)];
    }

    /// <summary>Cuántos avisos como mucho en <paramref name="minutos"/> seguidos de negativas. Es la
    /// forma de comprobar la promesa en unidades que se entienden: avisos que ve una persona.</summary>
    public static int AvisosComoMuchoEn(int minutos)
    {
        int avisos = 0;
        long transcurridoS = 0;
        long topeS = (long)minutos * 60;
        while (transcurridoS <= topeS)
        {
            avisos++;
            transcurridoS += EsperaTrasRechazoS(avisos - 1);
        }
        return avisos;
    }
}
