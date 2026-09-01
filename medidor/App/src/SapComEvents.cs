using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Runtime.Versioning;

namespace Medidor.App;

/// <summary>
/// Enganche de los eventos COM de <c>GuiSession</c> (StartRequest / EndRequest) SIN referenciar la
/// type library de SAP (sapfewse.ocx) — el resto del medidor habla con SAP por enlace tardío a
/// propósito, y esto sigue el mismo criterio. Son la latencia REAL de SAP: cada viaje al servidor
/// dispara StartRequest al salir y EndRequest al volver, sin sondear nada.
///
/// CÓMO: <see cref="ComEventsHelper"/> es la única API pública de .NET para suscribirse a un evento
/// COM sin PIA, pero exige el IID de la interfaz de origen y el DISPID exacto del método — ninguno de
/// los dos se escribe a mano sin la type library. Se resuelven en runtime:
///   1. <c>IProvideClassInfo2.GetGUID(GUIDKIND_DEFAULT_SOURCE_DISP_IID)</c> da el IID directo; si el
///      objeto no lo implementa, se recorren los ImplTypes marcados [source] del ClassInfo.
///   2. Con el ITypeInfo de esa interfaz se enumeran sus FUNCDESC y se buscan por NOMBRE (no por
///      DISPID fijo, que podría no coincidir entre versiones de SAP GUI) los eventos que interesan.
///   3. <c>ComEventsHelper.Combine</c> exige un delegado con EXACTAMENTE la aridad del evento COM;
///      como no se conoce de antemano, se arma según <c>FUNCDESC.cParams</c>.
///
/// Portado del asistente Ü (windows-graph/SapComEvents), que lo escribió con el mismo aviso: NO
/// VERIFICADO CONTRA UN SAP REAL en la máquina donde se escribió. Por diseño, cualquier fallo devuelve
/// false con el motivo en vez de lanzar: sin eventos, las visitas SAP se siguen midiendo por
/// identidad (duración y recorrido) y solo la espera y el time-to-ready quedan sin dato — y el log
/// dice exactamente por qué (los DISPIDs y aridades encontrados), que es lo que hace falta para
/// ajustarlo en el primer PC con SAP.
///
/// Los eventos llegan en el hilo STA que los enganchó, y solo si ese hilo BOMBEA mensajes
/// (ver HiloSap).
/// </summary>
[SupportedOSPlatform("windows")]
internal sealed class SapComEvents : IDisposable
{
    private const int GuidKindDefaultSourceDispIid = 1; // GUIDKIND_DEFAULT_SOURCE_DISP_IID

    private static readonly string[] Deseados = { "StartRequest", "EndRequest" };

    /// <summary>(nombre del evento, instante monotónico en ms). Sin argumentos del COM: no hacen falta.</summary>
    public event Action<string, long>? Disparado;

    private readonly object _com;
    private readonly List<(Guid Iid, int DispId, Delegate Sink)> _enganchados = new();

    public SapComEvents(object com) => _com = com;

    /// <summary>Intenta enganchar StartRequest y EndRequest. true si enganchó al menos uno.</summary>
    public bool Enganchar(out string diagnostico)
    {
        var partes = new List<string>();
        if (!ResolverInterfazDeOrigen(_com, out Guid iid, out ITypeInfo? info) || info == null)
        {
            diagnostico = "no se pudo resolver la interfaz de eventos (IProvideClassInfo/2)";
            return false;
        }

        foreach (var (nombre, dispId, aridad) in Metodos(info))
        {
            if (!Deseados.Contains(nombre, StringComparer.OrdinalIgnoreCase)) continue;
            try
            {
                var sink = SinkPara(nombre, aridad);
                ComEventsHelper.Combine(_com, iid, dispId, sink);
                _enganchados.Add((iid, dispId, sink));
                partes.Add($"{nombre} ok (dispid={dispId}, args={aridad})");
            }
            catch (Exception e)
            {
                partes.Add($"{nombre} NO (dispid={dispId}, args={aridad}): {e.GetType().Name}");
            }
        }

        diagnostico = partes.Count == 0 ? "la interfaz de origen no tiene StartRequest/EndRequest" : string.Join(" · ", partes);
        return _enganchados.Count > 0;
    }

    public void Desenganchar()
    {
        foreach (var (iid, dispId, sink) in _enganchados)
        {
            try { ComEventsHelper.Remove(_com, iid, dispId, sink); } catch { /* la sesión pudo morir antes */ }
        }
        _enganchados.Clear();
    }

    public void Dispose() => Desenganchar();

    private void Avisar(string nombre) => Disparado?.Invoke(nombre, Environment.TickCount64);

