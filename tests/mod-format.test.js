// Formatting snapshots for /warnings, /modlogs, /case and /appeals list.
// Regenerate deliberately with UPDATE_SNAPSHOTS=1 npm test after reviewing output changes.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {caseListPayload,caseEmbedFull,appealListPayload,appealEmbed} from '../src/mod-format.js';
const T=1767225600000;// 2026-01-01T00:00:00Z
const mod='222222222222222222',alex='444444444444444444';
const cases=[
 {id:'1563058619228880906',number:12,actor:mod,target:alex,action:'warn',reason:'Spamming in #general',created:T+3600e3,state:'succeeded',events:[]},
 {id:'1563058619228880907',number:9,actor:mod,target:alex,action:'timeout',reason:'Repeated insults',created:T,state:'uncertain',details:{until:T+600e3},events:[]},
];
const user={id:alex,name:'Alex',avatar:'https://cdn.discordapp.com/embed/avatars/0.png'};
function snap(name,value){
 const file=new URL(`./snapshots/${name}.json`,import.meta.url);const json=JSON.stringify(value,null,1)+'\n';
 if(process.env.UPDATE_SNAPSHOTS||!existsSync(file))writeFileSync(file,json);
 assert.equal(json,readFileSync(file,'utf8'));
 assert.doesNotMatch(json,/1563058619228880906|\d{4}-\d\d-\d\dT/,'no raw case ids or ISO dates');
}
test('/warnings embed',()=>snap('warnings',caseListPayload({kind:'warnings',user,rows:[cases[0]],invoker:mod})));
test('/warnings empty state',()=>snap('warnings-empty',caseListPayload({kind:'warnings',user,rows:[],invoker:mod})));
test('/modlogs embed',()=>snap('modlogs',caseListPayload({kind:'history',user,rows:cases,invoker:mod})));
test('/case embed',()=>snap('case',caseEmbedFull({...cases[1],events:[{at:T,action:'created',reason:'x'},{at:T+60e3,action:'note',reason:'Checked audit log'}]},{state:'open'})));
test('/appeals list embed',()=>snap('appeals-list',appealListPayload({rows:[{id:'appeal-1',caseId:cases[0].id,actor:alex,created:T+7200e3,state:'open'}],invoker:mod,caseOf:id=>cases.find(c=>c.id===id)})));
test('/appeals show embed',()=>snap('appeals-show',appealEmbed({id:'appeal-1',caseId:cases[0].id,actor:alex,created:T,state:'denied',reviewer:mod,reason:'Logs confirm spam',body:'I was hacked'},cases[0])));
