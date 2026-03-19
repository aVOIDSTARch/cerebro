import kuzu from "kuzu";

let _db: kuzu.Database | null = null;
let _conn: kuzu.Connection | null = null;
let _dbPath: string | null = null;

export function getDatabase(): kuzu.Database {
  const dbPath = process.env.KUZU_PATH ?? "./cerebro.db";
  if (!_db || _dbPath !== dbPath) {
    _conn = null;
    _dbPath = dbPath;
    _db = new kuzu.Database(dbPath);
  }
  return _db;
}

export function getConnection(): kuzu.Connection {
  if (!_conn) {
    _conn = new kuzu.Connection(getDatabase());
  }
  return _conn;
}

export async function closeDatabase(): Promise<void> {
  _conn = null;
  _db = null;
}

/**
 * Execute a prepared statement and return a single QueryResult.
 * Kùzu's execute() can return QueryResult | QueryResult[]; this unwraps it.
 */
export async function executeQuery(
  stmt: kuzu.PreparedStatement,
  params?: Record<string, kuzu.KuzuValue>,
): Promise<kuzu.QueryResult> {
  const conn = getConnection();
  const result = await conn.execute(stmt, params);
  if (Array.isArray(result)) return result[0];
  return result;
}

/**
 * Run a raw Cypher string and return a single QueryResult.
 */
export async function runQuery(cypher: string): Promise<kuzu.QueryResult> {
  const conn = getConnection();
  const result = await conn.query(cypher);
  if (Array.isArray(result)) return result[0];
  return result;
}

export async function bootstrapSchema(): Promise<void> {
  await runQuery(`
    CREATE NODE TABLE IF NOT EXISTS Entity(
      id              STRING PRIMARY KEY,
      label           STRING,
      type            STRING,
      epistemic_mode  STRING,
      fictional_world STRING,
      canonical_id    STRING,
      aliases         STRING[],
      created_at      STRING,
      deleted_at      STRING,
      notes           STRING
    )
  `);

  await runQuery(`
    CREATE NODE TABLE IF NOT EXISTS Source(
      id               STRING PRIMARY KEY,
      label            STRING,
      source_type      STRING,
      reliability_tier STRING,
      uri              STRING,
      doi              STRING,
      isbn             STRING,
      arxiv_id         STRING,
      local_path       STRING,
      authors          STRING[],
      publication_year INT64,
      publisher        STRING,
      journal          STRING,
      volume           STRING,
      issue            STRING,
      peer_reviewed    BOOLEAN,
      retracted        BOOLEAN DEFAULT false,
      retraction_uri   STRING,
      retraction_date  STRING,
      accessed_at      STRING,
      added_at         STRING,
      notes            STRING
    )
  `);

  await runQuery(`
    CREATE REL TABLE IF NOT EXISTS Assertion(
      FROM Entity TO Entity,
      id              STRING,
      predicate       STRING,
      epistemic_mode  STRING,
      confidence      STRING,
      fictional_world STRING,
      source          STRING,
      evidence        STRING,
      created_at      STRING,
      updated_at      STRING,
      deleted_at      STRING
    )
  `);

  await runQuery(`
    CREATE REL TABLE IF NOT EXISTS CitedBy(
      FROM Entity TO Source,
      id              STRING,
      assertion_id    STRING,
      citation_type   STRING,
      page_or_section STRING,
      quote           STRING,
      added_at        STRING
    )
  `);

  console.log("Kùzu schema bootstrapped.");
}
