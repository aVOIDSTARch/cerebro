import { v7 as uuid } from "uuid";
import { getConnection, executeQuery } from "../db/graph.js";
import { normalizePredicate } from "../db/predicates.js";
import type { CerebroAssertion } from "../types.js";

export async function createAssertion(
  params: Omit<CerebroAssertion, "id" | "created_at" | "updated_at" | "deleted_at">,
): Promise<CerebroAssertion> {
  const conn = getConnection();
  const now = new Date().toISOString().slice(0, 10);

  // Enforce invariants
  if (params.source === "inferred" && params.confidence !== "speculative") {
    throw new Error(
      `Inferred edges must have confidence 'speculative'. ` +
        `Received: '${params.confidence}'. Use promote() to advance.`,
    );
  }

  if (params.epistemic_mode === "fictional" && params.confidence !== null) {
    throw new Error(
      `Fictional edges must have confidence null. ` +
        `Received: '${params.confidence}'.`,
    );
  }

  // Normalize predicate
  const normalizedPredicate = normalizePredicate(params.predicate);

  const assertion: CerebroAssertion = {
    id: `edge:${uuid()}`,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...params,
    predicate: normalizedPredicate,
  };

  const stmt = await conn.prepare(
    `MATCH (a:Entity {id: $subject_id}), (b:Entity {id: $object_id})
     CREATE (a)-[:Assertion {
       id: $id,
       predicate: $predicate,
       epistemic_mode: $epistemic_mode,
       confidence: $confidence,
       fictional_world: $fictional_world,
       source: $source,
       evidence: $evidence,
       created_at: $created_at,
       updated_at: $updated_at,
       deleted_at: $deleted_at
     }]->(b)`,
  );
  await executeQuery(stmt, {
    subject_id: assertion.subject_id,
    object_id: assertion.object_id,
    id: assertion.id,
    predicate: assertion.predicate,
    epistemic_mode: assertion.epistemic_mode,
    confidence: assertion.confidence ?? "",
    fictional_world: assertion.fictional_world ?? "",
    source: assertion.source,
    evidence: assertion.evidence ?? "",
    created_at: assertion.created_at,
    updated_at: assertion.updated_at,
    deleted_at: assertion.deleted_at ?? "",
  });

  return assertion;
}

export async function getAssertionsBySubject(
  subjectId: string,
): Promise<Record<string, unknown>[]> {
  const conn = getConnection();
  const stmt = await conn.prepare(
    `MATCH (a:Entity {id: $id})-[r:Assertion]->(b:Entity)
     WHERE r.deleted_at = ''
     RETURN r.id, r.predicate, r.epistemic_mode, r.confidence,
            r.fictional_world, r.source, r.evidence,
            r.created_at, r.updated_at,
            b.id AS object_id, b.label AS object_label`,
  );
  const result = await executeQuery(stmt, { id: subjectId });
  return result.getAll();
}

export async function getAssertionById(
  id: string,
): Promise<Record<string, unknown> | null> {
  const conn = getConnection();
  const stmt = await conn.prepare(
    `MATCH (a:Entity)-[r:Assertion {id: $id}]->(b:Entity)
     WHERE r.deleted_at = ''
     RETURN r.id, r.predicate, r.epistemic_mode, r.confidence,
            r.fictional_world, r.source, r.evidence,
            r.created_at, r.updated_at,
            a.id AS subject_id, a.label AS subject_label,
            b.id AS object_id, b.label AS object_label`,
  );
  const result = await executeQuery(stmt, { id });
  const rows = await result.getAll();
  if (!rows.length) return null;
  return rows[0];
}

export async function softDeleteAssertion(id: string): Promise<void> {
  const conn = getConnection();
  const now = new Date().toISOString();
  const stmt = await conn.prepare(
    `MATCH ()-[r:Assertion {id: $id}]->() SET r.deleted_at = $deleted_at`,
  );
  await executeQuery(stmt, { id, deleted_at: now });
}
