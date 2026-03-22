import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest, FastifyReply } from "fastify";
import type { CloakState, TokenClaims } from "./types.js";

/**
 * Fastify onRequest hook that verifies Cloak HMAC-SHA256 bearer tokens.
 *
 * Token format: base64url(claims_json).hex(hmac_sha256)
 *
 * On success, attaches decoded TokenClaims to request via decoration.
 * On failure, returns 401/403/503.
 */
export function createAuthHook(state: CloakState) {
  return async function authHook(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    // Skip auth for health endpoint
    if (request.url === "/health") return;

    // Check halt state
    if (state.halted) {
      reply.code(503).send({
        error: "service_halted",
        detail: `Service halted: ${state.haltReason}`,
        service: "cerebro",
        halted: true,
      });
      return;
    }

    // Check signing key availability
    if (!state.signingKey) {
      reply.code(503).send({
        error: "no_signing_key",
        detail: "Service has no signing key (registration may have failed)",
        service: "cerebro",
      });
      return;
    }

    // Extract bearer token
    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      reply.code(401).send({
        error: "missing_token",
        detail: "Authorization header with Bearer token required",
        service: "cerebro",
      });
      return;
    }

    const token = authHeader.slice(7);
    const claims = verifyAndDecode(token, state.signingKey, reply);
    if (!claims) return; // reply already sent

    // Check expiration
    const expiresAt = new Date(claims.expires_at);
    if (expiresAt < new Date()) {
      reply.code(401).send({
        error: "token_expired",
        detail: "Token has expired",
        service: "cerebro",
      });
      return;
    }

    // Check cerebro scope
    const cerebroScope = claims.services.find((s) => s.service === "cerebro");
    if (!cerebroScope) {
      reply.code(403).send({
        error: "service_not_in_scope",
        detail: "Token does not grant access to cerebro",
        service: "cerebro",
      });
      return;
    }

    // Attach claims to request for handlers to use
    (request as any).cloakClaims = claims;
  };
}

/**
 * Verify token HMAC-SHA256 signature and decode claims.
 *
 * Token format: base64url(claims_json).hex(hmac_sha256)
 */
function verifyAndDecode(
  token: string,
  signingKey: Buffer,
  reply: FastifyReply,
): TokenClaims | null {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) {
    reply.code(401).send({
      error: "malformed_token",
      detail: "Token must be in format: payload.signature",
      service: "cerebro",
    });
    return null;
  }

  const payloadB64 = token.slice(0, dotIndex);
  const signatureHex = token.slice(dotIndex + 1);

  // Verify HMAC-SHA256 signature
  const expectedSig = createHmac("sha256", signingKey)
    .update(payloadB64)
    .digest("hex");

  const sigBuf = Buffer.from(signatureHex, "hex");
  const expectedBuf = Buffer.from(expectedSig, "hex");

  if (
    sigBuf.length !== expectedBuf.length ||
    !timingSafeEqual(sigBuf, expectedBuf)
  ) {
    reply.code(401).send({
      error: "invalid_signature",
      detail: "Token signature verification failed",
      service: "cerebro",
    });
    return null;
  }

  // Decode claims
  try {
    // base64url -> JSON
    const claimsJson = Buffer.from(payloadB64, "base64url").toString("utf-8");
    return JSON.parse(claimsJson) as TokenClaims;
  } catch (err) {
    reply.code(401).send({
      error: "invalid_token_payload",
      detail: `Cannot decode token claims: ${err}`,
      service: "cerebro",
    });
    return null;
  }
}
