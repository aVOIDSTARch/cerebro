import { describe, it, expect, beforeAll } from "vitest";
import { randomUUID } from "crypto";
import { writeCandidate, getPendingCandidates } from "./ingest.js";
import { bootstrapQuarantineSchema } from "./schema.js";
import { bootstrapPredicateRegistry, seedPredicates } from "../db/predicates.js";
import type { RawCandidate } from "./ingest.js";

process.env.QUARANTINE_DB = `/tmp/cerebro-test-ingest-${randomUUID()}.db`;

beforeAll(() => {
  bootstrapQuarantineSchema();
  bootstrapPredicateRegistry();
  seedPredicates();
});

describe("writeCandidate", () => {
  it("writes a candidate to quarantine with derived confidence", () => {
    const raw: RawCandidate = {
      subject_label: "Drug X",
      predicate: "reduces",
      object_label: "inflammation",
      raw_sentence: "Drug X may reduce inflammation in some patients.",
      source_paper_uri: "https://doi.org/10.1234/test",
      source_section: "abstract",
      hedge_flag: true,
      hedge_text: "may",
      scope_qualifier: "in some patients",
      negation_flag: false,
      suggested_confidence: "probable",
      extractor_model: "mistral:7b",
    };

    const candidate = writeCandidate(raw);

    expect(candidate.id).toMatch(/^candidate:/);
    expect(candidate.status).toBe("pending");
    // hedge_flag + scope_qualifier → speculative
    expect(candidate.suggested_confidence).toBe("speculative");
  });

  it("derives null confidence for negation", () => {
    const raw: RawCandidate = {
      subject_label: "X",
      predicate: "causes",
      object_label: "Y",
      raw_sentence: "We found no evidence that X causes Y.",
      source_paper_uri: "https://doi.org/10.1234/neg",
      negation_flag: true,
      hedge_flag: false,
      suggested_confidence: "probable",
      extractor_model: "llama3:70b",
    };

    const candidate = writeCandidate(raw);
    expect(candidate.suggested_confidence).toBeNull();
  });

  it("retrieves pending candidates sorted correctly", () => {
    const pending = getPendingCandidates();
    expect(pending.length).toBeGreaterThanOrEqual(2);
    expect(pending[0].status).toBe("pending");
    // Hedged candidates come first (hedge_flag DESC)
    expect(pending[0].hedge_flag).toBe(1);
  });
});
