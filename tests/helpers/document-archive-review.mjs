import assert from 'node:assert/strict';

export async function checkArchiveReview({core,db,bucket,state,request,command,artifacts,tables,setUser,setAfterPut,setAfterGet,setBeforeGet,io}){
  const orderId=command().source.orderId,query=(view='review',extra={})=>'?'+new URLSearchParams({companyId:'a',view,kind:'draft',orderId,...extra});
  const page=async(extra={})=>{const r=await request(query('review',extra));assert.equal(r.status,200,await r.clone().text());return r.json();};
  const detail=async(id,extra={})=>{const r=await request(query('review-detail',{id,...extra}));assert.equal(r.status,200,await r.clone().text());return r.json();};
  assert.deepEqual((await page()).items,[],'Healthy issued copies do not fill the attention list');
  const begin=async(at=new Date().toISOString())=>{
    const selected=command(),journal=new core.D1DocumentArchiveJournal(db,{clock:{now:()=>new Date(at),sqlNow:"'"+at+"'"}});
    const result=await journal.begin({request:selected,actorId:'manager',requestFingerprint:await core.historyExportFingerprint({request:selected,actorId:'manager'}),
      template:core.archiveTemplate('draft',selected.format),requestedAt:at,leaseMs:core.DOCUMENT_ARCHIVE_LEASE_MS});
    assert.equal(result.kind,'claim');return {journal,claim:result.claim};
  };
  const pending=await begin(),expired=await begin(new Date(Date.now()-240_000).toISOString());
  const unknown=await begin();await unknown.journal.hold(unknown.claim,'PRIVATE_REASON_WITH_PROVIDER_TOKEN');
  for(let i=0;i<21;i++)assert.equal((await request('',{...command(),source:{kind:'draft',orderId,revision:999}})).status,409);
  assert.equal((await request('',{companyId:'a',operationId:crypto.randomUUID(),format:'pdf',source:{kind:'history',filters:{},fingerprint:'0'.repeat(64)}})).status,409);
  const damaged=artifacts[0],missing=artifacts[1],damagedKey=await core.archiveObjectKey(damaged),missingKey=await core.archiveObjectKey(missing);
  await bucket.put(damagedKey,new Uint8Array(damaged.size));assert.equal((await request('?companyId=a&id='+damaged.id)).status,409);
  const original=new Uint8Array(await (await bucket.get(missingKey)).arrayBuffer());await bucket.delete(missingKey);assert.equal((await request('?companyId=a&id='+missing.id)).status,409);
  const lost=command();setAfterPut(async()=>{throw Error('PRIVATE_LOST_WRITE_RESPONSE');});assert.equal((await request('',lost)).status,409);
  const appTables=[...tables,'document_archive_intents','document_archive_leases','document_archive_observations'].sort();
  const allRows=async()=>JSON.stringify((await db.batch(appTables.map(name=>db.prepare(`SELECT * FROM "${name}"`)))).map(r=>r.results));
  const before=await allRows(),beforeIO=io(),first=await page(),second=await page({offset:'20'}),items=[...first.items,...second.items];
  assert.equal(first.items.length,20);assert.equal(first.hasMore,true);assert.equal(second.hasMore,false);assert.equal(new Set(items.map(i=>i.id)).size,items.length);
  assert.deepEqual((await page()).items,first.items,'Static pages are deterministic');
  assert.equal(items.find(i=>i.id===pending.claim.id).status,'pending');assert.equal(items.find(i=>i.id===expired.claim.id).status,'unconfirmed');
  assert.equal(items.find(i=>i.id===unknown.claim.id).reason,null);assert.equal(items.find(i=>i.id===damaged.id).status,'damaged');assert.equal(items.find(i=>i.id===missing.id).status,'missing');
  assert.ok(items.some(i=>i.status==='unavailable'));assert.ok(items.some(i=>i.reason==='source_changed'));
  const sourceHeld=items.find(i=>i.reason==='source_changed');assert.match((await detail(sourceHeld.id)).events[0].summary,/source changed/i);
  assert.equal((await detail(missing.id)).item.issued,true);assert.ok((await detail(missing.id)).events.some(e=>/not found/.test(e.summary)));
  assert.ok(!(JSON.stringify({first,second,detail:await detail(unknown.claim.id)})).includes('PRIVATE_'));
  const bucketBinding=state.env.DOCUMENT_ARCHIVE;delete state.env.DOCUMENT_ARCHIVE;await page();await detail(missing.id);state.env.DOCUMENT_ARCHIVE=bucketBinding;
  assert.equal(await allRows(),before,'Every review read preserves all business and archive rows');assert.deepEqual(io(),beforeIO,'Review does not read/write/list/delete R2');
  for(const who of [null,'employee','b-manager']){
    setUser(who);for(const url of [query(),query('review',{offset:'9000'}),query('review-detail',{id:missing.id})])assert.equal((await request(url)).status,who?403:401);
  }
  setUser('b-manager');assert.deepEqual((await (await request('?companyId=b&view=review&kind=history')).json()).items,[]);
  assert.equal((await request('?companyId=b&view=review-detail&kind=history&id='+missing.id)).status,404);
  setUser('owner');assert.equal((await detail(missing.id)).item.status,'missing');setUser('manager');
  assert.equal((await request(query('review-detail',{id:missing.id,orderId:'another-draft'}))).status,404);
  assert.equal((await request('?companyId=a&view=review-detail&kind=history&id='+missing.id)).status,404);
  const history=await request('?companyId=a&view=review&kind=history');assert.equal((await history.json()).items.length,1);
  for(const extra of [{offset:'-1'},{offset:'9007199254740992'},{token:'PRIVATE'},{id:missing.id}])assert.equal((await request(query('review',extra))).status,400);
  assert.equal((await request(query()+'&companyId=b')).status,400);assert.equal((await request(query('review-detail',{id:'bad'}))).status,400);
  state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW='disabled';assert.equal((await request(query())).status,404);assert.equal((await request(query('review-detail',{id:missing.id}))).status,404);state.env.PANTRACK_DOCUMENT_ARCHIVE_PREVIEW='enabled';
  // Revoke between the wrapper's membership read and the review's actual D1 batch.
  state.db={prepare:(...args)=>db.prepare(...args),batch:async statements=>{await db.prepare("UPDATE memberships SET role='employee' WHERE company_id='a' AND user_id='manager'").run();return db.batch(statements);}};
  try{assert.equal((await request(query())).status,403);}finally{state.db=db;await db.prepare("UPDATE memberships SET role='manager' WHERE company_id='a' AND user_id='manager'").run();}
  state.db={prepare:(...args)=>db.prepare(...args),batch:async statements=>{const result=await db.batch(statements);setUser('b-manager');return result;}};
  try{assert.equal((await request(query('review-detail',{id:missing.id}))).status,403);}finally{state.db=db;setUser('manager');}
  // Recovery is performed by the existing exact-request path, never by review reads.
  const puts=io().puts;assert.equal((await request('',lost)).status,200);assert.equal(io().puts,puts);
  await bucket.put(missingKey,original);assert.equal((await request('?companyId=a&id='+missing.id)).status,200);
  const after=[...(await page()).items,...(await page({offset:'20'})).items];assert.ok(!after.some(i=>i.id===missing.id));
  assert.ok((await detail(missing.id)).events.some(e=>/not found/.test(e.summary)),'Recovery retains the old missing-file observation');
  setBeforeGet(async()=>{throw Error('PRIVATE_READ_ERROR');});assert.equal((await request('?companyId=a&id='+missing.id)).status,503);
  assert.equal((await detail(missing.id)).item.status,'unavailable');assert.equal((await request('?companyId=a&id='+missing.id)).status,200);
  const journal=new core.D1DocumentArchiveJournal(db),at=new Date().toISOString();
  // Same-timestamp events with descending UUIDs must still use insertion order.
  for(const [id,present] of [['ffffffff-ffff-4fff-8fff-ffffffffffff',false],['00000000-0000-4000-8000-000000000001',true]]){
    await db.prepare('INSERT INTO document_archive_observations VALUES(?,?,?,?,NULL,?,?)').bind('a',missing.id,id,'manager',JSON.stringify({kind:'object',present,reportedSize:missing.size,byteLength:missing.size,sha256:missing.sha256}),at).run();
  }
  assert.equal((await detail(missing.id)).item.status,'issued');
  for(let i=0;i<22;i++)await journal.observeRead(missing,'manager',{kind:'object',present:true,reportedSize:missing.size,byteLength:missing.size,sha256:missing.sha256});
  const newer=await detail(missing.id),older=await detail(missing.id,{offset:'20'});assert.equal(newer.events.length,20);assert.equal(newer.hasMore,true);assert.ok(older.events.length>0);
  assert.equal(new Set([...newer.events,...older.events].map(e=>e.id)).size,newer.events.length+older.events.length);
  await db.prepare('INSERT INTO document_archive_observations VALUES(?,?,?,?,NULL,?,?)').bind('a',missing.id,crypto.randomUUID(),'manager',JSON.stringify({kind:'source_check',private:'PRIVATE_PROVIDER_SECRET'}),at).run();
  assert.ok(!JSON.stringify(await detail(missing.id)).includes('PRIVATE_'));
  console.log('PASS: native D1/R2 review states and recovery, scoped/authorized paging, retained safe history, no review writes or file IO, role/session revocation and redaction.');
}
