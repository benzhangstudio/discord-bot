import {Client,GatewayIntentBits} from 'discord.js';
import {Store} from './store.js';
import {createApp} from './app.js';
import {loadConfig,requireConfig} from './config.js';
import {syncApplicationCommands} from './registration.js';
import {safeError} from './responses.js';
loadConfig();
requireConfig(['DISCORD_TOKEN','DISCORD_APPLICATION_ID']);
const store=new Store();
const client=new Client({intents:[GatewayIntentBits.Guilds]});
const app=createApp(client,store);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.stop();client.destroy();store.close();process.exit(0);});
try {
  await syncApplicationCommands({token:process.env.DISCORD_TOKEN,applicationId:process.env.DISCORD_APPLICATION_ID,testGuildId:process.env.DISCORD_TEST_GUILD_ID});
  await client.login(process.env.DISCORD_TOKEN);
} catch(error) {console.error(`Number One could not start: ${safeError(error)}`);store.close();process.exitCode=1;client.destroy();}
