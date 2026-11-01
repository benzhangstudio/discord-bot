import { z } from "zod";

/**
 * Reaction roles: the settings shape shared by the bot and the dashboard.
 * Covers everything MEE6 / Carl-bot style role menus offer: reactions, buttons or a dropdown,
 * a text and/or embed message, selection modes, and who may use the menu.
 */

/** Most reaction-role messages one server can have. */
export const MAX_REACTION_ROLE_MESSAGES = 50;

/** How members pick their roles. */
export const reactionRoleKinds = [
  { id: "reactions", name: "Emoji reactions", description: "Members react with an emoji.", max: 20 },
  { id: "buttons", name: "Buttons", description: "A button for each role, with a label, emoji and colour.", max: 25 },
  { id: "dropdown", name: "Dropdown menu", description: "A menu listing every role. Tidy for long lists.", max: 25 },
] as const;
export type ReactionRoleKind = (typeof reactionRoleKinds)[number]["id"];

/** What picking a role does. `kinds` lists where each mode makes sense. */
export const reactionRoleModes = [
  {
    id: "normal",
    name: "Normal",
    description: "Pick to get a role, un-pick to lose it. Members can have several.",
    kinds: ["reactions", "buttons", "dropdown"],
  },
  {
    id: "unique",
    name: "One only",
    description: "Members can have just one role from this message. Picking another swaps it.",
    kinds: ["reactions", "buttons", "dropdown"],
  },
  {
    id: "verify",
    name: "Verify (add only)",
    description: "Picking gives the role. It isn't removed when un-picked. Great for accepting rules.",
    kinds: ["reactions", "buttons", "dropdown"],
  },
  {
    id: "drop",
    name: "Remove only",
    description: "Picking removes the role. Useful to let members leave a role on their own.",
    kinds: ["reactions", "buttons", "dropdown"],
  },
  {
    id: "reversed",
    name: "Reversed",
    description: "Reacting removes the role and un-reacting gives it back. For opt-out pings.",
    kinds: ["reactions"],
  },
  {
    id: "binding",
    name: "Permanent choice",
    description: "Members pick once and can't change it. Staff can still change roles by hand.",
    kinds: ["reactions", "buttons", "dropdown"],
  },
] as const;
export type ReactionRoleMode = (typeof reactionRoleModes)[number]["id"];

export const buttonStyles = [
  { id: "primary", name: "Blurple", color: "#5865f2" },
  { id: "secondary", name: "Grey", color: "#4e5058" },
  { id: "success", name: "Green", color: "#248046" },
  { id: "danger", name: "Red", color: "#da373c" },
] as const;
export type ButtonStyleId = (typeof buttonStyles)[number]["id"];

const snowflake = z.string().regex(/^\d{17,20}$/);
const imageUrl = z
  .string()
  .trim()
  .max(1000)
  .refine((v) => v === "" || /^https:\/\/\S+$/i.test(v), "Image links must start with https://")
  .default("");

export const reactionRoleEmbed = z.object({
  enabled: z.boolean().default(true),
  title: z.string().trim().max(256).default(""),
  description: z.string().max(4000).default(""),
  color: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i, "Pick a colour")
    .default("#ff4fa3"),
  image: imageUrl,
  thumbnail: imageUrl,
  footer: z.string().max(2048).default(""),
  /** Add an "emoji  @Role" line for each role under the description. */
  listRoles: z.boolean().default(true),
});

export const reactionRoleEntryInput = z.object({
  /** Required for reactions; optional on buttons and dropdown options. */
  emoji: z.string().trim().max(100).default(""),
  roleId: snowflake.or(z.literal("")).refine((v) => v !== "", "Pick a role for every row"),
  /** Button text / dropdown option name. Defaults to the role's name. */
  label: z.string().trim().max(80).default(""),
  /** Small grey text under a dropdown option. */
  description: z.string().trim().max(100).default(""),
  style: z.enum(["primary", "secondary", "success", "danger"]).default("secondary"),
});

/** What the dashboard sends to create or update a reaction-role message. */
export const reactionRoleInput = z
  .object({
    /** Internal name shown only in the dashboard. */
    name: z.string().trim().max(100).default(""),
    channelId: snowflake,
    kind: z.enum(["reactions", "buttons", "dropdown"]).default("reactions"),
    mode: z.enum(["normal", "unique", "verify", "drop", "reversed", "binding"]).default("normal"),
    /** Plain text above the embed. */
    content: z.string().max(2000).default(""),
    embed: reactionRoleEmbed.prefault({}),
    /** Dropdown placeholder text. */
    placeholder: z.string().trim().max(150).default(""),
    /** Most roles a member can hold from this message (0 = no limit). Normal mode only. */
    maxRoles: z.number().int().min(0).max(25).default(0),
    /** Members need at least one of these roles to use the message (empty = everyone). */
    allowedRoles: z.array(snowflake).max(25).default([]),
    /** Members with any of these roles can't use the message. */
    ignoredRoles: z.array(snowflake).max(25).default([]),
    /** Reactions only: take the member's reaction away after using it, so reacting again toggles the role. */
    removeReaction: z.boolean().default(false),
    /** Buttons and dropdown: tell members privately what changed. */
    confirm: z.boolean().default(true),
    entries: z.array(reactionRoleEntryInput).min(1, "Add at least one role"),
  })
  .superRefine((v, ctx) => {
    const kind = reactionRoleKinds.find((k) => k.id === v.kind)!;
    const mode = reactionRoleModes.find((m) => m.id === v.mode)!;
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    if (v.entries.length > kind.max) fail(`${kind.name} can have at most ${kind.max} roles.`);
    if (!(mode.kinds as readonly string[]).includes(v.kind)) fail(`“${mode.name}” mode only works with ${mode.kinds.join(" and ")}.`);
    if (v.kind === "reactions" && v.entries.some((e) => !e.emoji)) fail("Every reaction needs an emoji.");
    const embedHasText = v.embed.enabled && (v.embed.title || v.embed.description.trim() || v.embed.listRoles || v.embed.image);
    if (!v.content.trim() && !embedHasText) fail("Write a message, or turn on the embed.");
  });
export type ReactionRoleInput = z.infer<typeof reactionRoleInput>;
export type ReactionRoleOptions = Omit<ReactionRoleInput, "channelId" | "kind" | "mode" | "content" | "entries" | "name">;

/** Saved per-message options (stored as JSON). Parsing fills in defaults for older rows. */
export const reactionRoleOptions = z.object({
  embed: reactionRoleEmbed.prefault({}),
  placeholder: z.string().default(""),
  maxRoles: z.number().int().default(0),
  allowedRoles: z.array(z.string()).default([]),
  ignoredRoles: z.array(z.string()).default([]),
  removeReaction: z.boolean().default(false),
  confirm: z.boolean().default(true),
});

/** A reaction-role message as the dashboard shows it. */
export interface ReactionRoleMessageView {
  messageId: string;
  channelId: string;
  name: string;
  kind: ReactionRoleKind;
  mode: ReactionRoleMode;
  content: string;
  options: z.infer<typeof reactionRoleOptions>;
  url: string;
  /** Things stopping this message from working right now, in plain words (empty when all is well). */
  problems: string[];
  entries: {
    emojiKey: string;
    emojiDisplay: string;
    emojiUrl: string | null;
    roleId: string;
    label: string;
    description: string;
    style: ButtonStyleId;
  }[];
}
