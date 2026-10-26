import type {z} from 'zod';
import {D1PurchasingSuppliers} from './d1-purchasing-suppliers';
import {D1PurchaseOrderDrafts} from './d1-purchase-order-drafts';
import {D1SupplierSuggestions,SupplierSuggestionError} from './d1-supplier-suggestions';
import type {CloverReviewPolicy} from './d1-replenishment-clover-source';
import {PurchaseOrderError} from './purchase-order-contract';
import {SupplierRegistryError} from './purchasing-supplier-contract';
import {canonicalJson,frozenCopy} from './supplier-simulation-contract';
import {latestDue,MAX_ATTEMPTS,proposedCap,saveScheduleSchema,scheduleFail as fail,scheduleStatusSchema,
  type OccurrenceState,type ScheduleStatus} from './po-draft-schedule-contract';

const MANAGER="EXISTS (SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))";
type Clock={now():Date};
type ScheduleRow={company_id:string;id:string;version:number;status:ScheduleStatus;supplier_id:string;account_id:string;location_id:string;weekday:number;
  local_time:string;margin_percent:number;responsible_user_id:string;reason:string;actor:string;created_at:string;operation_id:string;fingerprint:string};
type OccurrenceRow={company_id:string;schedule_id:string;week_key:string;schedule_version:number;due_at:string;time_zone:string;state:OccurrenceState;
  reason:string|null;attempts:number;holder:string;lease_until:string|null;next_attempt_at:string|null;draft_actor:string|null;draft_input_json:string|null;
  order_id:string|null;result_json:string|null;created_at:string;updated_at:string};
const LATEST=`SELECT s.* FROM po_draft_schedules s WHERE s.company_id=? AND s.version=(SELECT MAX(version) FROM po_draft_schedules WHERE company_id=s.company_id AND id=s.id)`;
const view=(s:ScheduleRow)=>({id:s.id,version:s.version,status:s.status,supplierId:s.supplier_id,accountId:s.account_id,locationId:s.location_id,weekday:s.weekday,
  localTime:s.local_time,marginPercent:s.margin_percent,responsibleUserId:s.responsible_user_id,reason:s.reason,changedBy:s.actor,changedAt:s.created_at});
async function timeZone(db:D1Database,companyId:string){
  return (await db.prepare('SELECT time_zone FROM company_time_zones WHERE company_id=? ORDER BY version DESC LIMIT 1').bind(companyId).first<{time_zone:string}>())?.time_zone??null;
}

