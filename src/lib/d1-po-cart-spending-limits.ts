import {z} from 'zod';
import {canonicalJson,frozenCopy} from './supplier-simulation-contract';
import {recentlyVerified,type ReauthenticationState} from './reauthentication';
import {SPENDING_LIMIT_NOTICE,validTimeZone,loosens,setCompanyTimeZoneSchema,setSpendingLimitsSchema,spendingLimitFail as fail,
  spendingLimitsQuerySchema,spendingWindow,usageSql,type CompanyTimeZone,type SpendingLimits,type SpendingLimitsReceipt,
  type SpendingLimitsResult,type SpendingLimitsStatus,type SpendingUsage} from './po-cart-spending-limits-contract';

type Identity=ReauthenticationState&{userId:string};
type PolicyRow={version:number;per_order_minor:number;per_day_minor:number|null;per_month_minor:number|null;outstanding_minor:number;
  actor:string|null;created_at:string|null;operation_id:string|null;fingerprint:string|null};
type ZoneRow={version:number;time_zone:string;actor:string;created_at:string;operation_id:string;fingerprint:string};

const limits=(r:PolicyRow):SpendingLimits=>({version:r.version,perOrderMinor:r.per_order_minor,perDayMinor:r.per_day_minor,
  perMonthMinor:r.per_month_minor,outstandingMinor:r.outstanding_minor,ownerSet:r.actor!==null,actor:r.actor,createdAt:r.created_at});
const zone=(r:ZoneRow):CompanyTimeZone=>({version:r.version,timeZone:r.time_zone,actor:r.actor,createdAt:r.created_at});

