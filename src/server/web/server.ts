import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { config } from "../config.js";
import { registerApiRoutes } from "./api.js";
import { learnPublicUrl, registerAuthRoutes } from "./auth.js";

// Built dashboard files (created by `npm run build:dashboard`).
const dashboardDir = join(dirname(fileURLToPath(import.meta.url)), "../../dashboard");

export async function startWebServer() {
  const app = Fastify({ logger: { level: "warn" }, trustProxy: true });

  await app.register(cookie, { secret: config.sessionSecret });
  app.addHook("onRequest", async (request) => learnPublicUrl(request));
  registerAuthRoutes(app);
  registerApiRoutes(app);

  if (existsSync(dashboardDir)) {
    await app.register(fastifyStatic, { root: dashboardDir });
    // Any page that isn't a file or API route is handled by the dashboard app itself.
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/api/") || request.url.startsWith("/auth/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      return reply.sendFile("index.html");
    });
  } else {
    console.warn("[web] dashboard isn't built yet; run `npm run build`");
  }

  app.setErrorHandler((err, request, reply) => {
    request.log.error(err);
    reply.code(500).send({ error: "Something went wrong" });
  });

  await app.listen({ host: "0.0.0.0", port: config.port });
  console.log(`[web] dashboard online on port ${config.port}`);
  return app;
}
