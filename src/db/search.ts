import { MeiliSearch } from "meilisearch";

const MEILI_HOST = process.env.MEILI_HOST ?? "http://localhost:7700";
const MEILI_KEY = process.env.MEILI_KEY ?? "";
const INDEX_NAME = "cerebro_entities";

export const meili = new MeiliSearch({ host: MEILI_HOST, apiKey: MEILI_KEY });

export async function bootstrapSearchIndex(): Promise<void> {
  const index = meili.index(INDEX_NAME);

  await index.updateFilterableAttributes([
    "epistemic_mode",
    "type",
    "fictional_world",
    "deleted_at",
  ]);

  await index.updateSearchableAttributes(["label", "aliases", "notes"]);

  await index.updateRankingRules([
    "words",
    "typo",
    "proximity",
    "attribute",
    "sort",
    "exactness",
  ]);

  console.log("Meilisearch index configured.");
}

export async function indexEntity(entity: {
  id: string;
  label: string;
  aliases: string[];
  type: string;
  epistemic_mode: string;
  fictional_world: string | null;
  deleted_at: string | null;
  notes: string | null;
}): Promise<void> {
  await meili.index(INDEX_NAME).addDocuments([entity]);
}

export async function deleteEntityFromIndex(id: string): Promise<void> {
  await meili.index(INDEX_NAME).deleteDocument(id);
}

export async function searchEntities(
  query: string,
  epistemicMode?: string,
  fictionalWorld?: string,
  limit = 20,
) {
  const filter: string[] = ["deleted_at IS NULL"];
  if (epistemicMode) filter.push(`epistemic_mode = "${epistemicMode}"`);
  if (fictionalWorld) filter.push(`fictional_world = "${fictionalWorld}"`);

  return meili.index(INDEX_NAME).search(query, {
    limit,
    filter: filter.join(" AND "),
  });
}
