import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';

export function loadConfig(env=process.env,file=new URL('../.env',import.meta.url)) {
  let source;
  try {source=readFileSync(file,'utf8');} catch(error) {
    if(error.code==='ENOENT')return env;
    throw Error('Could not read the private server .env file. Check its file permissions.');
  }
  const values=parseEnv(source);
  // Hosting environment values take priority over the private file.
  for(const [key,value] of Object.entries(values))if(!env[key]?.trim())env[key]=value;
  for(const key of ['DISCORD_TOKEN','DISCORD_APPLICATION_ID','DISCORD_TEST_GUILD_ID'])if(env[key])env[key]=env[key].trim();
  return env;
}
export function requireConfig(keys,env=process.env) {
  const missing=keys.filter(key=>!env[key]?.trim());
  if(missing.length)throw Error(`Missing settings: ${missing.join(', ')}. Save them in Wispbyte Environment using the root .env file, or supply real environment variables. Values are never printed.`);
}
