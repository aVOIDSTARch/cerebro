import type { FastifyPluginAsync } from "fastify";
import { UpdateCandidateSchema } from "../../types.js";
import {
  getPendingCandidates,
  getCandidatesByStatus,
  getCandidateById,
  updateCandidate,
} from "../../quarantine/ingest.js";
import { promoteApproved } from "../../quarantine/promote.js";

export const quarantineRoutes: FastifyPluginAsync = async (app) => {
  // List candidates
  app.get<{ Querystring: { status?: string } }>("/", async (req) => {
    const { status } = req.query;
    if (status) {
      return getCandidatesByStatus(status);
    }
    return getPendingCandidates();
  });

  // Get candidate by ID
  app.get<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const candidate = getCandidateById(req.params.id);
    if (!candidate) {
      reply.code(404).send({ error: "Candidate not found" });
      return;
    }
    return candidate;
  });

  // Update candidate (approve, reject, edit)
  app.patch<{ Params: { id: string } }>("/:id", async (req, reply) => {
    const parsed = UpdateCandidateSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.code(400).send({ error: parsed.error.issues });
      return;
    }

    const candidate = getCandidateById(req.params.id);
    if (!candidate) {
      reply.code(404).send({ error: "Candidate not found" });
      return;
    }

    const updates: Record<string, unknown> = {
      status: parsed.data.status,
      reviewed_at: new Date().toISOString(),
    };

    if (parsed.data.final_confidence !== undefined) {
      updates.final_confidence = parsed.data.final_confidence;
    }
    if (parsed.data.final_subject_label !== undefined) {
      updates.final_subject_label = parsed.data.final_subject_label;
    }
    if (parsed.data.final_predicate !== undefined) {
      updates.final_predicate = parsed.data.final_predicate;
    }
    if (parsed.data.final_object_label !== undefined) {
      updates.final_object_label = parsed.data.final_object_label;
    }
    if (parsed.data.epistemic_mode !== undefined) {
      updates.epistemic_mode = parsed.data.epistemic_mode;
    }
    if (parsed.data.fictional_world !== undefined) {
      updates.fictional_world = parsed.data.fictional_world;
    }
    if (parsed.data.reviewer_notes !== undefined) {
      updates.reviewer_notes = parsed.data.reviewer_notes;
    }

    updateCandidate(req.params.id, updates);
    return { updated: true, id: req.params.id };
  });

  // Promote all approved candidates
  app.post("/promote", async () => {
    return promoteApproved();
  });
};
