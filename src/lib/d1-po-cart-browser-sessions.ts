import {z} from 'zod';
import {D1PoCartJobs,type CartWorkerAccess} from './d1-po-cart-jobs';
import {D1PoCartAuthorizations,type CartAuthorizationGuard as Guard} from './d1-po-cart-authorizations';
import {canonicalJson} from './supplier-simulation-contract';
import {checkBrowserCart} from './po-cart-browser-contract';
import {inspectCart} from './po-cart-reconciliation-contract';
import {cartJobFail as fail,type CartJobStatus} from './po-cart-job-contract';
import {workerView} from './po-cart-worker-transport';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';
import {requestBrowserSchema,closeBrowserSchema,resumeBrowserSchema,sessionWorkerSchema,activeBrowserStates,type SessionRow,type SessionReceipt} from './po-cart-browser-session-contract';
import type {CartEntry} from './cart-preview-contract';
const MEMBER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";
/** Human access never grants an addition or promotes a cart to ready. */
export class D1PoCartBrowserSessions {
 constructor(private db:D1Database,private options:{identity:()=>Promise<string|null>;workerAccess?:CartWorkerAccess;clock?:{now():Date};salesPolicy?:CloverReviewPolicy}){}
 private now(){return (this.options.clock?.now()??new Date()).toISOString();}
 private time(){return this.options.clock?'?':"strftime('%Y-%m-%dT%H:%M:%fZ','now')";}
 private timeArgs(){return this.options.clock?[this.now()]:[];}
 private parse<T>(schema:z.ZodType<T>,value:unknown):T{const p=schema.safeParse(value);if(!p.success)fail('invalid_request','Invalid browser request.');return p.data;}
 private jobs(){return new D1PoCartJobs(this.db,this.options);}
 private auth(){return new D1PoCartAuthorizations(this.db,this.options);}
 private async actor(company:string){const actor=await this.options.identity();if(!actor||!await this.db.prepare(`SELECT 1 WHERE ${MEMBER}`).bind(company,actor).first())fail('forbidden','Current owner or manager membership required.');return actor;}
 private async row(company:string,id:string){const r=await this.db.prepare('SELECT * FROM po_cart_browser_sessions WHERE company_id=? AND id=?').bind(company,id).first<SessionRow>();if(!r)fail('missing','Practice browser request unavailable.');return r;}
 private state(s:SessionRow):Guard{return {sql:'EXISTS (SELECT 1 FROM po_cart_browser_sessions WHERE company_id=? AND id=? AND revision=? AND state=? AND fence=?)',args:[s.company_id,s.id,s.revision,s.state,s.fence]};}
 private async replay(company:string,op:string,fp:string){const r=await this.db.prepare('SELECT fingerprint,receipt_json FROM po_cart_browser_operations WHERE company_id=? AND operation_id=?').bind(company,op).first<{fingerprint:string;receipt_json:string}>();if(!r)return null;if(r.fingerprint!==fp)fail('conflict','Operation identity already used.');return JSON.parse(r.receipt_json) as SessionReceipt;}
 private async scope(id:string){const a=this.options.workerAccess;if(!a||a.consumerKind!=='local_browser')fail('forbidden','Browser worker required.');await a.assertCurrent();
  if(!await this.db.prepare('SELECT 1 FROM po_cart_browser_sessions WHERE company_id=? AND id=? AND supplier_id=? AND account_id=?').bind(a.companyId,id,a.supplierId,a.accountId).first())fail('missing','Practice browser request unavailable.');return a;}
 private async job(company:string,id:string){return this.options.workerAccess?(await this.jobs().getWorker(id))!:this.jobs().get({companyId:company,jobId:id});}
 private async current(s:SessionRow){
  const j=await this.job(s.company_id,s.job_id),member=!!await this.db.prepare(`SELECT 1 WHERE ${MEMBER}`).bind(s.company_id,s.requested_by).first();
  const unresolvedInspection=s.purpose==='inspect'&&j.authorization.authorization?.releasedAt===null&&j.ownership?.jobId===j.job.id;
  const allowed=member&&(unresolvedInspection||j.job.state!=='canceled'&&j.authorization.authorization?.status!=='canceled')&&s.expires_at>this.now()
   &&(s.state==='requested'||!!s.lease_until&&s.lease_until>this.now())&&(s.purpose==='inspect'||j.authorization.valid);
  return {session:{id:s.id,jobId:s.job_id,revision:s.revision,purpose:s.purpose,state:s.state,fence:s.fence,workerId:s.worker_id,
   leaseUntil:s.lease_until,expiresAt:s.expires_at,reason:s.reason,allowed},...workerView(j)};
 }
 private async result(receipt:SessionReceipt){const a=await this.scope(receipt.sessionId),s=await this.row(a.companyId,receipt.sessionId),current=await this.current(s);await a.assertCurrent();return {receipt,current};}
 private receipt(s:SessionRow,operationId:string,action:string):SessionReceipt{return {operationId,jobId:s.job_id,sessionId:s.id,revision:s.revision+1,action,at:this.now()};}
 private async commit(company:string,fp:string,r:SessionReceipt,guards:Guard[],statements:D1PreparedStatement[],manager?:string){
  const access=this.options.workerAccess;
  if(access){await this.scope(r.sessionId);guards=[access.guard(),{sql:'EXISTS (SELECT 1 FROM po_cart_browser_sessions WHERE company_id=? AND id=? AND supplier_id=? AND account_id=?)',args:[access.companyId,r.sessionId,access.supplierId,access.accountId]},...guards];}
  if(manager){if(await this.actor(company)!==manager)fail('forbidden','Session changed.');guards=[{sql:MEMBER,args:[company,manager]},...guards];}
  const checks=guards.map(g=>this.db.prepare(`INSERT INTO po_cart_browser_operations SELECT ?,?,?,?,'{}',0 WHERE NOT (${g.sql})`).bind(company,r.operationId,r.sessionId,fp,...g.args));
  try{await this.db.batch([...checks,...statements,this.db.prepare('INSERT INTO po_cart_browser_operations VALUES(?,?,?,?,?,1)').bind(company,r.operationId,r.sessionId,fp,JSON.stringify(r))]);}
  catch{await access?.assertCurrent();if(manager)await this.actor(company);const prior=await this.replay(company,r.operationId,fp);if(prior)return manager?{receipt:prior}:this.result(prior);fail('conflict','Browser ownership, permission, source or lease changed.');}
  if(manager){if(await this.actor(company)!==manager)fail('forbidden','Session changed.');return {receipt:r};}return this.result(r);
 }
 private update(s:SessionRow,state:SessionRow['state'],reason:string,extra=' ',args:unknown[]=[]){return this.db.prepare(`UPDATE po_cart_browser_sessions SET revision=revision+1,state=?,reason=?,updated_at=? ${extra} WHERE company_id=? AND id=? AND revision=?`).bind(state,reason,this.now(),...args,s.company_id,s.id,s.revision);}
 private jobGuard(j:CartJobStatus):Guard{return {sql:'EXISTS (SELECT 1 FROM po_cart_jobs WHERE company_id=? AND id=? AND revision=? AND state=?)',args:[j.job.companyId,j.job.id,j.job.revision,j.job.state]};}
 private noAttempts(j:CartJobStatus):Guard{return {sql:'NOT EXISTS (SELECT 1 FROM po_cart_attempts WHERE company_id=? AND job_id=?)',args:[j.job.companyId,j.job.id]};}
 private signinEligible(j:CartJobStatus){return !!j.job.browser&&j.job.state==='review_needed'&&j.attempts.length===0&&j.authorization.valid
  &&j.authorization.authorization?.startedAt===null&&j.ownership?.jobId===j.job.id&&j.ownership.workerId===null
  &&j.events.at(-1)?.kind==='hold'&&j.events.at(-1)?.reason==='sign_in_required';}
 async requestBrowser(value:unknown){
  const i=this.parse(requestBrowserSchema,value),actor=await this.actor(i.companyId),fp=canonicalJson({actor,input:i});
  const prior=await this.replay(i.companyId,i.operationId,fp);if(prior)return {receipt:prior};
  const j=await this.job(i.companyId,i.jobId),o=j.ownership;
  if(j.job.revision!==i.expectedRevision||!j.job.browser||!(['ready','review_needed'].includes(j.job.state)||i.purpose==='inspect'&&j.job.state==='canceled'&&j.authorization.authorization?.releasedAt===null)||!o||o.jobId!==j.job.id||o.workerId!==null)fail('conflict','Stop preparation before opening the browser.');
  let guards=[this.jobGuard(j),{sql:'EXISTS (SELECT 1 FROM po_cart_owners WHERE company_id=? AND supplier_id=? AND account_id=? AND fence=? AND job_id=? AND worker_id IS NULL)',args:[i.companyId,j.job.supplierId,j.job.accountId,o.fence,j.job.id]}];
  if(i.purpose==='sign_in'){if(!this.signinEligible(j))fail('conflict','Only never-attempted sign-in holds can recover.');guards.push(...(await this.auth().guardedUse(i.companyId,j.job.authorizationId,j.job.requestedBy)).guards,this.noAttempts(j));}
  const at=this.now(),id=crypto.randomUUID(),expires=new Date(Date.parse(at)+1800000).toISOString();
  const receipt:SessionReceipt={operationId:i.operationId,jobId:i.jobId,sessionId:id,revision:1,action:i.action,at};
  return this.commit(i.companyId,fp,receipt,guards,[
   this.db.prepare("UPDATE po_cart_owners SET fence=fence+1 WHERE company_id=? AND supplier_id=? AND account_id=?").bind(i.companyId,j.job.supplierId,j.job.accountId),
   this.db.prepare("INSERT INTO po_cart_browser_sessions VALUES(?,?,?,?,?,?,?,1,'requested',?,NULL,NULL,?,?,?,NULL,'manager_requested')").bind(i.companyId,id,i.jobId,j.job.supplierId,j.job.accountId,i.purpose,actor,o.fence+1,expires,at,at),
  ],actor);
 }
 async closeBrowser(value:unknown){
  const i=this.parse(closeBrowserSchema,value),actor=await this.actor(i.companyId),fp=canonicalJson({actor,input:i}),prior=await this.replay(i.companyId,i.operationId,fp);if(prior)return {receipt:prior};
  const j=await this.job(i.companyId,i.jobId),s=await this.row(i.companyId,i.sessionId);
  if(s.job_id!==i.jobId||s.revision!==i.expectedSessionRevision||j.job.revision!==i.expectedRevision||!['requested','opening','open'].includes(s.state))fail('conflict','Browser status changed. Refresh before closing.');
  return this.commit(i.companyId,fp,this.receipt(s,i.operationId,i.action),[this.state(s),this.jobGuard(j)],[this.update(s,'closing','manager_closed')],actor);
 }
 async resume(value:unknown){
  const i=this.parse(resumeBrowserSchema,value),actor=await this.actor(i.companyId),fp=canonicalJson({actor,input:i}),prior=await this.replay(i.companyId,i.operationId,fp);if(prior)return {receipt:prior};
  const j=await this.job(i.companyId,i.jobId),s=await this.row(i.companyId,i.sessionId);
  const last=await this.db.prepare('SELECT id FROM po_cart_browser_sessions WHERE company_id=? AND job_id=? ORDER BY rowid DESC LIMIT 1').bind(i.companyId,i.jobId).first<{id:string}>();
  const observation=await this.db.prepare("SELECT observation_json FROM po_cart_browser_observations WHERE company_id=? AND session_id=? AND phase='close' AND verified=1").bind(i.companyId,i.sessionId).first<{observation_json:string}>();
  if(!this.signinEligible(j)||j.job.revision!==i.expectedRevision||s.revision!==i.expectedSessionRevision||s.job_id!==i.jobId||last?.id!==s.id||s.state!=='closed'||s.purpose!=='sign_in'||s.expires_at<=this.now()||!s.closed_at||!observation||this.check(j,JSON.parse(observation.observation_json),'sign_in')!=='verified')fail('conflict','This cart cannot safely resume. Only successfully closed, never-attempted sign-in recovery is eligible.');
  const use=await this.auth().guardedUse(i.companyId,j.job.authorizationId,j.job.requestedBy),r=this.receipt(s,i.operationId,i.action);
  r.revision=j.job.revision+1; // Resume changes the job; the closed session remains immutable.
  return this.commit(i.companyId,fp,r,[this.state(s),this.jobGuard(j),this.noAttempts(j),...use.guards,
   {sql:`EXISTS (SELECT 1 FROM po_cart_browser_sessions WHERE company_id=? AND id=? AND state='closed' AND expires_at>${this.time()}) AND NOT EXISTS (SELECT 1 FROM po_cart_browser_sessions WHERE company_id=? AND job_id=? AND rowid>(SELECT rowid FROM po_cart_browser_sessions WHERE company_id=? AND id=?))`,args:[i.companyId,s.id,...this.timeArgs(),i.companyId,i.jobId,i.companyId,s.id]},
   {sql:'EXISTS (SELECT 1 FROM po_cart_owners WHERE company_id=? AND job_id=? AND worker_id IS NULL AND fence=?)',args:[i.companyId,i.jobId,s.fence]},
  ],[this.db.prepare("UPDATE po_cart_jobs SET revision=revision+1,state='queued',kind='resume',actor=?,reason='Manager resumed after verified practice sign-in',updated_at=? WHERE company_id=? AND id=? AND revision=?").bind(actor,r.at,i.companyId,i.jobId,j.job.revision),
   this.db.prepare('UPDATE po_cart_owners SET fence=fence+1 WHERE company_id=? AND job_id=?').bind(i.companyId,i.jobId)],actor);
 }
 private check(j:CartJobStatus,cart:CartEntry[]|null,purpose:'sign_in'|'inspect'){
  if(!cart)return 'sign_in_required';
  const baseline=j.browserEvidence.find(e=>e.kind==='baseline'&&e.verified)?.observation;
  if(purpose==='sign_in'){if(checkBrowserCart('baseline',cart,j.job.inputs.preflight)!=='verified')return 'cart_mismatch';return baseline&&canonicalJson([...baseline].sort((a,b)=>a.sku.localeCompare(b.sku)))!==canonicalJson([...cart].sort((a,b)=>a.sku.localeCompare(b.sku)))?'baseline_changed':'verified';}
  if(j.job.state==='ready')return j.authorization.valid?checkBrowserCart('final',cart,j.job.inputs.preflight,baseline??[]):'permission_changed';
  return 'inspection_only';
 }
 private holdReady(j:CartJobStatus,reason:string,at:string){return j.job.state==='ready'?[this.db.prepare("UPDATE po_cart_jobs SET revision=revision+1,state='review_needed',kind='inspection',actor='system',reason=?,updated_at=? WHERE company_id=? AND id=? AND revision=?").bind(reason,at,j.job.companyId,j.job.id,j.job.revision)]:[];}
 async getWorker(id?:string){
  const a=this.options.workerAccess;if(!a||a.consumerKind!=='local_browser')fail('forbidden','Browser worker required.');await a.assertCurrent();
  if(!id)id=(await this.db.prepare("SELECT id FROM po_cart_browser_sessions WHERE company_id=? AND supplier_id=? AND account_id=? AND state IN ('requested','opening','open','closing') ORDER BY rowid LIMIT 1").bind(a.companyId,a.supplierId,a.accountId).first<{id:string}>())?.id;
  if(!id)return null;await this.scope(id);const current=await this.current(await this.row(a.companyId,id));await a.assertCurrent();return current;
 }
 async worker(value:unknown){
  const i=this.parse(sessionWorkerSchema,value),a=await this.scope(i.sessionId),fp=canonicalJson({actor:a.id,input:i}),prior=await this.replay(a.companyId,i.operationId,fp);if(prior)return this.result(prior);
  const s=await this.row(a.companyId,i.sessionId),j=await this.job(a.companyId,s.job_id),r=this.receipt(s,i.operationId,i.action),now=this.now();
  let guards=[this.state(s),this.jobGuard(j)],statements:D1PreparedStatement[]=[];
  if(i.action==='expire'){
   if(!activeBrowserStates.includes(s.state)||!(s.expires_at<=now||!!s.lease_until&&s.lease_until<=now))fail('conflict','Browser session has not expired.');
   guards.push({sql:`EXISTS (SELECT 1 FROM po_cart_browser_sessions WHERE company_id=? AND id=? AND (expires_at<=${this.time()} OR lease_until<=${this.time()}))`,args:[a.companyId,s.id,...this.timeArgs(),...this.timeArgs()]});
   statements=[this.update(s,'expired','connection_lost'),...this.holdReady(j,'Inspection expired; fresh verification required',now)];
  }else if(i.action==='claim'&&s.state==='closing'&&s.worker_id===null){
   statements=[this.update(s,'failed','browser_closed')];
  }else if(i.action==='claim'){
   if(s.state!=='requested'||!(await this.current(s)).session.allowed)fail('conflict','Browser session unavailable.');
   const o=j.ownership;if(!o||o.workerId!==null||o.fence!==s.fence)fail('conflict','Account ownership changed.');
   guards.push({sql:`EXISTS (SELECT 1 FROM po_cart_browser_sessions WHERE company_id=? AND id=? AND expires_at>${this.time()})`,args:[a.companyId,s.id,...this.timeArgs()]},{sql:MEMBER,args:[a.companyId,s.requested_by]});
   guards.push({sql:'EXISTS (SELECT 1 FROM po_cart_owners WHERE company_id=? AND supplier_id=? AND account_id=? AND fence=? AND worker_id IS NULL)',args:[a.companyId,s.supplier_id,s.account_id,s.fence]});
   if(s.purpose==='sign_in')guards.push(...(await this.auth().guardedUse(a.companyId,j.job.authorizationId,j.job.requestedBy)).guards,this.noAttempts(j));
   statements=[this.db.prepare('UPDATE po_cart_owners SET fence=fence+1 WHERE company_id=? AND supplier_id=? AND account_id=? AND fence=? AND worker_id IS NULL').bind(a.companyId,s.supplier_id,s.account_id,s.fence),
    this.update(s,'opening','worker_opening',',worker_id=?,lease_until=?,fence=fence+1',[a.id,new Date(Date.parse(now)+60000).toISOString()])];
  }else{
   if(!['opening','open','closing'].includes(s.state)||s.worker_id!==a.id||s.fence!==i.fence||!s.lease_until||s.lease_until<=now||s.expires_at<=now)fail('conflict','Browser lease lost.');
   guards.push({sql:`EXISTS (SELECT 1 FROM po_cart_browser_sessions WHERE company_id=? AND id=? AND worker_id=? AND fence=? AND lease_until>${this.time()} AND expires_at>${this.time()})`,args:[a.companyId,s.id,a.id,i.fence,...this.timeArgs(),...this.timeArgs()]});
   if(i.action==='heartbeat'){
    if(!(await this.current(s)).session.allowed)fail('conflict','Supervised access stopped.');
    guards.push({sql:MEMBER,args:[a.companyId,s.requested_by]});
    if(s.purpose==='sign_in')guards.push(...(await this.auth().guardedUse(a.companyId,j.job.authorizationId,j.job.requestedBy)).guards);
    statements=[this.update(s,s.state,s.reason,',lease_until=?',[new Date(Math.min(Date.parse(now)+60000,Date.parse(s.expires_at))).toISOString()])];
   }else if(i.action==='fail')statements=[this.update(s,'failed',i.reason),...this.holdReady(j,'Inspection could not be verified',now)];
   else{
    if(i.action==='opened'&&(s.state!=='opening'||!(await this.current(s)).session.allowed)||i.action==='complete'&&s.state!=='closing')fail('conflict','Browser lifecycle changed.');
    if(i.action==='opened'||i.action==='complete'&&(await this.current(s)).session.allowed){
     guards.push({sql:MEMBER,args:[a.companyId,s.requested_by]});
     if(s.purpose==='sign_in'||j.job.state==='ready'&&j.authorization.valid)guards.push(...(await this.auth().guardedUse(a.companyId,j.job.authorizationId,j.job.requestedBy)).guards);
    }
    let reason=this.check(j,i.cart,s.purpose);
    if(i.action==='complete'&&(s.reason==='permission_changed'||!(await this.current(s)).session.allowed))reason='permission_changed';
    statements=[this.db.prepare('INSERT INTO po_cart_browser_observations VALUES(?,?,?,?,?,?,?)').bind(a.companyId,s.id,i.action==='opened'?'open':'close',JSON.stringify(i.cart),Number(reason==='verified'),reason,now),
     this.update(s,i.action==='opened'?'open':s.purpose==='sign_in'&&reason!=='verified'?'failed':'closed',reason,i.action==='complete'?',closed_at=?':' ',i.action==='complete'?[now]:[]),
     ...(reason==='verified'?[]:this.holdReady(j,'Inspection changed or could not verify the complete cart',now))];
    if(i.action==='complete'&&s.purpose==='inspect'){
     if(!a.credentialId||!a.identityVersion)fail('forbidden','Authenticated inspection credential required.');
     const v=inspectCart(j,i.cart),safe=reason!=='permission_changed'&&s.reason==='manager_closed';
     statements.push(this.db.prepare(`INSERT INTO po_cart_reconciliation_evidence SELECT ?,?,?,j.revision,a.revision,?,?,?,?,?,?,?,?,?,?
      FROM po_cart_jobs j JOIN po_cart_authorizations a ON a.company_id=j.company_id AND a.id=j.authorization_id WHERE j.company_id=? AND j.id=?`)
      .bind(a.companyId,s.id,j.job.id,s.revision+1,s.fence,a.id,a.credentialId,a.identityVersion,Number(safe&&v.baselineVerified),Number(safe&&v.finalVerified),
       safe?v.baselineReason:'inspection_interrupted',safe?v.finalReason:'inspection_interrupted',now,a.companyId,j.job.id));
    }
   }
  }
  return this.commit(a.companyId,fp,r,guards,statements);
 }
}
