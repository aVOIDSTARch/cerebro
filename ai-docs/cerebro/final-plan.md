# Cerebro Knowledge Graph Engine — Full Implementation Plan

## Context

Cerebro is a personal knowledge graph with multi-modal epistemic tracking — empirical facts, hypotheses, and fictional fabrications in a single traversable graph. It is designed for homelab deployment on `ubuntu-server1`, single-user, privacy-first, no cloud dependencies.

Four design documents define the system:
- `ai-docs/cerebro/cerebro-kg-design.md` — data model, architecture, tech stack decision
- `ai-docs/cerebro/cerebro-backend-implementation.md` — TypeScript implementation plan (9 phases)
- `ai-docs/cerebro/extraction-design-schema.md` — LLM extraction pipeline with quarantine
- `ai-docs/cerebro/citation-inclusion-design-schema.md` — citation storage and validation
- `ai-docs/cerebro/suggestions-2.md` — 18 design gap resolutions

The stack: **TypeScript/Node.js, Kùzu (graph), Meilisearch (full-text), Chroma (vector), SQLite (quarantine), Fastify (API)**.

---

## Phase 1 — Project Scaffold

### 1.1 Initialize project
- Create directory structure per `cerebro-backend-implementation.md` lines 26–61
- Add `migrations/` directory (suggestion #5)
- `npm init`, install all dependencies:
  - Runtime: `kuzu`, `meilisearch`, `chromadb`, `better-sqlite3`, `@types/better-sqlite3`, `fastify`, `@fastify/cors`, `@fastify/static`, `zod`, `@xenova/transformers`, `uuid`, `pino-pretty`
  - Dev: `typescript`, `tsx`, `@types/node`, `vitest`

### 1.2 tsconfig.json
- Per `cerebro-backend-implementation.md` lines 83–98

### 1.3 package.json scripts
- `bootstrap`, `dev`, `build`, `start`, `test`, `test:unit`, `dedup`, `import`, `export`, `backup`

### 1.4 .env template
- Per `cerebro-backend-implementation.md` lines 1071–1078
- Add: `CEREBRO_API_TOKEN`, `EMBEDDING_MODEL`, `LOG_LEVEL`, `EXTRACTION_DELAY_MS`

### 1.5 docker-compose.yml
- Meilisearch + Chroma containers per `cerebro-backend-implementation.md` lines 1048–1067

**Files created:**
- `package.json`, `tsconfig.json`, `docker-compose.yml`, `.env.example`, `.gitignore` (update existing)

---

## Phase 2 — Shared Types (`src/types.ts`)

### 2.1 Core types
- All enums and interfaces from `cerebro-backend-implementation.md` lines 121–253
- Use UUIDv7 instead of v4 (suggestion #4)

### 2.2 Extended Source interface
- Add missing fields from citation design doc (suggestion #10): `arxiv_id`, `local_path`, `volume`, `issue`, `retraction_date`

### 2.3 Soft delete support
- Add `deleted_at: string | null` to `CerebroEntity` and `CerebroAssertion` (suggestion #7)

### 2.4 Zod validation schemas
- Mirror all interfaces as Zod schemas for runtime validation at API boundaries

**Files created:**
- `src/types.ts`

---

## Phase 3 — Database Layer

### 3.1 Kùzu graph store (`src/db/graph.ts`)
- Per `cerebro-backend-implementation.md` lines 262–346
- Add `arxiv_id`, `local_path`, `volume`, `issue`, `retraction_date` to Source node table
- Add `deleted_at` to Entity and Assertion tables
- Env-configurable DB path

### 3.2 Meilisearch client (`src/db/search.ts`)
- Per `cerebro-backend-implementation.md` lines 358–417
- Add `deleted_at` to filterable attributes (exclude soft-deleted by default)

### 3.3 Chroma vector store (`src/db/vectors.ts`)
- Per `cerebro-backend-implementation.md` lines 422–498
- Make embedding model configurable via `EMBEDDING_MODEL` env var (suggestion #3)

### 3.4 Quarantine SQLite store (`src/quarantine/schema.ts`)
- Per `cerebro-backend-implementation.md` lines 505–567
- Include citation fields from `citation-inclusion-design-schema.md` section 10

### 3.5 Migration runner (`src/db/migrations.ts`)
- `schema_versions` table in SQLite
- Auto-apply pending migrations at startup (suggestion #5)
- Initial migration = full schema creation

### 3.6 Predicate registry (`src/db/predicates.ts`)
- `predicate_registry` table in SQLite with canonical, aliases (JSON), domain, inverse, description (suggestion #11)
- Seed with ~30-50 common predicates (causes, influences, contains, is_a, part_of, precedes, contradicts, supports, etc.)
- `normalizePredicate(input)` function: check canonical + aliases, return canonical or flag as pending

**Files created:**
- `src/db/graph.ts`, `src/db/search.ts`, `src/db/vectors.ts`, `src/db/migrations.ts`, `src/db/predicates.ts`
- `src/quarantine/schema.ts`
- `migrations/001_initial_schema.ts`

---

## Phase 4 — Graph Operations

### 4.1 Entity CRUD (`src/graph/nodes.ts`)
- `createEntityAtomic()` with compensating-delete rollback across all three stores (suggestion #2)
- `getEntityById()`, `findOrCreateEntity()`
- `softDeleteEntity()` — sets `deleted_at`, removes from Meilisearch/Chroma
- Write-time alias check via Meilisearch before creating (suggestion #6, tier 1)
- UUIDv7 IDs with `node:` prefix

### 4.2 Assertion CRUD (`src/graph/edges.ts`)
- `createAssertion()` with invariant enforcement:
  - Inferred edges must be `confidence: speculative`
  - Fictional edges must have `confidence: null`
- Predicate normalization at write time (suggestion #11)
- `softDeleteAssertion()` — sets `deleted_at`

### 4.3 Source CRUD (`src/graph/sources.ts`)
- `createSource()`, `getSourceById()`, `markRetracted()`
- `markRetracted()` triggers retraction cascade query, returns affected assertions

### 4.4 Citation CRUD (`src/graph/citations.ts`)
- `createCitation()`, `getCitationsByAssertion()`, `getCitationsBySource()`

### 4.5 Queries (`src/graph/queries.ts`)
- `findJunctionNodes()` — nodes with both empirical and fictional edges
- `shortestPaths()` — with configurable max hops
- `findUndercitedEstablished()` — established claims with <2 live sources
- `findOrphanedAfterRetraction()` — claims with zero live sources
- All queries exclude `deleted_at IS NOT NULL` by default

**Files created:**
- `src/graph/nodes.ts`, `src/graph/edges.ts`, `src/graph/sources.ts`, `src/graph/citations.ts`, `src/graph/queries.ts`

---

## Phase 5 — Quarantine Pipeline

### 5.1 Ingest (`src/quarantine/ingest.ts`)
- `writeCandidate()` with confidence pre-population rules from `extraction-design-schema.md` section 8
- `getPendingCandidates()` sorted by hedge_flag DESC, date ASC

### 5.2 Promote (`src/quarantine/promote.ts`)
- `promoteApproved()` — creates entities (via `findOrCreateEntity`), assertion, source node, and CitedBy relationship
- Enforces: promoted candidates get `source: "citation"`, confidence = human-set value
- Sets `promoted_edge_id` on quarantine row, status = `"promoted"`

### 5.3 Deduplication CLI (`src/quarantine/dedup.ts`)
- Meilisearch pairwise similarity scan
- Clusters high-similarity entities with shared neighbors
- Interactive CLI: present merge candidates, merge on approval (suggestion #6, tier 2)
- Sets `canonical_id` on merged entity

**Files created:**
- `src/quarantine/ingest.ts`, `src/quarantine/promote.ts`, `src/quarantine/dedup.ts`

---

## Phase 6 — API Server

### 6.1 Server entry (`src/api/server.ts`)
- Fastify with pino logger (suggestion #8)
- `@fastify/cors`, `@fastify/static` (for future htmx UI)
- Bearer token auth via `onRequest` hook — checks `CEREBRO_API_TOKEN` on all routes except `GET /health` (suggestion #1)
- Register all route plugins

### 6.2 Entity routes (`src/api/routes/entities.ts`)
- `POST /entities` — create single entity
- `POST /entities/batch` — bulk create (suggestion #13)
- `GET /entities/:id` — get by ID
- `DELETE /entities/:id` — soft delete
- `GET /entities` — list with pagination, epistemic_mode filter, world filter (suggestion #12)

### 6.3 Assertion routes (`src/api/routes/assertions.ts`)
- `POST /assertions` — create assertion
- `GET /assertions/:id` — get by ID
- `GET /assertions?subject=:id` — get by subject
- `DELETE /assertions/:id` — soft delete

### 6.4 Source routes (`src/api/routes/sources.ts`)
- `POST /sources` — create source
- `GET /sources/:id` — get by ID
- `PATCH /sources/:id` — update (including retraction with cascade, suggestion #17)

### 6.5 Citation routes (`src/api/routes/citations.ts`)
- `POST /citations` — create citation linking assertion to source
- `GET /citations?assertion=:id` — get citations for assertion
- `GET /citations?source=:id` — get citations for source

### 6.6 Search routes (`src/api/routes/search.ts`)
- `GET /search/entities` — full-text via Meilisearch, with `?world=` filter
- `GET /search/semantic` — vector via Chroma, with `?world=` filter
- `GET /search/junctions` — junction node query

### 6.7 Quarantine routes (`src/api/routes/quarantine.ts`)
- `GET /quarantine?status=pending` — list candidates
- `PATCH /quarantine/:id` — approve/reject/edit
- `POST /quarantine/promote` — trigger promotion batch

### 6.8 Admin routes (`src/api/routes/admin.ts`)
- `GET /health` — no auth required
- `GET /worlds` — list all fictional worlds with counts (suggestion #12)
- `GET /admin/integrity` — run all integrity checks, return violations
- `GET /export/graphml` — full graph export as GraphML (suggestion #18)
- `GET /export/json` — full graph export as JSON (suggestion #13)

**Files created:**
- `src/api/server.ts`
- `src/api/routes/entities.ts`, `assertions.ts`, `sources.ts`, `citations.ts`, `search.ts`, `quarantine.ts`, `admin.ts`
- `src/api/auth.ts` (bearer token hook)

---

## Phase 7 — Bootstrap & Infrastructure

### 7.1 Bootstrap script (`scripts/bootstrap.ts`)
- Run migrations, bootstrap Kùzu schema, Meilisearch index, quarantine SQLite
- Seed predicate registry with initial ~30-50 predicates

### 7.2 Backup script (`scripts/backup.sh`)
- Nightly cron: snapshot Kùzu, SQLite, Chroma, Meilisearch dump (suggestion #9)
- Compress to timestamped tarball, prune >7 days

### 7.3 Sync integrity check (`scripts/sync-check.ts`)
- Compare entity IDs across Kùzu, Meilisearch, Chroma — report orphans (suggestion #2)
- Weekly cron

### 7.4 Import/Export CLI (`scripts/import.ts`, `scripts/export.ts`)
- JSON import with Zod validation, dedup, batch writes (suggestion #13)
- JSON and GraphML export with optional `--world` flag

**Files created:**
- `scripts/bootstrap.ts`, `scripts/backup.sh`, `scripts/sync-check.ts`, `scripts/import.ts`, `scripts/export.ts`

---

## Phase 8 — Deployment

### 8.1 Systemd service
- Per `cerebro-backend-implementation.md` lines 1086–1112
- `cerebro.service` targeting `dist/api/server.js`

### 8.2 Cron jobs
- Nightly: `backup.sh`
- Weekly: `sync-check.ts`

---

## Phase 9 — Testing

### 9.1 Unit tests (`src/**/*.test.ts`)
- Zod schema validation
- Confidence derivation logic
- Predicate normalization
- UUIDv7 generation and prefix formatting

### 9.2 Integration tests (`tests/integration/`)
- Kùzu CRUD against temp database
- Quarantine write → approve → promote end-to-end
- Multi-store sync verification
- Auth hook (valid token, invalid token, no token, health bypass)

### 9.3 Invariant tests (`tests/invariants/`)
- Inferred edges reject non-speculative confidence
- Fictional edges require null confidence
- Established edges flagged with <2 sources
- Soft-deleted entities excluded from queries

**Files created:**
- `vitest.config.ts`
- `src/**/*.test.ts` (co-located unit tests)
- `tests/integration/*.test.ts`
- `tests/invariants/*.test.ts`

---

## Implementation Order

| Step | Phase | Deliverable | Verification |
|------|-------|-------------|--------------|
| 1 | 1 | Project scaffold, deps installed | `npm run build` compiles |
| 2 | 2 | `src/types.ts` with Zod schemas | TypeScript compiles, Zod tests pass |
| 3 | 3.1–3.4 | All four database layers | `npm run bootstrap` creates all schemas |
| 4 | 3.5 | Migration runner | Migrations apply idempotently |
| 5 | 3.6 | Predicate registry | Normalize known + unknown predicates |
| 6 | 4.1 | Entity CRUD with atomic writes | Create entity → verify in all 3 stores |
| 7 | 4.2 | Assertion CRUD with invariants | Inferred+non-speculative throws |
| 8 | 4.3–4.4 | Source + Citation CRUD | Create source, cite assertion, query back |
| 9 | 4.5 | Graph queries | Junction query, undercited query return expected |
| 10 | 5.1–5.2 | Quarantine ingest + promote | Write candidate → approve → promote → verify in graph |
| 11 | 6.1–6.8 | Full API server | `GET /health` returns ok, all routes respond |
| 12 | 7.1 | Bootstrap script | Clean start creates everything |
| 13 | 9 | All tests | `npm test` passes |
| 14 | 7.2–7.4 | Scripts (backup, sync, import/export) | Export → wipe → import round-trip |
| 15 | 8 | Systemd + cron | `systemctl status cerebro` active |

---

## Key Invariants (must never be violated)

1. Inferred edges cannot self-promote — `createAssertion()` throws if `source === "inferred"` and `confidence !== "speculative"`
2. Nothing bypasses quarantine — extracted candidates go to SQLite first, promotion is explicit
3. All three stores stay in sync — atomic writes with compensating rollback
4. Fictional edges carry `confidence: null`
5. Established claims require 2 independent sources (validated by integrity checks)
6. Soft-deleted entities excluded from all queries by default
7. Auth required on all routes except `/health`

---

## Files Summary

```
/srv/cerebro/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── docker-compose.yml
├── .env.example
├── src/
│   ├── types.ts
│   ├── db/
│   │   ├── graph.ts
│   │   ├── search.ts
│   │   ├── vectors.ts
│   │   ├── migrations.ts
│   │   └── predicates.ts
│   ├── graph/
│   │   ├── nodes.ts
│   │   ├── edges.ts
│   │   ├── sources.ts
│   │   ├── citations.ts
│   │   └── queries.ts
│   ├── quarantine/
│   │   ├── schema.ts
│   │   ├── ingest.ts
│   │   ├── promote.ts
│   │   └── dedup.ts
│   ├── api/
│   │   ├── server.ts
│   │   ├── auth.ts
│   │   └── routes/
│   │       ├── entities.ts
│   │       ├── assertions.ts
│   │       ├── sources.ts
│   │       ├── citations.ts
│   │       ├── search.ts
│   │       ├── quarantine.ts
│   │       └── admin.ts
│   └── validate/
│       └── integrity.ts
├── scripts/
│   ├── bootstrap.ts
│   ├── backup.sh
│   ├── sync-check.ts
│   ├── import.ts
│   └── export.ts
├── migrations/
│   └── 001_initial_schema.ts
└── tests/
    ├── integration/
    └── invariants/
```

## Verification

After full implementation:
1. `docker-compose up -d` — Meilisearch + Chroma running
2. `npm run bootstrap` — all schemas created, predicates seeded
3. `npm test` — all unit, integration, invariant tests pass
4. `npm run dev` — API starts, `GET /health` returns `{ status: "ok" }`
5. Manual smoke test: create entity → create assertion → create source → cite → search → export GraphML
6. `npm run export -- --format json > backup.json && npm run import -- --file backup.json` — round-trip works

---

*Document version: 2026-03-19 | System: Cerebro*
