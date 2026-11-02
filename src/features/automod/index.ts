import { type Client, Events, type Guild, PermissionFlagsBits, type PermissionResolvable } from "discord.js";
import type { FastifyRequest } from "fastify";
import { canReadMessages, client } from "../../server/bot/discord.js";
import type { BotFeature } from "../../server/bot/types.js";
import { getFeatureState, saveFeatureState } from "../../server/settings.js";
import {
  type AutomodResponse,
  type AutomodSettings,
  automodSettings,
  botRules,
  discordRules,
  needsContent,
  ruleInfo,
  ruleKeys,
} from "../../shared/automod.js";
import { automodFeature } from "../../shared/features.js";
import { caughtCount, forgetState } from "./act.js";
import { editEvent, executionEvent, joinEvent, messageEvent } from "./events.js";
import { forgetGuild, sweepBursts, sweepRepeats } from "./filters.js";
import { activeRuleCount, cleanDomain, syncProblems, syncRules } from "./native.js";

type Req = FastifyRequest<{ Params: { guildId: string } }>;

class SettingsError extends Error {}

/** Missing permissions and setup problems, in plain words, for the dashboard. */
function setupProblems(guild: Guild, settings: AutomodSettings, enabled: boolean): string[] {
  const me = guild.members.me;
  if (!me || !enabled) return [];
  const problems: string[] = [];
  const on = ruleKeys.filter((k) => settings[k].enabled);
  const needs: [boolean, PermissionResolvable, string, string][] = [
    [on.some((k) => (discordRules as readonly string[]).includes(k)), PermissionFlagsBits.ManageGuild, "Manage Server", "create Discord AutoMod filters"],
    [on.some((k) => (botRules as readonly string[]).includes(k)), PermissionFlagsBits.ManageMessages, "Manage Messages", "delete messages my own filters catch"],
    [on.some((k) => settings[k].action === "warn" || settings[k].action === "timeout"), PermissionFlagsBits.ModerateMembers, "Timeout Members", "time members out"],
    [on.some((k) => settings[k].action === "kick"), PermissionFlagsBits.KickMembers, "Kick Members", "kick members"],
  ];
  for (const [needed, flag, name, what] of needs) {
    if (needed && !me.permissions.has(flag)) problems.push(`I need the ${name} permission to ${what}.`);
  }
  const paused = on.filter(needsContent);
  if (paused.length && !canReadMessages()) {
    problems.push(
      `${paused.map((k) => ruleInfo[k].name).join(", ")} ${paused.length === 1 ? "is" : "are"} paused: "Message Content Intent" is off. Turn it on in the Discord Developer Portal → Bot, then restart Number One.`,
    );
  }
  if (settings.alertChannelId) {
    const channel = guild.channels.cache.get(settings.alertChannelId);
    if (!channel?.isTextBased()) {
      problems.push("The alert channel no longer exists. Pick another one.");
    } else {
      const perms = channel.permissionsFor(me);
      const missing = (
        [
          [PermissionFlagsBits.ViewChannel, "View Channel"],
          [PermissionFlagsBits.SendMessages, "Send Messages"],
          [PermissionFlagsBits.EmbedLinks, "Embed Links"],
        ] as const
      )
        .filter(([flag]) => !perms?.has(flag))
        .map(([, name]) => name);
      if (missing.length) problems.push(`In #${channel.name} (alerts) I need: ${missing.join(", ")}.`);
    }
  }
  return [...problems, ...syncProblems(guild.id)];
}

/** Checks the settings make sense and tidies them before saving. Throws a SettingsError in plain words. */
function validate(guild: Guild, s: AutomodSettings) {
  if (s.alertChannelId) {
    const channel = guild.channels.cache.get(s.alertChannelId);
    if (!channel?.isTextBased() || channel.isThread()) throw new SettingsError("The alert channel no longer exists. Pick another one.");
  }
  const dedupe = (list: string[]) => [...new Set(list.map((w) => w.trim()).filter(Boolean))];
  s.words.blocked = dedupe(s.words.blocked.map((w) => w.toLowerCase()));
  s.words.allowed = dedupe(s.words.allowed.map((w) => w.toLowerCase()));
  s.links.allowedDomains = dedupe(s.links.allowedDomains.map(cleanDomain));
  for (const d of s.links.allowedDomains) {
    if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) throw new SettingsError(`"${d}" doesn't look like a website. Use something like youtube.com.`);
  }
  const w = s.words;
  if (w.enabled && !w.blocked.length && !w.profanity && !w.sexualContent && !w.slurs) {
    throw new SettingsError("Blocked words is on but has nothing to block. Add a word or turn on one of Discord's word lists.");
  }
  for (const word of w.blocked) {
    if (/^\*+$/.test(word)) throw new SettingsError(`"${word}" would block every message. Remove it.`);
  }
}

export async function respond(guild: Guild, settings: AutomodSettings, enabled: boolean): Promise<AutomodResponse> {
  return {
    settings,
    status: {
      discordRulesActive: activeRuleCount(guild),
      canReadMessages: canReadMessages(),
      caughtSinceRestart: caughtCount(guild.id),
      problems: setupProblems(guild, settings, enabled),
    },
  };
}

/** Brings every server's Discord rules in line with its settings (after a restart, or edits made while offline). */
async function syncAll(c: Client) {
  for (const guild of c.guilds.cache.values()) {
    const state = await getFeatureState(guild.id, automodFeature);
    await syncRules(guild, state.settings as AutomodSettings, state.enabled).catch((err) =>
      console.warn(`[automod] sync failed in ${guild.name} (${guild.id}):`, err),
    );
    await new Promise((r) => setTimeout(r, 250)); // go easy on Discord's rate limits
  }
  console.log(`[automod] checked AutoMod rules in ${c.guilds.cache.size} servers`);
}

export const automod: BotFeature = {
  info: automodFeature,
  events: [messageEvent, editEvent, executionEvent, joinEvent],

  setup(c) {
    c.once(Events.ClientReady, (ready) => void syncAll(ready));
    setInterval(() => {
      sweepRepeats();
      sweepBursts();
    }, 60_000).unref();
  },

  async onToggle(guildId, enabled) {
    forgetState(guildId);
    if (!enabled) forgetGuild(guildId);
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;
    const state = await getFeatureState(guildId, automodFeature);
    await syncRules(guild, state.settings as AutomodSettings, enabled);
  },

  async beforeDataDelete(guildId) {
    const guild = client.guilds.cache.get(guildId);
    if (guild) await syncRules(guild, automodSettings.parse({}), false);
  },

  registerApi(api) {
    api.get("/api/guilds/:guildId/automod", async (request: Req) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const state = await getFeatureState(guild.id, automodFeature);
      return respond(guild, state.settings as AutomodSettings, state.enabled);
    });

    api.put("/api/guilds/:guildId/automod", async (request: Req, reply) => {
      const guild = client.guilds.cache.get(request.params.guildId)!;
      const parsed = automodSettings.safeParse(request.body);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        return reply.code(400).send({ error: issue ? `${issue.path.join(" → ")}: ${issue.message}` : "Check the form and try again." });
      }
      try {
        validate(guild, parsed.data);
      } catch (err) {
        if (err instanceof SettingsError) return reply.code(400).send({ error: err.message });
        throw err;
      }
      const state = await getFeatureState(guild.id, automodFeature);
      await saveFeatureState(guild.id, automodFeature, { enabled: state.enabled, settings: parsed.data }, request.session!.userId);
      forgetState(guild.id);
      await syncRules(guild, parsed.data, state.enabled);
      return respond(guild, parsed.data, state.enabled);
    });
  },
};
