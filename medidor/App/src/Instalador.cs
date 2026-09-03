using System.Diagnostics;
using System.Runtime.Versioning;
using System.Security.Principal;
using System.Text;
using System.Xml.Linq;
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
///   3. registra la tarea programada «Medidor-Vigilante» (al iniciar sesión y cada 5 min) que lo
///      repone si se cierra — el .exe es la ÚNICA fuente de esa definición, el script no la crea
///   4. lanza a la copia instalada y se va
///
/// TODO EN LA CARPETA DEL USUARIO: ni %ProgramFiles%, ni HKLM, ni servicios. Por eso no pide
/// permisos de administrador, que en un PC de hospital no los da nadie. Y la tarea es de usuario
/// (InteractiveToken, LeastPrivilege): si la política del hospital no deja crearla, quedan las
/// otras tres capas y el latido del log lo dice (vigilante=no).
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Instalador
{
    private const string ClaveRun = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string NombreEnRun = "Medidor";
    private const string NombreDeTarea = "Medidor-Vigilante";
    private const string ArgumentoDelVigilante = "--vigilante";

    /// <summary>La carpeta donde el medidor vive una vez instalado.</summary>
    public static string CarpetaInstalado =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Medidor");

    public static string ExeInstalado => Path.Combine(CarpetaInstalado, "Medidor.exe");

    /// <summary>La ruta real de ESTE proceso. En una publicación de un solo archivo apunta al .exe
    /// que el usuario tocó, no a la carpeta temporal donde se extrae el runtime.</summary>
    private static string? ExeActual => Environment.ProcessPath;

    /// <summary><c>MEDIDOR_SIN_INSTALAR=1</c>: correr desde <c>bin/</c> en desarrollo sin copiarse,
    /// sin tocar la clave Run y sin registrar una tarea que apunte al exe de desarrollo.</summary>
    public static bool SinInstalar => Environment.GetEnvironmentVariable("MEDIDOR_SIN_INSTALAR") == "1";

    /// <summary>¿Este .exe se abrió desde fuera de su carpeta de instalación? Entonces toca
    /// instalar. Se compara la CARPETA, no el archivo: da igual cómo se llame el archivo
    /// descargado (Medidor.exe, Medidor(1).exe, Medidor-v1.0.2.exe…).</summary>
    public static bool HayQueInstalar()
    {
        if (SinInstalar) return false;
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

    /// <summary>Copia, registra el arranque y el vigilante, lanza la copia y termina. Devuelve el
    /// código de salida del proceso: este .exe no mide nada, solo instala.</summary>
    public static int InstalarYSalir()
    {
        var origen = ExeActual!;
        try
        {
            Registro.Anota("instalador", $"instalando desde {Path.GetDirectoryName(origen)}");

            Directory.CreateDirectory(CarpetaInstalado);
            Copiar(origen);
            AsegurarArranqueConWindows();
            AsegurarVigilante();

            Process.Start(new ProcessStartInfo(ExeInstalado) { UseShellExecute = true, WorkingDirectory = CarpetaInstalado });
            Registro.Anota("instalador", "instalado y arrancado");

            Win32.MessageBoxW(IntPtr.Zero,
                "El medidor quedó instalado y ya está midiendo.\n\n"
                + "Busca el círculo junto al reloj de Windows:\n"
                + "   verde — midiendo\n"
                + "   ámbar — sin consultorio asignado: asígnalo en el panel (Dispositivos)\n"
                + "   oscuro — sin conexión con el servidor (guardando en el PC)\n\n"
                + "Arranca solo cada vez que se encienda el computador y se vigila a sí mismo:\n"
                + "si se cierra, vuelve en menos de 5 minutos.\n\n"
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

    /// <summary>Una versión anterior corriendo tiene el archivo destino tomado: hay que pararla
    /// antes de reemplazarlo. Y el vigilante puede relanzar el exe viejo justo en la ventana entre
    /// matarlo y copiar — por eso tres intentos, parando lo que corra antes de cada uno.</summary>
    private static void Copiar(string origen)
    {
        Exception? ultimo = null;
        for (int intento = 1; intento <= 3; intento++)
        {
            DetenerLoQueEsteCorriendo();
            try { File.Copy(origen, ExeInstalado, overwrite: true); return; }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                ultimo = e;
                Registro.Anota("instalador", $"copia, intento {intento}/3: {e.GetType().Name}");
            }
        }
        throw ultimo!;
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

    /// <summary>La tarea programada que repone el medidor: al iniciar sesión (30 s después) y cada
    /// 5 min, siempre como el usuario, sin administrador. Idempotente: si la tarea ya apunta al exe
    /// instalado con <c>--vigilante</c>, no toca nada. Se llama en cada arranque y al instalar.
    /// Devuelve si la tarea quedó registrada; el fallo no es fatal (quedan las otras capas).</summary>
    public static bool AsegurarVigilante()
    {
        try
        {
            var exe = ExeInstalado;
            var (codigo, salida) = Schtasks($"/Query /TN \"{NombreDeTarea}\" /XML");
            if (codigo == 0 && TareaVigente(salida, exe)) return true;

            var sid = WindowsIdentity.GetCurrent().User?.Value;
            if (string.IsNullOrWhiteSpace(sid))
            {
                Registro.Anota("instalador", "sin SID del usuario: no se registra el vigilante");
                return false;
            }

            // UTF-16 LE con BOM: es lo que schtasks /XML espera y lo que declara la cabecera.
            File.WriteAllText(Rutas.ArchivoDelVigilanteXml, XmlDeLaTarea(sid, exe, CarpetaInstalado),
                new UnicodeEncoding(bigEndian: false, byteOrderMark: true));
            var (creado, respuesta) = Schtasks($"/Create /TN \"{NombreDeTarea}\" /XML \"{Rutas.ArchivoDelVigilanteXml}\" /F");
            if (creado == 0)
            {
                Registro.Anota("instalador", $"tarea {NombreDeTarea} registrada");
                return true;
            }
            Registro.Anota("instalador", $"schtasks /Create devolvió {creado}: {Resumen(respuesta)}");
            return false;
        }
        catch (Exception e) { Registro.Excepcion("instalador", e); return false; }
    }

    /// <summary>Borra la tarea. desinstalar.ps1 hace lo mismo por su cuenta, PRIMERO, para que la
    /// tarea no relance el medidor a mitad de la desinstalación.</summary>
    public static bool QuitarVigilante()
    {
        var (codigo, salida) = Schtasks($"/Delete /TN \"{NombreDeTarea}\" /F");
        Registro.Anota("instalador", codigo == 0 ? $"tarea {NombreDeTarea} borrada" : $"schtasks /Delete devolvió {codigo}: {Resumen(salida)}");
        return codigo == 0;
    }

    internal static void DetenerLoQueEsteCorriendo()
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

    // ── La tarea programada, por dentro ──────────────────────────────────────

    /// <summary>¿El XML que schtasks devolvió apunta al exe instalado con <c>--vigilante</c>? Sin
    /// espacio de nombres: la versión del esquema cambia con Windows y da igual.</summary>
    private static bool TareaVigente(string xml, string exe)
    {
        try
        {
            var doc = XDocument.Parse(xml.TrimStart('\uFEFF', ' ', '\t', '\r', '\n'));
            string? Valor(string nombre) => doc.Descendants().FirstOrDefault(e => e.Name.LocalName == nombre)?.Value.Trim();
            var comando = Valor("Command")?.Trim('"');
            var argumentos = Valor("Arguments");
            return string.Equals(comando, exe, StringComparison.OrdinalIgnoreCase)
                && string.Equals(argumentos, ArgumentoDelVigilante, StringComparison.Ordinal);
        }
        catch { return false; } // un XML que no se entiende se reescribe: /F lo pisa
    }

    /// <summary>schtasks.exe sin ventana, con 15 s de tope. Devuelve el código y la salida (stdout +
    /// stderr) ya decodificada: cuando se redirige, schtasks escribe en la página de códigos OEM
    /// aunque su cabecera XML diga UTF-16.</summary>
    private static (int Codigo, string Salida) Schtasks(string argumentos)
    {
        var codificacion = CodificacionDeConsola();
        var psi = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "schtasks.exe"), argumentos)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = codificacion,
            StandardErrorEncoding = codificacion,
        };
        using var p = Process.Start(psi);
        if (p == null) return (-1, "schtasks no arrancó");
        var salida = p.StandardOutput.ReadToEndAsync();
        var error = p.StandardError.ReadToEndAsync();
        if (!p.WaitForExit(15_000))
        {
            try { p.Kill(); } catch { }
            return (-2, "schtasks no contestó en 15 s");
        }
        return (p.ExitCode, salida.Result + error.Result);
    }

    private static Encoding CodificacionDeConsola()
    {
        try
        {
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            return Encoding.GetEncoding((int)Win32.GetOEMCP());
        }
        catch { return Encoding.UTF8; }
    }

    private static string Resumen(string salida)
    {
        var plano = salida.Replace("\r", " ").Replace("\n", " ").Trim();
        while (plano.Contains("  ")) plano = plano.Replace("  ", " ");
        return plano.Length <= 200 ? plano : plano[..200];
    }

    private static string XmlDeLaTarea(string sid, string exe, string dir) => PlantillaDeTarea
        .Replace("{SID}", Escapar(sid))
        .Replace("{EXE}", Escapar(exe))
        .Replace("{DIR}", Escapar(dir));

    private static string Escapar(string s) => new XText(s).ToString();

    /// <summary>El RegistrationTrigger arranca la cadencia de 5 min desde la instalación (el de logon
    /// solo se arma en el siguiente inicio de sesión). IgnoreNew + instancia única: correr la tarea
    /// con el medidor vivo no añade nada. Priority 5 = Normal (los ganchos de bajo nivel no quieren
    /// BelowNormal). ExecutionTimeLimit PT0S = sin límite: el medidor vive lo que la sesión.</summary>
    private const string PlantillaDeTarea = """
        <?xml version="1.0" encoding="UTF-16"?>
        <Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
          <RegistrationInfo><Author>Medidor</Author><URI>\Medidor-Vigilante</URI>
            <Description>Mantiene el Medidor corriendo: al iniciar sesión y cada 5 min. Inofensivo si ya corre (instancia única).</Description></RegistrationInfo>
          <Triggers>
            <LogonTrigger><Enabled>true</Enabled><UserId>{SID}</UserId><Delay>PT30S</Delay>
              <Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></LogonTrigger>
            <RegistrationTrigger><Enabled>true</Enabled>
              <Repetition><Interval>PT5M</Interval><StopAtDurationEnd>false</StopAtDurationEnd></Repetition></RegistrationTrigger>
          </Triggers>
          <Principals><Principal id="Author"><UserId>{SID}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
          <Settings>
            <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
            <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
            <AllowHardTerminate>false</AllowHardTerminate><StartWhenAvailable>true</StartWhenAvailable>
            <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
            <IdleSettings><StopOnIdleEnd>false</StopOnIdleEnd><RestartOnIdle>false</RestartOnIdle></IdleSettings>
            <AllowStartOnDemand>true</AllowStartOnDemand><Enabled>true</Enabled><Hidden>true</Hidden><RunOnlyIfIdle>false</RunOnlyIfIdle>
            <WakeToRun>false</WakeToRun><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><Priority>5</Priority>
          </Settings>
          <Actions Context="Author"><Exec><Command>{EXE}</Command><Arguments>--vigilante</Arguments><WorkingDirectory>{DIR}</WorkingDirectory></Exec></Actions>
        </Task>
        """;
}
