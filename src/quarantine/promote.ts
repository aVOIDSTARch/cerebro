import { getQuarantineDb } from "./schema.js";
import { findOrCreateEntity } from "../graph/nodes.js";
import { createAssertion } from "../graph/edges.js";
import type { ExtractionCandidate } from "../types.js";

export async function promoteApproved(): Promise<{
  promoted: number;
  errors: string[];
}> {
  const db = getQuarantineDb();
  const rows = db
    .prepare(
      `SELECT * FROM extraction_candidates
       WHERE status IN ('approved', 'edited')
         AND promoted_edge_id IS NULL`,
    )
    .all() as ExtractionCandidate[];

  console.log(`Promoting ${rows.length} approved candidates.`);

  let promoted = 0;
  const errors: string[] = [];

  for (const row of rows) {
    try {
      const subjectLabel = row.final_subject_label ?? row.subject_label;
      const predicate = row.final_predicate ?? row.predicate;
      const objectLabel = row.final_object_label ?? row.object_label;
      const confidence = row.final_confidence ?? row.suggested_confidence;

      const subjectEntity = await findOrCreateEntity(
        subjectLabel,
        "Unknown",
        row.epistemic_mode,
      );
      const objectEntity = await findOrCreateEntity(
        objectLabel,
        "Unknown",
        row.epistemic_mode,
      );

      const assertion = await createAssertion({
        subject_id: subjectEntity.id,
        predicate,
        object_id: objectEntity.id,
        epistemic_mode: row.epistemic_mode,
        confidence,
        fictional_world: row.fictional_world,
        source: "citation",
        evidence: `${row.source_paper_uri} — ${row.raw_sentence.slice(0, 120)}`,
      });

      db.prepare(
        `UPDATE extraction_candidates
         SET promoted_edge_id = ?, status = 'promoted'
         WHERE id = ?`,
      ).run(assertion.id, row.id);

      console.log(
        `  Promoted: (${subjectLabel}) —[${predicate}]→ (${objectLabel}) [${confidence}]`,
      );
      promoted++;
    } catch (err) {
      const msg = `Failed to promote ${row.id}: ${err}`;
      console.error(`  ${msg}`);
      errors.push(msg);
    }
  }

  console.log(`Promotion complete. ${promoted} promoted, ${errors.length} errors.`);
  return { promoted, errors };
}
