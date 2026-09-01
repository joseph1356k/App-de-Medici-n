namespace Medidor;

/// <summary>Lo que un tick aporta a su cubeta. Solo cantidades: aquí no cabe un título, un código
/// de tecla ni un valor de campo — el tipo mismo es la lista blanca.</summary>
public sealed record Aportes(int ForegroundMs, int ActiveMs, int TypingMs, int Teclas, int Clics, int Scroll,
    int CambiosDeContexto, int SapRoundtrips, int SapEsperaMs);

/// <summary>Una fila de la serie temporal: una cubeta de 15 s partida por contexto
/// (app · superficie · encounter), con su orden de aparición dentro de la cubeta.</summary>
public sealed record Muestra(DateTimeOffset BucketStart, int BucketMs, int Seq, string App, string? Surface, string? EncounterKey,
    int ForegroundMs, int ActiveMs, int TypingMs, int Teclas, int Clics, int Scroll,
    int CambiosDeContexto, int SapRoundtrips, int SapEsperaMs);

/// <summary>
/// LA SERIE TEMPORAL DEL MEDIDOR: acumula ticks en cubetas de 15 s alineadas al reloj de pared, y
/// parte cada cubeta por contexto — la app en foco y el encounter vigente. Así el entrelazado de
/// urgencias (paciente A → interrupción → B → vuelta a A) queda resuelto por atribución: cada
/// milisegundo pertenece a exactamente una parte, y las partes suman el total (promesa 10 — el
/// denominador es el plan, nunca lo ejecutado, aprendizaje nº10).
/// </summary>
public sealed class Cubetas
{
    public const int TamanoMs = 15_000;

    private sealed class Parte
    {
        public required string App;
        public string? Surface;
        public string? EncounterKey;
        public int ForegroundMs, ActiveMs, TypingMs, Teclas, Clics, Scroll, CambiosDeContexto, SapRoundtrips, SapEsperaMs;
    }

    private readonly SortedDictionary<long, List<Parte>> _cubetas = new();

    public void Registrar(DateTimeOffset instante, Superficie superficie, string? encounterKey, Aportes aportes)
    {
        var inicio = instante.ToUnixTimeMilliseconds() / TamanoMs * TamanoMs;
        if (!_cubetas.TryGetValue(inicio, out var partes))
            _cubetas[inicio] = partes = new List<Parte>();

        var parte = partes.FirstOrDefault(p =>
            p.App == superficie.App && p.Surface == superficie.Surface && p.EncounterKey == encounterKey);
        if (parte == null)
        {
            parte = new Parte { App = superficie.App, Surface = superficie.Surface, EncounterKey = encounterKey };
            partes.Add(parte);
        }

        parte.ForegroundMs += aportes.ForegroundMs;
        parte.ActiveMs += aportes.ActiveMs;
        parte.TypingMs += aportes.TypingMs;
        parte.Teclas += aportes.Teclas;
        parte.Clics += aportes.Clics;
        parte.Scroll += aportes.Scroll;
        parte.CambiosDeContexto += aportes.CambiosDeContexto;
        parte.SapRoundtrips += aportes.SapRoundtrips;
        parte.SapEsperaMs += aportes.SapEsperaMs;
    }

    /// <summary>Entrega y suelta las cubetas ya COMPLETAS (su ventana terminó antes de
    /// <paramref name="hasta"/>). La cubeta en curso se queda: entregarla a medias duplicaría al
    /// completarse.</summary>
    public IReadOnlyList<Muestra> Cosechar(DateTimeOffset hasta)
    {
        var tope = hasta.ToUnixTimeMilliseconds();
        var listas = _cubetas.Keys.Where(inicio => inicio + TamanoMs <= tope).ToList();
        return Emitir(listas);
    }

    /// <summary>Todo, incluida la cubeta en curso. Solo para el cierre (turno que termina, app que
    /// se apaga): después de esto no puede llegar ningún tick más de esas cubetas.</summary>
    public IReadOnlyList<Muestra> CosecharTodo() => Emitir(_cubetas.Keys.ToList());

    private IReadOnlyList<Muestra> Emitir(List<long> inicios)
    {
        var filas = new List<Muestra>();
        foreach (var inicio in inicios)
        {
            var partes = _cubetas[inicio];
            for (int seq = 0; seq < partes.Count; seq++)
            {
                var p = partes[seq];
                filas.Add(new Muestra(
                    DateTimeOffset.FromUnixTimeMilliseconds(inicio), p.ForegroundMs, seq,
                    p.App, p.Surface, p.EncounterKey,
                    p.ForegroundMs, p.ActiveMs, p.TypingMs, p.Teclas, p.Clics, p.Scroll,
                    p.CambiosDeContexto, p.SapRoundtrips, p.SapEsperaMs));
            }
            _cubetas.Remove(inicio);
        }
        return filas;
    }
}
