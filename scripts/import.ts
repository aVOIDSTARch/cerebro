import { readFileSync } from "fs";
import { createEntityAtomic } from "../src/graph/nodes.js";
import { createAssertion } from "../src/graph/edges.js";
import { CreateEntitySchema, CreateAssertionSchema } from "../src/types.js";

const args = process.argv.slice(2);
const fileIndex = args.indexOf("--file");
if (fileIndex === -1 || !args[fileIndex + 1]) {
  console.error("Usage: npm run import -- --file <path>");
  process.exit(1);
}

const filePath = args[fileIndex + 1];

async function importGraph() {
  const raw = readFileSync(filePath, "utf-8");
  const data = JSON.parse(raw);

  let entitiesCreated = 0;
  let entitiesSkipped = 0;
  let entitiesFailed = 0;

  console.log(`Importing from ${filePath}...`);

  // Import entities
  if (data.entities && Array.isArray(data.entities)) {
    console.log(`\nProcessing ${data.entities.length} entities...`);
    for (const entity of data.entities) {
      const input = {
        label: entity["e.label"] ?? entity.label,
        type: entity["e.type"] ?? entity.type,
        aliases: entity["e.aliases"] ?? entity.aliases ?? [],
        epistemic_mode: entity["e.epistemic_mode"] ?? entity.epistemic_mode,
        fictional_world: entity["e.fictional_world"] ?? entity.fictional_world ?? null,
        notes: entity["e.notes"] ?? entity.notes ?? null,
      };

      const parsed = CreateEntitySchema.safeParse(input);
      if (!parsed.success) {
        console.error(`  SKIP (validation): ${input.label} — ${parsed.error.message}`);
        entitiesSkipped++;
        continue;
      }

      try {
        await createEntityAtomic(parsed.data);
        entitiesCreated++;
      } catch (err) {
        console.error(`  FAIL: ${input.label} — ${err}`);
        entitiesFailed++;
      }
    }
  }

  let assertionsCreated = 0;
  let assertionsFailed = 0;

  // Import assertions
  if (data.assertions && Array.isArray(data.assertions)) {
    console.log(`\nProcessing ${data.assertions.length} assertions...`);
    for (const assertion of data.assertions) {
      const input = {
        subject_id: assertion["subject_id"] ?? assertion.subject_id,
        predicate: assertion["r.predicate"] ?? assertion.predicate,
        object_id: assertion["object_id"] ?? assertion.object_id,
        epistemic_mode: assertion["r.epistemic_mode"] ?? assertion.epistemic_mode,
        confidence: assertion["r.confidence"] ?? assertion.confidence ?? null,
        fictional_world: assertion["r.fictional_world"] ?? assertion.fictional_world ?? null,
        source: assertion["r.source"] ?? assertion.source,
        evidence: assertion["r.evidence"] ?? assertion.evidence ?? null,
      };

      const parsed = CreateAssertionSchema.safeParse(input);
      if (!parsed.success) {
        assertionsFailed++;
        continue;
      }

      try {
        await createAssertion(parsed.data);
        assertionsCreated++;
      } catch (err) {
        assertionsFailed++;
      }
    }
  }

  console.log(`\nImport complete:`);
  console.log(`  Entities:   ${entitiesCreated} created, ${entitiesSkipped} skipped, ${entitiesFailed} failed`);
  console.log(`  Assertions: ${assertionsCreated} created, ${assertionsFailed} failed`);
}

importGraph().catch(console.error);
