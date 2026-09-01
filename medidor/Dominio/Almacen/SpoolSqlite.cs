using Microsoft.Data.Sqlite;

namespace Medidor;

public sealed record FilaDelSpool(long Seq, string Json);

public sealed record LimitesDeLote(int Muestras = 1000, int Eventos = 500, int Visitas = 300, int Turnos = 20);

public sealed record LoteTomado(
    IReadOnlyList<FilaDelSpool> Turnos,
    IReadOnlyList<FilaDelSpool> Muestras,
    IReadOnlyList<FilaDelSpool> Eventos,
    IReadOnlyList<FilaDelSpool> Visitas)
{
    public bool Vacio => Turnos.Count == 0 && Muestras.Count == 0 && Eventos.Count == 0 && Visitas.Count == 0;
}

/// <summary>
/// EL SPOOL DURABLE del medidor — y es lo contrario exacto del `TelemetryClient` de U.exe, a
/// propósito: aquel descarta al llenarse y no reencola en fallo, porque su telemetría es
/// diagnóstico y «jamás debe tumbar al agente». Esto es un ESTUDIO: perder datos en silencio es
/// contaminar el baseline. Aquí lo tomado sin confirmar se vuelve a entregar idéntico, la
/// confirmación borra de una vez, y el tope descarta lo más viejo CONTANDO cada descarte.
///
/// SQLite con WAL: sobrevive a un kill del proceso a mitad de turno (se juzga en el contrato
/// reabriendo la base). `seq` es AUTOINCREMENT: monotónico aunque se borre y aunque se reinicie —
/// es el uid con el que el servidor desecha duplicados.
/// </summary>
public sealed class SpoolSqlite : IDisposable
{
    private static readonly string[] Colecciones = { "turnos", "muestras", "eventos", "visitas" };

    private readonly SqliteConnection _db;
    private readonly long _topeBytes;
    private long _bytes;
    private int _descartes;
    private int _venenos;

    public SpoolSqlite(string ruta, long topeBytes = 200L * 1024 * 1024)
    {
        _topeBytes = topeBytes;
        _db = new SqliteConnection($"Data Source={ruta};Pooling=False");
        _db.Open();
        Ejecutar("PRAGMA journal_mode=WAL");
        Ejecutar("PRAGMA synchronous=NORMAL");
        Ejecutar("""
            CREATE TABLE IF NOT EXISTS filas(
              seq INTEGER PRIMARY KEY AUTOINCREMENT,
              coleccion TEXT NOT NULL,
              json TEXT NOT NULL,
              bytes INTEGER NOT NULL);
            """);
        Ejecutar("CREATE INDEX IF NOT EXISTS filas_por_coleccion ON filas(coleccion, seq)");
        Ejecutar("CREATE TABLE IF NOT EXISTS meta(clave TEXT PRIMARY KEY, valor INTEGER NOT NULL)");

        _bytes = Escalar("SELECT COALESCE(SUM(bytes),0) FROM filas");
        _descartes = (int)LeerMeta("descartes");
        _venenos = (int)LeerMeta("venenos");
    }

    public int DescartesAcumulados => _descartes;
    public int VenenosAcumulados => _venenos;
    public long BytesAproximados => _bytes;

    public long Encolar(string coleccion, string json)
    {
        ExigirColeccion(coleccion);
        var bytes = System.Text.Encoding.UTF8.GetByteCount(json);

        using var cmd = _db.CreateCommand();
        cmd.CommandText = "INSERT INTO filas(coleccion, json, bytes) VALUES(@c, @j, @b); SELECT last_insert_rowid();";
        cmd.Parameters.AddWithValue("@c", coleccion);
        cmd.Parameters.AddWithValue("@j", json);
        cmd.Parameters.AddWithValue("@b", bytes);
        var seq = (long)cmd.ExecuteScalar()!;
        _bytes += bytes;

        RecortarSiDesborda();
        return seq;
    }

    public LoteTomado Tomar(LimitesDeLote limites) => new(
        Leer("turnos", limites.Turnos),
        Leer("muestras", limites.Muestras),
        Leer("eventos", limites.Eventos),
        Leer("visitas", limites.Visitas));