    // ComEventsHelper exige un delegado con la aridad EXACTA del evento COM.
    private Delegate SinkPara(string nombre, int aridad) => aridad switch
    {
        0 => new Action(() => Avisar(nombre)),
        1 => new Action<object?>(_ => Avisar(nombre)),
        2 => new Action<object?, object?>((_, _) => Avisar(nombre)),
        3 => new Action<object?, object?, object?>((_, _, _) => Avisar(nombre)),
        4 => new Action<object?, object?, object?, object?>((_, _, _, _) => Avisar(nombre)),
        _ => throw new NotSupportedException($"el evento «{nombre}» tiene {aridad} parámetros; no soportado (máximo 4)"),
    };

    // ── Introspección: IProvideClassInfo(2) → interfaz [source] → sus métodos ───────────────

    private static bool ResolverInterfazDeOrigen(object com, out Guid iid, out ITypeInfo? typeInfo)
    {
        iid = Guid.Empty; typeInfo = null;

        if (com is IProvideClassInfo2 pci2)
        {
            try
            {
                pci2.GetGUID(GuidKindDefaultSourceDispIid, out iid);
                if (iid != Guid.Empty && TypeInfoDeGuid(com, iid, out typeInfo)) return true;
            }
            catch { /* cae al camino largo */ }
        }

        if (com is IProvideClassInfo pci)
        {
            try
            {
                pci.GetClassInfo(out ITypeInfo classInfo);
                return BuscarInterfazDeOrigen(classInfo, out iid, out typeInfo);
            }
            catch { return false; }
        }
        return false;
    }

    private static bool TypeInfoDeGuid(object com, Guid iid, out ITypeInfo? typeInfo)
    {
        typeInfo = null;
        if (com is not IProvideClassInfo pci) return false;
        try
        {
            pci.GetClassInfo(out ITypeInfo classInfo);
            classInfo.GetContainingTypeLib(out ITypeLib lib, out _);
            lib.GetTypeInfoOfGuid(ref iid, out typeInfo);
            return typeInfo != null;
        }
        catch { return false; }
    }

    private static bool BuscarInterfazDeOrigen(ITypeInfo classInfo, out Guid iid, out ITypeInfo? typeInfo)
    {
        iid = Guid.Empty; typeInfo = null;
        IntPtr attrPtr = IntPtr.Zero;
        try
        {
            classInfo.GetTypeAttr(out attrPtr);
            var attr = Marshal.PtrToStructure<TYPEATTR>(attrPtr);
            for (int i = 0; i < attr.cImplTypes; i++)
            {
                try
                {
                    classInfo.GetImplTypeFlags(i, out IMPLTYPEFLAGS flags);
                    if ((flags & IMPLTYPEFLAGS.IMPLTYPEFLAG_FSOURCE) == 0) continue;
                    classInfo.GetRefTypeOfImplType(i, out int href);
                    classInfo.GetRefTypeInfo(href, out ITypeInfo srcInfo);
                    var srcAttr = TypeAttr(srcInfo);
                    if (srcAttr == null) continue;
                    iid = srcAttr.Value.guid;
                    typeInfo = srcInfo;
                    return true;
                }
                catch { continue; }
            }
        }
        catch { return false; }
        finally { if (attrPtr != IntPtr.Zero) classInfo.ReleaseTypeAttr(attrPtr); }
        return false;
    }

    private static TYPEATTR? TypeAttr(ITypeInfo info)
    {
        IntPtr p = IntPtr.Zero;
        try { info.GetTypeAttr(out p); return Marshal.PtrToStructure<TYPEATTR>(p); }
        catch { return null; }
        finally { if (p != IntPtr.Zero) info.ReleaseTypeAttr(p); }
    }

    private static IEnumerable<(string Nombre, int DispId, int Aridad)> Metodos(ITypeInfo info)
    {
        IntPtr attrPtr = IntPtr.Zero;
        TYPEATTR attr;
        try { info.GetTypeAttr(out attrPtr); attr = Marshal.PtrToStructure<TYPEATTR>(attrPtr); }
        finally { if (attrPtr != IntPtr.Zero) info.ReleaseTypeAttr(attrPtr); }

        for (int i = 0; i < attr.cFuncs; i++)
        {
            IntPtr fdPtr = IntPtr.Zero;
            FUNCDESC fd;
            try { info.GetFuncDesc(i, out fdPtr); fd = Marshal.PtrToStructure<FUNCDESC>(fdPtr); }
            catch { continue; }
            finally { if (fdPtr != IntPtr.Zero) info.ReleaseFuncDesc(fdPtr); }

            string nombre;
            try { info.GetDocumentation(fd.memid, out nombre, out _, out _, out _); }
            catch { continue; }
            if (!string.IsNullOrWhiteSpace(nombre)) yield return (nombre, fd.memid, fd.cParams);
        }
    }

    // Interfaces OLE estándar (GUIDs fijos de la especificación, no de SAP).
    [ComImport, Guid("B196B283-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IProvideClassInfo { void GetClassInfo(out ITypeInfo ppTI); }

    [ComImport, Guid("A6BC3AC0-DBAA-11CE-9DE3-00AA004BB851"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IProvideClassInfo2 { void GetClassInfo(out ITypeInfo ppTI); void GetGUID(int dwGuidKind, out Guid pGUID); }
}
