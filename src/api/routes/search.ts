import type { FastifyPluginAsync } from "fastify";
import { searchEntities } from "../../db/search.js";
import { semanticSearch } from "../../db/vectors.js";
import { findJunctionNodes } from "../../graph/queries.js";

export const searchRoutes: FastifyPluginAsync = async (app) => {
  // Full-text entity search
  app.get<{
    Querystring: { q: string; mode?: string; world?: string; limit?: string };
  }>("/entities", async (req, reply) => {
    const { q, mode, world, limit } = req.query;
    if (!q) {
      reply.code(400).send({ error: "q query parameter required" });
      return;
    }
    return searchEntities(q, mode, world, limit ? parseInt(limit) : 20);
  });

  // Semantic similarity search
  app.get<{
    Querystring: { q: string; mode?: string; n?: string };
  }>("/semantic", async (req, reply) => {
    const { q, mode, n } = req.query;
    if (!q) {
      reply.code(400).send({ error: "q query parameter required" });
      return;
    }
    return semanticSearch(q, mode, n ? parseInt(n) : 10);
  });

  // Junction nodes
  app.get("/junctions", async () => findJunctionNodes());
};
