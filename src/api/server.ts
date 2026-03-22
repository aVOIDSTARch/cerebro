import Fastify from "fastify";
import cors from "@fastify/cors";
import { createCloakState } from "../cloak/types.js";
import {
  registerWithCloak,
  listenHaltStream,
  type CloakClientConfig,
} from "../cloak/client.js";
import { createAuthHook } from "../cloak/auth.js";
import { entityRoutes } from "./routes/entities.js";
import { assertionRoutes } from "./routes/assertions.js";
import { sourceRoutes } from "./routes/sources.js";
import { citationRoutes } from "./routes/citations.js";
import { searchRoutes } from "./routes/search.js";
import { quarantineRoutes } from "./routes/quarantine.js";
import { adminRoutes } from "./routes/admin.js";

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info",
    transport:
      process.env.NODE_ENV === "development"
        ? { target: "pino-pretty" }
        : undefined,
  },
});

// Cloak integration
const cloakState = createCloakState();
const cloakConfig: CloakClientConfig = {
  cloakUrl: process.env.CLOAK_URL ?? "http://localhost:8300",
  manifestToken: process.env.CLOAK_MANIFEST_TOKEN ?? "",
  serviceId: "cerebro",
  serviceType: "knowledge_graph",
  version: "0.1.0",
  capabilities: ["entities", "assertions", "search", "quarantine"],
};

// Register with Cloak (non-fatal if Cloak not running)
try {
  const haltUrl = await registerWithCloak(cloakConfig, cloakState);
  // Start SSE halt listener in background (fire and forget)
  listenHaltStream(cloakConfig, cloakState, haltUrl).catch((err) =>
    console.error("[cloak] halt listener error:", err),
  );
} catch (err) {
  console.warn(`[cloak] Registration failed (continuing without): ${err}`);
}

// Global hooks
await app.register(cors, { origin: true });
app.addHook("onRequest", createAuthHook(cloakState));

// Routes
await app.register(adminRoutes);
await app.register(entityRoutes, { prefix: "/entities" });
await app.register(assertionRoutes, { prefix: "/assertions" });
await app.register(sourceRoutes, { prefix: "/sources" });
await app.register(citationRoutes, { prefix: "/citations" });
await app.register(searchRoutes, { prefix: "/search" });
await app.register(quarantineRoutes, { prefix: "/quarantine" });

const PORT = Number(process.env.PORT ?? 8101);
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`Cerebro API listening on :${PORT}`);
