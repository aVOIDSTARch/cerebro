import type { FastifyPluginAsync } from "fastify";
import { CreateAssertionSchema } from "../../types.js";
import {
  createAssertion,
  getAssertionById,
  getAssertionsBySubject,
  softDeleteAssertion,
} from "../../graph/edges.js";

export const assertionRoutes: FastifyPluginAsync = async (app) => {
  // Create assertion
  app.post("/", async (req, reply) => {
    const parsed = CreateAssertionSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues });
      return;
    }
    try {
      const assertion = await createAssertion(parsed.data);
      reply.code(201).send(assertion);
    } catch (err) {
      reply.code(400).send({ error: String(err) });
    }
  });

  // Get by ID
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const assertion = await getAssertionById(req.params.id);
    if (!assertion) {
      reply.code(404).send({ error: "Assertion not found" });
      return;
    }
    return assertion;
  });

  // Get by subject
  app.get<{ Querystring: { subject?: string } }>("/", async (req, reply) => {
    const { subject } = req.query;
    if (!subject) {
      reply.code(400).send({ error: "subject query parameter required" });
      return;
    }
    return getAssertionsBySubject(subject);
  });

  // Soft delete
  app.delete<{ Params: { id: string } }>("/:id", async (req, reply) => {
    await softDeleteAssertion(req.params.id);
    reply.code(204).send();
  });
};
