import {consumptionInstant} from '@/lib/inventory-consumption-engine';
import {curatedUnit, customUnit, readCanonical, toCanonical, type UnitDefinition} from '@/lib/inventory-quantities';
import type {UnitDimension} from '@/lib/inventory-consumption-contract';

type Unit = {unit_id:string;version:number;kind:string;dimension:UnitDimension|null;label:string;
  numerator:string|null;denominator:string|null;retired_at:string|null};
type Config = {id:string;status:string;stock_unit_id:string;stock_unit_version:number};
type Balance = {config_id:string;dimension:UnitDimension;on_hand_minor:string;incoming_minor:string;
  estimated_used_minor:string;version:number;latest_count_effective_at:string|null};
type Event = {id:string;product_id:string;action:string;quantity_minor:string|null;note:string};
type State = {products:{id:string}[];units:Unit[];configs:Config[];balances:Balance[];
  events:Event[];counts:{id:string}[];legacyInventory:{version:number}[];legacyEvents:{id:string}[]};
const parts = {
  products:['products','id','owner=(SELECT company FROM context) AND id=(SELECT product FROM context)','id'],
  units:['product_unit_versions','unit_id version kind dimension label numerator denominator retired_at','','unit_id,version'],
  configs:['inventory_config_versions','id status stock_unit_id stock_unit_version','','id'],
  balances:['inventory_balances_exact','config_id dimension on_hand_minor incoming_minor estimated_used_minor version latest_count_effective_at','','version'],
  events:['inventory_events_exact','id product_id action quantity_minor note','','id'],
  counts:['inventory_reconciliations','id','','id'],
  legacyInventory:['inventory','version','','version'],
  legacyEvents:['inventory_events','id','','id'],
} as const;
const SNAPSHOT = `WITH context AS (SELECT ? AS company, ? AS product)
  SELECT json_object(${Object.entries(parts).map(([name,[table,columns,special,order]])=>
    `'${name}',json((SELECT json_group_array(json_object(${columns.split(' ').map(column=>`'${column}',${column}`).join(',')}))
      FROM (SELECT ${columns.split(' ').join(',')} FROM ${table}
        WHERE ${table==='products'?special:'company_id=(SELECT company FROM context) AND product_id=(SELECT product FROM context)'}
        ORDER BY ${order})))`).join(',')}) AS snapshot`;
export class StockMovementError extends Error {
  constructor(public readonly code:'unauthenticated'|'forbidden'|'not_found'|'invalid_input'|'conflict'|'duplicate_key'|'opening_count_required',message:string){super(message);}
}
function fail(code:StockMovementError['code'],message:string):never{throw new StockMovementError(code,message);}
function identity(value:string){if(typeof value!=='string'||!value.trim()||value.length>200)fail('invalid_input','An identity is missing or too long.');}
type Action = 'receive'|'use'|'waste'|'incoming';
type Input = {id:string;action:Action;unitId:string;unitVersion:number;amount:string;note?:string;fromIncoming?:boolean};

