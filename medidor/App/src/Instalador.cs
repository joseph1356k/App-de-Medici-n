using System.Diagnostics;
using System.Runtime.Versioning;
using Microsoft.Win32;

namespace Medidor.App;

/// <summary>
/// EL MEDIDOR SE INSTALA SOLO. Descargar un archivo y hacerle doble clic es el gesto que la gente
/// ya sabe hacer; cualquier paso extra —descomprimir, encontrar un .ps1, clic derecho, «ejecutar
/// con PowerShell»— es un sitio donde la instalación se cae. En el piloto del HGM se cayó tres
/// veces seguidas antes de que existiera este archivo (2026-09-02).
///
/// Lo que hace es exactamente lo mismo que instalar.ps1, que sigue existiendo para quien prefiera
/// el script o necesite apuntar a otro servidor:
///   1. se copia a %LOCALAPPDATA%\Programs\Medidor\Medidor.exe
///   2. se registra en HKCU\...\Run para arrancar con la sesión de Windows
///   3. lanza a la copia instalada y se va
///
/// TODO EN LA CARPETA DEL USUARIO: ni %ProgramFiles%, ni HKLM, ni servicios. Por eso no pide
/// permisos de administrador, que en un PC de hospital no los da nadie.
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Instalador
{
    private const string ClaveRun = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string NombreEnRun = "Medidor";

    /// <summary>La carpeta donde el medidor vive una vez instalado.</summary>
    public static string CarpetaInstalado =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Medidor");

    public static string ExeInstalado => Path.Combine(CarpetaInstalado, "Medidor.exe");

    /// <summary>La ruta real de ESTE proceso. En una publicación de un solo archivo apunta al .exe
    /// que el usuario tocó, no a la carpeta temporal donde se extrae el runtime.</summary>
    private static string? ExeActual => Environment.ProcessPath;

    /// <summary>¿Este .exe se abrió desde fuera de su carpeta de instalación? Entonces toca
    /// instalar. Se compara la CARPETA, no el archivo: da igual cómo se llame el archivo
    /// descargado (Medidor.exe, Medidor(1).exe, Medidor-v1.0.2.exe…).</summary>
    public static bool HayQueInstalar()
    {
        var actual = ExeActual;
        if (string.IsNullOrWhiteSpace(actual)) return false; // sin ruta no se arriesga nada: se mide y ya
        try
        {
            var carpetaActual = Path.GetDirectoryName(Path.GetFullPath(actual));
            return !string.Equals(
                carpetaActual?.TrimEnd(Path.DirectorySeparatorChar),
                CarpetaInstalado.TrimEnd(Path.DirectorySeparatorChar),
                StringComparison.OrdinalIgnoreCase);
        }
        catch (Exception e) { Registro.Excepcion("instalador", e); return false; }
    }

    /// <summary>Copia, registra el arranque, lanza la copia y termina. Devuelve el código de salida
    /// del proceso: este .exe no mide nada, solo instala.</summary>
    public static int InstalarYSalir()
    {
        var origen = ExeActual!;
        try
        {
            Registro.Anota("instalador", $"instalando desde {Path.GetDirectoryName(origen)}");

            // Una versión anterior corriendo tiene el archivo destino tomado: hay que pararla antes
            // de reemplazarlo. Así este mismo .exe sirve también para actualizar.
            DetenerLoQueEsteCorriendo();

            Directory.CreateDirectory(CarpetaInstalado);
            File.Copy(origen, ExeInstalado, overwrite: true);
            AsegurarArranqueConWindows();

            Process.Start(new ProcessStartInfo(ExeInstalado) { UseShellExecute = true });
            Registro.Anota("instalador", "instalado y arrancado");

            Win32.MessageBoxW(IntPtr.Zero,
                "El medidor quedó instalado y ya está midiendo.\n\n"
                + "Busca el círculo junto al reloj de Windows:\n"
                + "   ámbar — falta elegir el médico (haz clic en él)\n"
                + "   verde — midiendo\n\n"
                + "Arranca solo cada vez que se encienda el computador.\n"
                + "Ya puedes borrar el archivo que descargaste.",
                "Medidor instalado", Win32.MB_OK | Win32.MB_ICONINFORMATION | Win32.MB_TOPMOST);
            return 0;
        }
        catch (Exception e)
        {
            Registro.Excepcion("instalador", e);
            Win32.MessageBoxW(IntPtr.Zero,
                "No se pudo instalar el medidor.\n\n" + e.Message
                + "\n\nCarpeta de destino:\n" + CarpetaInstalado
                + "\n\nSi el antivirus lo bloqueó, pide que autoricen este programa.",
                "Medidor", Win32.MB_OK | Win32.MB_ICONERROR | Win32.MB_TOPMOST);
            return 3;
        }
    }

    /// <summary>Deja el medidor arrancando con la sesión de Windows. Idempotente y silencioso: se
    /// llama también en cada arranque normal, porque una copia puesta a mano (o un perfil de
    /// Windows restaurado) puede tener el .exe sin la entrada del registro.</summary>
    public static void AsegurarArranqueConWindows()
    {
        try
        {
            using var run = Registry.CurrentUser.OpenSubKey(ClaveRun, writable: true);
            if (run == null) return;
            var esperado = $"\"{ExeInstalado}\"";
            if ((run.GetValue(NombreEnRun) as string) == esperado) return;
            run.SetValue(NombreEnRun, esperado, RegistryValueKind.String);
            Registro.Anota("instalador", "arranque con Windows registrado");
        }
        catch (Exception e)
        {
            // Sin arranque automático el medidor sigue sirviendo: mide mientras esté abierto. No es
            // motivo para no instalar, sí para dejarlo escrito.
            Registro.Excepcion("instalador", e);
        }
    }

    private static void DetenerLoQueEsteCorriendo()
    {
        var yo = Environment.ProcessId;
        foreach (var p in Process.GetProcessesByName("Medidor"))
        {
            try
            {
                if (p.Id == yo) continue;
                p.Kill();
                p.WaitForExit(5000);
                Registro.Anota("instalador", "se detuvo una instancia anterior");
            }
            catch (Exception e) { Registro.Excepcion("instalador", e); }
            finally { p.Dispose(); }
        }
        Thread.Sleep(500); // Windows tarda un instante en soltar el archivo
    }
}
