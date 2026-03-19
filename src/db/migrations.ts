import { getQuarantineDb } from "../quarantine/schema.js";

interface Migration {
  version: number;
  name: string;
  up: () => void;
}

const migrations: Migration[] = [];

export function registerMigration(migration: Migration): void {
  migrations.push(migration);
  migrations.sort((a, b) => a.version - b.version);
}

export function bootstrapMigrations(): void {
  const db = getQuarantineDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_versions (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  TEXT NOT NULL
    )
  `);
}

export function runPendingMigrations(): void {
  const db = getQuarantineDb();
  bootstrapMigrations();

  const applied = db
    .prepare("SELECT version FROM schema_versions ORDER BY version")
    .all() as { version: number }[];
  const appliedSet = new Set(applied.map((r) => r.version));

  for (const migration of migrations) {
    if (appliedSet.has(migration.version)) continue;

    console.log(`Applying migration ${migration.version}: ${migration.name}`);
    migration.up();

    db.prepare(
      "INSERT INTO schema_versions (version, name, applied_at) VALUES (?, ?, ?)",
    ).run(migration.version, migration.name, new Date().toISOString());
  }
}

export function getCurrentVersion(): number {
  const db = getQuarantineDb();
  const row = db
    .prepare("SELECT MAX(version) as v FROM schema_versions")
    .get() as { v: number | null } | undefined;
  return row?.v ?? 0;
}
