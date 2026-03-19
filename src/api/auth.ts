import type { FastifyRequest, FastifyReply } from "fastify";

const API_TOKEN = process.env.CEREBRO_API_TOKEN;

export async function authHook(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  // Skip auth for health endpoint
  if (request.url === "/health") return;

  // If no token is configured, skip auth (development mode)
  if (!API_TOKEN) return;

  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    reply.code(401).send({ error: "Missing or invalid Authorization header" });
    return;
  }

  const token = authHeader.slice(7);
  if (token !== API_TOKEN) {
    reply.code(401).send({ error: "Invalid API token" });
    return;
  }
}
