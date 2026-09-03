namespace Medidor;

/// <summary>Lo que un tick aporta a su cubeta. Solo cantidades: aquí no cabe un título, un código
/// de tecla ni un valor de campo — el tipo mismo es la lista blanca.</summary>
public sealed record Aportes(int ForegroundMs, int ActiveMs, int TypingMs, int Teclas, int Clics, int Scroll,
    int CambiosDeContexto, int SapRoundtrips, int SapEsperaMs,
    int Tabs = 0, int Enters = 0, int Correcciones = 0, int Copias = 0, int Pegados = 0, int Guardados = 0);

/// <summary>Una fila de la serie temporal: una cubeta de 15 s partida por contexto
/// (app · superficie · encounter · usuario SAP), con su orden de aparición dentro de la cubeta y el
/// día operativo al que pertenece.</summary>
public sealed record Muestra(DateTimeOffset BucketStart, int BucketMs, int Seq, string App, string? Surface, string? EncounterKey,
    string? SapUser, DateOnly DiaOperativo,
    int ForegroundMs, int ActiveMs, int TypingMs, int Teclas, int Clics, int Scroll,
    int CambiosDeContexto, int SapRoundtrips, int SapEsperaMs,
    int Tabs = 0, int Enters = 0, int Correcciones = 0, int Copias = 0, int Pegados = 0, int Guardados = 0);

/// <summary>
/// LA SERIE TEMPORAL DEL MEDIDOR: acumula ticks en cubetas de 15 s alineadas al reloj de pared, y
/// parte cada cubeta por contexto — la app en foco, el encounter vigente y el usuario SAP. Así el
/// entrelazado de urgencias (paciente A → interrupción → B → vuelta a A) queda resuelto por
/// atribución: cada milisegundo pertenece a exactamente una parte, y las partes suman el total
/// (promesa 10 — el denominador es el plan, nunca lo ejecutado, aprendizaje nº10).
///
/// El día operativo de la cubeta se fija con el instante LOCAL del primer registro, no con el
/// BucketStart en UTC: las 06:00 caen exactas en una frontera de 15 s, así que una cubeta nunca
/// cruza el corte.
/// </summary>
public sealed class Cubetas
{
    public const int TamanoMs = 15_000;

    private sealed class Parte
    {
        public required string App;
        public string? Surface;
        public string? EncounterKey;
        public string? SapUser;
        public int ForegroundMs, ActiveMs, TypingMs, Teclas, Clics, Scroll, CambiosDeContexto, SapRoundtrips, SapEsperaMs;
        public int Tabs, Enters, Correcciones, Copias, Pegados, Guardados;
    }

    private sealed class Cubeta
    {
        public required DateOnly Dia;
        public readonly List<Parte> Partes = new();
    }

    private readonly SortedDictionary<long, Cubeta> _cubetas = new();

    public void Registrar(DateTimeOffset instante, Superficie superficie, string? encounterKey, Aportes aportes, string? sapUser = null)
    {
        var inicio = instante.ToUnixTimeMilliseconds() / TamanoMs * TamanoMs;
        if (!_cubetas.TryGetValue(inicio, out var cubeta))
            _cubetas[inicio] = cubeta = new Cubeta { Dia = Huella.DiaOperativo(instante) };

        var parte = cubeta.Partes.FirstOrDefault(p =>
            p.App == superficie.App && p.Surface == superficie.Surface && p.EncounterKey == encounterKey && p.SapUser == sapUser);
        if (parte == null)
        {
            parte = new Parte { App = superficie.App, Surface = superficie.Surface, EncounterKey = encounterKey, SapUser = sapUser };
            cubeta.Partes.Add(parte);
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
        parte.Tabs += aportes.Tabs;
        parte.Enters += aportes.Enters;
        parte.Correcciones += aportes.Correcciones;
        parte.Copias += aportes.Copias;
        parte.Pegados += aportes.Pegados;
        parte.Guardados += aportes.Guardados;
    }

    /// <summary>Entrega y suelta las cubetas ya COMPLETAS (su ventana terminó antes de
    /// <paramref name="hasta"/>). La cubeta en curso se queda: entregarla a medias duplicaría al
    /// completarse — y en el servidor la clave única es (device, bucket_start, seq), así que la
    /// segunda copia se descartaría (contrato 6).</summary>
    public IReadOnlyList<Muestra> Cosechar(DateTimeOffset hasta)
    {
        var tope = hasta.ToUnixTimeMilliseconds();
        var listas = _cubetas.Keys.Where(inicio => inicio + TamanoMs <= tope).ToList();
        return Emitir(listas);
    }

    /// <summary>Todo, incluida la cubeta en curso. Solo para el cierre (cambio de día, app que se
    /// apaga, volcado de un colapso): después de esto no puede llegar ningún tick más de esas cubetas.</summary>
    public IReadOnlyList<Muestra> CosecharTodo() => Emitir(_cubetas.Keys.ToList());

    private IReadOnlyList<Muestra> Emitir(List<long> inicios)
    {
        var filas = new List<Muestra>();
        foreach (var inicio in inicios)
        {
            var cubeta = _cubetas[inicio];
            for (int seq = 0; seq < cubeta.Partes.Count; seq++)
            {
                var p = cubeta.Partes[seq];
                filas.Add(new Muestra(
                    DateTimeOffset.FromUnixTimeMilliseconds(inicio), TamanoMs, seq,
                    p.App, p.Surface, p.EncounterKey, p.SapUser, cubeta.Dia,
                    p.ForegroundMs, p.ActiveMs, p.TypingMs, p.Teclas, p.Clics, p.Scroll,
                    p.CambiosDeContexto, p.SapRoundtrips, p.SapEsperaMs,
                    p.Tabs, p.Enters, p.Correcciones, p.Copias, p.Pegados, p.Guardados));
            }
            _cubetas.Remove(inicio);
        }
        return filas;
    }
}
