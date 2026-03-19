import { v7 as uuid } from "uuid";
import { getConnection, executeQuery } from "../db/graph.js";
import type { CerebroCitation } from "../types.js";

export async function createCitation(
  params: Omit<CerebroCitation, "id" | "added_at">,
): Promise<CerebroCitation> {
  const conn = getConnection();
  const citation: CerebroCitation = {
    id: `citation:${uuid()}`,
    added_at: new Date().toISOString().slice(0, 10),
    ...params,
  };

  // CitedBy connects an Entity (the subject of the assertion) to the Source.
  // We need to find the subject entity of the assertion to create the relationship.
  const findSubjectStmt = await conn.prepare(
    `MATCH (a:Entity)-[r:Assertion {id: $assertion_id}]->(b:Entity)
     RETURN a.id AS subject_id`,
  );
  const findResult = await executeQuery(findSubjectStmt, {
    assertion_id: params.assertion_id,
  });
  const subjectRows = await findResult.getAll();

  if (!subjectRows.length) {
    throw new Error(`Assertion ${params.assertion_id} not found`);
  }

  const subjectId = subjectRows[0]["subject_id"] as string;

  const stmt = await conn.prepare(
    `MATCH (e:Entity {id: $subject_id}), (s:Source {id: $source_id})
     CREATE (e)-[:CitedBy {
       id: $id,
       assertion_id: $assertion_id,
       citation_type: $citation_type,
       page_or_section: $page_or_section,
       quote: $quote,
       added_at: $added_at
     }]->(s)`,
  );
  await executeQuery(stmt, {
    subject_id: subjectId,
    source_id: citation.source_id,
    id: citation.id,
    assertion_id: citation.assertion_id,
    citation_type: citation.citation_type,
    page_or_section: citation.page_or_section ?? "",
    quote: citation.quote ?? "",
    added_at: citation.added_at,
  });

  return citation;
}

export async function getCitationsByAssertion(
  assertionId: string,
): Promise<Record<string, unknown>[]> {
  const conn = getConnection();
  const stmt = await conn.prepare(
    `MATCH (e:Entity)-[c:CitedBy]->(s:Source)
     WHERE c.assertion_id = $assertion_id
     RETURN c.id, c.assertion_id, c.citation_type,
            c.page_or_section, c.quote, c.added_at,
            s.id AS source_id, s.label AS source_label,
            s.retracted AS source_retracted`,
  );
  const result = await executeQuery(stmt, { assertion_id: assertionId });
  return result.getAll();
}

export async function getCitationsBySource(
  sourceId: string,
): Promise<Record<string, unknown>[]> {
  const conn = getConnection();
  const stmt = await conn.prepare(
    `MATCH (e:Entity)-[c:CitedBy]->(s:Source {id: $source_id})
     RETURN c.id, c.assertion_id, c.citation_type,
            c.page_or_section, c.quote, c.added_at,
            e.id AS entity_id, e.label AS entity_label`,
  );
  const result = await executeQuery(stmt, { source_id: sourceId });
  return result.getAll();
}
