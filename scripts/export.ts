import { runQuery } from "../src/db/graph.js";

const args = process.argv.slice(2);
const format = args.includes("--format")
  ? args[args.indexOf("--format") + 1]
  : "json";
const worldFilter = args.includes("--world")
  ? args[args.indexOf("--world") + 1]
  : null;

async function exportGraph() {
  const worldClause = worldFilter
    ? `AND e.fictional_world = '${worldFilter}'`
    : "";

  const entitiesResult = await runQuery(`
    MATCH (e:Entity) WHERE e.deleted_at = '' ${worldClause}
    RETURN e.id, e.label, e.type, e.epistemic_mode, e.fictional_world,
           e.canonical_id, e.aliases, e.created_at, e.notes
  `);
  const entities = await entitiesResult.getAll();

  const assertionsResult = await runQuery(`
    MATCH (a:Entity)-[r:Assertion]->(b:Entity)
    WHERE r.deleted_at = ''
    RETURN r.id, r.predicate, r.epistemic_mode, r.confidence,
           r.fictional_world, r.source, r.evidence,
           r.created_at, r.updated_at,
           a.id AS subject_id, b.id AS object_id
  `);
  const assertions = await assertionsResult.getAll();

  const sourcesResult = await runQuery(`
    MATCH (s:Source) RETURN s.*
  `);
  const sources = await sourcesResult.getAll();

  const citationsResult = await runQuery(`
    MATCH (e:Entity)-[c:CitedBy]->(s:Source)
    RETURN c.id, c.assertion_id, c.citation_type,
           c.page_or_section, c.quote, c.added_at,
           e.id AS entity_id, s.id AS source_id
  `);
  const citations = await citationsResult.getAll();

  if (format === "json") {
    const data = {
      export_date: new Date().toISOString(),
      world_filter: worldFilter,
      entities,
      assertions,
      sources,
      citations,
    };
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.error(`Unsupported format: ${format}. Use --format json`);
    process.exit(1);
  }
}

exportGraph().catch(console.error);
