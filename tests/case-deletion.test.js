import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../src/store.js';
import {Moderation} from '../src/moderation-core.js';
import {createDashboardApi} from '../src/dashboard-api.js';
const fixture=(store,guild,id,extra={})=>{
  store.put(guild,'mod-case',{id,number:12,action:'warn',target:'member',actor:'moderator',created:Date.now(),state:'succeeded',events:[],...extra});
  store.put(guild,'mod-log',{id:'log-'+id,caseId:id,state:'queued'});
  store.put(guild,'mod-appeal',{id:'appeal-'+id,caseId:id,state:'open'});
  store.put(guild,'mod-number',{id,number:12});
};

test('hard deletion removes all related records in only the selected server and never reuses its number',()=>{
  const store=new Store(':memory:');try{
    fixture(store,'one','case');fixture(store,'two','case');const core=new Moderation(store);core.erase('one','case');
    for(const kind of ['mod-case','mod-log','mod-appeal','mod-number'])assert.deepEqual(store.list('one',kind),[]);
    assert(store.get('two','mod-case','case'));assert.equal(core.reserveNumber('one','next'),13);
    assert.throws(()=>core.getNumber('one',12),/not found/);
  }finally{store.close();}
});

test('legacy removed records are deleted before history and dashboard counts are returned',async()=>{
  const store=new Store(':memory:');try{
    fixture(store,'one','old',{voided:true});fixture(store,'one','also-old',{number:13,state:'removed'});
    const api=createDashboardApi({store});const overview=await api.handle({method:'GET',endpoint:'overview',guild:'one',identity:{owner:true,manager:true,dashboard:true}});
    assert.equal(overview.stats.moderationCases,0);
    const page=await api.handle({method:'GET',endpoint:'plugins/moderation',guild:'one',identity:{owner:true,manager:true,dashboard:true}});assert.deepEqual(page.recentCases,[]);
    for(const kind of ['mod-case','mod-log','mod-appeal','mod-number'])assert.deepEqual(store.list('one',kind),[]);
    assert.equal(new Moderation(store).reserveNumber('one','next'),14);
  }finally{store.close();}
});

test('case deletion rolls back completely if any related database deletion fails',()=>{
  const store=new Store(':memory:');try{
    fixture(store,'one','case');const remove=store.remove.bind(store);
    store.remove=(g,kind,id)=>{if(kind==='mod-log')throw Error('storage failure');return remove(g,kind,id);};
    assert.throws(()=>new Moderation(store).erase('one','case'),/storage failure/);
    for(const kind of ['mod-case','mod-log','mod-appeal','mod-number'])assert.equal(store.list('one',kind).length,1);
  }finally{store.close();}
});

test('legacy cleanup trusts the database server key even if stored case content contains a different server',()=>{
  const store=new Store(':memory:');try{
    fixture(store,'one','case',{guild:'two',voided:true});fixture(store,'two','case');
    new Moderation(store).purgeRemoved();
    assert.equal(store.get('one','mod-case','case'),undefined);
    assert(store.get('two','mod-case','case'));assert.equal(store.list('two','mod-log').length,1);
  }finally{store.close();}
});
