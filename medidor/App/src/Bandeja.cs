using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace Medidor.App;

/// <summary>Un médico del roster: lo que el menú muestra. El id es opaco (uuid del servidor); el
/// nombre es lo que el médico reconoce; los usuarios SAP sirven para asignar el turno solo.</summary>
public sealed record MedicoDelRoster(string Id, string Nombre, IReadOnlyList<string> UsuariosSap);

/// <summary>Lo que el usuario eligió en el menú de la bandeja.</summary>
public abstract record AccionDeMenu
{
    public sealed record ElegirMedico(MedicoDelRoster Medico) : AccionDeMenu;
    public sealed record CerrarTurno : AccionDeMenu;
    public sealed record Pausar : AccionDeMenu;
    public sealed record Reanudar : AccionDeMenu;
    public sealed record QueSeMide : AccionDeMenu;
    public sealed record VerPanel : AccionDeMenu;
    public sealed record Salir : AccionDeMenu;
}

/// <summary>
/// EL INDICADOR PERMANENTE. No es negociable: «un indicador permanente y un atajo para parar no son
/// cortesía: son lo que hace la diferencia entre una herramienta de medición y una cámara oculta».
/// El icono de bandeja está SIEMPRE, dice el estado de un vistazo (verde midiendo con médico, ámbar
/// sin médico, gris pausado, oscuro sin conexión) y abre el menú para elegir médico, pausar y ver
/// qué se mide.
///
/// Shell_NotifyIcon a pelo, sin WinForms: así el .exe se construye desde Linux. Si el Explorador se
/// reinicia, la barra manda TaskbarCreated y el icono se vuelve a poner (ver VentanaOculta).
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class Bandeja : IDisposable
{
    public enum EstadoUi { Midiendo, SinMedico, Pausado, Desconectado }

    public const uint MensajeDeBandeja = Win32.WM_APP + 1;
    private const uint IdIcono = 1;

    private readonly IntPtr _hwnd;
    private readonly Dictionary<EstadoUi, IntPtr> _iconos = new();
    private EstadoUi _estado = EstadoUi.Desconectado;
    private string _tip = "Medidor: arrancando";
    private bool _visible;

    public Bandeja(IntPtr hwnd)
    {
        _hwnd = hwnd;
        foreach (var e in Enum.GetValues<EstadoUi>()) _iconos[e] = Iconos.Circulo(ColorDe(e));
        Mostrar();
    }

    public EstadoUi Estado => _estado;

    /// <summary>Pone el icono (o lo vuelve a poner tras un reinicio del Explorador).</summary>
    public void Mostrar()
    {
        var d = Datos(Win32.NIF_MESSAGE | Win32.NIF_ICON | Win32.NIF_TIP | Win32.NIF_SHOWTIP);
        d.uCallbackMessage = MensajeDeBandeja;
        d.hIcon = _iconos[_estado];
        d.szTip = Recortar(_tip, 127);
        _visible = Win32.Shell_NotifyIconW(Win32.NIM_ADD, ref d);
        if (!_visible) Registro.Anota("bandeja", "Shell_NotifyIcon NIM_ADD falló: el icono no está visible");
    }

    public void MostrarEstado(EstadoUi estado, string? medico)
    {
        _estado = estado;
        _tip = estado switch
        {
            EstadoUi.Midiendo => $"Medidor: midiendo — {medico ?? "sin médico"}",
            EstadoUi.SinMedico => "Medidor: sin médico. Clic para elegir tu nombre",
            EstadoUi.Pausado => "Medidor: pausado",
            _ => "Medidor: sin conexión con el servidor (guardando en el PC)",
        };
        if (!_visible) { Mostrar(); return; }
        var d = Datos(Win32.NIF_ICON | Win32.NIF_TIP | Win32.NIF_SHOWTIP);
        d.hIcon = _iconos[estado];
        d.szTip = Recortar(_tip, 127);
        Win32.Shell_NotifyIconW(Win32.NIM_MODIFY, ref d);
    }

    public void Aviso(string titulo, string texto, bool advertencia = false)
    {
        var d = Datos(Win32.NIF_INFO);
        d.szInfoTitle = Recortar(titulo, 63);
        d.szInfo = Recortar(texto, 255);
        d.dwInfoFlags = advertencia ? Win32.NIIF_WARNING : Win32.NIIF_INFO;
        d.uTimeoutOrVersion = 6000;
        Win32.Shell_NotifyIconW(Win32.NIM_MODIFY, ref d);
    }

    /// <summary>El menú contextual, construido al vuelo con el roster vigente. Bloquea hasta que el
    /// usuario elige o lo cierra; devuelve null si lo cerró sin elegir.</summary>
    public AccionDeMenu? Menu(IReadOnlyList<MedicoDelRoster> roster, string? medicoActualId, bool pausado, bool hayTurnoConMedico)
    {
        const uint IdCerrar = 1, IdPausa = 2, IdQueMide = 3, IdPanel = 4, IdSalir = 5, BaseMedicos = 100;
        var menu = Win32.CreatePopupMenu();
        try
        {
            Win32.AppendMenuW(menu, Win32.MF_STRING | Win32.MF_GRAYED, UIntPtr.Zero, _tip.Replace("Medidor: ", ""));
            Win32.AppendMenuW(menu, Win32.MF_SEPARATOR, UIntPtr.Zero, null);
            if (roster.Count == 0)
                Win32.AppendMenuW(menu, Win32.MF_STRING | Win32.MF_GRAYED, UIntPtr.Zero, "Sin médicos en la lista (se configuran en el panel)");
            for (int i = 0; i < roster.Count; i++)
            {
                var marcado = roster[i].Id == medicoActualId ? Win32.MF_CHECKED : 0;
                Win32.AppendMenuW(menu, Win32.MF_STRING | marcado, (UIntPtr)(BaseMedicos + i), roster[i].Nombre);
            }
            Win32.AppendMenuW(menu, Win32.MF_SEPARATOR, UIntPtr.Zero, null);
            Win32.AppendMenuW(menu, Win32.MF_STRING | (hayTurnoConMedico ? 0 : Win32.MF_GRAYED), (UIntPtr)IdCerrar, "Cerrar mi turno");
            Win32.AppendMenuW(menu, Win32.MF_STRING, (UIntPtr)IdPausa, pausado ? "Reanudar la medición" : "Pausar la medición");
            Win32.AppendMenuW(menu, Win32.MF_SEPARATOR, UIntPtr.Zero, null);
            Win32.AppendMenuW(menu, Win32.MF_STRING, (UIntPtr)IdQueMide, "¿Qué mide esto?");
            Win32.AppendMenuW(menu, Win32.MF_STRING, (UIntPtr)IdPanel, "Ver el panel en el navegador");
            Win32.AppendMenuW(menu, Win32.MF_STRING, (UIntPtr)IdSalir, "Salir del medidor");

            // El ritual de Win32 para que un menú de bandeja se cierre al hacer clic fuera: traer la
            // ventana al frente antes, y mandarle un WM_NULL después.
            Win32.GetCursorPos(out var p);
            Win32.SetForegroundWindow(_hwnd);
            int id = Win32.TrackPopupMenuEx(menu, Win32.TPM_RETURNCMD | Win32.TPM_RIGHTBUTTON | Win32.TPM_BOTTOMALIGN, p.X, p.Y, _hwnd, IntPtr.Zero);
            Win32.PostMessageW(_hwnd, Win32.WM_NULL, IntPtr.Zero, IntPtr.Zero);

            if (id >= BaseMedicos && id - BaseMedicos < roster.Count) return new AccionDeMenu.ElegirMedico(roster[(int)(id - BaseMedicos)]);
            return (uint)id switch
            {
                IdCerrar => new AccionDeMenu.CerrarTurno(),
                IdPausa => pausado ? new AccionDeMenu.Reanudar() : new AccionDeMenu.Pausar(),
                IdQueMide => new AccionDeMenu.QueSeMide(),
                IdPanel => new AccionDeMenu.VerPanel(),
                IdSalir => new AccionDeMenu.Salir(),
                _ => null,
            };
        }
        finally { Win32.DestroyMenu(menu); }
    }

    public static void QueSeMide(IntPtr hwnd)
        => Win32.MessageBoxW(hwnd,
            "Este computador mide TIEMPOS de trabajo, no contenido.\n\n"
            + "• Cuánto tiempo se usa cada aplicación y el sistema clínico (SAP).\n"
            + "• Cuántos clics y cuánto tecleo hay — NUNCA qué se escribe.\n"
            + "• Qué pantallas del sistema se recorren y cuánto tarda SAP — NUNCA los datos del paciente.\n\n"
            + "El nombre del paciente, su historia y lo que escribes no salen de este computador.\n"
            + "Puedes pausar la medición desde el icono cuando quieras.",
            "¿Qué mide el medidor?", Win32.MB_OK | Win32.MB_ICONINFORMATION | Win32.MB_SETFOREGROUND | Win32.MB_TOPMOST);

    private static uint ColorDe(EstadoUi e) => e switch
    {
        EstadoUi.Midiendo => 0x2EA043,   // verde
        EstadoUi.SinMedico => 0xD29922,  // ámbar
        EstadoUi.Pausado => 0x8B949E,    // gris
        _ => 0x4A4A4A,                   // oscuro: sin conexión
    };

    private static string Recortar(string s, int max) => s.Length <= max ? s : s[..max];

    private Win32.NOTIFYICONDATAW Datos(uint flags) => new()
    {
        cbSize = (uint)Marshal.SizeOf<Win32.NOTIFYICONDATAW>(),
        hWnd = _hwnd, uID = IdIcono, uFlags = flags, szTip = "", szInfo = "", szInfoTitle = "",
    };

    public void Dispose()
    {
        var d = Datos(0);
        Win32.Shell_NotifyIconW(Win32.NIM_DELETE, ref d);
        foreach (var h in _iconos.Values) Win32.DestroyIcon(h);
        _iconos.Clear();
    }
}

