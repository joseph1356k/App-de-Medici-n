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

    /// <summary>
    /// EL TRAMO TRANQUILO EN CURSO. Un PC encendido toda la noche, o bloqueado media tarde, produce
    /// una cubeta cada 15 s en la que no pasa absolutamente nada: 240 filas por hora, ~3.400 en una
    /// noche, por PC, todas diciendo lo mismo. Guardarlas una a una cuesta disco, red y base sin
    /// añadir ni un dato — el minuto 43 de un bloqueo no dice nada que no diga «bloqueado de 22:10
    /// a 06:05».
    ///
    /// Así que mientras no haya NADA (ni input, ni tecleo, ni clics, ni round-trips) y el contexto
    /// no cambie, las cubetas seguidas se acumulan en UNA fila cuyo `bucket_ms` cubre todo el tramo.
    /// En cuanto vuelve a pasar algo, o cambia la app, la pantalla, el paciente o el usuario SAP, el
    /// tramo se cierra y se emite. No se pierde tiempo ni se inventa: la fila cubre exactamente los
    /// mismos milisegundos que cubrían las cubetas que resume.
    /// </summary>
    private Parte? _tranquila;
    private long _tranquilaInicio, _tranquilaFin;
    private DateOnly _tranquilaDia;

    /// <summary>Hasta dónde puede crecer un tramo tranquilo antes de emitirse igualmente. Cinco
    /// minutos: suficiente para bajar una noche de 3.400 filas a 170, y poco para que un corte de
    /// luz se lleve por delante algo que importe (lo que se pierde es «no pasaba nada»).</summary>
    public const int TopeDelTramoTranquiloMs = 5 * 60 * 1000;

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
        return Emitir(listas, cerrarTramo: false);
    }

    /// <summary>Todo, incluida la cubeta en curso. Solo para el cierre (cambio de día, app que se
    /// apaga, volcado de un colapso): después de esto no puede llegar ningún tick más de esas cubetas.</summary>
    public IReadOnlyList<Muestra> CosecharTodo() => Emitir(_cubetas.Keys.ToList(), cerrarTramo: true);

    /// <summary>¿En esta parte no pasó absolutamente nada? Solo entonces se puede fundir con la
    /// siguiente: el foreground se suma, y lo demás ya es cero.</summary>
    private static bool NoPasaNada(Parte p) =>
        p.ActiveMs == 0 && p.TypingMs == 0 && p.Teclas == 0 && p.Clics == 0 && p.Scroll == 0
        && p.CambiosDeContexto == 0 && p.SapRoundtrips == 0 && p.SapEsperaMs == 0
        && p.Tabs == 0 && p.Enters == 0 && p.Correcciones == 0 && p.Copias == 0 && p.Pegados == 0 && p.Guardados == 0;

    private static bool MismoContexto(Parte a, Parte b) =>
        a.App == b.App && a.Surface == b.Surface && a.EncounterKey == b.EncounterKey && a.SapUser == b.SapUser;

    private Muestra TramoTranquiloComoFila() => new(
        DateTimeOffset.FromUnixTimeMilliseconds(_tranquilaInicio), (int)(_tranquilaFin - _tranquilaInicio), 0,
        _tranquila!.App, _tranquila.Surface, _tranquila.EncounterKey, _tranquila.SapUser, _tranquilaDia,
        _tranquila.ForegroundMs, 0, 0, 0, 0, 0, 0, 0, 0);

    private void SoltarTramo(List<Muestra> filas)
    {
        if (_tranquila == null) return;
        filas.Add(TramoTranquiloComoFila());
        _tranquila = null;
    }

    private IReadOnlyList<Muestra> Emitir(List<long> inicios, bool cerrarTramo)
    {
        var filas = new List<Muestra>();
        foreach (var inicio in inicios)
        {
            var cubeta = _cubetas[inicio];

            // Una cubeta con UNA sola parte y sin nada dentro puede unirse al tramo tranquilo.
            if (cubeta.Partes.Count == 1 && NoPasaNada(cubeta.Partes[0]))
            {
                var p0 = cubeta.Partes[0];
                bool sigue = _tranquila != null && _tranquilaFin == inicio && _tranquilaDia == cubeta.Dia
                    && MismoContexto(_tranquila, p0)
                    && (_tranquilaFin + TamanoMs - _tranquilaInicio) <= TopeDelTramoTranquiloMs;
                if (sigue)
                {
                    _tranquila!.ForegroundMs += p0.ForegroundMs;
                    _tranquilaFin = inicio + TamanoMs;
                }
                else
                {
                    SoltarTramo(filas);
                    _tranquila = new Parte { App = p0.App, Surface = p0.Surface, EncounterKey = p0.EncounterKey, SapUser = p0.SapUser, ForegroundMs = p0.ForegroundMs };
                    _tranquilaInicio = inicio;
                    _tranquilaFin = inicio + TamanoMs;
                    _tranquilaDia = cubeta.Dia;
                }
                _cubetas.Remove(inicio);
                continue;
            }

            // Pasó algo: el tramo tranquilo se cierra ANTES, para que las filas salgan en orden.
            SoltarTramo(filas);
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
        // Al cerrar (cambio de día, apagado, volcado de un colapso) no queda nada esperando.
        if (cerrarTramo) SoltarTramo(filas);
        return filas;
    }
}
