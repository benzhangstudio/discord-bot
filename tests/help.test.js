import test from 'node:test';
import assert from 'node:assert/strict';
import {ButtonBuilder} from 'discord.js';
import {helpMenu,manualMessages} from '../src/help.js';
import {commands} from '../src/commands.js';
const size=embed=>[embed.title,embed.description,embed.footer?.text,...(embed.fields||[]).flatMap(f=>[f.name,f.value])].join('').length;
test('quick help lists every command with required inputs, short summaries, and one manual button',()=>{
  const p=helpMenu(),e=p.embeds[0].toJSON(),text=e.fields.map(f=>f.value).join(' ');
  const button=ButtonBuilder.from(p.components[0].components[0]).toJSON();
  assert.equal(button.type,2);assert.equal(button.custom_id,'help:manual');assert.equal(button.label,'DM full manual');assert.equal(p.components.length,1);
  assert.ok(size(e)<3600,'Quick help must stay concise');assert.ok(e.fields.every(f=>f.value.length<=1024));
  for(const c of commands)for(const sub of c.options||[null]) {
    const usage='/'+c.name+(sub?' '+sub.name:'');assert.ok(text.includes(usage),usage);
    for(const option of sub?.options||[])if(option.required)assert.ok(text.includes(usage+' ')&&text.includes(option.name));
  }
  assert.doesNotMatch(text,/personality|little help|make it yours|come back later|\\n|\\u0060/i);
  assert.ok(text.includes('/embed send message channel'));assert.ok(text.includes('/schedule add title start channel'));
});
test('the requested manual contains the complete reference, instructions, permissions and bot limits within message limits',()=>{
  const pages=manualMessages({timezone:'Asia/Seoul'});assert.equal(pages.length,3);
  const all=JSON.stringify(pages);
  for(const payload of pages){const embeds=payload.embeds.map(e=>e.toJSON());assert.ok(embeds.reduce((n,e)=>n+size(e),0)<=6000);for(const e of embeds)assert.ok(e.fields.every(f=>f.name.length<=256&&f.value.length<=1024));assert.deepEqual(payload.allowedMentions,{parse:[]});}
  for(const term of ['Asia/Seoul','RSS/Atom','30 minutes','Save & close','server owner','/access add','/access remove','separate for each server','No unsolicited DM fallback'])assert.ok(all.toLowerCase().includes(term.toLowerCase()),term);
  for(const c of commands)for(const sub of c.options||[null])assert.ok(all.includes('/'+c.name+(sub?' '+sub.name:'')));
});
test('old help topic menus resolve to the new reference, while unknown topics fail clearly',()=>{
  for(const page of ['home','embeds','events','feeds','setup'])assert.equal(helpMenu({page}).embeds[0].toJSON().title,'Number One · Commands');
  assert.throws(()=>helpMenu({page:'missing'}),/Open \/help/);
});
