import {Routes} from 'discord.js';
import {commands} from './commands.js';

export async function registerCommands(rest,applicationId,testGuildId,log=console.log) {
  if(testGuildId) {
    await rest.put(Routes.applicationGuildCommands(applicationId,testGuildId),{body:commands});
    log(`Registered ${commands.length} commands in the test server. Old commands in that server were removed.`);
    return;
  }
  // Replace this application's command set; unrelated bots are never affected.
  await rest.put(Routes.applicationCommands(applicationId),{body:commands});
  let after;let cleared=0;
  while(true) {
    const query=new URLSearchParams({limit:'200',...(after?{after}:{})});
    const guilds=await rest.get(Routes.userGuilds(),{query});
    for(const guild of guilds) {
      const route=Routes.applicationGuildCommands(applicationId,guild.id);
      const existing=await rest.get(route);
      if(existing.length) {await rest.put(route,{body:[]});cleared++;log(`Removed old server-specific commands in server ${guild.id}.`);}
    }
    if(guilds.length<200)break;
    after=guilds.at(-1).id;
  }
  log(`Registered ${commands.length} commands globally. Old commands were removed; cleared server-specific commands in ${cleared} server(s).`);
}
