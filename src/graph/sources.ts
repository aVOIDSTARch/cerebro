import { v7 as uuid } from "uuid";
import { getConnection, executeQuery } from "../db/graph.js";
import type { CerebroSource } from "../types.js";

export async function createSource(
  params: Omit<CerebroSource, "id" | "added_at">,
): Promise<CerebroSource> {
  const conn = getConnection();
  const source: CerebroSource = {
    id: `node:source:${uuid()}`,
    added_at: new Date().toISOString().slice(0, 10),
    ...params,
  };

  const stmt = await conn.prepare(
    `CREATE (:Source {
      id: $id, label: $label,
      source_type: $source_type,
      reliability_tier: $reliability_tier,
      uri: $uri, doi: $doi, isbn: $isbn,
      arxiv_id: $arxiv_id, local_path: $local_path,
      authors: $authors,
      publication_year: $publication_year,
      publisher: $publisher, journal: $journal,
      volume: $volume, issue: $issue,
      peer_reviewed: $peer_reviewed,
      retracted: $retracted,
      retraction_uri: $retraction_uri,
      retraction_date: $retraction_date,
      accessed_at: $accessed_at,
      added_at: $added_at,
      notes: $notes
    })`,
  );
  await executeQuery(stmt, {
    id: source.id,
    label: source.label,
    source_type: source.source_type,
    reliability_tier: source.reliability_tier,
    uri: source.uri ?? "",
    doi: source.doi ?? "",
    isbn: source.isbn ?? "",
    arxiv_id: source.arxiv_id ?? "",
    local_path: source.local_path ?? "",
    authors: source.authors,
    publication_year: source.publication_year ?? 0,
    publisher: source.publisher ?? "",
    journal: source.journal ?? "",
    volume: source.volume ?? "",
    issue: source.issue ?? "",
    peer_reviewed: source.peer_reviewed,
    retracted: source.retracted,
    retraction_uri: source.retraction_uri ?? "",
    retraction_date: source.retraction_date ?? "",
    accessed_at: source.accessed_at,
    added_at: source.added_at,
    notes: source.notes ?? "",
  });

  return source;
}

export async function getSourceById(
  id: string,
): Promise<Record<string, unknown> | null> {
  const conn = getConnection();
  const stmt = await conn.prepare(
    `MATCH (s:Source {id: $id})
     RETURN s.id, s.label, s.source_type, s.reliability_tier,
            s.uri, s.doi, s.isbn, s.arxiv_id, s.local_path,
            s.authors, s.publication_year, s.publisher, s.journal,
            s.volume, s.issue, s.peer_reviewed, s.retracted,
            s.retraction_uri, s.retraction_date,
            s.accessed_at, s.added_at, s.notes`,
  );
  const result = await executeQuery(stmt, { id });
  const rows = await result.getAll();
  if (!rows.length) return null;
  return rows[0];
}

export async function markRetracted(
  id: string,
  retractionUri: string | null,
  retractionDate: string | null,
): Promise<Record<string, unknown>[]> {
  const conn = getConnection();

  // Mark the source as retracted
  const updateStmt = await conn.prepare(
    `MATCH (s:Source {id: $id})
     SET s.retracted = true,
         s.retraction_uri = $retraction_uri,
         s.retraction_date = $retraction_date`,
  );
  await executeQuery(updateStmt, {
    id,
    retraction_uri: retractionUri ?? "",
    retraction_date: retractionDate ?? "",
  });

  // Find affected assertions via CitedBy relationships
  const cascadeStmt = await conn.prepare(
    `MATCH (e:Entity)-[c:CitedBy]->(s:Source {id: $id})
     RETURN c.assertion_id AS assertion_id`,
  );
  const cascadeResult = await executeQuery(cascadeStmt, { id });
  return cascadeResult.getAll();
}

export async function updateSource(
  id: string,
  updates: Record<string, string | boolean | null>,
): Promise<void> {
  const conn = getConnection();
  const setClauses: string[] = [];
  const params: Record<string, string | boolean> = { id };

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`s.${key} = $${key}`);
      params[key] = value ?? "";
    }
  }

  if (setClauses.length === 0) return;

  const stmt = await conn.prepare(
    `MATCH (s:Source {id: $id}) SET ${setClauses.join(", ")}`,
  );
  await executeQuery(stmt, params);
}