/// <summary>Los iconos se DIBUJAN en memoria (un círculo del color del estado). Sin archivos al lado
/// del .exe: un icono que no se encuentra sería un indicador que no se ve, y eso es justo lo que
/// esta bandeja existe para impedir.</summary>
[SupportedOSPlatform("windows")]
internal static class Iconos
{
    public static IntPtr Circulo(uint rgb)
    {
        int n = Math.Max(16, Win32.GetSystemMetrics(Win32.SM_CXSMICON));
        var bmi = new Win32.BITMAPINFOHEADER
        {
            biSize = (uint)Marshal.SizeOf<Win32.BITMAPINFOHEADER>(),
            biWidth = n, biHeight = -n, // negativo: filas de arriba a abajo
            biPlanes = 1, biBitCount = 32, biCompression = 0,
        };
        var color = Win32.CreateDIBSection(IntPtr.Zero, ref bmi, 0, out var bits, IntPtr.Zero, 0);
        if (color == IntPtr.Zero) return IntPtr.Zero;

        byte r = (byte)(rgb >> 16), g = (byte)(rgb >> 8), b = (byte)rgb;
        double c = n / 2.0, radio = n / 2.0 - 1.0;
        for (int y = 0; y < n; y++)
            for (int x = 0; x < n; x++)
            {
                double d = Math.Sqrt((x + 0.5 - c) * (x + 0.5 - c) + (y + 0.5 - c) * (y + 0.5 - c));
                double cobertura = Math.Clamp(radio + 0.5 - d, 0, 1);
                byte a = (byte)Math.Round(cobertura * 255);
                // BGRA premultiplicado, que es lo que espera el compositor de la barra.
                int pixel = (a << 24) | ((r * a / 255) << 16) | ((g * a / 255) << 8) | (b * a / 255);
                Marshal.WriteInt32(bits, (y * n + x) * 4, pixel);
            }

        var mascara = Win32.CreateBitmap(n, n, 1, 1, new byte[((n + 15) / 16) * 2 * n]);
        var ii = new Win32.ICONINFO { fIcon = true, hbmMask = mascara, hbmColor = color };
        var icono = Win32.CreateIconIndirect(ref ii);
        Win32.DeleteObject(mascara);
        Win32.DeleteObject(color);
        return icono;
    }
}
