using Microsoft.Data.Sqlite;

namespace Medidor;

public sealed record FilaDelSpool(long Seq, string Json);

public sealed record LimitesDeLote(int Muestras = 1000, int Eventos = 500, int Visitas = 300, int Jornadas = 20);

public sealed record LoteTomado(
    IReadOnlyList<FilaDelSpool> Jornadas,
    IReadOnlyList<FilaDelSpool> Muestras,
    IReadOnlyList<FilaDelSpool> Eventos,
    IReadOnlyList<FilaDelSpool> Visitas)
{
    public bool Vacio => Jornadas.Count == 0 && Muestras.Count == 0 && Eventos.Count == 0 && Visitas.Count == 0;

    public static readonly LoteTomado Nada = new(
        Array.Empty<FilaDelSpool>(), Array.Empty<FilaDelSpool>(), Array.Empty<FilaDelSpool>(), Array.Empty<FilaDelSpool>());
}

/// <summary>
/// EL SPOOL DURABLE del medidor — y es lo contrario exacto del `TelemetryClient` de U.exe, a
/// propósito: aquel descarta al llenarse y no reencola en fallo, porque su telemetría es
/// diagnóstico y «jamás debe tumbar al agente». Esto es un ESTUDIO: perder datos en silencio es
/// contaminar el baseline. Aquí lo tomado sin confirmar se vuelve a entregar idéntico, la
/// confirmación borra de una vez, y el tope descarta lo más viejo CONTANDO cada descarte.
///
/// SQLite con WAL: sobrevive a un kill del proceso a mitad de jornada (se juzga en el contrato
/// reabriendo la base). `seq` es AUTOINCREMENT: monotónico aunque se borre y aunque se reinicie —
/// es el uid con el que el servidor desecha duplicados.
///
/// UN ARCHIVO CORRUPTO NO TUMBA EL ARRANQUE (promesa 27): se aparta con fecha
/// (`spool.corrupto-AAAAMMDD-HHmmss.db`) y se recrea vacío; <see cref="ArchivoCorrupto"/> lo cuenta
/// para que la App emita `spool_reset`. Era la excepción que dejaba el medidor apagado con un
/// MessageBox que nadie veía.
///
/// FORMATO 2: las filas del formato 1 llevaban `shift_id` y el servidor v2 no las entiende; al
/// abrir una base vieja se purgan de una vez, contando (<see cref="FilasV1Purgadas"/>, promesa 29).
/// </summary>
public sealed class SpoolSqlite : IDisposable
{
    public const int Formato = 2;

    private static readonly string[] Colecciones = { "jornadas", "muestras", "eventos", "visitas" };

    private readonly string _ruta;
    private readonly long _topeBytes;
    private SqliteConnection _db = null!;
    private long _bytes;
    private int _descartes;
    private int _venenos;

    /// <summary>Ruta del archivo apartado por corrupto al abrir (o al reabrir), o null si estaba sano.</summary>
    public string? ArchivoCorrupto { get; private set; }

    /// <summary>Filas del formato 1 borradas al subir de formato en ESTA apertura (0 si ya era v2).</summary>
    public int FilasV1Purgadas { get; private set; }

    public SpoolSqlite(string ruta, long topeBytes = 200L * 1024 * 1024)
    {
        _ruta = ruta;
        _topeBytes = topeBytes;
        try { Abrir(); }
        catch (SqliteException e) when (EsCorrupcion(e))
        {
            ArchivoCorrupto = Apartar();
            Abrir();
        }
    }

    /// <summary>SQLITE_IOERR (10), SQLITE_CORRUPT (11) y SQLITE_NOTADB (26): el archivo, no el uso.</summary>
    public static bool EsCorrupcion(Exception e) => e is SqliteException s && s.SqliteErrorCode is 10 or 11 or 26;

    /// <summary>En marcha, tras una excepción de corrupción: cierra, aparta el archivo y abre uno
    /// nuevo. Devuelve la ruta del apartado. Lo que estaba en la base se pierde — ya estaba perdido.</summary>
    public string Reabrir()
    {
        try { _db?.Dispose(); } catch { /* una base rota puede no cerrar limpio */ }
        var movido = Apartar();
        Abrir();
        ArchivoCorrupto = movido;
        return movido;
    }

