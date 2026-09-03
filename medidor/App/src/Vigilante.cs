using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text.Json;

namespace Medidor.App;

/// <summary>
/// CÓMO ARRANCÓ ESTE PROCESO. Hay tres puertas y las tres llevan al mismo Main:
///   · <see cref="Normal"/>: la clave Run de HKCU al iniciar sesión, o el doble clic de una persona;
///   · <see cref="Vigilante"/>: la tarea programada «Medidor-Vigilante» (al iniciar sesión y cada
///     5 min) con <c>--vigilante</c>. Si ya hay un medidor vivo, sale en silencio;
///   · <see cref="Relanzado"/>: el hijo que un colapso lanza con <c>--relanzado=&lt;pid&gt;</c> (o WER
///     con <c>--relanzado</c> a secas). Espera a que muera el padre y toma el relevo.
/// El motivo viaja en <c>medidor_start {reason}</c> (contrato 3) para que el panel distinga un
/// arranque de un relanzo.
/// </summary>
public abstract record Arranque
{
    public sealed record Normal : Arranque { public override string ToString() => "Normal"; }
    public sealed record Vigilante : Arranque { public override string ToString() => "Vigilante"; }
    public sealed record Relanzado(int PidAnterior) : Arranque { public override string ToString() => $"Relanzado(pid={PidAnterior})"; }

    public string Motivo => this switch
    {
        Vigilante => "vigilante",
        Relanzado => "relanzado",
        _ => "arranque",
    };

    public static Arranque Desde(string[] args)
    {
        foreach (var a in args)
        {
            if (a.Equals("--vigilante", StringComparison.OrdinalIgnoreCase)) return new Vigilante();
            if (a.StartsWith("--relanzado", StringComparison.OrdinalIgnoreCase))
            {
                var i = a.IndexOf('=');
                return new Relanzado(i > 0 && int.TryParse(a[(i + 1)..], out var pid) ? pid : 0);
            }
        }
        return new Normal();
    }
}

/// <summary>
/// EL MEDIDOR SE VIGILA A SÍ MISMO. Cuatro capas, de la más rápida a la más lenta: el manejador de
/// colapsos que relanza (segundos) → RegisterApplicationRestart (WER, para cuelgues) → la tarea
/// programada cada 5 min → la clave Run al iniciar sesión. Esta clase es el punto de encuentro:
/// decide quién se queda con el mutex de instancia única y deja el latido (<c>latido.txt</c>) que
/// permite distinguir un medidor vivo de un zombi que tiene el mutex pero no mide.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Vigilante
{
    /// <summary>El latido se escribe al arrancar y cada 5 min; a los 15 min sin latido la instancia
    /// que tiene el mutex se da por muerta (colgada en COM, suspendida) y se releva.</summary>
    public static readonly TimeSpan LatidoViejo = TimeSpan.FromMinutes(15);

    /// <summary>Toma el mutex de instancia única según el modo. false = hay otro medidor midiendo:
    /// este proceso sobra y se va en silencio.</summary>
    public static bool TomarInstancia(Mutex mutex, Arranque modo)
    {
        switch (modo)
        {
            case Arranque.Relanzado r:
                // El padre está muriendo (Environment.Exit tras el volcado). Se le espera para no
                // medir dos a la vez, y luego se espera el mutex: abandonado cuenta como tomado.
                if (r.PidAnterior > 0) EsperarMuerte(r.PidAnterior, TimeSpan.FromSeconds(30));
                return Esperar(mutex, TimeSpan.FromSeconds(30));

            case Arranque.Vigilante:
                if (Esperar(mutex, TimeSpan.Zero)) return true;
                var edad = EdadDelLatido();
                if (edad != null && edad <= LatidoViejo) return false; // hay un medidor vivo: este sale en silencio (pasa cada 5 min, no se anota)

                // Latido viejo o ausente. Puede ser un PC que acaba de despertar de una suspensión larga:
                // la tarea despierta con él, y el medidor vivo renueva su latido en cuanto vuelve. Se le
                // dan 20 s antes de darlo por zombi; si en ese tiempo late, este proceso sobra.
                Thread.Sleep(20_000);
                if (Esperar(mutex, TimeSpan.Zero)) return true;
                var edadDespues = EdadDelLatido();
                if (edadDespues != null && edadDespues <= LatidoViejo) return false;

                Registro.Anota("vigilante", edadDespues == null
                    ? "instancia sin latido: se releva"
                    : $"instancia sin latido desde hace {edadDespues.Value.TotalMinutes:F0} min: se releva");
                Instalador.DetenerLoQueEsteCorriendo();
                return Esperar(mutex, TimeSpan.FromSeconds(10));

            default:
                return Esperar(mutex, TimeSpan.Zero);
        }
    }

    /// <summary>Escribe el latido. Al arrancar y cada 5 min desde el tick.</summary>
    public static void Latir()
    {
        try { File.WriteAllText(Rutas.ArchivoDeLatido, $"{DateTimeOffset.Now:O} pid={Environment.ProcessId}{Environment.NewLine}"); }
        catch (Exception e) { Registro.Excepcion("vigilante", e); }
    }

    public static IReadOnlyList<DateTimeOffset> LeerRelanzos()
    {
        try
        {
            if (!File.Exists(Rutas.ArchivoDeRelanzos)) return Array.Empty<DateTimeOffset>();
            return JsonSerializer.Deserialize<List<DateTimeOffset>>(File.ReadAllText(Rutas.ArchivoDeRelanzos)) ?? new List<DateTimeOffset>();
        }
        catch { return Array.Empty<DateTimeOffset>(); }
    }

    public static void GuardarRelanzos(IReadOnlyList<DateTimeOffset> historial)
    {
        try { File.WriteAllText(Rutas.ArchivoDeRelanzos, JsonSerializer.Serialize(historial)); }
        catch (Exception e) { Registro.Excepcion("vigilante", e); }
    }

    private static bool Esperar(Mutex mutex, TimeSpan espera)
    {
        try { return mutex.WaitOne(espera); }
        catch (AbandonedMutexException) { return true; } // el dueño murió sin soltarlo: es nuestro
    }

    private static TimeSpan? EdadDelLatido()
    {
        try
        {
            if (!File.Exists(Rutas.ArchivoDeLatido)) return null;
            return DateTime.Now - File.GetLastWriteTime(Rutas.ArchivoDeLatido);
        }
        catch { return null; }
    }

    private static void EsperarMuerte(int pid, TimeSpan tope)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            p.WaitForExit((int)tope.TotalMilliseconds);
        }
        catch { /* ya no existe: mejor */ }
    }
}
