import {D1InventoryConsumptionPort} from '@/lib/d1-inventory-consumption';
import {D1SalesEventStore} from '@/lib/d1-sales-event-store';
import {SALES_EVENT_CONTRACT,SalesIngestionService,type SalesActor,type SalesEventDraftV1,type SalesMappingPort,type SalesSourceBinding} from '@/lib/sales-ingestion';

export type LocalSalesSource='manual'|'recipe_csv'|'mapped_csv'|'bridge';
export type LocalSalesLine={recipeId?:string;mappingKey?:string;quantity:number};

const bindings:Record<LocalSalesSource,(companyId:string)=>SalesSourceBinding>={
 manual:companyId=>({kind:'manual',provider:'pantrack-manual',environment:'internal',connectionId:'manual-entry',merchantId:companyId,locationId:'default'}),
 recipe_csv:companyId=>({kind:'csv',provider:'pantrack-recipe-csv',environment:'internal',connectionId:'recipe-csv',merchantId:companyId,locationId:'default'}),
 mapped_csv:companyId=>({kind:'csv',provider:'pantrack-mapped-csv',environment:'internal',connectionId:'mapped-csv',merchantId:companyId,locationId:'default'}),
 bridge:companyId=>({kind:'bridge',provider:'pantrack-register-bridge',environment:'internal',connectionId:'register-bridge',merchantId:companyId,locationId:'default'}),
};

export class D1SalesMappingPort implements SalesMappingPort{
 constructor(private readonly db:D1Database){}
 async resolveLine(input:{companyId:string;source:SalesSourceBinding;externalItemId:string;externalVariationId?:string}){
  if(input.source.provider==='pantrack-manual'||input.source.provider==='pantrack-recipe-csv')return {status:'mapped' as const,recipeId:input.externalItemId};
  const row=await this.db.prepare('SELECT data FROM register_mappings WHERE company_id=? AND external_key=?').bind(input.companyId,input.externalItemId).first<{data:string}>();
  if(!row)return {status:'unknown_item' as const};
  try{const parsed=JSON.parse(row.data) as {recipeId?:unknown};return typeof parsed.recipeId==='string'&&parsed.recipeId?{status:'mapped' as const,recipeId:parsed.recipeId}:{status:'unknown_item' as const};}catch{return {status:'unknown_item' as const};}
 }
 async resolveModifier(){return {status:'unknown_modifier' as const};}
}

export function d1SalesService(db:D1Database){return new SalesIngestionService(new D1SalesEventStore(db),new D1SalesMappingPort(db),new D1InventoryConsumptionPort(db));}

export async function ingestLocalSale(input:{db:D1Database;companyId:string;source:LocalSalesSource;reference:string;occurredAt?:string;lines:LocalSalesLine[];actor:SalesActor}){
 const legacyReferences=input.source==='bridge'?[input.reference,`bridge:${input.reference}`]:[input.reference];
 for(const reference of legacyReferences){if(await input.db.prepare('SELECT 1 AS found FROM sales_imports WHERE company_id=? AND reference=?').bind(input.companyId,reference).first())return {ok:true,replayed:true,legacy:true};}
 const source=bindings[input.source](input.companyId),service=d1SalesService(input.db),receivedAt=new Date();
 const occurrence=input.occurredAt??receivedAt.toISOString();
 const grouped=new Map<string,{externalItemId:string;quantity:bigint}>();
 for(const line of input.lines){const externalItemId=line.recipeId??line.mappingKey;if(!externalItemId)throw new Error('Every sale line requires a recipe or mapping identity.');const key=`${line.recipeId?'recipe':'mapping'}:${externalItemId}`,current=grouped.get(key);grouped.set(key,{externalItemId,quantity:(current?.quantity??BigInt(0))+BigInt(line.quantity)});}
 const normalizedLines=[...grouped].sort(([left],[right])=>left.localeCompare(right)).map(([,line],index)=>({externalLineId:`line-${index+1}`,externalItemId:line.externalItemId,quantity:String(line.quantity),modifiers:[]}));
 const draft:SalesEventDraftV1={schemaVersion:SALES_EVENT_CONTRACT,externalEventId:input.reference,externalOrderId:input.reference,revision:1,eventType:'sale',orderStatus:'completed',preparationStatus:'fulfilled',occurredAt:occurrence,timeQuality:input.occurredAt?(input.source==='bridge'?'provider':'confirmed'):'inferred',lines:normalizedLines};
 const receipt=await service.receive({companyId:input.companyId,source,actor:input.actor},draft);
 if(receipt.kind==='created')await service.process(input.companyId,receipt.eventKey);
 const state=await new D1SalesEventStore(input.db).state(input.companyId,receipt.eventKey);
 return {ok:true,replayed:receipt.kind==='duplicate',conflict:receipt.kind==='conflict',eventKey:receipt.eventKey,state};
}

export function localUserActor(user:{userId:string},companyId:string,role:string):SalesActor{
 if(role!=='owner'&&role!=='manager'&&role!=='employee')throw new Error('Unsupported company role.');
 return {kind:'user',userId:user.userId,companyId,role};
}
export function bridgeActor(companyId:string){const source=bindings.bridge(companyId);return {kind:'machine' as const,machineId:`register-bridge:${companyId}`,companyId,source};}