    public int DescartesAcumulados => _descartes;
    public int VenenosAcumulados => _venenos;
    public long BytesAproximados => _bytes;
    public long Filas => Escalar("SELECT COUNT(*) FROM filas");
    public long FormatoEnDisco => LeerMeta("formato");

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
        Leer("jornadas", limites.Jornadas),
        Leer("muestras", limites.Muestras),
        Leer("eventos", limites.Eventos),
        Leer("visitas", limites.Visitas));

    /// <summary>Borra lo que el servidor YA aceptó. Solo se llama tras un 200 con el lote entero
    /// contabilizado — nunca antes: el orden es actuar y verificar después (aprendizaje nº19).
    /// Un seq que ya no existe (compactado entre tanto) es un no-op.</summary>
    public void Confirmar(LoteTomado lote)
    {
        var seqs = lote.Jornadas.Concat(lote.Muestras).Concat(lote.Eventos).Concat(lote.Visitas)
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

    /// <summary>De las fotos pendientes de una jornada del MISMO proceso y día, conserva solo la de
    /// mayor seq (la más nueva): las anteriores ya no dicen nada que la última no diga, y sin esto
    /// diez minutos sin red serían dos filas de jornada por minuto de espera. Las de otro proceso
    /// o de otro día no se tocan (promesa 28). Devuelve cuántas borró.</summary>
    public int Compactar(string coleccion, DateOnly dia, Guid procesoId)
    {
        ExigirColeccion(coleccion);
        using var cmd = _db.CreateCommand();
        cmd.CommandText = """
            DELETE FROM filas
             WHERE coleccion=@c
               AND json_extract(json, '$.dia_operativo')=@d
               AND json_extract(json, '$.proceso_id')=@p
               AND seq < (SELECT MAX(seq) FROM filas
                           WHERE coleccion=@c
                             AND json_extract(json, '$.dia_operativo')=@d
                             AND json_extract(json, '$.proceso_id')=@p)
            """;
        cmd.Parameters.AddWithValue("@c", coleccion);
        cmd.Parameters.AddWithValue("@d", dia.ToString("yyyy-MM-dd"));
        cmd.Parameters.AddWithValue("@p", procesoId.ToString());
        var borradas = cmd.ExecuteNonQuery();
        if (borradas > 0) _bytes = Escalar("SELECT COALESCE(SUM(bytes),0) FROM filas");
        return borradas;
    }

    public void Dispose() => _db?.Dispose();

    // ── por dentro ───────────────────────────────────────────────────────────

    private void Abrir()
    {
        var db = new SqliteConnection($"Data Source={_ruta};Pooling=False");
        try
        {
            db.Open();
            _db = db;
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

            // Formato: una base del formato 1 (o sin marca) trae filas con shift_id que el servidor
            // v2 rechazaría una a una. Se purgan ahora, contando, y la marca impide repetirlo.
            if (LeerMeta("formato") < Formato)
            {
                FilasV1Purgadas = Ejecutar("DELETE FROM filas");
                GuardarMeta("formato", Formato);
            }

            _bytes = Escalar("SELECT COALESCE(SUM(bytes),0) FROM filas");
            _descartes = (int)LeerMeta("descartes");
            _venenos = (int)LeerMeta("venenos");
        }
        catch
        {
            db.Dispose(); // que el archivo quede libre para apartarlo
            _db = null!;
            throw;
        }
    }

    private string Apartar()
    {
        var carpeta = Path.GetDirectoryName(_ruta) ?? "";
        var nombre = Path.GetFileNameWithoutExtension(_ruta);
        var sello = DateTime.Now.ToString("yyyyMMdd-HHmmss");
        var destino = Path.Combine(carpeta, $"{nombre}.corrupto-{sello}.db");
        for (int n = 2; File.Exists(destino); n++) destino = Path.Combine(carpeta, $"{nombre}.corrupto-{sello}-{n}.db");

        Mover(_ruta, destino);
        Mover(_ruta + "-wal", destino + "-wal");
        Mover(_ruta + "-shm", destino + "-shm");
        return destino;
    }

    private static void Mover(string de, string a)
    {
        try { if (File.Exists(de)) File.Move(de, a, overwrite: true); }
        catch
        {
            // Si no se deja mover (bloqueado), que al menos no vuelva a abrirse como si fuera bueno.
            try { File.Delete(de); } catch { /* si tampoco, Abrir volverá a fallar y se dirá */ }
        }
    }

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

    private int Ejecutar(string sql)
    {
        using var cmd = _db.CreateCommand();
        cmd.CommandText = sql;
        return cmd.ExecuteNonQuery();
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
