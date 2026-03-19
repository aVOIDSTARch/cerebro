import Fastify from "fastify";
import cors from "@fastify/cors";
import { authHook } from "./auth.js";
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

// Global hooks
await app.register(cors, { origin: true });
app.addHook("onRequest", authHook);

// Routes
await app.register(adminRoutes);
await app.register(entityRoutes, { prefix: "/entities" });
await app.register(assertionRoutes, { prefix: "/assertions" });
await app.register(sourceRoutes, { prefix: "/sources" });
await app.register(citationRoutes, { prefix: "/citations" });
await app.register(searchRoutes, { prefix: "/search" });
await app.register(quarantineRoutes, { prefix: "/quarantine" });

const PORT = Number(process.env.PORT ?? 3000);
await app.listen({ port: PORT, host: "0.0.0.0" });
console.log(`Cerebro API listening on :${PORT}`);
