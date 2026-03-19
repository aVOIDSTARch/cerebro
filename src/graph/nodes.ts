import { v7 as uuid } from "uuid";
import { getConnection, executeQuery } from "../db/graph.js";
import { indexEntity, deleteEntityFromIndex, searchEntities } from "../db/search.js";
import { indexEntityVector, deleteEntityVector } from "../db/vectors.js";
import type { CerebroEntity, EpistemicMode } from "../types.js";

export async function createEntityAtomic(
  params: Omit<CerebroEntity, "id" | "created_at" | "deleted_at" | "canonical_id">,
): Promise<CerebroEntity> {
  const conn = getConnection();
  const entity: CerebroEntity = {
    id: `node:${uuid()}`,
    created_at: new Date().toISOString().slice(0, 10),
    deleted_at: null,
    canonical_id: null,
    ...params,
  };

  // Step 1: Kùzu (source of truth)
  const stmt = await conn.prepare(
    `CREATE (:Entity {
      id: $id, label: $label, type: $type,
      epistemic_mode: $epistemic_mode,
      fictional_world: $fictional_world,
      canonical_id: $canonical_id,
      aliases: $aliases,
      created_at: $created_at,
      deleted_at: $deleted_at,
      notes: $notes
    })`,
  );
  await executeQuery(stmt, {
    id: entity.id,
    label: entity.label,
    type: entity.type,
    epistemic_mode: entity.epistemic_mode,
    fictional_world: entity.fictional_world ?? "",
    canonical_id: entity.canonical_id ?? "",
    aliases: entity.aliases,
    created_at: entity.created_at,
    deleted_at: entity.deleted_at ?? "",
    notes: entity.notes ?? "",
  });

  // Step 2: Meilisearch
  try {
    await indexEntity({
      id: entity.id,
      label: entity.label,
      aliases: entity.aliases,
      type: entity.type,
      epistemic_mode: entity.epistemic_mode,
      fictional_world: entity.fictional_world,
      deleted_at: entity.deleted_at,
      notes: entity.notes,
    });
  } catch (err) {
    await kuzuDeleteEntity(entity.id);
    throw new Error(`Meilisearch sync failed, rolled back Kùzu: ${err}`);
  }

  // Step 3: Chroma
  try {
    await indexEntityVector({
      id: entity.id,
      label: entity.label,
      notes: entity.notes,
      epistemic_mode: entity.epistemic_mode,
      type: entity.type,
      fictional_world: entity.fictional_world,
    });
  } catch (err) {
    await kuzuDeleteEntity(entity.id);
    await deleteEntityFromIndex(entity.id);
    throw new Error(`Chroma sync failed, rolled back Kùzu + Meili: ${err}`);
  }

  return entity;
}

async function kuzuDeleteEntity(id: string): Promise<void> {
  const conn = getConnection();
  const stmt = await conn.prepare("MATCH (e:Entity {id: $id}) DELETE e");
  await executeQuery(stmt, { id });
}

export async function getEntityById(id: string): Promise<CerebroEntity | null> {
  const conn = getConnection();
  const stmt = await conn.prepare(
    `MATCH (e:Entity {id: $id})
     WHERE e.deleted_at = ''
     RETURN e.id, e.label, e.type, e.epistemic_mode, e.fictional_world,
            e.canonical_id, e.aliases, e.created_at, e.deleted_at, e.notes`,
  );
  const result = await executeQuery(stmt, { id });
  const rows = await result.getAll();
  if (!rows.length) return null;
  return rowToEntity(rows[0]);
}

export async function findOrCreateEntity(
  label: string,
  type: string,
  epistemicMode: EpistemicMode = "empirical",
): Promise<CerebroEntity> {
  const conn = getConnection();

  // Try exact match first
  const stmt = await conn.prepare(
    `MATCH (e:Entity)
     WHERE e.label = $label AND e.deleted_at = ''
     RETURN e.id, e.label, e.type, e.epistemic_mode, e.fictional_world,
            e.canonical_id, e.aliases, e.created_at, e.deleted_at, e.notes`,
  );
  const result = await executeQuery(stmt, { label });
  const rows = await result.getAll();
  if (rows.length) return rowToEntity(rows[0]);

  // Try alias match via Meilisearch
  try {
    const searchResult = await searchEntities(label, undefined, undefined, 1);
    if (searchResult.hits.length > 0) {
      const hit = searchResult.hits[0];
      const aliases = (hit.aliases as string[]) ?? [];
      if (aliases.some((a) => a.toLowerCase() === label.toLowerCase())) {
        const existing = await getEntityById(hit.id as string);
        if (existing) return existing;
      }
    }
  } catch {
    // Meilisearch might not be running — fall through to create
  }

  return createEntityAtomic({
    label,
    type,
    aliases: [],
    epistemic_mode: epistemicMode,
    fictional_world: null,
    notes: null,
  });
}

export async function softDeleteEntity(id: string): Promise<void> {
  const conn = getConnection();
  const now = new Date().toISOString();
  const stmt = await conn.prepare(
    `MATCH (e:Entity {id: $id}) SET e.deleted_at = $deleted_at`,
  );
  await executeQuery(stmt, { id, deleted_at: now });

  try {
    await deleteEntityFromIndex(id);
  } catch {
    // Best effort — sync check will catch inconsistencies
  }

  try {
    await deleteEntityVector(id);
  } catch {
    // Best effort
  }
}

export async function listEntities(
  epistemicMode?: string,
  fictionalWorld?: string,
  limit = 100,
  offset = 0,
): Promise<CerebroEntity[]> {
  const conn = getConnection();
  let cypher = "MATCH (e:Entity) WHERE e.deleted_at = ''";
  const params: Record<string, string> = {};

  if (epistemicMode) {
    cypher += " AND e.epistemic_mode = $epistemic_mode";
    params.epistemic_mode = epistemicMode;
  }
  if (fictionalWorld) {
    cypher += " AND e.fictional_world = $fictional_world";
    params.fictional_world = fictionalWorld;
  }

  cypher += ` RETURN e.id, e.label, e.type, e.epistemic_mode, e.fictional_world,
              e.canonical_id, e.aliases, e.created_at, e.deleted_at, e.notes
              ORDER BY e.created_at DESC SKIP ${offset} LIMIT ${limit}`;

  const stmt = await conn.prepare(cypher);
  const result = await executeQuery(stmt, params);
  const rows = await result.getAll();
  return rows.map(rowToEntity);
}

function rowToEntity(row: Record<string, unknown>): CerebroEntity {
  return {
    id: row["e.id"] as string,
    label: row["e.label"] as string,
    type: row["e.type"] as string,
    epistemic_mode: row["e.epistemic_mode"] as EpistemicMode,
    fictional_world: (row["e.fictional_world"] as string) || null,
    canonical_id: (row["e.canonical_id"] as string) || null,
    aliases: (row["e.aliases"] as string[]) ?? [],
    created_at: row["e.created_at"] as string,
    deleted_at: (row["e.deleted_at"] as string) || null,
    notes: (row["e.notes"] as string) || null,
  };
}
