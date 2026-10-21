import {Client,GatewayIntentBits} from 'discord.js';
import {Store} from './store.js';
import {createApp} from './app.js';
import {loadConfig,requireConfig} from './config.js';
import {syncApplicationCommands} from './registration.js';
import {safeError} from './responses.js';
import {startHostedDashboard} from './dashboard.js';
loadConfig();
requireConfig(['DISCORD_TOKEN','DISCORD_APPLICATION_ID']);
const store=new Store();
const client=new Client({intents:[GatewayIntentBits.Guilds]});
const app=createApp(client,store);
let dashboard;
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{app.stop();client.destroy();await dashboard?.stop();store.close();process.exit(0);});
try {
  try {dashboard=await startHostedDashboard();}
  catch(error) {console.error(`Dashboard could not start: ${error.code === 'EADDRINUSE'?'Web port already in use.':error.status ? error.message : 'Check AGE_MODE, AGE_ORIGIN, AGE_PORT and private storage permissions.'} The Discord bot will continue; correct the web settings and restart.`);}
  await syncApplicationCommands({token:process.env.DISCORD_TOKEN,applicationId:process.env.DISCORD_APPLICATION_ID,testGuildId:process.env.DISCORD_TEST_GUILD_ID});
  await client.login(process.env.DISCORD_TOKEN);
} catch(error) {console.error(`Number One could not start: ${safeError(error)}`);await dashboard?.stop();store.close();process.exitCode=1;client.destroy();}