/** Internal company-scoped exact stock writer. The actor must come from a verified session. */
export class ExactStockMovementService {
  constructor(private readonly db:D1Database,private readonly companyId:string,private readonly userId:string|null,
    private readonly clock:()=>string=()=>new Date().toISOString(),private readonly idFactory:()=>string=()=>crypto.randomUUID()){identity(companyId);}
  private async authorize(){
    if(!this.userId)fail('unauthenticated','Sign in before updating stock.');
    const member=await this.db.prepare('SELECT role FROM memberships WHERE company_id=? AND user_id=?')
      .bind(this.companyId,this.userId).first<{role:string}>();
    if(!member||!['owner','manager'].includes(member.role))fail('forbidden','Only this company’s owner or manager can update stock.');
  }
  async inspect(productId:string):Promise<{token:string;balance:Balance|null}>{
    identity(productId);await this.authorize();
    const row=await this.db.prepare(SNAPSHOT).bind(this.companyId,productId).first<{snapshot:string}>();
    if(!row)throw new Error('Stock snapshot unavailable.');
    const state=JSON.parse(row.snapshot) as State;
    if(state.products.length!==1)fail('not_found','Product not found in this company.');
    return {token:row.snapshot,balance:state.balances[0]??null};
  }
  async record(productId:string,input:Input,expected:string){
    const data=structuredClone(input),current=await this.inspect(productId);
    if(!data||!['receive','use','waste','incoming'].includes(data.action))fail('invalid_input','Choose a stock action.');
    identity(data.id);identity(data.unitId);
    if(data.note!==undefined&&(typeof data.note!=='string'||data.note.length>300))fail('invalid_input','The note is too long.');
    if(data.fromIncoming!==undefined&&typeof data.fromIncoming!=='boolean')fail('invalid_input','Invalid delivery option.');
    if(data.action!=='receive'&&data.fromIncoming)fail('invalid_input','Only deliveries can reduce incoming stock.');
    const existing=await this.db.prepare('SELECT product_id,action,note FROM inventory_events_exact WHERE company_id=? AND id=?')
      .bind(this.companyId,data.id).first<{product_id:string;action:string;note:string}>();
    const fingerprint=JSON.stringify({productId,action:data.action,unitId:data.unitId,unitVersion:data.unitVersion,
      amount:data.amount,note:data.note?.trim()??'',fromIncoming:data.fromIncoming===true});
    if(existing){
      if(existing.product_id!==productId||existing.action!==data.action||existing.note!==fingerprint)fail('duplicate_key','This update ID was used for different stock input.');
      return {id:data.id,replayed:true};
    }
    if(current.token!==expected)fail('conflict','Stock changed. Reload before saving.');
    const state=JSON.parse(current.token) as State;
    const active=state.configs.filter(config=>config.status==='active'),balance=state.balances[0];
    if(active.length!==1||state.balances.length!==1||!balance||balance.config_id!==active[0].id||
      !Number.isSafeInteger(balance.version)||balance.version<0)fail('invalid_input','Classify this product before updating stock.');
    if(data.action!=='incoming'&&!balance.latest_count_effective_at)fail('opening_count_required','Record an opening physical count first.');
    const unit=state.units.find(row=>row.unit_id===data.unitId&&row.version===data.unitVersion);
    if(!unit||unit.retired_at||!unit.dimension||!['curated','custom'].includes(unit.kind)||
      data.unitVersion!==Math.max(...state.units.filter(row=>row.unit_id===data.unitId).map(row=>row.version)))fail('invalid_input','Choose a current classified unit.');
    let definition:UnitDefinition;
    if(unit.kind==='curated'){
      definition=curatedUnit(unit.unit_id);
      if(definition.version!==unit.version||definition.dimension!==unit.dimension||
        definition.numerator!==unit.numerator||definition.denominator!==unit.denominator)fail('invalid_input','Stored unit differs from its catalog.');
    }else definition=customUnit({id:unit.unit_id,version:unit.version,label:unit.label,dimension:unit.dimension,
      numerator:unit.numerator!,denominator:unit.denominator!,companyId:this.companyId,productId});
    const quantity=toCanonical(data.amount,definition,{companyId:this.companyId,productId},{dimension:balance.dimension});
    const amount=readCanonical(quantity);
    if(amount===BigInt(0)&&data.action!=='incoming')fail('invalid_input','Quantity must be greater than zero.');
    const before=readCanonical({dimension:balance.dimension,minor:balance.on_hand_minor});
    const incoming=readCanonical({dimension:balance.dimension,minor:balance.incoming_minor});
    let after=before,nextIncoming=incoming;
    if(data.action==='receive'){
      after=readCanonical({dimension:balance.dimension,minor:String(before+amount)});
      if(data.fromIncoming)nextIncoming=incoming>amount?incoming-amount:BigInt(0);
    }else if(data.action==='use'||data.action==='waste'){
      if(before<amount)fail('invalid_input','Quantity exceeds the current estimate. Record a fresh count.');
      after=before-amount;
    }else nextIncoming=amount;
    const rawAt=this.clock(),time=consumptionInstant(rawAt);
    if(time===null)fail('invalid_input','Invalid server clock.');
    const at=new Date(time).toISOString(),auditId=this.idFactory();
    const guard=this.db.prepare(`INSERT INTO security_audit(id,company_id,actor,action,target,created)
      SELECT CASE WHEN EXISTS(SELECT 1 FROM memberships WHERE company_id=? AND user_id=? AND role IN ('owner','manager'))
        AND (${SNAPSHOT})=? THEN ? ELSE NULL END,?,?,?,?,?`)
      .bind(this.companyId,this.userId,this.companyId,productId,expected,auditId,this.companyId,this.userId,
        'inventory.'+data.action,JSON.stringify({productId,eventId:data.id}),time);
    const update=this.db.prepare(`UPDATE inventory_balances_exact SET on_hand_minor=?,incoming_minor=?,version=?,updated_at=?
      WHERE company_id=? AND product_id=? AND config_id=? AND on_hand_minor=? AND incoming_minor=? AND version=?`)
      .bind(String(after),String(nextIncoming),balance.version+1,at,this.companyId,productId,balance.config_id,
        balance.on_hand_minor,balance.incoming_minor,balance.version);
    const event=this.db.prepare(`INSERT INTO inventory_events_exact
      (company_id,id,product_id,config_id,action,dimension,quantity_minor,entered_amount,entered_unit_id,
       balance_version_before,balance_version_after,effective_at,recorded_at,actor,note)
      VALUES (?,?,CASE WHEN changes()=1 THEN ? ELSE NULL END,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .bind(this.companyId,data.id,productId,balance.config_id,data.action,balance.dimension,quantity.minor,
        data.amount,data.unitId,balance.version,balance.version+1,at,at,this.userId,fingerprint);
    try{await this.db.batch([guard,update,event]);}
    catch(error){
      const winner=await this.db.prepare('SELECT product_id,action,note FROM inventory_events_exact WHERE company_id=? AND id=?')
        .bind(this.companyId,data.id).first<{product_id:string;action:string;note:string}>();
      if(winner){if(winner.product_id===productId&&winner.action===data.action&&winner.note===fingerprint)return {id:data.id,replayed:true};
        fail('duplicate_key','This update ID was used for different stock input.');}
      if(String(error).includes('NOT NULL constraint failed: security_audit.id')||
        String(error).includes('NOT NULL constraint failed: inventory_events_exact.product_id'))fail('conflict','Stock or access changed. Reload before saving.');
      throw error;
    }
    return {id:data.id,replayed:false,balanceAfter:{dimension:balance.dimension,minor:String(after)},
      incomingAfter:{dimension:balance.dimension,minor:String(nextIncoming)}};
  }
}
