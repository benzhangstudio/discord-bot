import { desc, eq, sql } from "drizzle-orm";
import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { client } from "../../server/bot/discord.js";
import type { ModalHandler, SlashCommand } from "../../server/bot/types.js";
import { db } from "../../server/db/client.js";
import { bugReports } from "../../server/db/schema.js";
import { MAX_DETAILS, MAX_SUMMARY, type BugReportView } from "../../shared/reports.js";
import { isDeveloper } from "../announcements/developer.js";

const MODAL_ID = "report:bug";
const COOLDOWN_MS = 60_000; // one report per person per minute, so it can't be used to flood the developer
const lastReport = new Map<string, number>();

/** /report opens a short form. Anyone who manages the server can send one. */
export const reportCommand: SlashCommand = {
  data: new SlashCommandBuilder()
    .setName("report")
    .setDescription("Report a bug or error to Number One's developer.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(0),
  async execute(interaction) {
    const modal = new ModalBuilder()
      .setCustomId(MODAL_ID)
      .setTitle("Report a bug")
      .addComponents(
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("summary")
            .setLabel("What went wrong?")
            .setPlaceholder("e.g. My reaction role menu stopped giving roles")
            .setStyle(TextInputStyle.Short)
            .setRequired(true)
            .setMaxLength(MAX_SUMMARY),
        ),
        new ActionRowBuilder<TextInputBuilder>().addComponents(
          new TextInputBuilder()
            .setCustomId("details")
            .setLabel("What were you doing? Any error message?")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setMaxLength(MAX_DETAILS),
        ),
      );
    await interaction.showModal(modal);
  },
};

export const reportModal: ModalHandler = {
  prefix: "report",
  async handle(interaction) {
    if (!interaction.inGuild()) return;
    const wait = (lastReport.get(interaction.user.id) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) {
      return interaction.reply({
        content: `Please wait ${Math.ceil(wait / 1000)} seconds before sending another report.`,
        flags: MessageFlags.Ephemeral,
      });
    }
    const summary = interaction.fields.getTextInputValue("summary").trim();
    const details = interaction.fields.getTextInputValue("details").trim();
    if (!summary) return interaction.reply({ content: "Please say what went wrong.", flags: MessageFlags.Ephemeral });

    lastReport.set(interaction.user.id, Date.now());
    const guild = interaction.guild;
    const row = await db
      .insert(bugReports)
      .values({
        guildId: interaction.guildId,
        guildName: guild?.name ?? "Unknown server",
        memberCount: guild?.memberCount ?? 0,
        userId: interaction.user.id,
        username: interaction.user.username,
        summary,
        details,
        createdAt: new Date(),
      })
      .returning({ id: bugReports.id })
      .get();
    // Private: it's the reporter's own confirmation, not something staff need to see.
    await interaction.reply({
      content: `✅ Thanks! Your report (#${row.id}) was sent to Number One's developer.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};

const toView = (r: typeof bugReports.$inferSelect): BugReportView => ({
  id: r.id,
  guildId: r.guildId,
  guildName: client.guilds.cache.get(r.guildId)?.name ?? r.guildName,
  memberCount: r.memberCount,
  userId: r.userId,
  username: r.username,
  summary: r.summary,
  details: r.details,
  resolved: r.resolved,
  createdAt: r.createdAt.getTime(),
});

/** Developer-only routes: read bug reports and mark them resolved. */
export function registerReportsApi(api: FastifyInstance) {
  api.register(async (dev) => {
    dev.addHook("preHandler", async (request, reply) => {
      if (!(await isDeveloper(request.session!.userId))) {
        return reply.code(403).send({ error: "Only the bot's developer can see bug reports." });
      }
    });

    dev.get("/api/developer/reports", async () => {
      const rows = await db.select().from(bugReports).orderBy(bugReports.resolved, desc(bugReports.id)).limit(100).all();
      const open = await db.select({ n: sql<number>`count(*)` }).from(bugReports).where(eq(bugReports.resolved, false)).get();
      return { reports: rows.map(toView), open: Number(open?.n ?? 0) };
    });

    dev.post<{ Params: { id: string } }>("/api/developer/reports/:id/resolved", async (request: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const body = z.object({ resolved: z.boolean() }).safeParse(request.body);
      const id = Number(request.params.id);
      if (!body.success || !Number.isInteger(id)) return reply.code(400).send({ error: "Invalid request" });
      const row = await db.update(bugReports).set({ resolved: body.data.resolved }).where(eq(bugReports.id, id)).returning().get();
      if (!row) return reply.code(404).send({ error: "Not found" });
      return toView(row);
    });
  });
}
