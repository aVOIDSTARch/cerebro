import { runQuery } from "../src/db/graph.js";
import { meili } from "../src/db/search.js";
import { getCollection } from "../src/db/vectors.js";

/**
 * Compares entity IDs across Kùzu, Meilisearch, and Chroma.
 * Reports orphans — entities that exist in one store but not all three.
 */
async function syncCheck() {
  console.log("Running sync integrity check...\n");

  // 1. Get all entity IDs from Kùzu
  const kuzuResult = await runQuery(
    "MATCH (e:Entity) WHERE e.deleted_at = '' RETURN e.id",
  );
  const kuzuRows = await kuzuResult.getAll();
  const kuzuIds = new Set(kuzuRows.map((r) => r["e.id"] as string));
  console.log(`Kùzu:        ${kuzuIds.size} entities`);

  // 2. Get all entity IDs from Meilisearch
  const meiliIds = new Set<string>();
  try {
    let offset = 0;
    const limit = 1000;
    while (true) {
      const docs = await meili.index("cerebro_entities").getDocuments({
        limit,
        offset,
        fields: ["id"],
      });
      for (const doc of docs.results) {
        meiliIds.add(doc.id as string);
      }
      if (docs.results.length < limit) break;
      offset += limit;
    }
    console.log(`Meilisearch: ${meiliIds.size} entities`);
  } catch {
    console.warn("Meilisearch not available — skipping");
  }

  // 3. Get all entity IDs from Chroma
  const chromaIds = new Set<string>();
  try {
    const collection = await getCollection();
    const result = await collection.get();
    for (const id of result.ids) {
      chromaIds.add(id);
    }
    console.log(`Chroma:      ${chromaIds.size} entities`);
  } catch {
    console.warn("Chroma not available — skipping");
  }

  // 4. Compare
  console.log("\n--- Orphan Report ---\n");
  let orphans = 0;

  for (const id of kuzuIds) {
    if (meiliIds.size > 0 && !meiliIds.has(id)) {
      console.log(`  ORPHAN [Kùzu only, missing from Meilisearch]: ${id}`);
      orphans++;
    }
    if (chromaIds.size > 0 && !chromaIds.has(id)) {
      console.log(`  ORPHAN [Kùzu only, missing from Chroma]:      ${id}`);
      orphans++;
    }
  }

  for (const id of meiliIds) {
    if (!kuzuIds.has(id)) {
      console.log(`  ORPHAN [Meilisearch only, missing from Kùzu]: ${id}`);
      orphans++;
    }
  }

  for (const id of chromaIds) {
    if (!kuzuIds.has(id)) {
      console.log(`  ORPHAN [Chroma only, missing from Kùzu]:      ${id}`);
      orphans++;
    }
  }

  if (orphans === 0) {
    console.log("  No orphans found. All stores are in sync.");
  } else {
    console.log(`\n  Total orphans: ${orphans}`);
  }
}

syncCheck().catch(console.error);
