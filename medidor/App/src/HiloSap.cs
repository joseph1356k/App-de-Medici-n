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
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class HiloSap : IDisposable
{
    private readonly Thread _hilo;
    private readonly Func<string, bool> _esProcesoSap;
    private readonly Func<int> _cadenciaMs;
    private readonly SapGui _sap = new();
    private volatile bool _vivo = true;
    private volatile VistaSap _ultima = VistaSap.Nada;
    private volatile int _saltadosPorBusy;

    public HiloSap(Func<string, bool> esProcesoSap, Func<int> cadenciaMs)
    {
        _esProcesoSap = esProcesoSap;
        _cadenciaMs = cadenciaMs;
        _hilo = new Thread(Bucle) { IsBackground = true, Name = "medidor-sap" };
        _hilo.SetApartmentState(ApartmentState.STA);
    }

    public void Arrancar() => _hilo.Start();

    public VistaSap Ultima => _ultima;
    public bool Enganchado => _sap.Enganchado;
    public int SaltadosPorBusy => _saltadosPorBusy;

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
                    var vista = _sap.Mirar(raiz);
                    if (vista.EstabaOcupado) _saltadosPorBusy++;
                    _ultima = vista;
                }
            }
            catch (Exception e) { Registro.Excepcion("sap", e); _ultima = VistaSap.Nada; }

            Thread.Sleep(Math.Clamp(_cadenciaMs(), 500, 10_000));
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
