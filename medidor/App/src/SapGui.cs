using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.Versioning;

namespace Medidor.App;

/// <summary>Un round-trip de SAP visto por sus eventos COM: StartRequest (EsInicio) o EndRequest, con el
/// instante monotónico y, al terminar, si SAP quedó ocupado o listo.</summary>
public readonly record struct EventoSap(bool EsInicio, long MonoMs, bool BusyDespues);

/// <summary>Lo que SAP contó en un tick: la identidad de la pantalla (o null si SAP no está
/// delante), si estaba ocupado (tick saltado), el usuario SAP y el título de la ventana.
/// El título vive UN tick en memoria para la regla de extracción del paciente: nunca se
/// serializa, ni se loguea, ni entra en una cubeta.</summary>
public sealed record VistaSap(string? Surface, bool EstabaOcupado, string? SapUser, string? TituloSap)
{
    public static readonly VistaSap Nada = new(null, false, null, null);
}

/// <summary>
/// SAP GUI Scripting por COM, con ENLACE TARDÍO: sin referencia a sapfewse.ocx, así compila en
/// cualquier máquina (y en Linux) y sobrevive a los cambios de versión de SAP GUI (el interop se
/// rompió entre 7.40 → 7.70 → 8.0). Entrada por el ProgID <c>SapROTWr.SapROTWrapper</c> →
/// <c>GetROTEntry("SAPGUI")</c> → <c>GetScriptingEngine</c>.
///
/// Lo que lee, y NADA más: <c>Info.SystemName/Transaction/Program/ScreenNumber/User</c>, el
/// subdynpro del área de usuario, el título de wnd[0], y —solo por una regla remota— UN campo por
/// selector. No recorre formularios, no lee valores, no captura pantalla.
///
/// Disciplina Busy, no negociable: con <c>session.Busy = true</c> cualquier otra llamada al
/// scripting se bloquea SIN retorno. Se pregunta Busy primero y, si está ocupado, se salta el tick
/// (y se cuenta en la calidad).
///
/// Requisito del cliente: el parámetro <c>sapgui/user_scripting = TRUE</c> en el servidor SAP y el
/// scripting permitido en el SAP GUI local. Si no, <see cref="Enganchado"/> queda en false y el
/// medidor sigue midiendo el tiempo en SAP como app, sin pantallas.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class SapGui
{
    private static readonly string[] ProgIds = { "SapROTWr.SapROTWrapper", "SapROTWr.CSapROTWrapper" };

    private object? _motor;
    private dynamic? _ultimaSesion;
    private DateTime _proximoIntento = DateTime.MinValue;

    private SapComEvents? _eventos;
    private string _idSesionConEventos = "";
    private DateTime _proximoIntentoEventos = DateTime.MinValue;

    public bool Enganchado => _motor != null;

    /// <summary>Los StartRequest/EndRequest que llegaron desde la última vez que alguien los drenó.
    /// Los encola el hilo SAP (los eventos COM llegan ahí); los drena el orquestador en su tick.</summary>
    public ConcurrentQueue<EventoSap> Eventos { get; } = new();

    public bool EventosEnganchados => _eventos != null;

    /// <summary>Mira la sesión SAP cuya ventana es <paramref name="hwndRaiz"/> (la de primer plano).
    /// Si ninguna sesión está delante, devuelve <see cref="VistaSap.Nada"/>. Si la que está delante
    /// está ocupada, devuelve EstabaOcupado=true sin tocarla.</summary>
    public VistaSap Mirar(IntPtr hwndRaiz)
    {
        dynamic? app;
        try { app = Motor(); }
        catch (Exception e) { Soltar("motor", e); return VistaSap.Nada; }
        if (app == null) return VistaSap.Nada;

        try
        {
            dynamic conexiones = app.Connections;
            int nc = (int)conexiones.Count;
            bool algunaOcupada = false;
            for (int i = 0; i < nc; i++)
            {
                dynamic conn = conexiones.ElementAt(i);
                dynamic sesiones = conn.Sessions;
                int ns = (int)sesiones.Count;
                for (int j = 0; j < ns; j++)
                {
                    dynamic s = sesiones.ElementAt(j);
                    bool ocupada;
                    try { ocupada = (bool)s.Busy; } catch { continue; }
                    if (ocupada) { algunaOcupada = true; continue; }

                    long h;
                    try { h = (long)s.ActiveWindow.Handle; } catch { continue; }
                    var hwnd = (IntPtr)h;
                    if (hwnd == hwndRaiz || Win32.GetAncestor(hwnd, Win32.GA_ROOT) == hwndRaiz)
                    {
                        _ultimaSesion = s;
                        AsegurarEventos(s);
                        return Identidad(s);
                    }
                }
            }
            // Ninguna sesión libre calzó con la ventana de delante. Si alguna estaba ocupada, lo
            // más probable es que sea esa: se reporta como tick saltado, no como «SAP no está».
            return algunaOcupada ? new VistaSap(null, true, null, null) : VistaSap.Nada;
        }
        catch (Exception e)
        {
            Soltar("sesiones", e);
            return VistaSap.Nada;
        }
    }

    /// <summary>Lee UN campo por selector en la última sesión vista, para la extracción del ID de
    /// paciente por regla remota. Devuelve el valor crudo; el que llama lo hashea y lo suelta.
    /// Es la ÚNICA lectura de contenido del medidor.</summary>
    public string? ValorActual(string selector)
    {
        try
        {
            dynamic? s = _ultimaSesion;
            if (s == null) return null;
            if ((bool)s.Busy) return null;
            dynamic? campo = s.FindById(Relativo(selector), false);
            return campo == null ? null : Str(campo.Text);
        }
        catch (Exception e)
        {
            Registro.Anota("sap", $"campo por selector no legible: {e.GetType().Name}");
            return null;
        }
    }

    private static VistaSap Identidad(dynamic s)
    {
        dynamic info = s.Info;
        string sid = Str(info.SystemName).Trim();
        string tcode = Str(info.Transaction).Trim();
        string programa = "", dynpro = "", usuario = "";
        try { programa = Str(info.Program).Trim(); } catch { }
        try { dynpro = Str(info.ScreenNumber).Trim(); } catch { }
        try { usuario = Str(info.User).Trim(); } catch { }

        string titulo = "";
        try { titulo = Str(s.FindById("wnd[0]").Text); } catch { }

        if (sid.Length == 0 || tcode.Length == 0) return new VistaSap(null, false, usuario.Length == 0 ? null : usuario, titulo);

        // A 4 dígitos: SAP nombra los dynpros así (0100); sin normalizar «100» y «0100» serían
        // dos pantallas distintas según de dónde venga el dato.
        if (int.TryParse(dynpro, out int n)) dynpro = n.ToString("D4");
        var url = $"sapgui://{sid}/{tcode}/{(programa.Length > 0 ? programa : "-")}/{(dynpro.Length > 0 ? dynpro : "-")}";

        // El subdynpro del área de usuario: dentro del Puesto de trabajo (NWP1) abrir una fila
        // cambia el panel derecho sin cambiar transacción, programa ni dynpro. Sin esto toda la
        // transacción sería UNA pantalla y el journey quedaría ciego justo donde importa.
        var sub = Subdynpro(s);
        if (sub.Length > 0) url += "/" + sub;

        return new VistaSap(url, false, usuario.Length == 0 ? null : usuario, titulo);
    }

    private static string Subdynpro(dynamic s)
    {
        try
        {
            dynamic? area = s.FindById("wnd[0]/usr", false);
            if (area == null) return "";
            dynamic hijos = area.Children;
            int n = (int)hijos.Count;
            for (int i = 0; i < n && i < 12; i++)
            {
                string id;
                try { id = Str(hijos.ElementAt(i).Id); } catch { continue; }
                var hoja = id[(id.LastIndexOf('/') + 1)..];
                // «sub» y «ssub»: SAP usa los dos prefijos (subdynpro dinámico y estático).
                if (hoja.StartsWith("ssub", StringComparison.OrdinalIgnoreCase) && hoja.Length > 4) return Limpio(hoja);
                if (hoja.StartsWith("sub", StringComparison.OrdinalIgnoreCase) && hoja.Length > 3) return Limpio(hoja);
            }
        }
        catch { /* la pantalla cambia bajo los pies: sin dato es mejor que un dato inventado */ }
        return "";
    }

    /// <summary>Solo caracteres de identificador: un id de subdynpro es un nombre técnico
    /// (ssubVIEW_SCREEN:SAPLN1LSTAMB:0007), nunca texto libre. Cualquier otra cosa se descarta.</summary>
    private static string Limpio(string s)
        => new(s.Where(c => char.IsAsciiLetterOrDigit(c) || c is '_' or ':' or '.' or '-').ToArray());

    private object? Motor()
    {
        if (_motor != null) return _motor;
        if (DateTime.UtcNow < _proximoIntento) return null;

        foreach (var progId in ProgIds)
        {
            var tipo = Type.GetTypeFromProgID(progId);
            if (tipo == null) continue;
            var wrapper = Activator.CreateInstance(tipo);
            var rot = tipo.InvokeMember("GetROTEntry", BindingFlags.InvokeMethod, null, wrapper, new object[] { "SAPGUI" });
            if (rot == null) break;
            _motor = rot.GetType().InvokeMember("GetScriptingEngine", BindingFlags.InvokeMethod, null, rot, null);
            if (_motor != null) { Registro.Anota("sap", "enganchado al motor de scripting"); return _motor; }
        }
        // Sin SAP GUI abierto (o sin scripting): no insistir cada tick, que cada intento cuesta.
        _proximoIntento = DateTime.UtcNow.AddSeconds(15);
        return null;
    }

    /// <summary>Engancha StartRequest/EndRequest en la sesión que está delante (una vez por sesión).
    /// Si el enganche falla, se anota el diagnóstico y se reintenta al minuto: las visitas siguen
    /// midiéndose por identidad; solo la espera y el time-to-ready quedan sin dato.</summary>
    private void AsegurarEventos(dynamic s)
    {
        string id;
        try { id = Str(s.Id); } catch { return; }
        if (id == _idSesionConEventos && (_eventos != null || DateTime.UtcNow < _proximoIntentoEventos)) return;

        _eventos?.Dispose();
        _eventos = null;
        _idSesionConEventos = id;

        var ev = new SapComEvents((object)s);
        ev.Disparado += (nombre, t) =>
        {
            bool busy = false;
            try { busy = (bool)s.Busy; } catch { /* a mitad de un round-trip SAP puede no contestar */ }
            Eventos.Enqueue(new EventoSap(nombre.Equals("StartRequest", StringComparison.OrdinalIgnoreCase), t, busy));
        };
        if (ev.Enganchar(out var diagnostico))
        {
            _eventos = ev;
            Registro.Anota("sap", $"eventos COM enganchados en {id}: {diagnostico}");
        }
        else
        {
            ev.Dispose();
            _proximoIntentoEventos = DateTime.UtcNow.AddMinutes(1);
            Registro.Anota("sap", $"eventos COM no disponibles ({diagnostico}): la espera y el time-to-ready quedan sin dato");
        }
    }

    private void Soltar(string donde, Exception e)
    {
        // SAP se cerró o el proxy COM murió: se suelta el motor y se reintenta luego. La cadena
        // entera de la excepción, por tipo: aquí no hay contenido clínico, solo el motivo.
        Registro.Anota("sap", $"se soltó el motor ({donde}): {e.GetType().Name}");
        _eventos?.Dispose();
        _eventos = null;
        _idSesionConEventos = "";
        _motor = null;
        _ultimaSesion = null;
        _proximoIntento = DateTime.UtcNow.AddSeconds(5);
    }

    private static string Relativo(string selector)
    {
        // «/app/con[0]/ses[0]/wnd[0]/usr/...» → «wnd[0]/usr/...»: FindById en la sesión espera la
        // ruta relativa a ella.
        var i = selector.IndexOf("/wnd[", StringComparison.OrdinalIgnoreCase);
        return i > 0 ? selector[(i + 1)..] : selector;
    }

    private static string Str(object? v) => v?.ToString() ?? "";
}
