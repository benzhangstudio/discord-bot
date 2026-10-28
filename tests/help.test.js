import test from 'node:test';
import assert from 'node:assert/strict';
import {helpMenu,categories} from '../src/help.js';
import {commands} from '../src/commands.js';
test('help overview is a plain category list with a select menu',()=>{
  const p=helpMenu(),e=p.embeds[0].toJSON(),select=p.components[0].components[0];
  assert.equal(e.title,'Help');assert.equal(e.color,0x5865f2);assert.ok(!e.fields?.length);
  assert.match(e.description,/^Select a category to see its commands\.\n\n\*\*Moderation\*\* – /);
  assert.equal(e.footer.text,'Commands require the matching Discord permissions.');
  assert.equal(select.type,3);assert.equal(select.custom_id,'help:topic');assert.equal(select.placeholder,'Select a category');
  assert.equal(p.components.length,1);assert.doesNotMatch(JSON.stringify(p),/manual|DM |Number One|!/);
  for(const c of categories)assert.ok(e.description.includes(`**${c.label}** – ${c.description}`));
});
test('every registered command and subcommand appears in exactly one help category',()=>{
  const owner=new Map();
  for(const c of categories)for(const name of c.commands){assert.ok(!owner.has(name),name);owner.set(name,c.value);}
  for(const c of commands){
    assert.ok(owner.has(c.name),`${c.name} has no help category`);
    const e=helpMenu({page:owner.get(c.name)}).embeds[0].toJSON();assert.equal(e.title,categories.find(x=>x.value===owner.get(c.name)).label);
    for(const sub of c.options?.some(o=>o.type===1)?c.options:[null]){
      const usage='`/'+c.name+(sub?' '+sub.name:'')+'`';assert.ok(e.description.includes(usage+' – '+(sub||c).description.replace(/\.$/,'')),usage);
    }
  }
  for(const name of owner.keys())assert.ok(commands.some(c=>c.name===name),`${name} is not registered`);
});
test('category pages fit Discord limits and older topic values still resolve',()=>{
  for(const option of helpMenu().components[0].components[0].options){
    const page=helpMenu({page:option.value});const e=page.embeds[0].toJSON();
    assert.ok(e.description.length<=4096);assert.ok(option.description.length<=100);
    assert.equal(page.components[0].components[0].options.filter(o=>o.default).length,1);
  }
  for(const page of ['home','embeds','events','feeds','setup'])assert.ok(helpMenu({page}).embeds[0].toJSON().title.length>0);
  assert.throws(()=>helpMenu({page:'missing'}),/Open \/help/);
});
