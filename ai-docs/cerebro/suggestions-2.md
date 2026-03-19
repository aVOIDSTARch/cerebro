# Cerebro — Design Questions & Recommended Answers

> Open questions surfaced during design review, with opinionated recommendations
> for the best version of this system.

---

## 1. Authentication & Authorization

**Question:** The API routes are defined but there is no mention of authentication. Should the Fastify server enforce auth, and if so, what mechanism?

**Recommendation:** Use a static bearer token for the API, loaded from the `.env` file (`CEREBRO_API_TOKEN`). Cerebro is a single-user homelab system — full OAuth/session management is over-engineered. A bearer token gives you:

- Protection against accidental exposure if the port is forwarded or the tailnet is misconfigured
- Zero external dependencies (no auth provider, no database sessions)
- Easy rotation by editing `.env` and restarting the service

Implementation: a Fastify `onRequest` hook that checks `Authorization: Bearer <token>` on all routes except `GET /health`. Reject with 401 if missing or wrong. This is ~15 lines of code and eliminates an entire class of "oops I left the port open" scenarios.

If Cerebro later grows a multi-user dimension, upgrade to Fastify JWT with a local SQLite user table — but do not build that now.

---

## 2. Multi-Store Write Failure & Rollback

**Question:** `createEntity()` writes to Kùzu, Meilisearch, and Chroma sequentially. If the second or third write fails, the entity exists in some stores but not others. What is the rollback strategy?

**Recommendation:** Implement a compensating-delete pattern, not distributed transactions. The write order should be:

1. **Kùzu first** — this is the source of truth. If Kùzu fails, abort immediately; nothing else was touched.
2. **Meilisearch second** — if this fails, delete the Kùzu node and throw.
3. **Chroma third** — if this fails, delete from Kùzu and Meilisearch, then throw.

Wrap this in a `createEntityAtomic()` function that catches at each step and rolls back prior writes. This is simpler and more reliable than a saga or two-phase commit at homelab scale.

Additionally, add a periodic **sync integrity check** — a script that compares IDs across all three stores and reports orphans. Run it via cron weekly. This catches any edge cases where compensating deletes themselves fail (power loss, process kill).

```typescript
async function createEntityAtomic(
  params: Omit<CerebroEntity, "id" | "created_at">
): Promise<CerebroEntity> {
  const entity = buildEntity(params);

  // Step 1: Kùzu (source of truth)
  await kuzuInsert(entity);

  // Step 2: Meilisearch
  try {
    await indexEntity(entity);
  } catch (err) {
    await kuzuDelete(entity.id);
    throw new Error(`Meilisearch sync failed, rolled back Kùzu: ${err}`);
  }

  // Step 3: Chroma
  try {
    await indexEntityVector(entity);
  } catch (err) {
    await kuzuDelete(entity.id);
    await meiliDelete(entity.id);
    throw new Error(`Chroma sync failed, rolled back Kùzu + Meili: ${err}`);
  }

  return entity;
}
```

---

## 3. Embedding Model Choice

**Question:** The implementation plan references `@xenova/transformers` with `Xenova/all-MiniLM-L6-v2` for Chroma embeddings. Is this the right model, and should the choice be configurable?

**Recommendation:** `all-MiniLM-L6-v2` is the correct starting point. It is:

- Small (~80MB), fast on CPU, no GPU required
- Well-tested for semantic similarity tasks
- Produces 384-dimensional embeddings — compact and efficient for Chroma's HNSW index

However, make the model name configurable via `.env` (`EMBEDDING_MODEL=Xenova/all-MiniLM-L6-v2`). Cerebro deals with scientific and historical content — if the graph grows large enough that retrieval quality matters, you may want to swap to a domain-specific model (e.g., `allenai/specter2` for scientific literature, or `nomic-ai/nomic-embed-text-v1.5` for general-purpose with longer context).

Do NOT embed assertions/edges yet. Start with entity nodes only. Edge embeddings (embedding the evidence text of assertions) are a natural second step but add complexity — the embedding text for an edge is ambiguous (predicate? evidence? both?) and should be designed deliberately, not bolted on.

---

## 4. Node & Edge ID Generation

**Question:** The design uses `node:<uuid>` and `edge:<uuid>` but does not specify which UUID version. Should IDs be random UUIDs, or deterministic?

