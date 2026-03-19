import type { FastifyPluginAsync } from "fastify";
import { runIntegrityChecks } from "../../validate/integrity.js";
import { listFictionalWorlds } from "../../graph/queries.js";
import { getConnection, runQuery } from "../../db/graph.js";

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // Health check (no auth required — handled by auth hook)
  app.get("/health", async () => ({ status: "ok" }));

  // List fictional worlds
  app.get("/worlds", async () => listFictionalWorlds());

  // Run integrity checks
  app.get("/integrity", async () => {
    const violations = await runIntegrityChecks();
    return {
      total_violations: violations.length,
      violations,
    };
  });

  // Export graph as JSON
  app.get("/export/json", async () => {
    const entitiesResult = await runQuery(
      `MATCH (e:Entity) WHERE e.deleted_at = ''
       RETURN e.id, e.label, e.type, e.epistemic_mode, e.fictional_world,
              e.canonical_id, e.aliases, e.created_at, e.notes`,
    );
    const entities = await entitiesResult.getAll();

    const assertionsResult = await runQuery(
      `MATCH (a:Entity)-[r:Assertion]->(b:Entity)
       WHERE r.deleted_at = ''
       RETURN r.id, r.predicate, r.epistemic_mode, r.confidence,
              r.fictional_world, r.source, r.evidence,
              r.created_at, r.updated_at,
              a.id AS subject_id, b.id AS object_id`,
    );
    const assertions = await assertionsResult.getAll();

    const sourcesResult = await runQuery(
      `MATCH (s:Source)
       RETURN s.id, s.label, s.source_type, s.reliability_tier,
              s.uri, s.doi, s.peer_reviewed, s.retracted, s.added_at`,
    );
    const sources = await sourcesResult.getAll();

    const citationsResult = await runQuery(
      `MATCH (e:Entity)-[c:CitedBy]->(s:Source)
       RETURN c.id, c.assertion_id, c.citation_type,
              c.page_or_section, c.quote, c.added_at,
              e.id AS entity_id, s.id AS source_id`,
    );
    const citations = await citationsResult.getAll();

    return {
      export_date: new Date().toISOString(),
      entities,
      assertions,
      sources,
      citations,
    };
  });

  // Export graph as GraphML
  app.get("/export/graphml", async (req, reply) => {
    const entitiesResult = await runQuery(
      `MATCH (e:Entity) WHERE e.deleted_at = ''
       RETURN e.id, e.label, e.type, e.epistemic_mode, e.fictional_world`,
    );
    const entities = await entitiesResult.getAll();

    const assertionsResult = await runQuery(
      `MATCH (a:Entity)-[r:Assertion]->(b:Entity)
       WHERE r.deleted_at = ''
       RETURN r.id, r.predicate, r.epistemic_mode, r.confidence,
              a.id AS subject_id, b.id AS object_id`,
    );
    const assertions = await assertionsResult.getAll();

    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphstruct.org/graphml">
  <key id="label" for="node" attr.name="label" attr.type="string"/>
  <key id="type" for="node" attr.name="type" attr.type="string"/>
  <key id="epistemic_mode" for="node" attr.name="epistemic_mode" attr.type="string"/>
  <key id="predicate" for="edge" attr.name="predicate" attr.type="string"/>
  <key id="confidence" for="edge" attr.name="confidence" attr.type="string"/>
  <graph id="cerebro" edgedefault="directed">
`;

    for (const e of entities) {
      const id = escapeXml(e["e.id"] as string);
      const label = escapeXml(e["e.label"] as string);
      const type = escapeXml(e["e.type"] as string);
      const mode = escapeXml(e["e.epistemic_mode"] as string);
      xml += `    <node id="${id}">
      <data key="label">${label}</data>
      <data key="type">${type}</data>
      <data key="epistemic_mode">${mode}</data>
    </node>\n`;
    }

    for (const a of assertions) {
      const id = escapeXml(a["r.id"] as string);
      const src = escapeXml(a["subject_id"] as string);
      const tgt = escapeXml(a["object_id"] as string);
      const pred = escapeXml(a["r.predicate"] as string);
      const conf = escapeXml((a["r.confidence"] as string) ?? "null");
      xml += `    <edge id="${id}" source="${src}" target="${tgt}">
      <data key="predicate">${pred}</data>
      <data key="confidence">${conf}</data>
    </edge>\n`;
    }

    xml += `  </graph>
</graphml>`;

    reply.type("application/xml").send(xml);
  });
};

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
