using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text;

namespace Medidor.App;

/// <summary>Lo que la sonda vio, ya podado: el proceso (para normalizar a app) y, si es un
/// navegador, un host sacado del título. El título entero no sale de aquí.</summary>
public sealed record VistaDePrimerPlano(string Proceso, string? UrlNavegador);

/// <summary>
/// El sondeo barato de «¿qué app está delante?»: GetForegroundWindow → ventana raíz → nombre de
/// proceso. NO resuelve la identidad SAP — de eso se encarga el hilo STA.
///
/// La URL del navegador es el único dato «rico» que toca, y solo para clasificar el dominio contra
/// la lista blanca; el título jamás se guarda ni se emite (promesa 1 del contrato).
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class SondaPrimerPlano
{
    private static readonly HashSet<string> Navegadores = new(StringComparer.OrdinalIgnoreCase)
    { "chrome", "msedge", "firefox", "brave", "opera", "iexplore" };

    public VistaDePrimerPlano? Mirar()
    {
        var hwnd = Win32.GetAncestor(Win32.GetForegroundWindow(), Win32.GA_ROOT);
        if (hwnd == IntPtr.Zero) return null;

        Win32.GetWindowThreadProcessId(hwnd, out var pid);
        string proceso;
        try { proceso = Process.GetProcessById((int)pid).ProcessName; }
        catch { return null; } // el proceso murió entre el hwnd y el lookup: el próximo tick lo recoge

        var procesoExe = proceso.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ? proceso : proceso + ".exe";

        string? url = null;
        if (Navegadores.Contains(proceso)) url = HostDesdeTitulo(hwnd);

        return new VistaDePrimerPlano(procesoExe, url);
    }

    /// <summary>Los navegadores no exponen su URL por Win32; el título es lo que hay. Se intenta
    /// sacar un host de él y NADA MÁS. Si no hay host reconocible, la web queda sin dominio (cae a
    /// «navegador a secas»). Deliberadamente conservador: mejor sin dominio que con un título filtrado.</summary>
    private static string? HostDesdeTitulo(IntPtr hwnd)
    {
        var sb = new StringBuilder(512);
        if (Win32.GetWindowTextW(hwnd, sb, sb.Capacity) == 0) return null;
        var titulo = sb.ToString();

        foreach (var token in titulo.Split(new[] { ' ', '\t', '—', '-', '|', '·', '(', ')' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var t = token.Trim().TrimEnd('/');
            if (t.Contains('.') && !t.Contains(' ') && Uri.CheckHostName(t) != UriHostNameType.Unknown)
                return "https://" + t;
        }
        return null;
    }
}
