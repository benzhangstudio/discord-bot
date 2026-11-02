import { ChannelType, Events, type Guild } from "discord.js";
import type { FastifyRequest } from "fastify";
import { client } from "../../server/bot/discord.js";
import type { BotFeature } from "../../server/bot/types.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import {
  type AnnouncementSettings,
  type AnnouncementTypeId,
  type AnnouncementsPanelData,
  announcementSettings,
} from "../../shared/announcements.js";
import { announcementsFeature } from "../../shared/features.js";
import { chosenChannel, runAnnouncement, sendTest } from "./deliver.js";
import * as store from "./store.js";

type GuildReq = FastifyRequest<{ Params: { guildId: string } }>;

const TEXT_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

/** Problems with the saved settings that an admin can fix, in plain language. */
function problemsFor(guild: Guild, s: AnnouncementSettings): string[] {
  const problems: string[] = [];
  if (s.channelId) {
    const target = chosenChannel(guild, s.channelId);
    if ("problem" in target) problems.push(target.problem);
  }
  if (s.roleId) {
    const role = guild.roles.cache.get(s.roleId);
    const me = guild.members.me;
    if (!role) problems.push("The role to ping was deleted. Pick another or remove it.");
    else if (!role.mentionable && !me?.permissions.has("MentionEveryone")) {
      problems.push(`I can't ping @${role.name}. Make the role mentionable or give me the Mention Everyone permission.`);
    }
  }
  return problems;
}

async function panelData(guild: Guild): Promise<AnnouncementsPanelData> {
  const state = await getFeatureState(guild.id, announcementsFeature);
  const settings = state.settings as AnnouncementSettings;
  const recent = await store.receivedBy(guild.id, 10);
  return {
    settings,
    warnings: problemsFor(guild, settings),
    recent: recent.map((r) => ({
      id: r.id,
      type: r.type as AnnouncementTypeId,
      title: r.title,
      body: r.body,
      url: r.url,
      createdAt: r.createdAt.getTime(),
      outcome: r.outcome as "channel" | "fallback",
    })),
  };
}

export const announcements: BotFeature = {
  info: announcementsFeature,

  // Announcements still being sent when the bot restarted pick up where they left off.
  setup(c) {
    c.once(Events.ClientReady, async () => {
      for (const row of await store.unfinishedAnnouncements().catch(() => [])) void runAnnouncement(row.id);
    });
  },

  registerApi(api) {
    const guildOf = (request: GuildReq) => client.guilds.cache.get(request.params.guildId)!;

    api.get("/api/guilds/:guildId/announcements", async (request: GuildReq) => panelData(guildOf(request)));

    api.put("/api/guilds/:guildId/announcements", async (request: GuildReq, reply) => {
      const guild = guildOf(request);
      const parsed = announcementSettings.safeParse(request.body);
      if (!parsed.success) return reply.code(400).send({ error: "Check the form and try again." });
      const settings = parsed.data;
      if (settings.channelId) {
        const channel = guild.channels.cache.get(settings.channelId);
        if (!channel || !TEXT_TYPES.has(channel.type)) return reply.code(400).send({ error: "That channel no longer exists. Pick another." });
      }
      if (settings.roleId && !guild.roles.cache.has(settings.roleId)) {
        return reply.code(400).send({ error: "That role no longer exists. Pick another." });
      }
      const state = await getFeatureState(guild.id, announcementsFeature);
      await saveFeatureState(guild.id, announcementsFeature, { enabled: state.enabled, settings }, request.session!.userId);
      return panelData(guild);
    });

    api.post("/api/guilds/:guildId/announcements/test", async (request: GuildReq, reply) => {
      const guild = guildOf(request);
      const state = await getFeatureState(guild.id, announcementsFeature);
      const problem = await sendTest(guild, state.settings as AnnouncementSettings);
      if (problem) return reply.code(400).send({ error: problem });
      return { ok: true };
    });
  },
};
