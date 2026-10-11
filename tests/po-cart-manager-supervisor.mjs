import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {rmSync,statSync} from 'node:fs';
import {fixtureProvisioner} from '../scripts/po-cart-worker/manager-supervisor.mjs';
import {readPrivate,writePrivate} from '../scripts/po-cart-worker/private-files.mjs';
const root='.sites-runtime/po-cart-workers/supervisor-test-'+randomUUID(),store=root+'/store.json',file=root+'/sessions.json';
try{
 writePrivate(file,{version:1,origin:'http://127.0.0.1:5182',jobs:{}});
 const provision=await fixtureProvisioner(store),candidate={job:{id:randomUUID()},browser:{layout:'rows',scenario:'normal'},scope:{companyId:'a',supplierId:'supplier',accountId:'account'}};
 provision(candidate,file);const first=readPrivate(file),saved=readPrivate(store);assert.ok(first.jobs[candidate.job.id].token);
 if(process.platform!=='win32')assert.equal(statSync(file).mode&0o077,0);
 saved.fixtures[candidate.job.id].entries.push({sku:'AFTER-INTERRUPTION',unitLabel:'box',packs:'1',unitMinor:'100'});writePrivate(store,saved);
 provision(candidate,file);assert.deepEqual(readPrivate(store),saved);assert.deepEqual(readPrivate(file),first);
 // A crash between the private storefront and worker manifest writes must preserve the session and cart.
 writePrivate(file,{...first,jobs:{}});provision(candidate,file);assert.deepEqual(readPrivate(file),first);assert.deepEqual(readPrivate(store),saved);
 assert.throws(()=>provision({...candidate,browser:{layout:'compact',scenario:'normal'}},file));
 assert.throws(()=>provision({...candidate,scope:{...candidate.scope,companyId:'b'}},file));assert.deepEqual(readPrivate(store),saved);
}finally{rmSync(root,{recursive:true,force:true});}
console.log('PASS: local supervisor provisions private sessions once, preserves modified carts/tokens across restart and interrupted provisioning, and rejects scope/configuration mismatch.');