/** Owner-only spending limits for the fictional cart preview. The database guards and audits every version. */
export class D1PoCartSpendingLimits {
  constructor(private readonly db:D1Database,private readonly options:{identity:()=>Promise<Identity|null>;clock?:{now():Date}}) {}
  private now(){return (this.options.clock?.now()??new Date());}
  private parse<T>(schema:z.ZodType<T>,value:unknown):T {
    const parsed=schema.safeParse(value);
    if(!parsed.success)fail('invalid_request',parsed.error.issues.find(i=>i.code==='custom')?.message??
      'Enter whole-cent limits, the expected version and a UUID operation identity.');
    return parsed.data;
  }
  private async owner(companyId:string):Promise<Identity> {
    const user=await this.options.identity();
    if(!user||!await this.db.prepare(`SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role='owner'`).bind(companyId,user.userId).first())
      fail('forbidden','Only the company owner can view or change spending limits.');
    return user;
  }
  private requireVerified(user:Identity,what:string){
    if(!recentlyVerified(user,this.now().getTime()))fail('reauthentication_required',`Confirm your password to ${what}.`);
  }
  async get(value:unknown):Promise<SpendingLimitsStatus> {
    const {companyId}=this.parse(spendingLimitsQuerySchema,value),user=await this.owner(companyId);
    return this.status(companyId,user.userId);
  }
  private async status(companyId:string,actor:string):Promise<SpendingLimitsStatus> {
    const [policies,zones]=await this.db.batch([
      this.db.prepare('SELECT * FROM po_cart_budget_policies WHERE company_id=? ORDER BY version DESC').bind(companyId),
      this.db.prepare('SELECT * FROM company_time_zones WHERE company_id=? ORDER BY version DESC').bind(companyId)]);
    const history=(policies.results as PolicyRow[]).map(limits),timeZoneHistory=(zones.results as ZoneRow[]).map(zone);
    const timeZone=timeZoneHistory[0]??null;
    const usage=timeZone?await this.usage(companyId,timeZone,this.now().toISOString()):null;
    if(!await this.db.prepare(`SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role='owner'`).bind(companyId,actor).first())
      fail('forbidden','Owner membership changed during the read.');
    return frozenCopy({limits:history[0]??null,timeZone,usage,history,timeZoneHistory,notice:SPENDING_LIMIT_NOTICE});
  }
  /** Current day/month exposure in the café's time zone, using the reservation guard's rule. */
  async usage(companyId:string,timeZone:CompanyTimeZone,at:string):Promise<SpendingUsage> {
    const window=spendingWindow(at,timeZone.timeZone,timeZone.version),day=usageSql('day'),month=usageSql('month');
    const [d,m,o]=await this.db.batch([
      this.db.prepare(day.sql).bind(companyId,...day.keys.map(k=>window[k])),
      this.db.prepare(month.sql).bind(companyId,...month.keys.map(k=>window[k])),
      this.db.prepare(`SELECT COALESCE(SUM(total_minor),0) AS used FROM po_cart_reservations WHERE company_id=? AND state='reserved'`).bind(companyId)]);
    const used=(r:D1Result)=>Number((r.results[0] as {used:number}).used);
    return {window,dayMinor:used(d),monthMinor:used(m),outstandingMinor:used(o)};
  }
  private async latest<T>(table:'po_cart_budget_policies'|'company_time_zones',companyId:string){
    return this.db.prepare(`SELECT * FROM ${table} WHERE company_id=? ORDER BY version DESC LIMIT 1`).bind(companyId).first<T>();
  }
  private async replay(table:'po_cart_budget_policies'|'company_time_zones',companyId:string,operationId:string,fingerprint:string,
    action:SpendingLimitsReceipt['action']):Promise<SpendingLimitsReceipt|null> {
    const row=await this.db.prepare(`SELECT version,actor,created_at,fingerprint FROM ${table} WHERE company_id=? AND operation_id=?`)
      .bind(companyId,operationId).first<{version:number;actor:string;created_at:string;fingerprint:string}>();
    if(!row)return null;
    if(row.fingerprint!==fingerprint)fail('conflict','Operation identity was used for another request or actor.');
    return {operationId,action,version:row.version,actor:row.actor,at:row.created_at};
  }
  private async commit(table:'po_cart_budget_policies'|'company_time_zones',companyId:string,operationId:string,fingerprint:string,
    action:SpendingLimitsReceipt['action'],actor:string,statement:D1PreparedStatement):Promise<SpendingLimitsResult> {
    try {await this.db.batch([statement]);}
    catch {
      const replay=await this.replay(table,companyId,operationId,fingerprint,action);
      if(replay)return frozenCopy({receipt:replay,current:await this.status(companyId,actor)});
      fail('conflict','Spending limits, time zone or owner membership changed; nothing was saved.');
    }
    const saved=await this.replay(table,companyId,operationId,fingerprint,action);
    if(!saved)fail('storage_failure','Save outcome is uncertain. Retry the same operation identity.');
    return frozenCopy({receipt:saved,current:await this.status(companyId,actor)});
  }
  async setLimits(value:unknown):Promise<SpendingLimitsResult> {
    const input=this.parse(setSpendingLimitsSchema,value),user=await this.owner(input.companyId),actor=user.userId;
    const fingerprint=canonicalJson({actor,input});
    const prior=await this.replay('po_cart_budget_policies',input.companyId,input.operationId,fingerprint,'set_limits');
    if(prior)return frozenCopy({receipt:prior,current:await this.status(input.companyId,actor)});
    const current=await this.latest<PolicyRow>('po_cart_budget_policies',input.companyId);
    if((current?.version??0)!==input.expectedVersion)fail('conflict','Spending limits changed; reload before saving.');
    if(!await this.latest<ZoneRow>('company_time_zones',input.companyId))fail('time_zone_required','Set the café time zone before spending limits.');
    if(loosens(current?limits(current):null,input))this.requireVerified(user,'raise, remove or first set spending limits');
    return this.commit('po_cart_budget_policies',input.companyId,input.operationId,fingerprint,'set_limits',actor,
      this.db.prepare(`INSERT INTO po_cart_budget_policies(company_id,version,per_order_minor,outstanding_minor,per_day_minor,per_month_minor,
        actor,created_at,operation_id,fingerprint) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(input.companyId,input.expectedVersion+1,input.perOrderMinor,
        input.outstandingMinor,input.perDayMinor,input.perMonthMinor,actor,this.now().toISOString(),input.operationId,fingerprint));
  }
  /** Moving the day boundary can free daily budget, so every change asks for the password. */
  async setTimeZone(value:unknown):Promise<SpendingLimitsResult> {
    const input=this.parse(setCompanyTimeZoneSchema,value),user=await this.owner(input.companyId),actor=user.userId;
    if(!validTimeZone(input.timeZone))fail('invalid_request','Choose a time zone such as America/New_York.');
    const fingerprint=canonicalJson({actor,input});
    const prior=await this.replay('company_time_zones',input.companyId,input.operationId,fingerprint,'set_time_zone');
    if(prior)return frozenCopy({receipt:prior,current:await this.status(input.companyId,actor)});
    const current=await this.latest<ZoneRow>('company_time_zones',input.companyId);
    if((current?.version??0)!==input.expectedVersion)fail('conflict','Time zone changed; reload before saving.');
    if(current?.time_zone===input.timeZone)fail('invalid_request','That time zone is already set.');
    this.requireVerified(user,'change the café time zone');
    return this.commit('company_time_zones',input.companyId,input.operationId,fingerprint,'set_time_zone',actor,
      this.db.prepare(`INSERT INTO company_time_zones(company_id,version,time_zone,actor,created_at,operation_id,fingerprint)
        VALUES (?,?,?,?,?,?,?)`).bind(input.companyId,input.expectedVersion+1,input.timeZone,actor,this.now().toISOString(),input.operationId,fingerprint));
  }
}