    /// <summary>Borra lo que el servidor YA aceptó. Solo se llama tras un 200 con el lote entero
    /// contabilizado — nunca antes: el orden es actuar y verificar después (aprendizaje nº19).</summary>
    public void Confirmar(LoteTomado lote)
    {
        var seqs = lote.Turnos.Concat(lote.Muestras).Concat(lote.Eventos).Concat(lote.Visitas)
            .Select(f => f.Seq).ToList();
        if (seqs.Count == 0) return;
        BorrarPorSeq(seqs);
    }

    /// <summary>Saca UNA fila que el servidor rechazó como inválida. Sin esto, una fila envenenada
    /// encabezaría cada lote para siempre y la cola entera quedaría atascada detrás de ella.</summary>
    public void Envenenar(string coleccion, long seq)
    {
        ExigirColeccion(coleccion);
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "DELETE FROM filas WHERE coleccion=@c AND seq=@s";
        cmd.Parameters.AddWithValue("@c", coleccion);
        cmd.Parameters.AddWithValue("@s", seq);
        if (cmd.ExecuteNonQuery() > 0)
        {
            _venenos++;
            GuardarMeta("venenos", _venenos);
            _bytes = Escalar("SELECT COALESCE(SUM(bytes),0) FROM filas");
        }
    }

    public void Dispose() => _db.Dispose();

    // ── por dentro ───────────────────────────────────────────────────────────

    private void RecortarSiDesborda()
    {
        while (_bytes > _topeBytes)
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = """
                DELETE FROM filas WHERE seq = (SELECT MIN(seq) FROM filas)
                RETURNING bytes;
                """;
            var quitado = cmd.ExecuteScalar();
            if (quitado == null) break; // vacío: no hay nada más que recortar
            _bytes -= (long)quitado;
            _descartes++;
        }
        GuardarMeta("descartes", _descartes);
    }

    private List<FilaDelSpool> Leer(string coleccion, int limite)
    {
        var filas = new List<FilaDelSpool>();
        if (limite <= 0) return filas;
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "SELECT seq, json FROM filas WHERE coleccion=@c ORDER BY seq LIMIT @n";
        cmd.Parameters.AddWithValue("@c", coleccion);
        cmd.Parameters.AddWithValue("@n", limite);
        using var r = cmd.ExecuteReader();
        while (r.Read()) filas.Add(new FilaDelSpool(r.GetInt64(0), r.GetString(1)));
        return filas;
    }

    private void BorrarPorSeq(List<long> seqs)
    {
        // Los seq son enteros salidos de esta misma base; el IN se arma con números, no con texto.
        foreach (var trozo in seqs.Chunk(500))
        {
            using var cmd = _db.CreateCommand();
            cmd.CommandText = $"DELETE FROM filas WHERE seq IN ({string.Join(',', trozo)})";
            cmd.ExecuteNonQuery();
        }
        _bytes = Escalar("SELECT COALESCE(SUM(bytes),0) FROM filas");
    }

    private static void ExigirColeccion(string coleccion)
    {
        if (!Colecciones.Contains(coleccion))
            throw new ArgumentException($"colección desconocida: «{coleccion}» (válidas: {string.Join(", ", Colecciones)})");
    }

    private void Ejecutar(string sql)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }

    private long Escalar(string sql)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = sql;
        return (long)(cmd.ExecuteScalar() ?? 0L);
    }

    private long LeerMeta(string clave)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "SELECT valor FROM meta WHERE clave=@k";
        cmd.Parameters.AddWithValue("@k", clave);
        return (long)(cmd.ExecuteScalar() ?? 0L);
    }

    private void GuardarMeta(string clave, long valor)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = "INSERT INTO meta(clave, valor) VALUES(@k, @v) ON CONFLICT(clave) DO UPDATE SET valor=@v";
        cmd.Parameters.AddWithValue("@k", clave);
        cmd.Parameters.AddWithValue("@v", valor);
        cmd.ExecuteNonQuery();
    }
}
