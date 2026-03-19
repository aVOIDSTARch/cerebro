import { describe, it, expect } from "vitest";
import {
  CreateEntitySchema,
  CreateAssertionSchema,
  CreateSourceSchema,
  CreateCitationSchema,
  UpdateCandidateSchema,
  EpistemicModeSchema,
  ConfidenceSchema,
} from "./types.js";

describe("EpistemicModeSchema", () => {
  it("accepts valid modes", () => {
    expect(EpistemicModeSchema.safeParse("empirical").success).toBe(true);
    expect(EpistemicModeSchema.safeParse("hypothetical").success).toBe(true);
    expect(EpistemicModeSchema.safeParse("fictional").success).toBe(true);
  });

  it("rejects invalid modes", () => {
    expect(EpistemicModeSchema.safeParse("invalid").success).toBe(false);
    expect(EpistemicModeSchema.safeParse("").success).toBe(false);
  });
});

describe("ConfidenceSchema", () => {
  it("accepts valid confidence levels", () => {
    expect(ConfidenceSchema.safeParse("axiomatic").success).toBe(true);
    expect(ConfidenceSchema.safeParse("established").success).toBe(true);
    expect(ConfidenceSchema.safeParse("probable").success).toBe(true);
    expect(ConfidenceSchema.safeParse("plausible").success).toBe(true);
    expect(ConfidenceSchema.safeParse("speculative").success).toBe(true);
  });

  it("accepts null for fictional edges", () => {
    expect(ConfidenceSchema.safeParse(null).success).toBe(true);
  });

  it("rejects invalid confidence", () => {
    expect(ConfidenceSchema.safeParse("high").success).toBe(false);
  });
});

describe("CreateEntitySchema", () => {
  it("validates a complete entity", () => {
    const result = CreateEntitySchema.safeParse({
      label: "Marie Curie",
      type: "Person",
      aliases: ["M. Curie", "Madame Curie"],
      epistemic_mode: "empirical",
      fictional_world: null,
      notes: "Pioneer of radioactivity research",
    });
    expect(result.success).toBe(true);
  });

  it("applies defaults for optional fields", () => {
    const result = CreateEntitySchema.safeParse({
      label: "Test Entity",
      type: "Concept",
      epistemic_mode: "empirical",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.aliases).toEqual([]);
      expect(result.data.fictional_world).toBeNull();
      expect(result.data.notes).toBeNull();
    }
  });

  it("rejects empty label", () => {
    const result = CreateEntitySchema.safeParse({
      label: "",
      type: "Person",
      epistemic_mode: "empirical",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid epistemic mode", () => {
    const result = CreateEntitySchema.safeParse({
      label: "Test",
      type: "Person",
      epistemic_mode: "unknown",
    });
    expect(result.success).toBe(false);
  });
});

describe("CreateAssertionSchema", () => {
  it("validates a complete assertion", () => {
    const result = CreateAssertionSchema.safeParse({
      subject_id: "node:123",
      predicate: "influences",
      object_id: "node:456",
      epistemic_mode: "hypothetical",
      confidence: "plausible",
      source: "self",
      evidence: "Based on correspondence analysis",
    });
    expect(result.success).toBe(true);
  });

  it("accepts null confidence for fictional edges", () => {
    const result = CreateAssertionSchema.safeParse({
      subject_id: "node:123",
      predicate: "knows",
      object_id: "node:456",
      epistemic_mode: "fictional",
      confidence: null,
      source: "self",
    });
    expect(result.success).toBe(true);
  });
});

describe("CreateSourceSchema", () => {
  it("validates a minimal source", () => {
    const result = CreateSourceSchema.safeParse({
      label: "Einstein (1905)",
      source_type: "primary_research",
      reliability_tier: "primary",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.peer_reviewed).toBe(false);
      expect(result.data.retracted).toBe(false);
    }
  });

  it("validates a complete source", () => {
    const result = CreateSourceSchema.safeParse({
      label: "On the Electrodynamics of Moving Bodies",
      source_type: "primary_research",
      reliability_tier: "primary",
      doi: "10.1002/andp.19053221004",
      authors: ["Albert Einstein"],
      publication_year: 1905,
      journal: "Annalen der Physik",
      volume: "322",
      issue: "10",
      peer_reviewed: true,
    });
    expect(result.success).toBe(true);
  });
});

describe("CreateCitationSchema", () => {
  it("validates with defaults", () => {
    const result = CreateCitationSchema.safeParse({
      assertion_id: "edge:123",
      source_id: "node:source:456",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.citation_type).toBe("direct");
      expect(result.data.page_or_section).toBeNull();
    }
  });
});

describe("UpdateCandidateSchema", () => {
  it("validates approval", () => {
    const result = UpdateCandidateSchema.safeParse({
      status: "approved",
      final_confidence: "probable",
    });
    expect(result.success).toBe(true);
  });

  it("validates rejection", () => {
    const result = UpdateCandidateSchema.safeParse({
      status: "rejected",
      reviewer_notes: "Negation was missed",
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid status", () => {
    const result = UpdateCandidateSchema.safeParse({
      status: "promoted",
    });
    expect(result.success).toBe(false);
  });
});
