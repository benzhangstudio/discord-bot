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

/** Why an announcement did or didn't reach a server. */
export type DeliveryOutcome =
  | "channel" // posted in the server's chosen channel
  | "fallback" // no channel set: posted in the system channel or sent to the owner
  | "skipped-off" // the server turned announcements off
  | "skipped-type" // the server turned this kind off
  | "skipped-nochannel" // no channel set and the kind isn't urgent
  | "failed"; // couldn't post (channel deleted, missing permissions...)

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
