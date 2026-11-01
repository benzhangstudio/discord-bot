import type { FastifyReply, FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import type { BotFeature } from "../../server/bot/types.js";
import { isFeatureEnabled } from "../../server/settings.js";
import { type ButtonStyleId, type ReactionRoleMessageView, reactionRoleInput, reactionRolesFeature } from "../../shared/features.js";
import { reactionRoleComponents } from "./components.js";
import { startRoleTimers } from "./timers.js";
import { emojiImageUrl } from "./emoji.js";
import { reactionRoleEvents } from "./events.js";
import { SetupError, createFromDashboard, deleteMenu, updateFromDashboard } from "./manage.js";
import { configProblems, messageUrl } from "./message.js";
import * as store from "./store.js";

type Req = FastifyRequest<{ Params: { guildId: string; messageId?: string } }>;

type Stats = ReactionRoleMessageView["stats"];

/** Usage numbers for each menu, keyed by message ID. */
async function statsByMenu(configs: store.ReactionRoleConfig[]): Promise<Map<string, Stats>> {
  const ids = configs.map((c) => c.messageId);
  const [rows, timers] = await Promise.all([store.statsFor(ids), store.activeTimerCounts(ids)]);
  const out = new Map<string, Stats>();
  for (const id of ids) out.set(id, { picks: 0, removals: 0, lastUsedAt: null, roles: {}, activeTemporary: timers.get(id) ?? 0 });
  for (const r of rows) {
    const s = out.get(r.messageId)!;
    s.picks += r.added;
    s.removals += r.removed;
    s.roles[r.roleId] = { added: r.added, removed: r.removed };
    const at = r.lastUsedAt?.getTime() ?? null;
    if (at && (!s.lastUsedAt || at > s.lastUsedAt)) s.lastUsedAt = at;
  }
  return out;
}

async function toViews(configs: store.ReactionRoleConfig[]) {
  const stats = await statsByMenu(configs);
  return configs.map((c) => toView(c, stats.get(c.messageId)!));
}

function toView(c: store.ReactionRoleConfig, stats: Stats): ReactionRoleMessageView {
  const guild = client.guilds.cache.get(c.guildId);
  return {
    external: c.external,
    stats,
    messageId: c.messageId,
    channelId: c.channelId,
    name: c.name,
    kind: c.kind,
    mode: c.mode,
    content: c.content,
    // The embed's title and description live in their own columns; put them back together here.
    options: { ...c.options, embed: { ...c.options.embed, title: c.title, description: c.description } },
    url: messageUrl(c),
    problems: guild ? configProblems(guild, c) : [],
    entries: c.entries.map((e) => ({
      emojiKey: e.emojiKey,
      emojiDisplay: e.emojiDisplay,
      emojiUrl: e.emojiDisplay ? emojiImageUrl(e.emojiDisplay) : null,
      roleId: e.roleId,
      label: e.label,
      description: e.description,
      style: (["primary", "secondary", "success", "danger"].includes(e.style) ? e.style : "secondary") as ButtonStyleId,
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
    const [message] = await toViews([(await store.getConfig(messageId))!]);
    return { message, warnings };
  } catch (err) {
    if (err instanceof SetupError) return reply.code(400).send({ error: err.message });
    throw err;
  }
}

export const reactionRoles: BotFeature = {
  info: reactionRolesFeature,
  events: reactionRoleEvents,
  components: [reactionRoleComponents],
  setup: startRoleTimers,

  // Reaction roles are managed only from the dashboard, to keep the slash command list short.
  registerApi(api) {
    api.get("/api/guilds/:guildId/reaction-roles", async (request: Req) =>
      toViews(await store.listConfigs(request.params.guildId)),
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
      await deleteMenu(client, config);
      return { ok: true };
    });
  },
};
