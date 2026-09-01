using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Medidor.App;

/// <summary>La cuenta de input desde la última cosecha: cuántos clics, cuánto scroll, los instantes
/// de tecleo (para medir ráfagas, en la escala interna de los ganchos) y hace cuántos ms fue el
/// último input. NUNCA qué tecla — el gancho ni siquiera mira el código de tecla.
///
/// `UltimoInputHaceMs` es RELATIVO (ms desde ahora), no un timestamp absoluto: los ganchos y el
/// orquestador tienen relojes monotónicos distintos, y restar timestamps entre relojes distintos no
/// significa nada. El valor relativo sí es comparable en cualquier reloj.</summary>
public sealed record ContadoresDeInput(int Clics, int Scroll, IReadOnlyList<long> InstantesDeTecla, long UltimoInputHaceMs);

/// <summary>
/// GANCHOS GLOBALES de ratón y teclado, siempre activos, con el patrón de ClickWatcher: el callback
/// hace LO MÍNIMO (incrementar un contador, anotar un instante) y nada más — «un hook lento retrasa
/// el ratón de TODA la máquina». Cuenta clics izquierdos, scroll y golpes de tecla; del teclado solo
/// sube el instante, jamás el código (promesa 9).
///
/// Si SetWindowsHookEx falla (antivirus, política del hospital), se degrada: sin ganchos, la
/// actividad se saca de GetLastInputInfo (activo/idle sí, conteos no) y se emite hooks_degradados.
/// Eso es visible en la calidad del turno — el estudio sabe que ese PC midió menos.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class Ganchos : IDisposable
{
    private const int WH_MOUSE_LL = 14, WH_KEYBOARD_LL = 13;
    private const int WM_LBUTTONDOWN = 0x0201, WM_MOUSEWHEEL = 0x020A;
    private const int WM_KEYDOWN = 0x0100, WM_SYSKEYDOWN = 0x0104;

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT { public int X, Y; public uint MouseData, Flags, Time; public IntPtr Extra; }
    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT { public uint VkCode, ScanCode, Flags, Time; public IntPtr Extra; }

    private delegate IntPtr HookProc(int code, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll")] private static extern IntPtr SetWindowsHookExW(int id, HookProc proc, IntPtr mod, uint thread);
    [DllImport("user32.dll")] private static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr GetModuleHandleW(string? name);

    // GetLastInputInfo: el respaldo cuando los ganchos no entran.
    [StructLayout(LayoutKind.Sequential)] private struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
    [DllImport("user32.dll")] private static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
    [DllImport("kernel32.dll")] private static extern uint GetTickCount();

    private readonly HookProc _mouseProc; // guardados en campo: si el GC los recoge, el hook muere
    private readonly HookProc _kbProc;
    private IntPtr _mouseHook, _kbHook;

    private int _clics, _scroll;
    private readonly List<long> _teclas = new();
    private long _ultimoInputMono;
    private readonly object _candado = new();

    public bool Degradado { get; private set; }

    public Ganchos()
    {
        _mouseProc = MouseCb;
        _kbProc = KbCb;
    }

    public void Enganchar()
    {
        var mod = GetModuleHandleW(null);
        _mouseHook = SetWindowsHookExW(WH_MOUSE_LL, _mouseProc, mod, 0);
        _kbHook = SetWindowsHookExW(WH_KEYBOARD_LL, _kbProc, mod, 0);
        if (_mouseHook == IntPtr.Zero || _kbHook == IntPtr.Zero)
        {
            Degradado = true;
            Registro.Anota("ganchos", "degradado a GetLastInputInfo: SetWindowsHookEx no entró (antivirus/política)");
        }
    }

    /// <summary>Cosecha y pone a cero. Todo lo temporal se calcula con el reloj propio de los
    /// ganchos y se devuelve RELATIVO, para que el orquestador no tenga que compartir reloj.</summary>
    public ContadoresDeInput Cosechar()
    {
        lock (_candado)
        {
            var ahora = _reloj.ElapsedMilliseconds;
            if (Degradado)
            {
                // Sin ganchos: la actividad se saca de GetLastInputInfo. No hay conteos ni ráfagas,
                // solo «hace cuánto hubo input», que es lo que necesita el activo/idle.
                long haceMs = UmbralGrande;
                var info = new LASTINPUTINFO { cbSize = (uint)Marshal.SizeOf<LASTINPUTINFO>() };
                if (GetLastInputInfo(ref info))
                    haceMs = unchecked(GetTickCount() - info.dwTime);
                return new ContadoresDeInput(0, 0, Array.Empty<long>(), haceMs);
            }

            long ultimoHace = _ultimoInputMono == 0 ? UmbralGrande : Math.Max(0, ahora - _ultimoInputMono);
            var r = new ContadoresDeInput(_clics, _scroll, _teclas.ToArray(), ultimoHace);
            _clics = 0; _scroll = 0; _teclas.Clear();
            return r;
        }
    }

    // Un «hace mucho» cuando aún no hubo input: mayor que cualquier umbral de actividad razonable.
    private const long UmbralGrande = 24L * 3600 * 1000;

    private IntPtr MouseCb(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            int msg = (int)wParam;
            if (msg == WM_LBUTTONDOWN) lock (_candado) { _clics++; Marca(); }
            else if (msg == WM_MOUSEWHEEL) lock (_candado) { _scroll++; Marca(); }
        }
        return CallNextHookEx(_mouseHook, code, wParam, lParam);
    }

    private IntPtr KbCb(int code, IntPtr wParam, IntPtr lParam)
    {
        if (code >= 0)
        {
            int msg = (int)wParam;
            if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN)
                lock (_candado) { _teclas.Add(_reloj.ElapsedMilliseconds); Marca(); }
            // Aquí NO se lee lParam->VkCode: no hace falta para contar, y leerlo sería el primer
            // paso para guardarlo. La lista blanca de la privacidad empieza por no mirar.
        }
        return CallNextHookEx(_kbHook, code, wParam, lParam);
    }

    private readonly System.Diagnostics.Stopwatch _reloj = System.Diagnostics.Stopwatch.StartNew();
    private void Marca() => _ultimoInputMono = _reloj.ElapsedMilliseconds;

    /// <summary>El reloj monotónico de los ganchos, para que los instantes de tecla y el
    /// último-input hablen la misma escala que el resto del medidor.</summary>
    public long AhoraMono => _reloj.ElapsedMilliseconds;

    public void Dispose()
    {
        if (_mouseHook != IntPtr.Zero) UnhookWindowsHookEx(_mouseHook);
        if (_kbHook != IntPtr.Zero) UnhookWindowsHookEx(_kbHook);
    }
}
