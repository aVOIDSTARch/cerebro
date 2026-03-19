import Database from "better-sqlite3";

let _qdb: Database.Database | null = null;
let _qdbPath: string | null = null;

export function getQuarantineDb(): Database.Database {
  const dbPath = process.env.QUARANTINE_DB ?? "./quarantine.db";
  if (!_qdb || _qdbPath !== dbPath) {
    if (_qdb) _qdb.close();
    _qdbPath = dbPath;
    _qdb = new Database(dbPath);
    _qdb.pragma("journal_mode = WAL");
    _qdb.pragma("foreign_keys = ON");
  }
  return _qdb;
}

export function closeQuarantineDb(): void {
  if (_qdb) {
    _qdb.close();
    _qdb = null;
  }
}

export function bootstrapQuarantineSchema(): void {
  const db = getQuarantineDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS extraction_candidates (
      id                      TEXT PRIMARY KEY,
      subject_label           TEXT NOT NULL,
      subject_node_id         TEXT,
      predicate               TEXT NOT NULL,
      object_label            TEXT NOT NULL,
      object_node_id          TEXT,
      raw_sentence            TEXT NOT NULL,
      source_paper_uri        TEXT NOT NULL,
      source_section          TEXT,
      page_number             INTEGER,
      hedge_flag              INTEGER NOT NULL DEFAULT 0,
      hedge_text              TEXT,
      scope_qualifier         TEXT,
      negation_flag           INTEGER NOT NULL DEFAULT 0,
      suggested_confidence    TEXT NOT NULL,
      extractor_model         TEXT NOT NULL,
      extraction_method       TEXT NOT NULL DEFAULT 'llm',
      status                  TEXT NOT NULL DEFAULT 'pending',
      final_confidence        TEXT,
      final_subject_label     TEXT,
      final_predicate         TEXT,
      final_object_label      TEXT,
      epistemic_mode          TEXT NOT NULL DEFAULT 'empirical',
      fictional_world         TEXT,
      reviewer_notes          TEXT,
      source_reliability_tier TEXT,
      citation_type           TEXT NOT NULL DEFAULT 'direct',
      source_peer_reviewed    INTEGER,
      source_retracted        INTEGER NOT NULL DEFAULT 0,
      extracted_at            TEXT NOT NULL,
      reviewed_at             TEXT,
      promoted_edge_id        TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_status ON extraction_candidates(status);
    CREATE INDEX IF NOT EXISTS idx_source ON extraction_candidates(source_paper_uri);
    CREATE INDEX IF NOT EXISTS idx_hedge  ON extraction_candidates(hedge_flag);
  `);

  console.log("Quarantine SQLite schema bootstrapped.");
}
