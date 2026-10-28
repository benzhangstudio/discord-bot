import {assert,Fault} from './core.js';

// A case has one mutation owner through preflight, saved decision and delivery.
// Keep network work outside SQLite transactions; a late response cannot save a decision.
export class VerificationWorkflow {
  constructor({root,discord,mode,authorize,timeout=8000}){
    Object.assign(this,{root,discord,mode,authorize,timeout});this.active=new Set();
  }
  async bounded(work){
    let timer;
    try{return await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{
      timer=setTimeout(()=>reject(new Fault(504,'The check took too long. Refresh to check the saved status before trying again.')),this.timeout);
    })]);}finally{clearTimeout(timer);}
  }
  async lock(store,id,work){
    const key=store.guild+':'+id;
    assert(!this.active.has(key),409,'This case is being updated. Refresh its status shortly.');
    this.active.add(key);try{return await work();}finally{this.active.delete(key);}
  }
  idle(store,id){assert(!this.active.has(store.guild+':'+id),409,'This case is being updated. Refresh its status shortly.');}
  open(store){assert(store.settings()?.enabled,409,'Verification is not open for this server. Its owner can enable it here.');}
  async fresh(store,session,permission){
    const identity=await this.bounded(()=>this.authorize(store.guild,session));
    assert(identity?.id===session.id&&identity[permission]===true,403,permission==='owner'?'Only the current server owner can manage verification privacy.':'Your reviewer permission was removed.');
    return identity;
  }
  claim(store,id,actor){this.idle(store,id);this.open(store);store.claim(id,actor);}
  evidence(store,id,actor){this.idle(store,id);this.open(store);return store.evidence(id,actor);}
  async decide(store,id,session,decision){
    assert(['approved','denied'].includes(decision),400,'Choose approve or deny.');
    return this.lock(store,id,async()=>{
      this.open(store);const item=store.reviewable(id,session.id),revision=store.revision();
      // Reject invalid claims/expired evidence before any Discord work.
      store.evidence(id,session.id);
      if(this.mode==='discord'&&decision==='approved'){
        assert(item.roleId!==store.settings().reviewerRole,409,'The saved verification role is now a reviewer role. The owner must resolve this case.');
        await this.bounded(()=>this.discord.validateVerified(store.guild,item.roleId));
        if(this.discord.member){
          const member=await this.bounded(()=>this.discord.member(store.guild,item.member));
          assert(member&&!member.user?.bot,409,'The applicant must still be a human member of this server.');
        }
      }
      await this.fresh(store,session,'reviewer');
      this.open(store);assert(store.revision()===revision,409,'Verification settings changed. Refresh the case before deciding.');
      store.decide(id,session.id,decision);
      await this.#deliver(store,id);
      return store.list().find(row=>row.id===id);
    });
  }
  async #deliver(store,id){
    const item=store.get(id);if(!item)return;
    // Mark before sending. Crashes/timeouts stay uncertain and are never blindly retried.
    for(const [field,work] of [
      ['roleState',()=>this.discord.role(store.guild,item.member,item.roleId)],
      ['dmState',()=>this.discord.dm(store.guild,item.member,item.status)]
    ]){
      if(item[field]!=='pending')continue;
      store.delivery(id,field,'uncertain');
      try{
        if(this.mode==='discord')await this.bounded(work);
        store.delivery(id,field,this.mode==='demo'?'simulated':'delivered');
      }catch(error){
        // A definitive Discord rejection has no side effect; network failures may have one.
        const rejected=[400,401,403,404,429].includes(error.discordStatus);
        store.delivery(id,field,rejected?'failed':'uncertain');
      }
    }
  }
  async erase(store,requestId,session){
    const request=store.deletion(requestId);assert(request,404,'Open deletion request not found in this server.');
    return this.lock(store,store.mine(request.member)?.id||'member:'+request.member,async()=>{
      const item=store.mine(request.member);
      assert(!item||!['pending','uncertain'].includes(item.roleState),409,'Role delivery is active or uncertain. Inspect Discord and reconcile it first.');
      await this.fresh(store,session,'owner');
      if(this.mode==='discord'&&item?.status==='approved'){
        await this.bounded(()=>this.discord.removeRole(store.guild,request.member,item.roleId));
        // Ownership can change during the removal. Keep records if authority was lost.
        await this.fresh(store,session,'owner');
      }
      assert(store.deletion(requestId),409,'This privacy request was already completed.');
      store.erase(request.member);return {ok:true};
    });
  }
  async reconcile(store,id,session){
    return this.lock(store,id,async()=>{
      const item=store.get(id);assert(item?.status==='approved'&&item.roleState==='uncertain',409,'No completed uncertain role delivery in this server.');
      let member={roles:[]};
      if(this.mode==='discord'){
        try{member=await this.bounded(()=>this.discord.member(store.guild,item.member));}
        catch(error){if(error.discordStatus!==404||error.discordCode!==10007)throw error;}
      }
      await this.fresh(store,session,'owner');
      assert(Array.isArray(member.roles),502,'Discord role status is unavailable. Refresh before trying again.');
      store.delivery(id,'roleState',member.roles.includes(item.roleId)?'delivered':'not_delivered');return {ok:true};
    });
  }
}
