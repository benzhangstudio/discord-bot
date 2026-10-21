import {readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
for(const directory of ['src','scripts','tests','age-verification','age-verification/test','age-verification/public']) {
  const url=new URL(`../${directory}/`,import.meta.url);
  for(const file of readdirSync(url).filter(name=>/\.m?js$/.test(name))) {
    const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL(file,url))],{stdio:'inherit'});
    if(result.status!==0)process.exit(result.status || 1);
  }
}
console.log('All source, script, and test files pass syntax checks.');
