namespace Medidor;

/// <summary>A qué se atribuye un tick: la superficie, el paciente, el usuario SAP y si cuenta como activo.</summary>
public sealed record Atribucion(Superficie Superficie, string? EncounterKey, string? SapUser, bool Activo);

/// <summary>
/// GRABACIÓN CONTINUA: el medidor no tiene compuerta. Antes, con el PC bloqueado, pausado o sin turno,
/// el tick se descartaba y la línea de tiempo quedaba en blanco sin decir por qué. Ahora cada tick cae
/// en una cubeta, y la única pregunta es a qué se atribuye:
///   · bloqueado ⇒ app «bloqueado», sin superficie, sin paciente, sin usuario SAP y activo = false
///     (contrato 5: foreground_ms = transcurrido, active_ms = 0);
///   · sin ventana delante (escritorio vacío, una transición) ⇒ «otro», no un tick perdido;
///   · si no ⇒ lo que está delante, con el encounter y el usuario SAP vigentes.
/// Es pura para poder jurarla en el contrato (promesa 13) sin una sesión de Windows.
/// </summary>
public static class Continuidad
{
    public const string AppBloqueado = "bloqueado";

    public static Atribucion Atribuir(bool bloqueado, Superficie? delante, string? encounterKey, string? sapUser, bool inputReciente)
        => bloqueado
            ? new Atribucion(new Superficie(AppBloqueado, null), null, null, false)
            : new Atribucion(delante ?? new Superficie(Normalizador.AppOtro, null), encounterKey, sapUser, inputReciente);
}