**Recommendation:** Use **UUIDv7** (time-sortable) instead of UUIDv4 (random). UUIDv7 gives you:

- Chronological ordering for free — `SELECT * FROM entities ORDER BY id` returns creation order
- Better index locality in Kùzu's columnar storage (sequentially inserted IDs cluster together)
- No functional difference in uniqueness guarantees

The `uuid` npm package supports v7 as of v9+. Replace `v4 as uuid` with `v7 as uuid` everywhere.

Keep the `node:` / `edge:` / `candidate:` / `citation:` / `node:source:` prefixes — they make IDs self-describing in logs and debug output. This is worth the few extra bytes.

---

## 5. Schema Migration Strategy

**Question:** If the Kùzu or SQLite schemas evolve after the database contains data, how are migrations handled?

**Recommendation:** Use a versioned migration system with a dedicated `schema_version` table in SQLite and a migration runner script.

Structure:

```
/srv/cerebro/
└── migrations/
    ├── 001_initial_schema.ts
    ├── 002_add_arxiv_to_sources.ts
    └── 003_add_volume_issue_to_sources.ts
```

Each migration exports an `up()` function. The runner checks the current version and applies outstanding migrations in order.

For **SQLite** (quarantine store): standard `ALTER TABLE` migrations work well.

For **Kùzu**: the situation is trickier. Kùzu supports `ALTER TABLE` for adding columns but not for renaming or removing them. For destructive schema changes, the migration would need to:
1. Export affected data to JSON
2. Drop and recreate the table
3. Re-import

This is acceptable at personal scale. At larger scale, consider maintaining a schema version in a Kùzu node (`Meta` table with a single row).

Run migrations automatically at startup in `bootstrap.ts` — check version, apply pending, update version. Never require manual migration steps.

---

## 6. Entity Resolution & Deduplication

**Question:** `findOrCreateEntity()` matches on exact label. What happens when "Marie Curie", "M. Curie", and "Madame Curie" are all ingested?

**Recommendation:** Implement a two-tier entity resolution strategy:

**Tier 1 — Write-time alias check (automatic):**
Before creating a new entity, query Meilisearch with the candidate label. If a result scores above a configurable threshold (e.g., 0.85 match score) AND the top result's `aliases` array contains the candidate label (case-insensitive), resolve to the existing entity. This catches the easy cases at write time with no human involvement.

**Tier 2 — Periodic deduplication pass (human-gated):**
A CLI command (`npm run dedup`) that:
1. Runs all entity labels through Meilisearch pairwise similarity
2. Clusters entities with high label similarity AND shared edge neighbors
3. Presents merge candidates to the user for approval
4. On approval, merges the duplicate into the canonical entity: reassigns all edges, unions alias lists, deletes the duplicate from all three stores

Do NOT auto-merge. The junction node concept means that two entities with similar labels but different epistemic modes (e.g., the historical Vienna vs. a fictional Vienna) are intentionally distinct. Human confirmation is required.

Add a `canonical_id` field to entities — when an entity is merged into another, set `canonical_id` to the surviving entity's ID. This creates an audit trail and lets you redirect stale references.

---

## 7. Deletion & Soft Delete Policy

**Question:** None of the CRUD operations include delete. Can entities or assertions be deleted, and what happens to dependent data?

**Recommendation:** Implement **soft delete** for entities and assertions, **hard delete** only for quarantine candidates.

Entities:
- Add `deleted_at: string | null` to the Entity schema
- Soft-deleted entities are excluded from all search results and graph queries by default
- Edges connected to soft-deleted entities are hidden but preserved
- A `purge` command hard-deletes entities that have been soft-deleted for >30 days, along with their orphaned edges
- Purge also removes the entity from Meilisearch and Chroma

Assertions:
- Add `deleted_at: string | null` to the Assertion schema
- Soft-deleted assertions are excluded from queries
- Citations pointing to soft-deleted assertions are preserved (audit trail)

Quarantine candidates:
- Hard delete is fine — rejected candidates can be purged immediately. Keep a `rejection_log` table with minimal metadata (id, subject, predicate, object, rejection reason, date) for auditability without data bloat.

This protects against accidental deletion of interconnected graph data while keeping the system clean over time.

---

## 8. Logging & Observability

**Question:** The system uses `console.log` throughout. Is this sufficient for a production homelab service?

