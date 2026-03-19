import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { createAssertion } from "../../src/graph/edges.js";

// Use unique temp databases per test file
const testId = randomUUID().slice(0, 8);
process.env.KUZU_PATH = `/tmp/cerebro-test-kuzu-${testId}`;
process.env.QUARANTINE_DB = `/tmp/cerebro-test-inv-${testId}.db`;

let entityA: { id: string };
let entityB: { id: string };

beforeAll(async () => {
  const { bootstrapSchema } = await import("../../src/db/graph.js");
  const { bootstrapQuarantineSchema } = await import("../../src/quarantine/schema.js");
  const { bootstrapPredicateRegistry, seedPredicates } = await import("../../src/db/predicates.js");

  await bootstrapSchema();
  bootstrapQuarantineSchema();
  bootstrapPredicateRegistry();
  seedPredicates();

  const { getConnection, executeQuery } = await import("../../src/db/graph.js");
  const conn = getConnection();

  const stmtA = await conn.prepare(
    `CREATE (:Entity {
      id: 'node:test-a', label: 'Entity A', type: 'Test',
      epistemic_mode: 'empirical', fictional_world: '', canonical_id: '',
      aliases: [], created_at: '2026-03-19', deleted_at: '', notes: ''
    })`,
  );
  await executeQuery(stmtA);

  const stmtB = await conn.prepare(
    `CREATE (:Entity {
      id: 'node:test-b', label: 'Entity B', type: 'Test',
      epistemic_mode: 'empirical', fictional_world: '', canonical_id: '',
      aliases: [], created_at: '2026-03-19', deleted_at: '', notes: ''
    })`,
  );
  await executeQuery(stmtB);

  entityA = { id: "node:test-a" };
  entityB = { id: "node:test-b" };
});

describe("Edge Invariants", () => {
  it("INVARIANT 1: Inferred edges must have speculative confidence", async () => {
    await expect(
      createAssertion({
        subject_id: entityA.id,
        predicate: "causes",
        object_id: entityB.id,
        epistemic_mode: "empirical",
        confidence: "established",
        fictional_world: null,
        source: "inferred",
        evidence: null,
      }),
    ).rejects.toThrow("Inferred edges must have confidence 'speculative'");
  });

  it("INVARIANT 1: Inferred edges with speculative confidence succeed", async () => {
    const assertion = await createAssertion({
      subject_id: entityA.id,
      predicate: "causes",
      object_id: entityB.id,
      epistemic_mode: "empirical",
      confidence: "speculative",
      fictional_world: null,
      source: "inferred",
      evidence: null,
    });
    expect(assertion.id).toMatch(/^edge:/);
    expect(assertion.confidence).toBe("speculative");
    expect(assertion.source).toBe("inferred");
  });

  it("INVARIANT 4: Fictional edges must have null confidence", async () => {
    const { getConnection, executeQuery } = await import("../../src/db/graph.js");
    const conn = getConnection();

    const stmtC = await conn.prepare(
      `CREATE (:Entity {
        id: 'node:test-fic-a', label: 'Fictional A', type: 'Character',
        epistemic_mode: 'fictional', fictional_world: 'world:test', canonical_id: '',
        aliases: [], created_at: '2026-03-19', deleted_at: '', notes: ''
      })`,
    );
    await executeQuery(stmtC);

    const stmtD = await conn.prepare(
      `CREATE (:Entity {
        id: 'node:test-fic-b', label: 'Fictional B', type: 'Character',
        epistemic_mode: 'fictional', fictional_world: 'world:test', canonical_id: '',
        aliases: [], created_at: '2026-03-19', deleted_at: '', notes: ''
      })`,
    );
    await executeQuery(stmtD);

    await expect(
      createAssertion({
        subject_id: "node:test-fic-a",
        predicate: "knows",
        object_id: "node:test-fic-b",
        epistemic_mode: "fictional",
        confidence: "established",
        fictional_world: "world:test",
        source: "self",
        evidence: null,
      }),
    ).rejects.toThrow("Fictional edges must have confidence null");
  });

  it("INVARIANT 4: Fictional edges with null confidence succeed", async () => {
    const assertion = await createAssertion({
      subject_id: "node:test-fic-a",
      predicate: "knows",
      object_id: "node:test-fic-b",
      epistemic_mode: "fictional",
      confidence: null,
      fictional_world: "world:test",
      source: "self",
      evidence: null,
    });
    expect(assertion.confidence).toBeNull();
    expect(assertion.epistemic_mode).toBe("fictional");
  });

  it("Self-authored empirical assertions can have any valid confidence", async () => {
    for (const confidence of [
      "axiomatic",
      "established",
      "probable",
      "plausible",
      "speculative",
    ] as const) {
      const assertion = await createAssertion({
        subject_id: entityA.id,
        predicate: "influences",
        object_id: entityB.id,
        epistemic_mode: "empirical",
        confidence,
        fictional_world: null,
        source: "self",
        evidence: `Test evidence for ${confidence}`,
      });
      expect(assertion.confidence).toBe(confidence);
    }
  });
});
