# Cerebro

Personal knowledge graph with multi-modal epistemic tracking — empirical facts, hypotheses, and fictional fabrications in a single traversable graph.

## Project Information

- **Author:** Louie Casinelli
- **Created:** 2026-03-18
- **Language:** TypeScript / Node.js
- **License:** MIT
- **Repository:** [github.com/aVOIDSTARch/cerebro](https://github.com/aVOIDSTARch/cerebro)

## What Cerebro Does

Cerebro stores knowledge as a property graph where every edge carries epistemic metadata: how confident are you in this claim, where did it come from, and is it attempting truth or operating inside a fictional world?

Three epistemic modes classify all knowledge:

| Mode | Meaning |
|------|---------|
| `empirical` | Attempting truth — subject to confidence rating |
| `hypothetical` | Attempting truth but unresolved |
| `fictional` | Not attempting truth — internal consistency applies |

Five confidence tiers rate empirical and hypothetical claims:

| Tier | Meaning |
|------|---------|
| `axiomatic` | Definitional, not subject to revision |
| `established` | Consensus or well-cited (requires 2+ independent sources) |
| `probable` | Strong evidence, not definitively settled |
| `plausible` | Some evidence, contested or incomplete |
| `speculative` | Intuition or raw hypothesis, no hard evidence |

**Junction nodes** — entities touched by both empirical and fictional edges — let you find where your research and worldbuilding intersect.

## Architecture

```
Kùzu (graph store)  ─── property graph with Cypher queries
Meilisearch         ─── full-text entity search, typo-tolerant
Chroma              ─── vector embeddings for semantic similarity
SQLite              ─── quarantine store for extraction candidates
Fastify             ─── REST API with bearer token auth
```

Total idle footprint: ~120MB RAM. No cloud dependencies.

## Key Design Principles

1. **Nothing bypasses quarantine.** LLM-extracted knowledge goes to a SQLite staging table. Promotion to the main graph requires explicit human approval.
2. **Inferred edges cannot self-promote.** Machine-derived edges are locked to `confidence: speculative` until a human upgrades them.
3. **Citations are load-bearing.** Sources are first-class graph nodes, not string metadata. Established claims require 2 independent sources. Retraction cascades are queryable.
4. **Atomic multi-store writes.** Entity creation writes to Kùzu, Meilisearch, and Chroma with compensating rollback if any store fails.
5. **Predicate normalization.** A registry of 40+ canonical predicates with aliases prevents fragmentation (`"influences"`, `"affected"`, `"has influence on"` all resolve to one canonical form).

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Start Meilisearch and Chroma
docker-compose up -d

# 3. Bootstrap all databases and seed predicate registry
npm run bootstrap

# 4. Start the API server
npm run dev
```

The API starts on `http://localhost:3000`. Verify with:

```bash
curl http://localhost:3000/health
# {"status":"ok"}
```

## Configuration

Copy `.env.example` to `.env` and set values:

| Variable | Default | Purpose |
|----------|---------|---------|
| `KUZU_PATH` | `./cerebro.db` | Kùzu database directory |
| `QUARANTINE_DB` | `./quarantine.db` | SQLite quarantine database |
| `MEILI_HOST` | `http://localhost:7700` | Meilisearch URL |
| `MEILI_KEY` | — | Meilisearch master key |
| `CHROMA_PATH` | `http://localhost:8000` | Chroma URL |
| `PORT` | `3000` | API server port |
| `CEREBRO_API_TOKEN` | — | Bearer token for API auth (optional in dev) |
| `EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Sentence embedding model |
| `LOG_LEVEL` | `info` | Pino log level |

## API

All routes except `/health` require `Authorization: Bearer <token>` when `CEREBRO_API_TOKEN` is set.

### Entities

```
POST   /entities          Create entity
POST   /entities/batch    Bulk create entities
GET    /entities           List (with ?mode=, ?world=, ?limit=, ?offset=)
GET    /entities/:id      Get by ID
DELETE /entities/:id      Soft delete
```

### Assertions

```
POST   /assertions        Create assertion (enforces epistemic invariants)
GET    /assertions?subject=:id   Get by subject entity
GET    /assertions/:id    Get by ID
DELETE /assertions/:id    Soft delete
```

### Sources

```
POST   /sources           Create source node
GET    /sources/:id       Get by ID
PATCH  /sources/:id       Update (set retracted: true triggers cascade)
```

### Citations

```
POST   /citations         Link assertion to source
GET    /citations?assertion=:id  Get by assertion
GET    /citations?source=:id     Get by source
```

### Search

```
GET    /search/entities?q=     Full-text search (Meilisearch)
GET    /search/semantic?q=     Semantic similarity (Chroma)
GET    /search/junctions       Find junction nodes
```

### Quarantine

```
GET    /quarantine?status=     List candidates
GET    /quarantine/:id         Get candidate
PATCH  /quarantine/:id         Approve / reject / edit
POST   /quarantine/promote     Promote all approved to main graph
```

### Admin

```
GET    /health             Health check (no auth)
GET    /worlds             List fictional worlds with counts
GET    /admin/integrity    Run citation integrity checks
GET    /export/json        Full graph export as JSON
GET    /export/graphml     Full graph export as GraphML
```

## Project Structure

```
src/
├── types.ts                 Shared types, enums, Zod schemas
├── db/
│   ├── graph.ts             Kùzu connection and schema
│   ├── search.ts            Meilisearch client
│   ├── vectors.ts           Chroma client and embeddings
│   ├── migrations.ts        Versioned migration runner
│   └── predicates.ts        Predicate registry and normalization
├── graph/
│   ├── nodes.ts             Entity CRUD (atomic multi-store writes)
│   ├── edges.ts             Assertion CRUD (invariant enforcement)
│   ├── sources.ts           Source CRUD (retraction cascades)
│   ├── citations.ts         Citation CRUD
│   └── queries.ts           Junction, path, integrity queries
├── quarantine/
│   ├── schema.ts            SQLite quarantine table
│   ├── ingest.ts            Write candidates with confidence derivation
│   ├── promote.ts           Promote approved candidates to graph
│   └── dedup.ts             Entity deduplication
├── api/
│   ├── server.ts            Fastify entry point
│   ├── auth.ts              Bearer token auth hook
│   └── routes/              7 route modules
├── validate/
│   └── integrity.ts         Citation integrity checks
scripts/
├── bootstrap.ts             Schema creation + predicate seeding
├── backup.sh                Nightly backup (all 4 stores)
├── sync-check.ts            Cross-store orphan detection
├── import.ts                JSON import with Zod validation
└── export.ts                JSON/GraphML export
deploy/
├── cerebro.service          Systemd unit file
├── crontab.example          Backup + sync cron jobs
└── README.md                Deployment instructions
```

## Scripts

| Command | Purpose |
|---------|---------|
| `npm run bootstrap` | Create all schemas, seed predicates |
| `npm run dev` | Start API with hot reload |
| `npm run build` | Compile TypeScript |
| `npm start` | Run compiled API |
| `npm test` | Run all tests |
| `npm run test:unit` | Run unit tests only |
| `npm run export` | Export graph (`--format json`, `--world <name>`) |
| `npm run import -- --file data.json` | Import from JSON |
| `npm run dedup` | Run entity deduplication |

## Testing

30 tests across 4 test files:

- **Unit tests** — Zod schema validation, predicate normalization, confidence derivation
- **Invariant tests** — Inferred edges locked to speculative, fictional edges require null confidence, all valid confidence tiers accepted for self-authored assertions

```bash
npm test
```

## Design Documents

Detailed architecture and rationale in [ai-docs/cerebro/](ai-docs/cerebro/):

- `cerebro-kg-design.md` — Data model, tech stack decision, alternatives analysis
- `cerebro-backend-implementation.md` — Full implementation plan
- `extraction-design-schema.md` — LLM extraction pipeline, failure modes, quarantine design
- `citation-inclusion-design-schema.md` — Citation as load-bearing structure
- `suggestions-2.md` — 18 design gap resolutions
- `final-plan.md` — Consolidated implementation plan

## Deployment

See [deploy/README.md](deploy/README.md) for full instructions. Summary:

```bash
# On ubuntu-server1
docker-compose up -d
npm run bootstrap
sudo cp deploy/cerebro.service /etc/systemd/system/
sudo systemctl enable --now cerebro
crontab deploy/crontab.example
```