**Recommendation:** Replace `console.log` with **pino** (Fastify's built-in logger). Pino gives you:

- Structured JSON logs (parseable by `jq`, Loki, or any log aggregator)
- Log levels (debug/info/warn/error) — suppress noise in production, enable in development
- Request-scoped logging via Fastify's built-in `request.log`
- Minimal overhead (~30% faster than winston, bunyan)

Fastify already initializes pino when you pass `{ logger: true }` — extend it:

```typescript
const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport: process.env.NODE_ENV === "development"
      ? { target: "pino-pretty" }
      : undefined,
  },
});
```

For the quarantine pipeline and graph operations, pass the logger instance rather than using console directly. This gives you a single log stream for the entire system, filterable by component.

Add a `/metrics` endpoint later if you want Prometheus scraping, but structured logs are sufficient to start.

---

## 9. Backup & Disaster Recovery

**Question:** The design does not address backups. What is the backup strategy for a system with four data stores?

**Recommendation:** A single backup script that runs via cron nightly:

1. **Kùzu** — copy the `cerebro.db/` directory while the API is briefly paused (Kùzu supports snapshot copies when no write transaction is active). Alternatively, export to Cypher dump.
2. **SQLite** — use `.backup` command or simple file copy (WAL mode makes this safe during reads).
3. **Meilisearch** — use the `/dumps` API endpoint to create a portable dump.
4. **Chroma** — copy the `chroma_data/` directory (Chroma's persistent storage is a directory of files).

Compress all four into a single timestamped tarball. Retain 7 daily + 4 weekly backups. Store on a separate drive or rsync to a second machine.

```bash
#!/bin/bash
# /srv/cerebro/scripts/backup.sh
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/backups/cerebro/${TIMESTAMP}"
mkdir -p "${BACKUP_DIR}"

# Pause API (optional — prevents writes during backup)
systemctl stop cerebro

cp -r /srv/cerebro/cerebro.db    "${BACKUP_DIR}/cerebro.db"
cp    /srv/cerebro/quarantine.db "${BACKUP_DIR}/quarantine.db"
cp -r /srv/cerebro/chroma_data   "${BACKUP_DIR}/chroma_data"
curl -s -X POST http://localhost:7700/dumps -H "Authorization: Bearer ${MEILI_KEY}" \
  -o "${BACKUP_DIR}/meili_dump.dump"

systemctl start cerebro

tar czf "/backups/cerebro/${TIMESTAMP}.tar.gz" -C /backups/cerebro "${TIMESTAMP}"
rm -rf "${BACKUP_DIR}"

# Prune old backups (keep 7 daily)
find /backups/cerebro -name "*.tar.gz" -mtime +7 -delete
```

Add a `restore.sh` script that reverses the process. Test it once before you need it.

---

## 10. Source Node Fields Missing from Implementation

**Question:** The citation design document specifies `arxiv_id`, `local_path`, `volume`, `issue`, and `retraction_date` on Source nodes, but the TypeScript implementation in `cerebro-backend-implementation.md` omits them. Should they be included?

**Recommendation:** Yes — add them. These fields serve distinct, non-redundant purposes:

| Field | Why it matters |
|-------|---------------|
| `arxiv_id` | Many preprints are cited before they receive a DOI. Without this, you cannot link to the canonical preprint. |
| `local_path` | Cerebro is a homelab system — PDFs stored locally on the server should be directly referenceable. This enables a future "open source PDF" action from the graph UI. |
| `volume` / `issue` | Required for correct bibliographic citation rendering (APA, Chicago, etc.). If you ever export citations, these are mandatory. |
| `retraction_date` | Distinct from `retracted: boolean` — knowing *when* a source was retracted lets you answer "was this source retracted before or after I cited it?" which matters for epistemic auditing. |

Add all five to the Kùzu Source node table and the `CerebroSource` TypeScript interface. The storage cost is negligible and the information loss from omitting them is permanent.

---

## 11. Predicate Normalization & Controlled Vocabulary

**Question:** Predicates on assertions are free-text strings. Will this lead to fragmentation — `"influences"`, `"influenced"`, `"has influence on"`, `"affects"` all meaning the same thing?

**Recommendation:** Yes, this will happen quickly and degrade query reliability. Implement a **predicate registry** — a curated list of canonical predicates with aliases.

Store the registry in SQLite (same quarantine database, separate table):

```sql
CREATE TABLE predicate_registry (
  canonical   TEXT PRIMARY KEY,      -- "influences"
  aliases     TEXT NOT NULL,         -- JSON array: ["influenced", "has_influence_on", "affects"]
  domain      TEXT,                  -- optional: "biology", "history", "general"
  inverse     TEXT,                  -- "is_influenced_by"
  description TEXT
);
```

At write time:
1. Check if the predicate matches a canonical entry or any alias
2. If yes, normalize to the canonical form
3. If no match, write it as-is but flag it for review (add to a `pending_predicates` queue)
4. Periodically review pending predicates — either add them to the registry or map them to existing canonical forms

Start with ~30-50 canonical predicates covering common relationships (causes, influences, contains, is_a, part_of, precedes, contradicts, supports, etc.). Grow the registry organically as the graph populates.

Store the `inverse` field so you can traverse bidirectionally — if A "influences" B, then B "is_influenced_by" A, and both queries should work.

---

## 12. Fictional World Isolation & Cross-World Queries

**Question:** Fictional entities carry a `fictional_world` string (e.g., `"world:project_lazarus"`), but the query layer doesn't have explicit world-scoping. How should world isolation work?

**Recommendation:** Add a `fictional_world` filter to all search and query endpoints as a first-class parameter. The default should be `null` (empirical/hypothetical only — fictional entities excluded unless explicitly requested).

Key query behaviors:
- **Within-world queries:** `GET /search/entities?world=project_lazarus` returns only entities in that world
- **Cross-world queries:** Explicitly opt-in. A query like "find all junction nodes between empirical and world:project_lazarus" is powerful and should be supported, but never be the default
- **World listing:** `GET /worlds` endpoint that returns all distinct `fictional_world` values and their entity/edge counts
- **World integrity:** An edge connecting two fictional entities from different worlds should be flagged as a potential error unless the user explicitly allows cross-world assertions

This keeps the empirical graph clean by default while making the fictional planes fully queryable when you want them.

---

## 13. Batch Import & Bulk Operations

**Question:** The current API is designed for single-entity and single-assertion operations. How do you populate the graph with an initial dataset or import from another system?

**Recommendation:** Add a batch import endpoint and a CLI command:

**API:** `POST /entities/batch` and `POST /assertions/batch` that accept arrays. Use database transactions (Kùzu supports them) to make batch writes atomic.

**CLI:** `npm run import -- --file data.json` that reads a JSON file conforming to the Cerebro schema and writes entities and assertions in bulk. The import should:
1. Validate all entities/assertions against Zod schemas before writing anything
2. Deduplicate against existing graph data
3. Write in batches of 100 (keeps memory bounded)
4. Report: created, skipped (duplicate), failed (validation error)

**Export:** `npm run export -- --format json` that dumps the entire graph to a portable JSON file. This serves double duty as a human-readable backup and an interoperability format.

Support a `--world` flag on both import and export to scope operations to a single fictional world.

---

## 14. Rate Limiting the Extraction Pipeline

**Question:** The LLM extraction pipeline calls Ollama for each paper section. If you batch-process 50 papers, what prevents Ollama from being overwhelmed?

**Recommendation:** Add a simple concurrency limiter to the extraction pipeline:

- Process papers sequentially (one at a time)
- Process sections within a paper with a concurrency limit of 2 (abstract + results can run in parallel, but don't overload Ollama)
- Add a configurable delay between papers (`EXTRACTION_DELAY_MS=2000`) to let Ollama's memory settle

Use a semaphore pattern (p-limit npm package) rather than building a queue system. This is a single-user homelab — a full job queue (Bull, BullMQ) is over-engineered.

Add progress reporting to stdout: `[3/50] Processing: "Effects of X on Y" — extracted 12 candidates, 3 hedged`.

---

## 15. Testing Strategy

**Question:** The implementation plan lists phase-by-phase testability but does not specify a testing framework or approach.

**Recommendation:** Use **vitest** (fast, TypeScript-native, compatible with the existing toolchain). Structure tests in three tiers:

**Unit tests** (`src/**/*.test.ts`):
- Zod schema validation (do malformed inputs get rejected?)
- Confidence derivation logic in quarantine ingest
- Predicate normalization
- ID generation

**Integration tests** (`tests/integration/`):
- Kùzu CRUD operations against a temporary database
- Meilisearch indexing and search (requires running Meilisearch — use docker-compose in CI)
- Quarantine write → approve → promote pipeline end-to-end
- Multi-store sync (create entity, verify it exists in all three stores)

**Invariant tests** (`tests/invariants/`):
- Inferred edges cannot have confidence above speculative
- Fictional edges must have null confidence
- Established edges require 2+ sources (after citation creation)
- Promoted candidates have `promoted_edge_id` set

Run with `npm test`. CI runs all three tiers. Local development can run unit tests only with `npm run test:unit` for speed.

Do NOT write tests for Fastify route handlers — test the underlying functions directly. Route handlers are thin wrappers; testing them adds maintenance cost without catching real bugs.

---

## 16. CLI vs. Web UI for Human Review

**Question:** The extraction design includes a Python CLI for reviewing quarantine candidates. The backend is TypeScript/Fastify. Should the review interface be a CLI, a web UI, or both?

**Recommendation:** Build the review interface as **API endpoints first**, then a **minimal web UI** second. Skip the Python CLI entirely — it creates a language split and duplicates logic.

API endpoints (already partially designed):
- `GET /quarantine?status=pending` — list candidates
- `PATCH /quarantine/:id` — approve, reject, or edit a candidate
- `POST /quarantine/promote` — trigger promotion of all approved candidates

Web UI: a single-page app served by Fastify's static file serving. Use vanilla HTML + htmx (no React, no build step). The review UI needs exactly three views:
1. **Queue view:** table of pending candidates, sorted by hedge_flag and date
2. **Review view:** single candidate with source sentence, hedge/scope/negation flags, editable fields, approve/reject/edit buttons
3. **Stats view:** counts by status, recent promotions, integrity violations

htmx keeps this under 500 lines of HTML/JS and avoids a frontend build pipeline entirely. It makes PATCH/POST requests directly to the Fastify API.

---

## 17. Handling Retraction Events

**Question:** The citation design describes retraction cascade queries, but how does a retraction actually enter the system? Is it manual, or can it be detected?

**Recommendation:** Start **manual-only**, with a clear workflow:

1. `PATCH /sources/:id` with `{ retracted: true, retraction_uri: "...", retraction_date: "..." }`
2. The endpoint automatically runs the retraction cascade query
3. Returns a list of affected assertions with their current confidence and remaining live source count
4. Assertions that are now orphaned (zero live sources) get flagged with a `needs_review: true` marker
5. The user reviews affected assertions and manually downgrades confidence or adds replacement sources

Future enhancement: a cron job that checks Retraction Watch's database or CrossRef's retraction API for DOIs in your source nodes. But do not build this until you have enough sources to make it worthwhile — manual retraction tracking is sufficient for the first year of use.

---

## 18. Graph Visualization

**Question:** The design documents are entirely API-focused. Is there a plan for visual graph exploration?

**Recommendation:** Do not build a custom graph visualization. Instead, expose a **Cypher-compatible export** that can be loaded into existing tools:

- **Option A: Neo4j Browser via Bolt protocol.** Use the `neo4j-driver` npm package to stand up a lightweight Bolt-compatible proxy that translates queries between Kùzu and Neo4j's wire protocol. This is non-trivial and should be deferred.

- **Option B (recommended): Export to GraphML or JSON for Gephi / yEd / Obsidian.** Add `GET /export/graphml` and `GET /export/obsidian` endpoints. GraphML is a standard XML format that every graph visualization tool supports. For Obsidian, export as a folder of markdown files with `[[wikilinks]]` representing edges — this gives you a visual canvas view in Obsidian's graph view with zero custom code.

- **Option C: D3.js force-directed graph.** If you want an in-browser visualization, embed a D3 force graph in the htmx review UI. Feed it from `GET /export/d3` which returns `{ nodes: [...], links: [...] }`. This is ~100 lines of D3 code and gives you an interactive, filterable graph view. Scope it to a single entity's neighborhood (2-hop ego graph) rather than the full graph — full-graph force layouts are unusable past ~500 nodes.

Start with Option B (GraphML export) — it's the simplest and works with the most tools.

---

---

*Document version: 2026-03-19 | System: Cerebro*
*Companion documents: cerebro-kg-design.md, cerebro-backend-implementation.md, extraction-design-schema.md, citation-inclusion-design-schema.md*
