/** Bug reports that server admins send with /report. Shared by the bot and the Developer page. */

export const MAX_SUMMARY = 100;
export const MAX_DETAILS = 1500;

export interface BugReportView {
  id: number;
  guildId: string;
  guildName: string;
  memberCount: number;
  userId: string;
  username: string;
  summary: string;
  details: string;
  resolved: boolean;
  createdAt: number;
}
