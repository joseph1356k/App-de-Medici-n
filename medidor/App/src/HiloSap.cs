using System.Diagnostics;
using System.Runtime.Versioning;

namespace Medidor.App;

/// <summary>
/// EL HILO SAP: la capa COM de SAP GUI Scripting exige STA, así que el medidor tiene su propio
/// hilo, dueño del <see cref="SapGui"/>, y todo lo que se le pregunta a SAP pasa por aquí.
///
/// Solo toca COM cuando la ventana de primer plano es de un proceso SAP (saplogon.exe…). Si el
/// médico está en otra cosa, este hilo no gasta nada. Cadencia 1,5 s: 5-8 llamadas COM por tick,
/// muy por debajo de lo que degrada SAP.
///
/// Entre sondeo y sondeo el hilo BOMBEA mensajes en vez de dormir: los eventos COM de SAP
/// (StartRequest/EndRequest, la espera real del servidor) llegan a un hilo STA solo a través de
/// su bomba de mensajes. Un Thread.Sleep aquí sería un buzón cerrado.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class HiloSap : IDisposable
{
    private readonly Thread _hilo;
    private readonly Func<string, bool> _esProcesoSap;
    private readonly Func<int> _cadenciaMs;
    private readonly Func<string, bool> _esVentanaDeSesion;
    private string _claseAnotada = "";
    private readonly SapGui _sap = new();
    private volatile bool _vivo = true;
    private volatile VistaSap _ultima = VistaSap.Nada;
    private volatile int _saltadosPorBusy;

    public HiloSap(Func<string, bool> esProcesoSap, Func<int> cadenciaMs, Func<string, bool> esVentanaDeSesion)
    {
        _esProcesoSap = esProcesoSap;
        _cadenciaMs = cadenciaMs;
        _esVentanaDeSesion = esVentanaDeSesion;
        _hilo = new Thread(Bucle) { IsBackground = true, Name = "medidor-sap" };
        _hilo.SetApartmentState(ApartmentState.STA);
    }

    public void Arrancar() => _hilo.Start();

    public VistaSap Ultima => _ultima;
    public bool Enganchado => _sap.Enganchado;
    public bool EventosEnganchados => _sap.EventosEnganchados;
    public int SaltadosPorBusy => _saltadosPorBusy;

    /// <summary>Saca todos los StartRequest/EndRequest acumulados desde el último drenado.</summary>
    public List<EventoSap> Drenar()
    {
        var lista = new List<EventoSap>();
        while (_sap.Eventos.TryDequeue(out var e)) lista.Add(e);
        return lista;
    }

    /// <summary>Lee UN campo SAP por selector para la regla de extracción del paciente. El que llama
    /// lo hashea y lo suelta. Corre en el hilo que llama; SapGui protege con Busy.</summary>
    public string? LeerCampo(string selector) => _sap.ValorActual(selector);

    private void Bucle()
    {
        while (_vivo)
        {
            try
            {
                var raiz = Win32.GetAncestor(Win32.GetForegroundWindow(), Win32.GA_ROOT);
                if (raiz == IntPtr.Zero || !EsSap(raiz))
                {
                    _ultima = VistaSap.Nada;
                }
                else
                {
                    // Engancharse al scripting saca un aviso en la pantalla del médico, así que solo
                    // se intenta con una SESIÓN SAP delante, no con el lanzador de SAP Logon (donde
                    // encima no hay nada que medir). Con el motor ya enganchado esto no estorba: se
                    // sigue mirando igual, sin volver a engancharse.
                    var clase = Win32.ClaseDeVentana(raiz);
                    var esSesion = _esVentanaDeSesion(clase);
                    if (!esSesion && !_sap.Enganchado && clase != _claseAnotada)
                    {
                        _claseAnotada = clase;
                        Registro.Anota("sap", $"ventana SAP delante que no es una sesión (clase «{clase}»): no se engancha");
                    }
                    var vista = _sap.Mirar(raiz, esSesion);
                    if (vista.EstabaOcupado) _saltadosPorBusy++;
                    _ultima = vista;
                }
            }
            catch (Exception e) { Registro.Excepcion("sap", e); _ultima = VistaSap.Nada; }

            Bombear(Math.Clamp(_cadenciaMs(), 500, 10_000));
        }
    }

    /// <summary>Espera <paramref name="ms"/> despachando los mensajes que lleguen (ahí vienen los
    /// eventos COM). Un WM_QUIT en este hilo termina la espera.</summary>
    private static void Bombear(int ms)
    {
        long fin = Environment.TickCount64 + ms;
        while (true)
        {
            long resta = fin - Environment.TickCount64;
            if (resta <= 0) return;
            Win32.MsgWaitForMultipleObjectsEx(0, IntPtr.Zero, (uint)resta, Win32.QS_ALLINPUT, Win32.MWMO_INPUTAVAILABLE);
            while (Win32.PeekMessageW(out var m, IntPtr.Zero, 0, 0, Win32.PM_REMOVE))
            {
                if (m.message == Win32.WM_QUIT) return;
                Win32.TranslateMessage(ref m);
                Win32.DispatchMessageW(ref m);
            }
        }
    }

    private bool EsSap(IntPtr hwnd)
    {
        Win32.GetWindowThreadProcessId(hwnd, out var pid);
        try { return _esProcesoSap(Process.GetProcessById((int)pid).ProcessName); }
        catch { return false; }
    }

    public void Dispose()
    {
        _vivo = false;
        if (_hilo.IsAlive) _hilo.Join(TimeSpan.FromSeconds(3));
    }
}
