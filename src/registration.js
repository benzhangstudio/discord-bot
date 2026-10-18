import {REST,Routes} from 'discord.js';
import {commands} from './commands.js';

function shape(command) {
  return {name:command.name,description:command.description,type:command.type??1,required:Boolean(command.required),autocomplete:Boolean(command.autocomplete),min_value:command.min_value??null,max_value:command.max_value??null,min_length:command.min_length??null,max_length:command.max_length??null,channel_types:command.channel_types||[],default_member_permissions:command.default_member_permissions??null,choices:(command.choices||[]).map(choice=>({name:choice.name,value:choice.value})),options:(command.options||[]).map(shape)};
}
function matches(actual) {return JSON.stringify(actual.map(shape).sort((a,b)=>a.name.localeCompare(b.name)))===JSON.stringify(commands.map(shape).sort((a,b)=>a.name.localeCompare(b.name)));}
async function replaceAndVerify(rest,route,log) {
  const previous=await rest.get(route);
  if(!matches(previous)) {
    const retired=previous.filter(command=>!commands.some(current=>current.name===command.name)).map(command=>'/'+command.name);
    if(retired.length)log(`Removing retired commands: ${retired.join(', ')}`);
    await rest.put(route,{body:commands});
  }
  if(!matches(await rest.get(route)))throw Error('Discord’s command list did not match the current build after updating. Startup stopped; try starting again.');
}

export async function syncApplicationCommands({token,applicationId,testGuildId,rest=new REST({version:'10'}).setToken(token),log=console.log}) {
  const app=await rest.get('/applications/@me');
  if(app.id!==applicationId)throw Error('DISCORD_APPLICATION_ID does not match the application that owns DISCORD_TOKEN.');
  if(app.interactions_endpoint_url)throw Error('Clear Interactions Endpoint URL in Discord Developer Portal, save, then start again.');
  log(`Checking commands for ${app.name || 'Number One'} (application ${app.id}).`);
  await registerCommands(rest,app.id,testGuildId,log);
}

export async function registerCommands(rest,applicationId,testGuildId,log=console.log) {
  if(testGuildId) {
    await replaceAndVerify(rest,Routes.applicationGuildCommands(applicationId,testGuildId),log);
    log(`Verified ${commands.length} commands in the test server. Global commands are unchanged while DISCORD_TEST_GUILD_ID is set.`);
    return;
  }
  // Replace this application's command set; unrelated bots are never affected.
  await replaceAndVerify(rest,Routes.applicationCommands(applicationId),log);
  let after;let cleared=0;
  while(true) {
    const query=new URLSearchParams({limit:'200',...(after?{after}:{})});
    const guilds=await rest.get(Routes.userGuilds(),{query});
    for(const guild of guilds) {
      const route=Routes.applicationGuildCommands(applicationId,guild.id);
      const existing=await rest.get(route);
      if(existing.length) {
        log(`Removing server-specific commands in ${guild.id}: ${existing.map(command=>'/'+command.name).join(', ')}`);
        await rest.put(route,{body:[]});
        if((await rest.get(route)).length)throw Error(`Discord still has server-specific commands in server ${guild.id}. Startup stopped; try starting again.`);
        cleared++;log(`Removed and verified old server-specific commands in server ${guild.id}.`);
      }
    }
    if(guilds.length<200)break;
    after=guilds.at(-1).id;
  }
  log(`Verified ${commands.length} global commands: ${commands.map(command=>'/'+command.name).join(', ')}. Cleared server-specific commands in ${cleared} server(s).`);
}
