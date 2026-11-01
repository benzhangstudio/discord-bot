import { type GuildMember, MessageFlags, type MessageComponentInteraction } from "discord.js";
import type { ComponentHandler } from "../../server/bot/types.js";
import { isFeatureEnabled } from "../../server/settings.js";
import { reactionRolesFeature } from "../../shared/features.js";
import { type Outcome, describeOutcome, inOrder, pickFromMenu, toggle } from "./apply.js";
import { BUTTON_ID, MENU_ID } from "./message.js";
import * as store from "./store.js";

/** Private reply to the member who clicked. Role mentions are shown but never ping. */
async function answer(interaction: MessageComponentInteraction, text: string) {
  await interaction.editReply({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
}

/** Buttons and the dropdown on reaction-role messages. */
export const reactionRoleComponents: ComponentHandler = {
  prefix: "rr",
  async handle(interaction) {
    if (!interaction.inCachedGuild()) return;
    const config = await store.getConfig(interaction.message.id);
    // Same-server check, and only for the kind of message this setup is now.
    if (!config || config.guildId !== interaction.guildId || config.kind === "reactions") {
      return interaction.reply({ content: "This role menu isn't set up anymore.", flags: MessageFlags.Ephemeral });
    }
    if (!(await isFeatureEnabled(config.guildId, reactionRolesFeature))) {
      return interaction.reply({ content: "Role menus are turned off in this server right now.", flags: MessageFlags.Ephemeral });
    }

    // Answer within Discord's 3-second limit, then work. The reply is private either way.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = interaction.member as GuildMember;

    const outcome: Outcome | null = await inOrder(interaction.guildId, member.id, async () => {
      if (interaction.isButton() && interaction.customId.startsWith(BUTTON_ID)) {
        const entry = config.entries.find((e) => e.roleId === interaction.customId.slice(BUTTON_ID.length));
        return entry ? toggle(member, config, entry) : null;
      }
      if (interaction.isStringSelectMenu() && interaction.customId === MENU_ID) {
        return pickFromMenu(member, config, interaction.values);
      }
      return null;
    });

    if (!outcome) return answer(interaction, "That option isn't available anymore.");
    if (!config.options.confirm && !outcome.denied) return interaction.deleteReply().catch(() => {});
    return answer(interaction, describeOutcome(outcome, "Nothing to change: your roles already match."));
  },
};
