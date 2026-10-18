import {syncApplicationCommands} from './registration.js';
import {loadConfig,requireConfig} from './config.js';
loadConfig();
requireConfig(['DISCORD_TOKEN','DISCORD_APPLICATION_ID']);
await syncApplicationCommands({token:process.env.DISCORD_TOKEN,applicationId:process.env.DISCORD_APPLICATION_ID,testGuildId:process.env.DISCORD_TEST_GUILD_ID});
