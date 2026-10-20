import test from 'node:test';
import assert from 'node:assert/strict';
import {StringSelectMenuBuilder} from 'discord.js';
import {helpMenu} from '../src/help.js';
test('every help topic renders a standard dropdown and stays within Discord text limits',()=>{
  for(const page of ['home','embeds','events','feeds','setup']) {
    const payload=helpMenu({page,canManage:true,canConfigure:true});const embed=payload.embeds[0].toJSON();
    const menu=StringSelectMenuBuilder.from(payload.components[0].components[0]).toJSON();
    assert.equal(menu.type,3);assert.equal(menu.options.length,5);assert.equal(menu.options.find(o=>o.default).value,page);
    assert.ok(embed.fields.every(field=>field.name.length<=256&&field.value.length<=1024));
    const text=[embed.title,embed.description,embed.footer.text,...embed.fields.flatMap(f=>[f.name,f.value])].join('');assert.ok(text.length<=6000);
    assert.doesNotMatch(text,/DISCORD_TOKEN|npm |node |\.env|GitHub|Wispbyte/);
  }
});
test('member help focuses on participation; staff and administrator instructions match access',()=>{
  const member=JSON.stringify(helpMenu({page:'events'}));assert.ok(!member.includes('/schedule add'));assert.ok(member.includes('/schedule list'));
  const staff=JSON.stringify(helpMenu({page:'embeds',canManage:true}));assert.ok(staff.includes('/embed create'));
  const setup=JSON.stringify(helpMenu({page:'setup'}));assert.ok(!setup.includes('/settings staff'));
  assert.ok(JSON.stringify(helpMenu({page:'setup',canConfigure:true})).includes('Administrator'));
  assert.throws(()=>helpMenu({page:'missing'}),/Open \/help/);
});
