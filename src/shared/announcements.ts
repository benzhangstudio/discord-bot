import { z } from "zod";

/**
 * Announcements from the bot's developer to every server (updates, maintenance, security notices...).
 * Shared by the bot and the dashboard. Each server picks one channel and which kinds it wants.
 */

export const announcementTypes = [
  { id: "update", name: "Updates", emoji: "🆕", description: "New features and changes", optional: true },
  { id: "maintenance", name: "Maintenance", emoji: "🛠️", description: "Planned downtime and restarts", optional: true },
  { id: "status", name: "Online / offline", emoji: "📡", description: "Number One is down, or back online", optional: true },
  { id: "news", name: "News", emoji: "📣", description: "Anything else worth knowing", optional: true },
  { id: "security", name: "Security", emoji: "🔒", description: "Security issues. Always delivered", optional: false },
] as const;

export type AnnouncementTypeId = (typeof announcementTypes)[number]["id"];
export const announcementTypeIds = announcementTypes.map((t) => t.id) as [AnnouncementTypeId, ...AnnouncementTypeId[]];

/** Types that ping the server's chosen role. Updates and news never ping. */
export const PINGING_TYPES: AnnouncementTypeId[] = ["security", "maintenance", "status"];

const snowflake = z.string().regex(/^\d{17,20}$/);

/** A server's announcement settings. Every field has a safe default. */
export const announcementSettings = z.object({
  /** Where announcements are posted. Empty = only urgent ones, in the server's system channel. */
  channelId: snowflake.nullable().default(null),
  /** Pinged for security, maintenance and online/offline notices. */
  roleId: snowflake.nullable().default(null),
  update: z.boolean().default(true),
  maintenance: z.boolean().default(true),
  status: z.boolean().default(true),
  news: z.boolean().default(true),
});

export type AnnouncementSettings = z.infer<typeof announcementSettings>;

export const MAX_TITLE = 100;
export const MAX_BODY = 3500;

/** What the developer fills in to publish an announcement. */
export const announcementInput = z.object({
  type: z.enum(announcementTypeIds),
  title: z.string().trim().min(1, "Add a title").max(MAX_TITLE, `Keep the title under ${MAX_TITLE} characters`),
  body: z.string().trim().min(1, "Write the message").max(MAX_BODY, `Keep the message under ${MAX_BODY} characters`),
  /** Optional "Learn more" link. */
  url: z
    .string()
    .trim()
    .max(300)
    .default("")
    .refine((v) => v === "" || /^https:\/\/[^\s]+$/.test(v), "The link must start with https://"),
});

export type AnnouncementInput = z.infer<typeof announcementInput>;

/** Why an announcement did or didn't reach a server. */
export type DeliveryOutcome =
  | "channel" // posted in the server's chosen channel
  | "fallback" // no channel set: posted in the system channel or sent to the owner
  | "skipped-off" // the server turned announcements off
  | "skipped-type" // the server turned this kind off
  | "skipped-nochannel" // no channel set and the kind isn't urgent
  | "failed"; // couldn't post (channel deleted, missing permissions...)

export interface AnnouncementSummary {
  id: number;
  type: AnnouncementTypeId;
  title: string;
  body: string;
  url: string;
  createdAt: number;
  status: "sending" | "done";
  /** Counts per outcome. */
  counts: Record<DeliveryOutcome, number>;
  /** Servers the bot is in right now. */
  servers: number;
}

export interface AnnouncementFailure {
  guildId: string;
  guildName: string;
  reason: string;
}

/** What the developer sees before sending: how many servers each outcome would apply to. */
export interface AudiencePreview {
  servers: number;
  counts: Record<DeliveryOutcome, number>;
}

/** A past announcement as a server's admins see it. */
export interface ReceivedAnnouncement {
  id: number;
  type: AnnouncementTypeId;
  title: string;
  body: string;
  url: string;
  createdAt: number;
  outcome: DeliveryOutcome;
}

export interface AnnouncementsPanelData {
  settings: AnnouncementSettings;
  recent: ReceivedAnnouncement[];
  warnings: string[];
}
