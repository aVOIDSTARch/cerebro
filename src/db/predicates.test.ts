import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import {
  bootstrapPredicateRegistry,
  seedPredicates,
  normalizePredicate,
  getPendingPredicates,
} from "./predicates.js";
import { bootstrapQuarantineSchema } from "../quarantine/schema.js";

// Use a unique temp database per test file
process.env.QUARANTINE_DB = `/tmp/cerebro-test-pred-${randomUUID()}.db`;

beforeAll(() => {
  bootstrapQuarantineSchema();
  bootstrapPredicateRegistry();
  seedPredicates();
});

describe("normalizePredicate", () => {
  it("returns canonical form for exact match", () => {
    expect(normalizePredicate("causes")).toBe("causes");
    expect(normalizePredicate("influences")).toBe("influences");
  });

  it("normalizes aliases to canonical form", () => {
    expect(normalizePredicate("affected_by")).toBe("influenced_by");
    expect(normalizePredicate("is_part_of")).toBe("part_of");
    expect(normalizePredicate("is_type_of")).toBe("is_a");
  });

  it("normalizes whitespace and case", () => {
    expect(normalizePredicate("  Causes  ")).toBe("causes");
    expect(normalizePredicate("INFLUENCES")).toBe("influences");
  });

  it("records unknown predicates as pending", () => {
    const result = normalizePredicate("grapples_with");
    expect(result).toBe("grapples_with");

    const pending = getPendingPredicates();
    expect(pending.some((p) => p.predicate === "grapples_with")).toBe(true);
  });

  it("increments occurrence count for repeated unknown predicates", () => {
    normalizePredicate("novel_relation");
    normalizePredicate("novel_relation");

    const pending = getPendingPredicates();
    const entry = pending.find((p) => p.predicate === "novel_relation");
    expect(entry?.occurrences).toBe(2);
  });
});
