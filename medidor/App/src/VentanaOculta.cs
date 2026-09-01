using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Medidor.App;

/// <summary>
/// LA VENTANA QUE NADIE VE: existe para tener una bomba de mensajes en el hilo principal. De ella
/// cuelgan el icono de bandeja, los dos relojes (latido de medición y latido de subida), los
/// ganchos de teclado y ratón (que exigen un hilo con bomba), y los avisos de Windows que el
/// medidor necesita para no mentir: bloqueo/desbloqueo de sesión (WTS), suspensión/reanudación
/// (WM_POWERBROADCAST), apagado (WM_ENDSESSION) y reinicio del Explorador (TaskbarCreated).
///
/// Todo lo que pasa aquí pasa en UN hilo, en orden. Por eso el orquestador no necesita candados.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class VentanaOculta : IDisposable
{
    private const string Clase = "MedidorTrabajoClinico";
    private static readonly UIntPtr TimerLatido = (UIntPtr)1, TimerSubida = (UIntPtr)2;

    private readonly Win32.WndProc _proc; // en campo: si el GC lo recoge, la ventana muere
    private readonly uint _taskbarCreated;

    public IntPtr Hwnd { get; }

    public event Action? Latido;
    public event Action? Subida;
    public event Action<bool>? Bloqueo;      // true = bloqueado, false = desbloqueado
    public event Action? Suspende;
    public event Action? Reanuda;
    public event Action? MenuPedido;
    public event Action? Apagando;
    public event Action? BarraRecreada;

    public VentanaOculta()
    {
        _proc = Proc;
        var cls = new Win32.WNDCLASSEXW
        {
            cbSize = (uint)Marshal.SizeOf<Win32.WNDCLASSEXW>(),
            lpfnWndProc = _proc,
            hInstance = Win32.GetModuleHandleW(null),
            lpszClassName = Clase,
        };
        if (Win32.RegisterClassExW(ref cls) == 0) throw new Win32Exception(Marshal.GetLastWin32Error(), "RegisterClassEx");
        Hwnd = Win32.CreateWindowExW(0, Clase, "Medidor", 0, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero, cls.hInstance, IntPtr.Zero);
        if (Hwnd == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateWindowEx");
        _taskbarCreated = Win32.RegisterWindowMessageW("TaskbarCreated");
        if (!Win32.WTSRegisterSessionNotification(Hwnd, Win32.NOTIFY_FOR_THIS_SESSION))
            Registro.Anota("ventana", "WTSRegisterSessionNotification falló: no se verán bloqueos de sesión");
    }

    public void ArmarRelojes(uint latidoMs, uint subidaMs)
    {
        Win32.SetTimer(Hwnd, TimerLatido, latidoMs, IntPtr.Zero);
        Win32.SetTimer(Hwnd, TimerSubida, subidaMs, IntPtr.Zero);
    }

    /// <summary>La bomba. Bloquea hasta WM_QUIT.</summary>
    public void Correr()
    {
        while (Win32.GetMessageW(out var m, IntPtr.Zero, 0, 0) > 0)
        {
            Win32.TranslateMessage(ref m);
            Win32.DispatchMessageW(ref m);
        }
    }

    public void Cerrar() => Win32.PostMessageW(Hwnd, Win32.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);

    private IntPtr Proc(IntPtr hwnd, uint msg, IntPtr wParam, IntPtr lParam)
    {
        try
        {
            switch (msg)
            {
                case Win32.WM_TIMER:
                    if ((ulong)wParam == (ulong)TimerLatido) Latido?.Invoke();
                    else if ((ulong)wParam == (ulong)TimerSubida) Subida?.Invoke();
                    return IntPtr.Zero;

                case Bandeja.MensajeDeBandeja:
                    switch ((uint)((long)lParam & 0xFFFF))
                    {
                        case Win32.WM_LBUTTONUP:
                        case Win32.WM_LBUTTONDBLCLK:
                        case Win32.WM_RBUTTONUP:
                        case Win32.WM_CONTEXTMENU:
                            MenuPedido?.Invoke();
                            break;
                    }
                    return IntPtr.Zero;

                case Win32.WM_WTSSESSION_CHANGE:
                    switch ((int)wParam)
                    {
                        case Win32.WTS_SESSION_LOCK: Bloqueo?.Invoke(true); break;
                        case Win32.WTS_SESSION_UNLOCK: Bloqueo?.Invoke(false); break;
                        case Win32.WTS_SESSION_LOGOFF: Apagando?.Invoke(); break;
                    }
                    return IntPtr.Zero;

                case Win32.WM_POWERBROADCAST:
                    switch ((int)wParam)
                    {
                        case Win32.PBT_APMSUSPEND: Suspende?.Invoke(); break;
                        case Win32.PBT_APMRESUMEAUTOMATIC:
                        case Win32.PBT_APMRESUMESUSPEND: Reanuda?.Invoke(); break;
                    }
                    return (IntPtr)1;

                case Win32.WM_QUERYENDSESSION:
                    Apagando?.Invoke();
                    return (IntPtr)1;

                case Win32.WM_ENDSESSION:
                    if (wParam != IntPtr.Zero) Apagando?.Invoke();
                    return IntPtr.Zero;

                case Win32.WM_CLOSE:
                    Win32.DestroyWindow(hwnd);
                    return IntPtr.Zero;

                case Win32.WM_DESTROY:
                    Win32.KillTimer(hwnd, TimerLatido);
                    Win32.KillTimer(hwnd, TimerSubida);
                    Win32.WTSUnRegisterSessionNotification(hwnd);
                    Win32.PostQuitMessage(0);
                    return IntPtr.Zero;
            }
            if (msg == _taskbarCreated) { BarraRecreada?.Invoke(); return IntPtr.Zero; }
        }
        catch (Exception e)
        {
            // Una excepción que escape del WndProc tumba el proceso sin log. Aquí se anota y sigue.
            Registro.Excepcion("ventana", e);
        }
        return Win32.DefWindowProcW(hwnd, msg, wParam, lParam);
    }

    public void Dispose() { /* la ventana se destruye con WM_CLOSE; el proceso termina después */ }
}
