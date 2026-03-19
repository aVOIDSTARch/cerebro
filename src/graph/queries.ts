import { getConnection, executeQuery, runQuery } from "../db/graph.js";

/** Nodes touched by both empirical and fictional edges */
export async function findJunctionNodes(): Promise<Record<string, unknown>[]> {
  const result = await runQuery(`
    MATCH (a:Entity)-[r:Assertion]->(b:Entity)
    WHERE r.deleted_at = ''
    WITH a, collect(DISTINCT r.epistemic_mode) AS modes
    WHERE 'empirical' IN modes AND 'fictional' IN modes
    RETURN a.label AS label, a.id AS id, modes
  `);
  return result.getAll();
}

/** All paths from startId to endId within N hops */
export async function shortestPaths(
  startId: string,
  endId: string,
  maxHops = 4,
): Promise<Record<string, unknown>[]> {
  const conn = getConnection();
  const stmt = await conn.prepare(
    `MATCH p = (a:Entity {id: $startId})-[:Assertion*1..${maxHops}]->(b:Entity {id: $endId})
     RETURN p`,
  );
  const result = await executeQuery(stmt, { startId, endId });
  return result.getAll();
}

/** Established claims with fewer than 2 live (non-retracted) sources */
export async function findUndercitedEstablished(): Promise<
  Record<string, unknown>[]
> {
  const result = await runQuery(`
    MATCH (a:Entity)-[r:Assertion]->(b:Entity)
    WHERE r.confidence = 'established' AND r.deleted_at = ''
    WITH r.id AS edge_id, r.predicate AS predicate,
         a.label AS subject_label, b.label AS object_label,
         count {
           MATCH (e:Entity)-[c:CitedBy {assertion_id: r.id}]->(s:Source)
           WHERE s.retracted = false
         } AS live_sources
    WHERE live_sources < 2
    RETURN edge_id, predicate, subject_label, object_label, live_sources
    ORDER BY live_sources ASC
  `);
  return result.getAll();
}

/** Edges whose only supporting sources are retracted */
export async function findOrphanedAfterRetraction(): Promise<
  Record<string, unknown>[]
> {
  const result = await runQuery(`
    MATCH (a:Entity)-[r:Assertion]->(b:Entity)
    WHERE r.confidence IN ['established', 'probable'] AND r.deleted_at = ''
    WITH r, a, b, count {
      MATCH (e:Entity)-[c:CitedBy {assertion_id: r.id}]->(s:Source)
      WHERE s.retracted = false
    } AS live_sources
    WHERE live_sources = 0
    RETURN r.id AS edge_id, r.predicate, r.confidence,
           a.label AS subject_label, b.label AS object_label
  `);
  return result.getAll();
}

/** List all distinct fictional worlds with entity counts */
export async function listFictionalWorlds(): Promise<
  Record<string, unknown>[]
> {
  const result = await runQuery(`
    MATCH (e:Entity)
    WHERE e.fictional_world <> '' AND e.deleted_at = ''
    RETURN e.fictional_world AS world, count(e) AS entity_count
    ORDER BY entity_count DESC
  `);
  return result.getAll();
}
