import { v7 as uuid } from "uuid";
import { getQuarantineDb } from "./schema.js";
import type { ExtractionCandidate, Confidence } from "../types.js";

export interface RawCandidate {
  subject_label: string;
  predicate: string;
  object_label: string;
  raw_sentence: string;
  source_paper_uri: string;
  source_section?: string;
  page_number?: number;
  hedge_flag: boolean;
  hedge_text?: string;
  scope_qualifier?: string;
  negation_flag: boolean;
  suggested_confidence: Confidence;
  extractor_model: string;
}

/** Pre-populate confidence tier based on extraction flags */
function deriveConfidence(raw: RawCandidate): Confidence {
  if (raw.negation_flag) return null; // force manual review
  if (raw.hedge_flag && raw.scope_qualifier) return "speculative";
  if (raw.hedge_flag) return "plausible";
  if (raw.source_section === "abstract") return "probable";
  if (raw.source_section === "discussion") return "plausible";
  return raw.suggested_confidence;
}

export function writeCandidate(raw: RawCandidate): ExtractionCandidate {
  const db = getQuarantineDb();
  const candidate: ExtractionCandidate = {
    id: `candidate:${uuid()}`,
    subject_label: raw.subject_label,
    subject_node_id: null,
    predicate: raw.predicate,
    object_label: raw.object_label,
    object_node_id: null,
    raw_sentence: raw.raw_sentence,
    source_paper_uri: raw.source_paper_uri,
    source_section: raw.source_section ?? null,
    page_number: raw.page_number ?? null,
    hedge_flag: raw.hedge_flag,
    hedge_text: raw.hedge_text ?? null,
    scope_qualifier: raw.scope_qualifier ?? null,
    negation_flag: raw.negation_flag,
    suggested_confidence: deriveConfidence(raw),
    extractor_model: raw.extractor_model,
    extraction_method: "llm",
    status: "pending",
    final_confidence: null,
    final_subject_label: null,
    final_predicate: null,
    final_object_label: null,
    epistemic_mode: "empirical",
    fictional_world: null,
    reviewer_notes: null,
    source_reliability_tier: null,
    citation_type: "direct",
    source_peer_reviewed: null,
    source_retracted: false,
    extracted_at: new Date().toISOString(),
    reviewed_at: null,
    promoted_edge_id: null,
  };

  db.prepare(`
    INSERT OR IGNORE INTO extraction_candidates
    (id, subject_label, predicate, object_label, raw_sentence,
     source_paper_uri, source_section, page_number, hedge_flag, hedge_text,
     scope_qualifier, negation_flag, suggested_confidence,
     extractor_model, extraction_method, status, epistemic_mode,
     citation_type, source_retracted, extracted_at)
    VALUES
    ($id, $subject_label, $predicate, $object_label, $raw_sentence,
     $source_paper_uri, $source_section, $page_number, $hedge_flag, $hedge_text,
     $scope_qualifier, $negation_flag, $suggested_confidence,
     $extractor_model, $extraction_method, $status, $epistemic_mode,
     $citation_type, $source_retracted, $extracted_at)
  `).run({
    id: candidate.id,
    subject_label: candidate.subject_label,
    predicate: candidate.predicate,
    object_label: candidate.object_label,
    raw_sentence: candidate.raw_sentence,
    source_paper_uri: candidate.source_paper_uri,
    source_section: candidate.source_section,
    page_number: candidate.page_number,
    hedge_flag: candidate.hedge_flag ? 1 : 0,
    hedge_text: candidate.hedge_text,
    scope_qualifier: candidate.scope_qualifier,
    negation_flag: candidate.negation_flag ? 1 : 0,
    suggested_confidence: candidate.suggested_confidence ?? "speculative",
    extractor_model: candidate.extractor_model,
    extraction_method: candidate.extraction_method,
    status: candidate.status,
    epistemic_mode: candidate.epistemic_mode,
    citation_type: candidate.citation_type,
    source_retracted: candidate.source_retracted ? 1 : 0,
    extracted_at: candidate.extracted_at,
  });

  return candidate;
}

export function getPendingCandidates(): ExtractionCandidate[] {
  return getQuarantineDb()
    .prepare(
      `SELECT * FROM extraction_candidates WHERE status = 'pending'
       ORDER BY hedge_flag DESC, extracted_at ASC`,
    )
    .all() as ExtractionCandidate[];
}

export function getCandidatesByStatus(
  status: string,
): ExtractionCandidate[] {
  return getQuarantineDb()
    .prepare("SELECT * FROM extraction_candidates WHERE status = ? ORDER BY extracted_at ASC")
    .all(status) as ExtractionCandidate[];
}

export function getCandidateById(
  id: string,
): ExtractionCandidate | undefined {
  return getQuarantineDb()
    .prepare("SELECT * FROM extraction_candidates WHERE id = ?")
    .get(id) as ExtractionCandidate | undefined;
}

export function updateCandidate(
  id: string,
  updates: Record<string, unknown>,
): void {
  const db = getQuarantineDb();
  const setClauses: string[] = [];
  const values: unknown[] = [];

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = ?`);
      values.push(value);
    }
  }

  if (setClauses.length === 0) return;

  values.push(id);
  db.prepare(
    `UPDATE extraction_candidates SET ${setClauses.join(", ")} WHERE id = ?`,
  ).run(...values);
}
