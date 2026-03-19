import { findUndercitedEstablished, findOrphanedAfterRetraction } from "../graph/queries.js";

export interface IntegrityViolation {
  type: string;
  edge_id: string;
  predicate: string;
  subject_label?: string;
  object_label?: string;
  detail: string;
}

export async function runIntegrityChecks(): Promise<IntegrityViolation[]> {
  const violations: IntegrityViolation[] = [];

  // Check 1: Established claims with fewer than 2 sources
  const undercited = await findUndercitedEstablished();
  for (const row of undercited) {
    violations.push({
      type: "undercited_established",
      edge_id: row.edge_id as string,
      predicate: row.predicate as string,
      subject_label: row.subject_label as string,
      object_label: row.object_label as string,
      detail: `Established claim has only ${row.live_sources} live source(s), requires 2`,
    });
  }

  // Check 2: Claims with only retracted sources
  const orphaned = await findOrphanedAfterRetraction();
  for (const row of orphaned) {
    violations.push({
      type: "orphaned_after_retraction",
      edge_id: row.edge_id as string,
      predicate: row.predicate as string,
      subject_label: row.subject_label as string,
      object_label: row.object_label as string,
      detail: `${row.confidence} claim has zero live (non-retracted) sources`,
    });
  }

  return violations;
}
