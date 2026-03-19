import { ChromaClient, type Collection } from "chromadb";

const CHROMA_PATH = process.env.CHROMA_PATH ?? "http://localhost:8000";
const MODEL_NAME = process.env.EMBEDDING_MODEL ?? "Xenova/all-MiniLM-L6-v2";

const chroma = new ChromaClient({ path: CHROMA_PATH });
let _collection: Collection | null = null;
let _embedder: any = null;

async function getEmbedder() {
  if (!_embedder) {
    const { pipeline } = await import("@xenova/transformers");
    _embedder = await pipeline("feature-extraction", MODEL_NAME);
  }
  return _embedder;
}

export async function getCollection(): Promise<Collection> {
  if (!_collection) {
    _collection = await chroma.getOrCreateCollection({
      name: "cerebro_nodes",
      metadata: { "hnsw:space": "cosine" },
    });
  }
  return _collection;
}

export async function embedText(text: string): Promise<number[]> {
  const embedder = await getEmbedder();
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data as Float32Array);
}

export async function indexEntityVector(entity: {
  id: string;
  label: string;
  notes: string | null;
  epistemic_mode: string;
  type: string;
  fictional_world: string | null;
}): Promise<void> {
  const collection = await getCollection();
  const text = [entity.label, entity.notes ?? ""].filter(Boolean).join(" ");
  const embedding = await embedText(text);

  await collection.upsert({
    ids: [entity.id],
    embeddings: [embedding],
    metadatas: [
      {
        epistemic_mode: entity.epistemic_mode,
        type: entity.type,
        fictional_world: entity.fictional_world ?? "",
      },
    ],
    documents: [text],
  });
}

export async function deleteEntityVector(id: string): Promise<void> {
  const collection = await getCollection();
  await collection.delete({ ids: [id] });
}

export async function semanticSearch(
  query: string,
  epistemicMode?: string,
  nResults = 10,
) {
  const collection = await getCollection();
  const embedding = await embedText(query);

  const where = epistemicMode
    ? { epistemic_mode: { $eq: epistemicMode } }
    : undefined;

  return collection.query({
    queryEmbeddings: [embedding],
    nResults,
    where,
  });
}
