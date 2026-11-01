import type { GuildMember } from "discord.js";
import { roleProblem } from "../../server/bot/roles.js";
import type { OnboardingSettings } from "../../shared/onboarding.js";
import type { Progress } from "./store.js";

const log = (...args: unknown[]) => console.warn("[onboarding]", ...args);

/** Roles the bot is able to give or take right now (others are skipped and logged). */
export function manageable(member: GuildMember, roleIds: Iterable<string>) {
  const ok: string[] = [];
  for (const id of new Set(roleIds)) {
    const problem = roleProblem(member.guild, id);
    if (problem) log(`skipping role ${id} in ${member.guild.name} (${member.guild.id}): ${problem}`);
    else ok.push(id);
  }
  return ok;
}

export async function addRoles(member: GuildMember, roleIds: string[], reason: string) {
  const toAdd = manageable(member, roleIds).filter((id) => !member.roles.cache.has(id));
  if (toAdd.length) await member.roles.add(toAdd, reason).catch((err) => log("couldn't add roles:", err.message ?? err));
}

/** Every role any onboarding answer can give. */
export function allAnswerRoles(settings: OnboardingSettings) {
  return new Set(settings.flow.questions.flatMap((q) => q.options.flatMap((o) => o.roleIds)));
}

/** The roles a member's answers earn. */
export function rolesFromAnswers(settings: OnboardingSettings, answers: Progress["answers"]) {
  const roles = new Set<string>();
  for (const q of settings.flow.questions) {
    for (const optionId of answers[q.id] ?? []) {
      for (const roleId of q.options.find((o) => o.id === optionId)?.roleIds ?? []) roles.add(roleId);
    }
  }
  return roles;
}

/**
 * Applies the end result of onboarding in a single update: gives the roles the answers earn,
 * removes answer roles no longer chosen, and removes the temporary "new member" role.
 */
export async function applyFinalRoles(member: GuildMember, settings: OnboardingSettings, answers: Progress["answers"]) {
  const chosen = rolesFromAnswers(settings, answers);
  const removable = allAnswerRoles(settings);
  if (settings.gate.roleId) removable.add(settings.gate.roleId);

  const current = new Set(member.roles.cache.keys());
  current.delete(member.guild.id); // @everyone isn't a real role assignment
  const toRemove = manageable(member, [...removable].filter((id) => current.has(id) && !chosen.has(id)));
  const toAdd = manageable(member, [...chosen].filter((id) => !current.has(id)));
  if (!toRemove.length && !toAdd.length) return;

  const next = [...current].filter((id) => !toRemove.includes(id)).concat(toAdd);
  await member.roles.set(next, "Onboarding finished");
}
