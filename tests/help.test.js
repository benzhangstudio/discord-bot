import test from 'node:test';
import assert from 'node:assert/strict';
import {helpMenu} from '../src/help.js';
import {commands} from '../src/commands.js';
const size=embed=>[embed.title,embed.description,embed.footer?.text,...(embed.fields||[]).flatMap(f=>[f.name,f.value])].join('').length;
test('help is a compact category menu without DM controls and every command available',()=>{
  const p=helpMenu(),e=p.embeds[0].toJSON(),select=p.components[0].components[0];
  assert.equal(select.type,3);assert.equal(select.custom_id,'help:topic');
  assert.equal(p.components.length,1);assert.equal(p.components[0].components.length,1);
  assert.doesNotMatch(JSON.stringify(p),/manual|DM /);
  assert.ok(size(e)<1000);assert.ok(!JSON.stringify(e).includes('/embed create'));
  const text=select.options.map(option=>{
    const page=helpMenu({page:option.value});const embed=page.embeds[0].toJSON();
    assert.ok(size(embed)<1600);assert.ok(embed.fields.every(f=>f.value.length<=1024));
    assert.equal(page.components[0].components[0].options.filter(o=>o.default).length,1);
    return JSON.stringify(embed);
  }).join(' ');
  for(const c of commands)for(const sub of c.options?.some(o=>o.type===1)?c.options:[null]) {
    const usage='/'+c.name+(sub?' '+sub.name:'');assert.ok(text.includes(usage),usage);
    for(const option of sub?.options||c.options||[])if(option.required)assert.ok(text.includes(option.name));
  }
  assert.ok(text.includes('/embed send message channel'));assert.ok(text.includes('/schedule add title start channel'));
});

test('old help topic menus resolve to the new reference, while unknown topics fail clearly',()=>{
  for(const page of ['home','embeds','events','feeds','setup'])assert.ok(helpMenu({page}).embeds[0].toJSON().title.length>0);
  assert.throws(()=>helpMenu({page:'missing'}),/Open \/help/);
});
