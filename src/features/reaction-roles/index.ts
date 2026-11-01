import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import type { BotFeature } from "../../server/bot/types.js";
import { isFeatureEnabled } from "../../server/settings.js";
import { type ReactionRoleMessageView, reactionRoleInput, reactionRolesFeature } from "../../shared/features.js";
import { emojiImageUrl } from "./emoji.js";
import { reactionRoleEvents } from "./events.js";
import { SetupError, createFromDashboard, updateFromDashboard } from "./manage.js";
import { configProblems, fetchConfigMessage, messageUrl } from "./message.js";
import * as store from "./store.js";

type Req = FastifyRequest<{ Params: { guildId: string; messageId?: string } }>;

function toView(c: store.ReactionRoleConfig): ReactionRoleMessageView {
  const guild = client.guilds.cache.get(c.guildId);
  return {
    problems: guild ? configProblems(guild, c) : [],
    messageId: c.messageId,
    channelId: c.channelId,
    title: c.title,
    description: c.description,
    singleChoice: c.singleChoice,
    url: messageUrl(c),
    entries: c.entries.map((e) => ({
      emojiKey: e.emojiKey,
      emojiDisplay: e.emojiDisplay,
      emojiUrl: emojiImageUrl(e.emojiDisplay),
      roleId: e.roleId,
    })),
  };
}

/** Shared handling for create and update: validates input and turns admin-fixable problems into clear messages. */
async function save(request: Req, reply: FastifyReply, run: (input: ReturnType<typeof reactionRoleInput.parse>) => Promise<{ messageId: string; warnings: string[] }>) {
  if (!(await isFeatureEnabled(request.params.guildId, reactionRolesFeature))) {
    return reply.code(400).send({ error: "Turn on Reaction roles first." });
  }
  const parsed = reactionRoleInput.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? "Check the form and try again." });
  try {
    const { messageId, warnings } = await run(parsed.data);
    return { message: toView((await store.getConfig(messageId))!), warnings };
  } catch (err) {
    if (err instanceof SetupError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

export const reactionRoles: BotFeature = {
  info: reactionRolesFeature,
  events: reactionRoleEvents,

  // Reaction roles are managed only from the dashboard, to keep the slash command list short.
  registerApi(api) {
    api.get("/api/guilds/:guildId/reaction-roles", async (request: Req) =>
      (await store.listConfigs(request.params.guildId)).map(toView),
    );

    api.post("/api/guilds/:guildId/reaction-roles", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      return save(request, reply, (input) => createFromDashboard(client, guild, request.session!.userId, input));
    });

    api.put("/api/guilds/:guildId/reaction-roles/:messageId", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      return save(request, reply, (input) =>
        updateFromDashboard(client, guild, request.session!.userId, request.params.messageId!, input),
      );
    });

    api.delete("/api/guilds/:guildId/reaction-roles/:messageId", async (request: Req, reply) => {
      const config = await store.getConfig(request.params.messageId!);
      if (!config || config.guildId !== request.params.guildId) return reply.code(404).send({ error: "Not found" });
      await store.deleteMessage(config.messageId);
      const message = await fetchConfigMessage(client, config).catch(() => null);
      await message?.delete().catch(() => {});
      return { ok: true };
    });
  },
};
