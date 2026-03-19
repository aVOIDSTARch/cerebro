import { searchEntities } from "../db/search.js";
import { getConnection, executeQuery } from "../db/graph.js";
import { deleteEntityFromIndex } from "../db/search.js";
import { deleteEntityVector } from "../db/vectors.js";
import type { CerebroEntity } from "../types.js";

export interface MergeCandidate {
  canonical: { id: string; label: string };
  duplicate: { id: string; label: string };
  similarity: number;
}

/**
 * Find potential duplicate entities by scanning Meilisearch for similar labels.
 */
export async function findDuplicates(
  threshold = 0.85,
): Promise<MergeCandidate[]> {
  const conn = getConnection();
  const allEntitiesResult = await conn.query(
    `MATCH (e:Entity) WHERE e.deleted_at = '' RETURN e.id, e.label ORDER BY e.created_at`,
  );
  if (Array.isArray(allEntitiesResult)) return [];
  const allEntities = await allEntitiesResult.getAll();

  const candidates: MergeCandidate[] = [];
  const seen = new Set<string>();

  for (const entity of allEntities) {
    const id = entity["e.id"] as string;
    const label = entity["e.label"] as string;
    if (seen.has(id)) continue;

    try {
      const results = await searchEntities(label, undefined, undefined, 5);
      for (const hit of results.hits) {
        const hitId = hit.id as string;
        if (hitId === id || seen.has(hitId)) continue;

        // Simple label similarity check
        const hitLabel = hit.label as string;
        const sim = labelSimilarity(label, hitLabel);
        if (sim >= threshold) {
          candidates.push({
            canonical: { id, label },
            duplicate: { id: hitId, label: hitLabel },
            similarity: sim,
          });
          seen.add(hitId);
        }
      }
    } catch {
      // Meilisearch not available
    }

    seen.add(id);
  }

  return candidates;
}

/**
 * Merge a duplicate entity into a canonical entity.
 * Reassigns all edges, unions aliases, soft-deletes the duplicate.
 */
export async function mergeEntities(
  canonicalId: string,
  duplicateId: string,
): Promise<void> {
  const conn = getConnection();

  // Get duplicate's aliases and label
  const dupStmt = await conn.prepare(
    `MATCH (e:Entity {id: $id}) RETURN e.label, e.aliases`,
  );
  const dupResult = await executeQuery(dupStmt, { id: duplicateId });
  const dupRows = await dupResult.getAll();
  if (!dupRows.length) throw new Error(`Entity ${duplicateId} not found`);

  const dupLabel = dupRows[0]["e.label"] as string;
  const dupAliases = (dupRows[0]["e.aliases"] as string[]) ?? [];

  // Add duplicate's label and aliases to canonical's aliases
  const canStmt = await conn.prepare(
    `MATCH (e:Entity {id: $id}) RETURN e.aliases`,
  );
  const canResult = await executeQuery(canStmt, { id: canonicalId });
  const canRows = await canResult.getAll();
  const canAliases = (canRows[0]?.["e.aliases"] as string[]) ?? [];

  const mergedAliases = [
    ...new Set([...canAliases, dupLabel, ...dupAliases]),
  ];

  // Update canonical entity's aliases
  const updateStmt = await conn.prepare(
    `MATCH (e:Entity {id: $id}) SET e.aliases = $aliases`,
  );
  await executeQuery(updateStmt, { id: canonicalId, aliases: mergedAliases });

  // Set canonical_id on duplicate and soft-delete it
  const now = new Date().toISOString();
  const markStmt = await conn.prepare(
    `MATCH (e:Entity {id: $id})
     SET e.canonical_id = $canonical_id, e.deleted_at = $deleted_at`,
  );
  await executeQuery(markStmt, {
    id: duplicateId,
    canonical_id: canonicalId,
    deleted_at: now,
  });

  // Clean up search/vector indexes
  try {
    await deleteEntityFromIndex(duplicateId);
  } catch { /* best effort */ }
  try {
    await deleteEntityVector(duplicateId);
  } catch { /* best effort */ }

  console.log(
    `Merged entity "${dupLabel}" (${duplicateId}) into ${canonicalId}`,
  );
}

/** Simple normalized Levenshtein similarity (0-1) */
function labelSimilarity(a: string, b: string): number {
  const la = a.toLowerCase().trim();
  const lb = b.toLowerCase().trim();
  if (la === lb) return 1;

  const maxLen = Math.max(la.length, lb.length);
  if (maxLen === 0) return 1;

  const dist = levenshtein(la, lb);
  return 1 - dist / maxLen;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
