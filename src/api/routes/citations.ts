import type { FastifyPluginAsync } from "fastify";
import { CreateCitationSchema } from "../../types.js";
import {
  createCitation,
  getCitationsByAssertion,
  getCitationsBySource,
} from "../../graph/citations.js";

export const citationRoutes: FastifyPluginAsync = async (app) => {
  // Create citation
  app.post("/", async (req, reply) => {
    const parsed = CreateCitationSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues });
      return;
    }
    try {
      const citation = await createCitation(parsed.data);
      reply.code(201).send(citation);
    } catch (err) {
      reply.code(400).send({ error: String(err) });
    }
  });

  // Get citations by assertion or source
  app.get<{
    Querystring: { assertion?: string; source?: string };
  }>("/", async (req, reply) => {
    const { assertion, source } = req.query;
    if (assertion) {
      return getCitationsByAssertion(assertion);
    }
    if (source) {
      return getCitationsBySource(source);
    }
    reply.code(400).send({
      error: "Either 'assertion' or 'source' query parameter required",
    });
  });
};
