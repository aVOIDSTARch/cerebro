import type { FastifyPluginAsync } from "fastify";
import { CreateEntitySchema } from "../../types.js";
import {
  createEntityAtomic,
  getEntityById,
  listEntities,
  softDeleteEntity,
} from "../../graph/nodes.js";

export const entityRoutes: FastifyPluginAsync = async (app) => {
  // Create entity
  app.post("/", async (req, reply) => {
    const parsed = CreateEntitySchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues });
      return;
    }
    const entity = await createEntityAtomic(parsed.data);
    reply.code(201).send(entity);
  });

  // Batch create
  app.post("/batch", async (req, reply) => {
    const bodies = req.body as unknown[];
    if (!Array.isArray(bodies)) {
      reply.code(400).send({ error: "Request body must be an array" });
      return;
    }

    const results: { created: unknown[]; errors: { index: number; error: unknown }[] } = {
      created: [],
      errors: [],
    };

    for (let i = 0; i < bodies.length; i++) {
      const parsed = CreateEntitySchema.safeParse(bodies[i]);
      if (!parsed.success) {
        results.errors.push({ index: i, error: parsed.error.issues });
        continue;
      }
      try {
        const entity = await createEntityAtomic(parsed.data);
        results.created.push(entity);
      } catch (err) {
        results.errors.push({ index: i, error: String(err) });
      }
    }

    reply.code(201).send(results);
  });

  // Get by ID
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const entity = await getEntityById(req.params.id);
    if (!entity) {
      reply.code(404).send({ error: "Entity not found" });
      return;
    }
    return entity;
  });

  // List entities
  app.get<{
    Querystring: {
      mode?: string;
      world?: string;
      limit?: string;
      offset?: string;
    };
  }>("/", async (req) => {
    const { mode, world, limit, offset } = req.query;
    return listEntities(
      mode,
      world,
      limit ? parseInt(limit) : 100,
      offset ? parseInt(offset) : 0,
    );
  });

  // Soft delete
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await softDeleteEntity(req.params.id);
    reply.code(204).send();
  });
};
