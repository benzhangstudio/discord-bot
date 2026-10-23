// Prints every command, subcommand, option and choice description for copy review.
import {commands} from '../src/commands.js';
const walk=(path,o,depth)=>{
  console.log(`${'  '.repeat(depth)}${path}: ${o.description??''}`);
  for(const c of o.choices||[])console.log(`${'  '.repeat(depth+1)}choice ${c.name} = ${c.value}`);
  for(const x of o.options||[])walk(x.name,x,depth+1);
};
for(const c of commands)walk('/'+c.name,c,0);
