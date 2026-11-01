import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { updateStatus, statusView } from "../../server/bot/presence.js";
import { WORKING_HOURS } from "../../shared/botStatus.js";
import { isDeveloper } from "../announcements/developer.js";

const hours = z.union(WORKING_HOURS.map((h) => z.literal(h)) as [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<4>, z.ZodLiteral<8>]);
const patch = z.object({ showStatus: z.boolean().optional(), workingHours: hours.nullable().optional() });

/** Developer-only routes for the bot's own status (the "Coding new features" switch and the master on/off). */
export function registerStatusApi(api: FastifyInstance) {
  api.register(async (dev) => {
    dev.addHook("preHandler", async (request, reply) => {
      if (!(await isDeveloper(request.session!.userId))) {
        return reply.code(403).send({ error: "Only the bot's developer can change its status." });
      }
    });

    dev.get("/api/developer/status", async () => statusView());

    dev.put("/api/developer/status", async (request, reply) => {
      const body = patch.safeParse(request.body);
      if (!body.success) return reply.code(400).send({ error: "Pick 1, 2, 4 or 8 hours." });
      return updateStatus(body.data);
    });
  });
}