/** Owner and manager schedule settings: appended versions, replay-safe, one supplier-list group each. */
export class D1PoDraftSchedules {
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<string|null>;clock?:Clock}){}
  private now(){return (this.options.clock?.now()??new Date()).toISOString();}
  private parse<T>(schema:z.ZodType<T>,value:unknown):T{
    const parsed=schema.safeParse(value);
    if(!parsed.success)fail('invalid_request',parsed.error.issues.find(i=>i.path[0]==='localTime')?.message??'Check the schedule fields.');
    return parsed.data;
  }
  private async actor(companyId:string){
    const actor=await this.options.identity();
    if(!actor||!await this.db.prepare(`SELECT 1 WHERE ${MANAGER}`).bind(companyId,actor).first())fail('forbidden','Manager or owner membership is required.');
    return actor!;
  }
  private async latest(companyId:string,scheduleId:string){
    return this.db.prepare(`${LATEST} AND s.id=?`).bind(companyId,scheduleId).first<ScheduleRow>();
  }
  private async replay(companyId:string,operationId:string,fingerprint:string){
    const row=await this.db.prepare('SELECT * FROM po_draft_schedules WHERE company_id=? AND operation_id=?').bind(companyId,operationId).first<ScheduleRow>();
    if(!row)return null;
    if(row.fingerprint!==fingerprint)fail('conflict','Operation identity was used for another schedule change or person.');
    return frozenCopy(view(row));
  }
  private async append(companyId:string,actor:string,operationId:string,fingerprint:string,row:Omit<ScheduleRow,'company_id'|'actor'|'created_at'|'operation_id'|'fingerprint'>){
    try{
      if(await this.actor(companyId)!==actor)fail('forbidden','Session changed before saving.');
      await this.db.prepare(`INSERT INTO po_draft_schedules(company_id,id,version,status,supplier_id,account_id,location_id,weekday,local_time,margin_percent,
        responsible_user_id,reason,actor,created_at,operation_id,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(companyId,row.id,row.version,row.status,
        row.supplier_id,row.account_id,row.location_id,row.weekday,row.local_time,row.margin_percent,row.responsible_user_id,row.reason,actor,this.now(),operationId,fingerprint).run();
    }catch{
      await this.actor(companyId);const replayed=await this.replay(companyId,operationId,fingerprint);if(replayed)return replayed;
      fail('conflict','The schedule, supplier or memberships changed; nothing was saved. Reload and try again.');
    }
    return (await this.replay(companyId,operationId,fingerprint))??fail('storage_failure','Save outcome is uncertain. Retry the same operation identity.');
  }
  async list(companyId:string){
    await this.actor(companyId);
    const schedules=(await this.db.prepare(`${LATEST} ORDER BY s.id`).bind(companyId).all<ScheduleRow>()).results;
    const weeks=(await this.db.prepare(`SELECT o.*,d.number AS order_number,d.status AS order_status FROM po_draft_occurrences o
      LEFT JOIN purchase_order_drafts d ON d.company_id=o.company_id AND d.id=o.order_id WHERE o.company_id=? ORDER BY o.week_key DESC LIMIT 200`).bind(companyId)
      .all<OccurrenceRow&{order_number:string|null;order_status:string|null}>()).results;
    const zone=await timeZone(this.db,companyId),now=Date.parse(this.now());
    return frozenCopy({timeZone:zone,schedules:schedules.map(s=>{
      const due=zone?latestDue(now,s.weekday,s.local_time,zone):null;
      return {...view(s),nextRun:zone&&s.status==='active'?latestDue(now+7*86_400_000,s.weekday,s.local_time,zone).dueAt:null,lastDue:due?.dueAt??null,
        weeks:weeks.filter(w=>w.schedule_id===s.id).slice(0,8).map(w=>({weekKey:w.week_key,dueAt:w.due_at,state:w.state,reason:w.reason,attempts:w.attempts,
          orderId:w.order_id,orderNumber:w.order_number,orderStatus:w.order_status,updatedAt:w.updated_at}))};
    })});
  }
  async save(value:unknown){
    const input=this.parse(saveScheduleSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.replay(input.companyId,input.operationId,fingerprint);if(prior)return prior;
    const current=await this.latest(input.companyId,input.scheduleId);
    if((current?.version??0)!==input.expectedVersion)fail('conflict','This schedule changed; reload before saving.');
    if(current&&(current.supplier_id!==input.supplierId||current.account_id!==input.accountId||current.location_id!==input.locationId))
      fail('invalid_request','A schedule keeps its supplier, account and delivery location; create another schedule instead.');
    if(!await timeZone(this.db,input.companyId))fail('conflict','The owner must set the café\'s time zone first.');
    if(!await this.db.prepare(`SELECT 1 WHERE ${MANAGER}`).bind(input.companyId,input.responsibleUserId).first())
      fail('invalid_request','The responsible person must be a current owner or manager.');
    try{
      const registry=new D1PurchasingSuppliers(this.db,{identity:async()=>actor,clock:this.options.clock});
      const profile=await registry.profile(input.companyId,input.supplierId);
      await registry.draftSources(input.companyId,input.supplierId,profile.version,input.accountId,input.locationId,[]);
    }catch(error){if(error instanceof SupplierRegistryError)fail('invalid_request','Choose an active supplier, account and delivery location.');throw error;}
    return this.append(input.companyId,actor,input.operationId,fingerprint,{id:input.scheduleId,version:input.expectedVersion+1,status:current?.status??'active',
      supplier_id:input.supplierId,account_id:input.accountId,location_id:input.locationId,weekday:input.weekday,local_time:input.localTime,
      margin_percent:input.marginPercent,responsible_user_id:input.responsibleUserId,reason:input.reason});
  }
  async setStatus(value:unknown){
    const input=this.parse(scheduleStatusSchema,value),actor=await this.actor(input.companyId),fingerprint=canonicalJson({actor,input});
    const prior=await this.replay(input.companyId,input.operationId,fingerprint);if(prior)return prior;
    const current=await this.latest(input.companyId,input.scheduleId);
    if(!current)fail('missing','Schedule not found.');
    if(current!.version!==input.expectedVersion)fail('conflict','This schedule changed; reload before saving.');
    const status=input.action==='pause'?'paused':'active';
    if(current!.status===status)fail('conflict',status==='paused'?'This schedule is already paused.':'This schedule is already active.');
    return this.append(input.companyId,actor,input.operationId,fingerprint,{...current!,version:current!.version+1,status,reason:input.reason});
  }
}

/**
 * The weekly check for one company. Each schedule's latest due week is claimed once and fenced by
 * attempt and holder; earlier missed weeks are never drafted. The draft input is saved before the
 * draft is created, so a retry after a lost acknowledgment replays the same draft. Schedules only
 * create drafts for review.
 */
export class D1PoDraftScheduler {
  private readonly holder:string;
  constructor(private readonly db:D1Database,private readonly options:{clock?:Clock;salesPolicy:CloverReviewPolicy;holder?:string;leaseMs?:number;retryMs?:number}){
    this.holder=options.holder??crypto.randomUUID();
  }
  private nowMs(){return (this.options.clock?.now()??new Date()).getTime();}
  private iso(ms:number){return new Date(ms).toISOString();}
  async tick(companyId:string){
    const now=this.nowMs(),at=this.iso(now),zone=await timeZone(this.db,companyId);
    if(!zone)return frozenCopy({companyId,ran:false,reason:'time_zone_missing',weeks:[]});
    await this.db.prepare(`INSERT INTO po_draft_tick_leases(company_id,holder,lease_until) VALUES (?,?,?)
      ON CONFLICT(company_id) DO UPDATE SET holder=excluded.holder,lease_until=excluded.lease_until WHERE po_draft_tick_leases.lease_until<=?`)
      .bind(companyId,this.holder,this.iso(now+(this.options.leaseMs??300_000)),at).run();
    const lease=await this.db.prepare('SELECT holder FROM po_draft_tick_leases WHERE company_id=?').bind(companyId).first<{holder:string}>();
    if(lease?.holder!==this.holder)return frozenCopy({companyId,ran:false,reason:'another_check_running',weeks:[]});
    const weeks:{scheduleId:string;weekKey:string;state:OccurrenceState;reason:string|null;orderId:string|null}[]=[];
    try{
      for(const s of (await this.db.prepare(`${LATEST} ORDER BY s.id`).bind(companyId).all<ScheduleRow>()).results){
        const due=latestDue(now,s.weekday,s.local_time,zone);
        // Older weeks still waiting to retry are replaced by the latest week.
        for(const old of (await this.db.prepare(`SELECT * FROM po_draft_occurrences WHERE company_id=? AND schedule_id=? AND week_key<? AND state IN ('running','retry')`)
          .bind(companyId,s.id,due.weekKey).all<OccurrenceRow>()).results){
          const claimed=await this.reclaim(old,now);
          if(claimed)weeks.push(await this.finish(claimed,now,'held','A later week replaced this one.'));
          else if(old.state==='running'&&old.attempts>=MAX_ATTEMPTS&&old.lease_until!<=at)
            weeks.push(await this.finish(old,now,'failed',`Stopped after ${MAX_ATTEMPTS} attempts.`,undefined,old.holder));
        }
        if(due.dueAt<s.created_at)continue;
        let occurrence=await this.occurrence(companyId,s.id,due.weekKey);
        if(!occurrence){
          try{
            await this.db.prepare(`INSERT INTO po_draft_occurrences(company_id,schedule_id,week_key,schedule_version,due_at,time_zone,state,reason,attempts,holder,lease_until,
              next_attempt_at,draft_actor,draft_input_json,order_id,result_json,created_at,updated_at) VALUES (?,?,?,?,?,?,'running',NULL,1,?,?,NULL,NULL,NULL,NULL,NULL,?,?)`)
              .bind(companyId,s.id,due.weekKey,s.version,due.dueAt,zone,this.holder,this.iso(now+(this.options.leaseMs??300_000)),at,at).run();
          }catch{continue;}
          occurrence=await this.occurrence(companyId,s.id,due.weekKey);
          if(occurrence?.holder!==this.holder||occurrence.state!=='running'||occurrence.attempts!==1)continue;
        }else{
          const claimed=await this.reclaim(occurrence,now);
          if(!claimed){
            if(occurrence.state==='running'&&occurrence.attempts>=MAX_ATTEMPTS&&occurrence.lease_until!<=at)
              weeks.push(await this.finish(occurrence,now,'failed',`Stopped after ${MAX_ATTEMPTS} attempts.`,undefined,occurrence.holder));
            continue;
          }
          occurrence=claimed;
        }
        weeks.push(await this.run(occurrence!,s,now));
      }
    }finally{
      await this.db.prepare('UPDATE po_draft_tick_leases SET lease_until=? WHERE company_id=? AND holder=?').bind(at,companyId,this.holder).run();
    }
    return frozenCopy({companyId,ran:true,reason:null,weeks});
  }
  private occurrence(companyId:string,scheduleId:string,weekKey:string){
    return this.db.prepare('SELECT * FROM po_draft_occurrences WHERE company_id=? AND schedule_id=? AND week_key=?').bind(companyId,scheduleId,weekKey).first<OccurrenceRow>();
  }
  /** Takes a week waiting to retry, or one whose holder's lease expired, as the next attempt. */
  private async reclaim(o:OccurrenceRow,now:number){
    const at=this.iso(now),ready=(o.state==='retry'&&o.next_attempt_at!<=at)||(o.state==='running'&&o.lease_until!<=at);
    if(!ready||o.attempts>=MAX_ATTEMPTS)return null;
    await this.db.prepare(`UPDATE po_draft_occurrences SET state='running',reason=NULL,attempts=attempts+1,holder=?,lease_until=?,next_attempt_at=NULL,updated_at=?
      WHERE company_id=? AND schedule_id=? AND week_key=? AND state=? AND attempts=? AND holder=?`).bind(this.holder,this.iso(now+(this.options.leaseMs??300_000)),at,
      o.company_id,o.schedule_id,o.week_key,o.state,o.attempts,o.holder).run().catch(()=>null);
    const next=await this.occurrence(o.company_id,o.schedule_id,o.week_key);
    return next?.state==='running'&&next.holder===this.holder&&next.attempts===o.attempts+1?next:null;
  }
  private async finish(o:OccurrenceRow,now:number,state:Exclude<OccurrenceState,'running'|'retry'>,reason:string|null,extra:{orderId?:string;result?:unknown}={},holder=this.holder){
    const at=this.iso(now);
    await this.db.prepare(`UPDATE po_draft_occurrences SET state=?,reason=?,order_id=?,result_json=?,draft_input_json=?,lease_until=NULL,next_attempt_at=NULL,updated_at=?
      WHERE company_id=? AND schedule_id=? AND week_key=? AND state='running' AND attempts=? AND holder=?`).bind(state,reason,extra.orderId??null,
      extra.result===undefined?null:JSON.stringify(extra.result),state==='drafted'||state==='failed'?o.draft_input_json:null,at,
      o.company_id,o.schedule_id,o.week_key,o.attempts,holder).run();
    return {scheduleId:o.schedule_id,weekKey:o.week_key,state,reason,orderId:extra.orderId??null};
  }
  private async retry(o:OccurrenceRow,now:number,reason:string,keepInput:boolean){
    if(o.attempts>=MAX_ATTEMPTS)return this.finish(o,now,'failed',`${reason} Stopped after ${MAX_ATTEMPTS} attempts.`);
    const at=this.iso(now);
    await this.db.prepare(`UPDATE po_draft_occurrences SET state='retry',reason=?,next_attempt_at=?,lease_until=NULL,draft_input_json=?,updated_at=?
      WHERE company_id=? AND schedule_id=? AND week_key=? AND state='running' AND attempts=? AND holder=?`).bind(reason,this.iso(now+(this.options.retryMs??900_000)*o.attempts),
      keepInput?o.draft_input_json:null,at,o.company_id,o.schedule_id,o.week_key,o.attempts,this.holder).run();
    return {scheduleId:o.schedule_id,weekKey:o.week_key,state:'retry' as const,reason,orderId:null};
  }
  private async run(o:OccurrenceRow,s:ScheduleRow,now:number){
    if(!o.draft_input_json){
      if(s.status==='paused')return this.finish(o,now,'skipped_paused','The schedule is paused.');
      if(!await this.db.prepare(`SELECT 1 WHERE ${MANAGER}`).bind(s.company_id,s.responsible_user_id).first())
        return this.finish(o,now,'held','The responsible person is no longer an owner or manager.');
      const waiting=await this.db.prepare(`SELECT o.week_key,d.number FROM po_draft_occurrences o JOIN purchase_order_drafts d ON d.company_id=o.company_id AND d.id=o.order_id
        WHERE o.company_id=? AND o.schedule_id=? AND o.week_key<? AND o.state='drafted' AND d.status='draft' ORDER BY o.week_key DESC LIMIT 1`)
        .bind(s.company_id,s.id,o.week_key).first<{week_key:string;number:string}>();
      if(waiting)return this.finish(o,now,'skipped_waiting',`Draft ${waiting.number} from the week of ${waiting.week_key} is still waiting for review.`);
      let suggestion;
      try{
        suggestion=await new D1SupplierSuggestions(this.db,{identity:async()=>s.responsible_user_id,clock:this.options.clock,salesPolicy:this.options.salesPolicy})
          .suggest({companyId:s.company_id,supplierId:s.supplier_id,accountId:s.account_id,locationId:s.location_id});
      }catch(error){
        if(error instanceof SupplierSuggestionError)return this.finish(o,now,'held',error.code==='forbidden'?'The responsible person is no longer an owner or manager.'
          :'The supplier, account or delivery location is no longer active.');
        return this.retry(o,now,'Suggestions could not be calculated.',false);
      }
      const result={calculatedAt:suggestion.calculatedAt,sales:suggestion.sales,lines:suggestion.lines.map(l=>({mappingId:l.mappingId,description:l.description,packs:l.packs,attention:l.attention})),
        held:suggestion.held,notNeeded:suggestion.notNeeded.length};
      // Durable proposals need current sales data; a weekly draft follows the same rule.
      if(suggestion.sales.status!=='current')return this.finish(o,now,'held','Sales data is not up to date, so the suggestions could miss recent sales.',{result});
      if(!suggestion.lines.length)return this.finish(o,now,'nothing_needed','Nothing needs ordering from this supplier this week.',{result});
      const priced=suggestion.lines.filter(l=>l.estimatedLineMinor!==null),known=priced.reduce((t,l)=>t+BigInt(l.estimatedLineMinor!),BigInt(0));
      if(known===BigInt(0))return this.finish(o,now,'held','None of the suggested items has an estimated price, so no cap can be proposed.',{result});
      const notes=[`Created by the weekly schedule for the week of ${o.week_key}. Review before preparing a cart.`,
        priced.length<suggestion.lines.length?`${suggestion.lines.length-priced.length} item(s) have no estimated price and are not in the proposed cap.`:'',
        suggestion.held.length?`${suggestion.held.length} item(s) were held for review.`:'',
        suggestion.lines.some(l=>l.attention.length)?'Some counts are overdue; check them before ordering.':''].filter(Boolean).join(' ');
      const input={action:'create',companyId:s.company_id,operationId:`weekly:${s.id}:${o.week_key}`,source:'registry',
        supplierRef:{id:suggestion.supplier.id,version:suggestion.supplier.version,accountId:s.account_id,locationId:s.location_id},
        capMinor:proposedCap(known,s.margin_percent).toString(),notes,lines:suggestion.lines.map(l=>({kind:'stock',mappingId:l.mappingId,mappingVersion:l.mappingVersion,packs:l.packs}))};
      // Saved before the draft is created: a retry after an uncertain create replays this exact input.
      await this.db.prepare(`UPDATE po_draft_occurrences SET draft_input_json=?,draft_actor=?,updated_at=? WHERE company_id=? AND schedule_id=? AND week_key=?
        AND state='running' AND attempts=? AND holder=? AND draft_input_json IS NULL`).bind(JSON.stringify({input,result}),s.responsible_user_id,this.iso(now),
        o.company_id,o.schedule_id,o.week_key,o.attempts,this.holder).run();
      const saved=await this.occurrence(o.company_id,o.schedule_id,o.week_key);
      if(saved?.state!=='running'||saved.holder!==this.holder||saved.attempts!==o.attempts||!saved.draft_input_json)return {scheduleId:o.schedule_id,weekKey:o.week_key,state:'running' as const,reason:'Another check took this week.',orderId:null};
      o=saved;
    }
    const {input,result}=JSON.parse(o.draft_input_json!) as {input:unknown;result:unknown};
    try{
      const draft=await new D1PurchaseOrderDrafts(this.db,{identity:async()=>o.draft_actor,clock:this.options.clock,salesPolicy:this.options.salesPolicy}).create(input);
      return this.finish(o,now,'drafted',null,{orderId:draft.snapshot.id,result});
    }catch(error){
      if(error instanceof PurchaseOrderError&&error.code==='forbidden')return this.retry(o,now,'The responsible person could not create the draft.',false);
      // A definite refusal saved nothing, so the next attempt recalculates; an uncertain one replays the same input.
      if(error instanceof PurchaseOrderError&&error.code!=='storage_failure')return this.retry(o,now,'Stock or the supplier list changed while drafting.',false);
      return this.retry(o,now,'The draft save outcome is uncertain; the next attempt replays it.',true);
    }
  }
}
