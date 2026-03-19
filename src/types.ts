import { z } from "zod/v4";

// ── Enums ───────────────────────────────────────────────────────────────────

export type EpistemicMode = "empirical" | "hypothetical" | "fictional";

export type Confidence =
  | "axiomatic"
  | "established"
  | "probable"
  | "plausible"
  | "speculative"
  | null; // null = fictional edges only

export type AssertionSource = "self" | "citation" | "inferred";

export type CitationType = "direct" | "indirect" | "refuting" | "contextual";

export type ReliabilityTier = "primary" | "secondary" | "tertiary" | "grey";

export type SourceType =
  | "primary_research"
  | "systematic_review"
  | "encyclopedia"
  | "reference_work"
  | "official_record"
  | "contemporaneous"
  | "monograph"
  | "grey";

export type CandidateStatus =
  | "pending"
  | "approved"
  | "edited"
  | "rejected"
  | "promoted";

// ── Node ────────────────────────────────────────────────────────────────────

export interface CerebroEntity {
  id: string; // "node:<uuidv7>"
  label: string;
  type: string;
  aliases: string[];
  epistemic_mode: EpistemicMode;
  fictional_world: string | null;
  canonical_id: string | null; // set when merged into another entity
  created_at: string; // ISO date
  deleted_at: string | null;
  notes: string | null;
}

// ── Edge ────────────────────────────────────────────────────────────────────

export interface CerebroAssertion {
  id: string; // "edge:<uuidv7>"
  subject_id: string;
  predicate: string;
  object_id: string;
  epistemic_mode: EpistemicMode;
  confidence: Confidence;
  fictional_world: string | null;
  source: AssertionSource;
  evidence: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

// ── Source node ──────────────────────────────────────────────────────────────

export interface CerebroSource {
  id: string; // "node:source:<uuidv7>"
  label: string;
  source_type: SourceType;
  reliability_tier: ReliabilityTier;
  uri: string | null;
  doi: string | null;
  isbn: string | null;
  arxiv_id: string | null;
  local_path: string | null;
  authors: string[];
  publication_year: number | null;
  publisher: string | null;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  peer_reviewed: boolean;
  retracted: boolean;
  retraction_uri: string | null;
  retraction_date: string | null;
  accessed_at: string;
  added_at: string;
  notes: string | null;
}

// ── Citation relationship ────────────────────────────────────────────────────

export interface CerebroCitation {
  id: string; // "citation:<uuidv7>"
  assertion_id: string;
  source_id: string;
  citation_type: CitationType;
  page_or_section: string | null;
  quote: string | null;
  added_at: string;
}

// ── Quarantine candidate ─────────────────────────────────────────────────────

export interface ExtractionCandidate {
  id: string;
  subject_label: string;
  subject_node_id: string | null;
  predicate: string;
  object_label: string;
  object_node_id: string | null;
  raw_sentence: string;
  source_paper_uri: string;
  source_section: string | null;
  page_number: number | null;
  hedge_flag: boolean;
  hedge_text: string | null;
  scope_qualifier: string | null;
  negation_flag: boolean;
  suggested_confidence: Confidence;
  extractor_model: string;
  extraction_method: string;
  status: CandidateStatus;
  final_confidence: Confidence | null;
  final_subject_label: string | null;
  final_predicate: string | null;
  final_object_label: string | null;
  epistemic_mode: EpistemicMode;
  fictional_world: string | null;
  reviewer_notes: string | null;
  source_reliability_tier: ReliabilityTier | null;
  citation_type: CitationType;
  source_peer_reviewed: boolean | null;
  source_retracted: boolean;
  extracted_at: string;
  reviewed_at: string | null;
  promoted_edge_id: string | null;
}

// ── Zod Schemas ──────────────────────────────────────────────────────────────

export const EpistemicModeSchema = z.enum(["empirical", "hypothetical", "fictional"]);

export const ConfidenceSchema = z
  .enum(["axiomatic", "established", "probable", "plausible", "speculative"])
  .nullable();

export const AssertionSourceSchema = z.enum(["self", "citation", "inferred"]);

export const CitationTypeSchema = z.enum(["direct", "indirect", "refuting", "contextual"]);

export const ReliabilityTierSchema = z.enum(["primary", "secondary", "tertiary", "grey"]);

export const SourceTypeSchema = z.enum([
  "primary_research",
  "systematic_review",
  "encyclopedia",
  "reference_work",
  "official_record",
  "contemporaneous",
  "monograph",
  "grey",
]);

export const CandidateStatusSchema = z.enum([
  "pending",
  "approved",
  "edited",
  "rejected",
  "promoted",
]);

export const CreateEntitySchema = z.object({
  label: z.string().min(1),
  type: z.string().min(1),
  aliases: z.array(z.string()).default([]),
  epistemic_mode: EpistemicModeSchema,
  fictional_world: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

export const CreateAssertionSchema = z.object({
  subject_id: z.string().min(1),
  predicate: z.string().min(1),
  object_id: z.string().min(1),
  epistemic_mode: EpistemicModeSchema,
  confidence: ConfidenceSchema,
  fictional_world: z.string().nullable().default(null),
  source: AssertionSourceSchema,
  evidence: z.string().nullable().default(null),
});

export const CreateSourceSchema = z.object({
  label: z.string().min(1),
  source_type: SourceTypeSchema,
  reliability_tier: ReliabilityTierSchema,
  uri: z.string().nullable().default(null),
  doi: z.string().nullable().default(null),
  isbn: z.string().nullable().default(null),
  arxiv_id: z.string().nullable().default(null),
  local_path: z.string().nullable().default(null),
  authors: z.array(z.string()).default([]),
  publication_year: z.number().int().nullable().default(null),
  publisher: z.string().nullable().default(null),
  journal: z.string().nullable().default(null),
  volume: z.string().nullable().default(null),
  issue: z.string().nullable().default(null),
  peer_reviewed: z.boolean().default(false),
  retracted: z.boolean().default(false),
  retraction_uri: z.string().nullable().default(null),
  retraction_date: z.string().nullable().default(null),
  notes: z.string().nullable().default(null),
});

export const CreateCitationSchema = z.object({
  assertion_id: z.string().min(1),
  source_id: z.string().min(1),
  citation_type: CitationTypeSchema.default("direct"),
  page_or_section: z.string().nullable().default(null),
  quote: z.string().nullable().default(null),
});

export const UpdateCandidateSchema = z.object({
  status: z.enum(["approved", "rejected", "edited"]),
  final_confidence: ConfidenceSchema.optional(),
  final_subject_label: z.string().nullable().optional(),
  final_predicate: z.string().nullable().optional(),
  final_object_label: z.string().nullable().optional(),
  epistemic_mode: EpistemicModeSchema.optional(),
  fictional_world: z.string().nullable().optional(),
  reviewer_notes: z.string().nullable().optional(),
});

export const UpdateSourceSchema = z.object({
  label: z.string().min(1).optional(),
  retracted: z.boolean().optional(),
  retraction_uri: z.string().nullable().optional(),
  retraction_date: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});
