import {REST, Routes} from 'discord.js';
import {commands} from './commands.js';
if (!process.env.DISCORD_TOKEN || !process.env.DISCORD_APPLICATION_ID) throw Error('Fill DISCORD_TOKEN and DISCORD_APPLICATION_ID in .env first.');
const rest = new REST({version:'10'}).setToken(process.env.DISCORD_TOKEN);
const app = await rest.get('/applications/@me');
if (app.id !== process.env.DISCORD_APPLICATION_ID) throw Error('Application ID and bot token do not belong to the same application.');
if (app.interactions_endpoint_url) throw Error('Clear the Interactions Endpoint URL in the Discord Developer Portal before using this gateway bot.');
const route = process.env.DISCORD_TEST_GUILD_ID
  ? Routes.applicationGuildCommands(app.id, process.env.DISCORD_TEST_GUILD_ID)
  : Routes.applicationCommands(app.id);
for (const command of commands) await rest.post(route,{body:command});
console.log(`Registered ${commands.length} commands ${process.env.DISCORD_TEST_GUILD_ID ? 'in the test server' : 'globally'}. Other command names were preserved.`);
