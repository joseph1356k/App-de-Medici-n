using System.Runtime.Versioning;
using System.Security.Cryptography;

namespace Medidor.App;

/// <summary>
/// El secreto HMAC del hospital, cifrado en reposo con DPAPI (CurrentUser). Es la única pieza con
/// la que se podría re-derivar una huella, así que no puede quedar en claro en el disco de un PC
/// compartido. DPAPI lo ata al usuario de Windows de la máquina: copiar el archivo a otro PC no
/// sirve de nada.
///
/// Nunca se loguea, nunca entra en un lote, nunca sale de este proceso salvo hacia el HMAC en
/// memoria. Llega UNA vez en el registro (y en una rotación explícita).
/// </summary>
[SupportedOSPlatform("windows")]
internal static class Secreto
{
    private static readonly byte[] Entropia = "medidor-hmac-v1"u8.ToArray();

    public static void Guardar(byte[] secreto)
    {
        var cifrado = ProtectedData.Protect(secreto, Entropia, DataProtectionScope.CurrentUser);
        File.WriteAllBytes(Rutas.ArchivoDeSecreto, cifrado);
    }

    public static byte[]? Cargar()
    {
        try
        {
            if (!File.Exists(Rutas.ArchivoDeSecreto)) return null;
            var cifrado = File.ReadAllBytes(Rutas.ArchivoDeSecreto);
            return ProtectedData.Unprotect(cifrado, Entropia, DataProtectionScope.CurrentUser);
        }
        catch (Exception e)
        {
            Registro.Excepcion("secreto", e);
            return null;
        }
    }
}
