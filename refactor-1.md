# Refactor 1 — Conditional Retrieval Router

## Context

`cerebro-backend-implementation.md` defines three independent stores:
- **Kùzu** — graph traversal (Cypher)
- **Meilisearch** — full-text / label search
- **Chroma** — semantic vector search

These are currently queried independently with no routing logic.
This refactor adds a query-intent classification layer that dispatches
to the correct store(s) based on the nature of the incoming query,
inspired by the AdaMem paper's question-conditioned retrieval routing.

---

## New File: `src/retrieval/router.ts`

Create this module. It sits between the API routes and the three stores.
Nothing in `src/api/routes/search.ts` should call the stores directly after
this refactor — all queries route through here.

### Intent types

```typescript
export type QueryIntent =
  | "entity_lookup"       // query contains a resolvable entity label
  | "graph_traversal"     // query anchors on a known entity and asks about relations
  | "persona_recall"      // query asks about stable/established facts
  | "semantic_exploration"; // open-ended, no clear entity anchor
```

### Classification logic

Implement `classifyIntent(query: string): Promise<QueryIntent>` using
rule-based logic for now — keep it simple, make the interface stable
so it can be swapped for a model-based classifier later without touching
callers.

Rules in priority order:

1. If query contains a label that resolves to a known entity **and** contains
   relational language ("connected to", "related to", "path", "how does X
   relate to Y") → `graph_traversal`
2. If query contains a resolvable entity label but no relational language
   → `entity_lookup`
3. If query contains words indicating high-confidence recall ("what do I know
   for certain", "established", "axiomatic", "what is X" where X resolves)
   → `persona_recall`
4. Default → `semantic_exploration`

Entity label resolution: call Meilisearch with the query tokens and check
if any result has a score above a threshold (e.g. 0.85). If yes, treat as
a known entity anchor.

### Dispatch logic

Implement `conditionalRetrieve(query: string): Promise<RetrievalResult>`:

| Intent | Primary store | Secondary (if primary returns < 3 results) |
|---|---|---|
| `entity_lookup` | Meilisearch exact label | Kùzu `getEntityById` |
| `graph_traversal` | Kùzu `shortestPaths` or `getAssertionsBySubject` | Chroma semantic on result labels |
| `persona_recall` | Kùzu filtered by `confidence IN ['axiomatic','established']` | Meilisearch |
| `semantic_exploration` | Chroma `semanticSearch` | Meilisearch as fallback |

### Return type

```typescript
export interface RetrievalResult {
  intent:   QueryIntent;
  results:  unknown[];       // typed per intent — narrow later
  sources:  ("kuzu" | "meilisearch" | "chroma")[];
  fallback: boolean;         // true if secondary store was invoked
}
```

---

## Modify: `src/api/routes/search.ts`

Remove direct store imports. Import `conditionalRetrieve` from
`src/retrieval/router.ts` instead.

Replace the existing `/semantic` and `/entities` handlers with a single
`GET /search?q=...&mode=...` handler that calls `conditionalRetrieve`
and returns the `RetrievalResult` envelope. Keep the `/junctions` route
unchanged — it is a graph-specific query, not a retrieval route.

---

## Do Not Touch

- `src/db/graph.ts`, `src/db/search.ts`, `src/db/vectors.ts` — store
  clients are unchanged
- `src/quarantine/` — unaffected
- `src/graph/nodes.ts`, `edges.ts`, `queries.ts` — unaffected
- The three stores remain independently callable for internal use
  (e.g. `promoteApproved` calls Kùzu directly — that is correct)

---

## Test Criteria

- `GET /search?q=Marie+Curie` → intent: `entity_lookup`
- `GET /search?q=how+does+Marie+Curie+relate+to+Nietzsche` → intent: `graph_traversal`
- `GET /search?q=what+are+established+facts+about+Vienna` → intent: `persona_recall`
- `GET /search?q=themes+of+isolation+in+early+20th+century` → intent: `semantic_exploration`
- All four return a valid `RetrievalResult` with correct `sources` array populated

---

*Refactor 1 of N | Cerebro backend | Companion: cerebro-backend-implementation.md*
