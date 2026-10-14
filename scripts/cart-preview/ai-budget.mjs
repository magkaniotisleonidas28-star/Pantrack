import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {readPrivate,writePrivate,profileLock} from '../po-cart-worker/private-files.mjs';

export const budgetFile=resolve('.sites-runtime/cart-ai-budget/ledger.json');
export const legacyBudgetFile=resolve('.sites-runtime/cart-ai-evaluation/state.json');
const ceiling=5_000_000;
const count=n=>Number.isSafeInteger(n)&&n>=0;

// Both evaluators use this one ledger. Reservations are never refunded, even on
// refusal, interruption, timeout or a crash before the provider's reply is saved.
export class AiBudgetLedger {
  constructor(file=budgetFile,legacy=legacyBudgetFile){this.file=file;this.legacy=legacy;}
  async locked(fn){
    const deadline=Date.now()+5000;let release;
    while(!release){
      try{release=profileLock(this.file+'.ownership');}
      catch(e){
        // A reclamation guard left by a crash requires review. Never remove it.
        if(e.code!=='EEXIST'&&e.message!=='Account profile is actively owned.')throw e;
        if(Date.now()>=deadline)throw Error('AI budget lock requires local review.');
        await new Promise(ok=>setTimeout(ok,10));
      }
    }
    try{return fn();}finally{release();}
  }
  read(){
    const state=existsSync(this.file)?readPrivate(this.file):{version:1,legacyReservedMicros:0,legacyCalls:0,reservations:[]};
    if(state.version!==1||!count(state.legacyReservedMicros)||!count(state.legacyCalls)||!Array.isArray(state.reservations)
      ||state.reservations.some(r=>!r.id||!count(r.micros)||r.micros===0))throw Error('AI budget ledger requires local review.');
    if(existsSync(this.legacy)){
      const old=readPrivate(this.legacy);
      if(!count(old.reservedMicros)||!count(old.calls))throw Error('Legacy AI budget requires local review.');
      // Carry forward the high-water mark, including later legacy reservations.
      state.legacyReservedMicros=Math.max(state.legacyReservedMicros,old.reservedMicros);
      state.legacyCalls=Math.max(state.legacyCalls,old.calls);
    }
    return state;
  }
  total(state){const n=state.legacyReservedMicros+state.reservations.reduce((sum,r)=>sum+r.micros,0);if(!count(n))throw Error('Invalid AI budget total.');return n;}
  async snapshot(){return this.locked(()=>{const s=this.read();writePrivate(this.file,s);return {...s,reservedMicros:this.total(s)};});}
  async reserve(micros,metadata={}){
    return this.locked(()=>{
      const s=this.read();
      if(!count(micros)||micros===0||this.total(s)+micros>ceiling)throw Error('The cumulative $5 AI evaluation budget cannot cover another call.');
      const reservation={...metadata,id:randomUUID(),micros,at:new Date().toISOString(),status:'reserved'};
      s.reservations.push(reservation);writePrivate(this.file,s);return reservation.id;
    });
  }
  async complete(id,usage){
    return this.locked(()=>{const s=this.read(),r=s.reservations.find(r=>r.id===id);if(!r)throw Error('Missing AI reservation.');
      r.status='completed';r.usage=usage;writePrivate(this.file,s);
    });
  }
}
