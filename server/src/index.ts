import { resolve } from "node:path";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { ZodError } from "zod";
import { config, repoRoot } from "./config.js";
import { closeDb, getDb } from "./db/index.js";
import { purgeExpiredSessions } from "./auth/session.js";
import { authPlugin } from "./auth/plugin.js";
import { HttpError } from "./http-error.js";
import { authRoutes } from "./routes/auth.js";
import { projectRoutes } from "./routes/projects.js";

const app = Fastify({
  logger: config.isProduction
    ? true
    : { transport: undefined, level: "info" },
  // Timeline documents are large-ish JSON; 8 MB is generous for the 5000-item
  // cap in the document schema and still bounded.
  bodyLimit: 8 * 1024 * 1024,
  trustProxy: config.isProduction,
});

await app.register(cookie, { secret: undefined });

await app.register(rateLimit, {
  global: false,
  max: 300,
  timeWindow: "1 minute",
});

/*
 * Called directly rather than through app.register: a registered plugin gets
 * its own encapsulation context, and hooks added there would not run for the
 * sibling scopes the routes live in. These hooks must apply to every request.
 */
await authPlugin(app);

/*
 * One error handler for the whole API. Anything that is not an HttpError or a
 * validation failure is logged in full and reported as a bare 500, so internal
 * messages and stack traces never leave the server.
 */
app.setErrorHandler((error, request, reply) => {
  if (error instanceof HttpError) {
    return reply
      .status(error.status)
      .send({ error: { code: error.code, message: error.message, details: error.details } });
  }

  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: {
        code: "invalid_request",
        message: "The request body is not valid.",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
    });
  }

  if ((error as { statusCode?: number }).statusCode === 429) {
    return reply
      .status(429)
      .send({ error: { code: "rate_limited", message: "Too many requests. Slow down." } });
  }

  request.log.error({ err: error }, "Unhandled error");
  return reply
    .status(500)
    .send({ error: { code: "internal_error", message: "Something went wrong." } });
});

app.get("/api/health", async () => ({ ok: true, driver: (await getDb()).driver }));

// Sign-in and registration are the endpoints worth grinding, so they get a
// tighter per-IP budget than the rest of the API.
await app.register(async (scope) => {
  scope.addHook(
    "onRequest",
    scope.rateLimit({ max: 20, timeWindow: "5 minutes" }),
  );
  await authRoutes(scope);
});

await app.register(async (scope) => {
  scope.addHook("onRequest", scope.rateLimit({ max: 600, timeWindow: "1 minute" }));
  await projectRoutes(scope);
});

/*
 * In production the built browser app is served from the same origin as the
 * API, which is what makes SameSite=Lax cookies sufficient. In development Vite
 * serves it on :5173 and proxies /api here.
 */
const webDist = resolve(repoRoot, "web", "dist");
if (config.isProduction && existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, index: false });

  // With directory indexes disabled, @fastify/static answers a request for "/"
  // by trying to redirect, which it then refuses - so the root needs its own
  // route. Every other client-side path falls through to the handler below.
  app.get("/", (_request, reply) => reply.sendFile("index.html"));

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/")) {
      return reply.status(404).send({ error: { code: "not_found", message: "No such endpoint." } });
    }
    // Client-side routing: any non-API path renders the app shell.
    return reply.sendFile("index.html");
  });
}

const db = await getDb();
await purgeExpiredSessions(db);
const purgeTimer = setInterval(() => {
  void purgeExpiredSessions(db).catch((error) => app.log.error({ err: error }, "Session purge failed"));
}, 60 * 60 * 1000);
purgeTimer.unref();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "Shutting down");
  clearInterval(purgeTimer);
  await app.close();
  await closeDb();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.port, host: "0.0.0.0" });
app.log.info(
  `Chronoplot API on http://localhost:${config.port} (${config.db.driver}, ${config.nodeEnv})`,
);
