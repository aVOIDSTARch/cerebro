import type { FastifyPluginAsync } from "fastify";
import { CreateSourceSchema, UpdateSourceSchema } from "../../types.js";
import {
  createSource,
  getSourceById,
  markRetracted,
  updateSource,
} from "../../graph/sources.js";

export const sourceRoutes: FastifyPluginAsync = async (app) => {
  // Create source
  app.post("/", async (req, reply) => {
    const parsed = CreateSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues });
      return;
    }
    const source = await createSource({
      ...parsed.data,
      accessed_at: new Date().toISOString().slice(0, 10),
    });
    reply.code(201).send(source);
  });

  // Get by ID
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const source = await getSourceById(req.params.id);
    if (!source) {
      reply.code(404).send({ error: "Source not found" });
      return;
    }
    return source;
  });

  // Update source (including retraction)
  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const parsed = UpdateSourceSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues });
      return;
    }

    const data = parsed.data;

    // If marking as retracted, use the retraction cascade
    if (data.retracted === true) {
      const affected = await markRetracted(
        req.params.id,
        data.retraction_uri ?? null,
        data.retraction_date ?? null,
      );
      return {
        retracted: true,
        affected_assertions: affected,
      };
    }

    // Otherwise, apply updates normally
    const updates: Record<string, string | boolean | null> = {};
    if (data.label !== undefined) updates.label = data.label;
    if (data.notes !== undefined) updates.notes = data.notes;
    if (data.retraction_uri !== undefined) updates.retraction_uri = data.retraction_uri;
    if (data.retraction_date !== undefined) updates.retraction_date = data.retraction_date;

    await updateSource(req.params.id, updates);
    return { updated: true };
  });
};
