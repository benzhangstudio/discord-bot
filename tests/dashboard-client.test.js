import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../age-verification/public/app.js',import.meta.url),'utf8');
const FIRST='111111111111111111',SECOND='222222222222222222';
function deferred(){let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve};}
function client(){
  const nodes=new Map(),controls=[];
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.disabled=false;this.hidden=false;this.textContent='';this.value='';this.attributes={};this.listeners={};}
    setAttribute(key,value){this.attributes[key]=value;}
    append(...items){this.children.push(...items);}
    replaceChildren(...items){this.children=[...items];this.textContent='';}
    add(item){this.children.push(item);}
    addEventListener(name,fn){this.listeners[name]=fn;}
    reset(){this.value='';}
  }
  const document={hidden:false,getElementById(id){if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},createElement(tag){return new Element(tag);},addEventListener(){},querySelectorAll(selector){return controls.filter(node=>selector.split(',').some(part=>part.trim().endsWith(node.tagName)));}};
  const context={document,AbortSignal,Date,Blob,URL,console,routeVersion:0,navigator:{clipboard:{writeText:async()=>{}}},Option:function(text,value){this.textContent=text;this.value=value;},setTimeout(fn,ms){const timer=setTimeout(fn,ms);timer.unref();return timer;},clearTimeout};
  runInNewContext(source+'\nglobalThis.client={NO,Verification};',context);
  return {...context.client,nodes,controls,Element,get:id=>document.getElementById(id),advanceRoute:()=>context.routeVersion++};
}
const info=name=>({name,enabled:true,manager:false,reviewer:false,owner:false,shareUrl:'https://example.test/verify?guild='+name,case:null});

test('dashboard actions restore disabled permissions and clear progress after a cancelled action',async()=>{
  const c=client(),locked=new c.Element('input'),editable=new c.Element('textarea'),button=new c.Element('button');locked.disabled=true;c.controls.push(locked,editable,button);
  await c.NO.action(async()=>{assert.equal(locked.disabled,true);assert.equal(editable.disabled,true);assert.equal(button.disabled,true);})();
  assert.equal(locked.disabled,true);assert.equal(editable.disabled,false);assert.equal(button.disabled,false);assert.equal(c.NO.busy,false);assert.equal(c.get('message').textContent,'');
});

test('a late verification context cannot overwrite the newly selected server',async()=>{
  const c=client(),late=deferred();c.NO.api=path=>path.includes(FIRST)?late.promise:Promise.resolve(info('Second community'));
  const previous=c.Verification.load(FIRST);assert.equal(await c.Verification.load(SECOND),true);
  late.resolve(info('First community'));assert.equal(await previous,false);
  assert.equal(c.get('serverName').textContent,'Second community');assert.match(c.get('share').value,/Second community/);assert.equal(c.get('evidence').hidden,true);
});

test('an action failing after navigation does not replace the current page message',async()=>{
  const c=client(),work=deferred();const pending=c.NO.action(async()=>{await work.promise;throw new Error('Previous server error');})();
  c.advanceRoute();c.NO.message('Current page ready.');work.resolve();await pending;
  assert.equal(c.get('message').textContent,'Current page ready.');assert.equal(c.NO.busy,false);
});

test('leaving a verification server during a claim does not fetch or show its evidence',async()=>{
  const c=client(),claim=deferred(),calls=[];c.NO.session={id:'reviewer'};
  c.NO.api=async path=>{
    calls.push(path);if(path.endsWith(FIRST+'/context'))return {...info('First community'),reviewer:true};if(path.endsWith('/queue'))return [{id:'case-reference',status:'pending',created:Date.now()}];if(path.endsWith('/claim'))return claim.promise;if(path.endsWith(SECOND+'/context'))return info('Second community');throw new Error('Unexpected evidence request');
  };
  await c.Verification.load(FIRST);const review=c.get('queue').children[0].children[1];const pending=review.onclick();
  c.Verification.clearEvidence();await c.Verification.load(SECOND);claim.resolve({});await pending;
  assert(!calls.some(path=>path.includes('/evidence')));assert.equal(c.get('evidence').hidden,true);assert.equal(c.get('serverName').textContent,'Second community');
});

test('a failed review action clears evidence while keeping the current review usable',async()=>{
  const c=client();let claims=0;c.NO.session={id:'reviewer'};
  c.NO.api=async path=>{
    if(path.endsWith('/context'))return {...info('First community'),reviewer:true};if(path.endsWith('/queue'))return [{id:'case-reference',status:'pending',created:Date.now()}];
    if(path.endsWith('/claim')){if(++claims===1)throw new Error('Claim unavailable. Refresh the queue.');return {};}
    if(path.includes('/evidence?'))return {dob:'1995-04-12',portrait:'/portrait.svg',synthetic:true};throw new Error('Unexpected request');
  };
  await c.Verification.load(FIRST);const review=c.get('queue').children[0].children[1];await review.onclick();
  assert.equal(c.get('message').attributes.role,'alert');assert.equal(c.get('evidence').hidden,true);
  await review.onclick();assert.equal(claims,2);assert.equal(c.get('evidence').hidden,false);assert.match(c.get('dob').textContent,/1995/);c.Verification.clearEvidence();
});
