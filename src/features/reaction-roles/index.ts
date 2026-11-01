import type { FastifyRequest } from "fastify";
import type { BotFeature } from "../../server/bot/types.js";
import { client } from "../../server/bot/client.js";
import { type ReactionRoleMessageView, reactionRolesFeature } from "../../shared/features.js";
import { reactionRolesCommand } from "./commands.js";
import { emojiImageUrl } from "./emoji.js";
import { reactionRoleEvents } from "./events.js";
import { fetchConfigMessage, messageUrl } from "./message.js";
import * as store from "./store.js";

type GuildParams = FastifyRequest<{ Params: { guildId: string; messageId?: string } }>;

export const reactionRoles: BotFeature = {
  info: reactionRolesFeature,
  commands: [reactionRolesCommand],
  events: reactionRoleEvents,

  registerApi(api) {
    api.get("/api/guilds/:guildId/reaction-roles", async (request: GuildParams): Promise<ReactionRoleMessageView[]> => {
      const configs = await store.listConfigs(request.params.guildId);
      return configs.map((c) => ({
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
      }));
    });

    api.delete("/api/guilds/:guildId/reaction-roles/:messageId", async (request: GuildParams, reply) => {
      const config = await store.getConfig(request.params.messageId!);
      if (!config || config.guildId !== request.params.guildId) return reply.code(404).send({ error: "Not found" });
      await store.deleteMessage(config.messageId);
      const message = await fetchConfigMessage(client, config).catch(() => null);
      await message?.delete().catch(() => {});
      return { ok: true };
    });
  },
};
