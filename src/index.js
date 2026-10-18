import {Client,GatewayIntentBits} from 'discord.js';
import {Store} from './store.js';
import {createApp} from './app.js';
if(!process.env.DISCORD_TOKEN)throw Error('Create .env from .env.example and fill in DISCORD_TOKEN.');
const store=new Store();
const client=new Client({intents:[GatewayIntentBits.Guilds]});
const app=createApp(client,store);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{app.stop();client.destroy();store.close();process.exit(0);});
try {await client.login(process.env.DISCORD_TOKEN);} catch {console.error('Could not connect Number One. Check DISCORD_TOKEN and network access.');store.close();process.exitCode=1;client.destroy();}
