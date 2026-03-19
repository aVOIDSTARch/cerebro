import { bootstrapSchema } from "../src/db/graph.js";
import { bootstrapSearchIndex } from "../src/db/search.js";
import { bootstrapQuarantineSchema } from "../src/quarantine/schema.js";
import { bootstrapPredicateRegistry, seedPredicates } from "../src/db/predicates.js";
import { bootstrapMigrations, runPendingMigrations } from "../src/db/migrations.js";

console.log("Bootstrapping Cerebro...\n");

// 1. Kùzu graph schema
await bootstrapSchema();

// 2. Meilisearch index
try {
  await bootstrapSearchIndex();
} catch (err) {
  console.warn("Meilisearch not available — skipping index setup:", err);
  console.warn("Start Meilisearch with: docker-compose up -d meilisearch\n");
}

// 3. Quarantine SQLite
bootstrapQuarantineSchema();

// 4. Migration system
bootstrapMigrations();
runPendingMigrations();

// 5. Predicate registry
bootstrapPredicateRegistry();
seedPredicates();

console.log("\nBootstrap complete.");
