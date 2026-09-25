import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {cloverConfig,cloverJson,withClover} from '@/lib/clover';
import {cloverSource,normalizeCloverOrder,type CloverOrder} from '@/lib/clover-orders';
import {d1SalesService} from '@/lib/d1-sales-runtime';

const PAGE_SIZE=100;
const MAX_PAGES=20;
const OVERLAP_MS=60*60*1000;

export function cloverSyncEnabled(){const settings=env as unknown as {PANTRACK_CLOVER_SYNC_ENABLED?:string;CLOVER_ENVIRONMENT?:string};return settings.PANTRACK_CLOVER_SYNC_ENABLED==='enabled'&&settings.CLOVER_ENVIRONMENT==='sandbox';}

export async function cloverSyncStatus(companyId:string){
 const db=database();
 const state=await db.prepare('SELECT environment,merchant_id,started_at,checkpoint,last_attempt,last_success,last_error FROM clover_sync_state WHERE company_id=?').bind(companyId).first<{environment:string;merchant_id:string;started_at:number;checkpoint:number;last_attempt:string|null;last_success:string|null;last_error:string|null}>();
 if(!state)return null;
 const count=await db.prepare("SELECT COUNT(*) AS n FROM sales_events e JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key WHERE e.company_id=? AND e.provider='clover' AND e.environment=? AND e.merchant_id=? AND s.state='held'").bind(companyId,state.environment,state.merchant_id).first<{n:number}>();
 return {startedAt:new Date(state.started_at).toISOString(),checkpoint:new Date(state.checkpoint).toISOString(),lastAttempt:state.last_attempt,lastSuccess:state.last_success,lastError:state.last_error,heldCount:count?.n??0,lagMs:Math.max(0,Date.now()-state.checkpoint),enabled:cloverSyncEnabled()};
}

export async function syncClover(companyId:string){
 if(!cloverSyncEnabled())throw new Error('Clover sales sync is disabled.');
 const db=database(),now=Date.now(),lease=now+120_000;
 const state=await db.prepare('UPDATE clover_sync_state SET lease_until=?,last_attempt=?,last_error=NULL WHERE company_id=? AND lease_until<? RETURNING environment,merchant_id,started_at,checkpoint').bind(lease,new Date(now).toISOString(),companyId,now).first<{environment:string;merchant_id:string;started_at:number;checkpoint:number}>();
 if(!state)throw new Error('Clover is disconnected or a sync is already running.');
 try{
  const result=await withClover(companyId,async(connection,token)=>{
   if(connection.merchant_id!==state.merchant_id||connection.environment!==state.environment)throw new Error('Clover connection changed. Reconnect before syncing.');
   const config=cloverConfig(),source=cloverSource(companyId,state.environment,state.merchant_id),service=d1SalesService(db);
   const lower=Math.max(state.started_at,state.checkpoint-OVERLAP_MS),upper=Math.min(Date.now(),lower+24*60*60*1000);
   if(upper<lower)return {scanned:0,created:0,held:0,duplicates:0,checkpoint:new Date(state.checkpoint).toISOString()};
   let scanned=0,created=0,held=0,duplicates=0,finished=false;
   for(let page=0;page<MAX_PAGES;page++){
    const url=new URL(config.api+'/v3/merchants/'+encodeURIComponent(state.merchant_id)+'/orders');
    url.searchParams.set('filter',`modifiedTime>=${lower}`);
    url.searchParams.append('filter',`modifiedTime<=${upper}`);
    url.searchParams.set('orderBy','modifiedTime ASC,id ASC');
    url.searchParams.set('limit',String(PAGE_SIZE));url.searchParams.set('offset',String(page*PAGE_SIZE));
    const list=await cloverJson(url.href,{headers:{Authorization:'Bearer '+token}}) as {elements?:Array<{id?:string;modifiedTime?:number}>};
    if(!Array.isArray(list.elements)||list.elements.length>PAGE_SIZE)throw new Error('Clover returned an invalid orders page.');
    for(const item of list.elements){
     if(!item.id||!Number.isSafeInteger(item.modifiedTime))throw new Error('Clover returned an order without stable identity.');
     if((item.modifiedTime as number)>upper)continue;
     const detailUrl=config.api+'/v3/merchants/'+encodeURIComponent(state.merchant_id)+'/orders/'+encodeURIComponent(item.id)+'?expand=lineItems,lineItems.modifications,payments';
     const order=await cloverJson(detailUrl,{headers:{Authorization:'Bearer '+token}}) as CloverOrder;
     if(order.id!==item.id)throw new Error('Clover order identity changed during sync.');
     if(order.modifiedTime>upper)continue;
     const draft=normalizeCloverOrder(order,state.started_at);scanned++;
     if(!draft)continue;
     const receipt=await service.receive({companyId,source,actor:{kind:'machine',machineId:`clover:${companyId}`,companyId,source}},draft);
     if(receipt.kind==='created'){
      created++;
      const status=await service.process(companyId,receipt.eventKey);
      if(status?.state==='held')held++;
      if(status?.state==='failed')throw new Error('A Clover sale was received but could not be applied.');
     }else duplicates++;
    }
    if(list.elements.length<PAGE_SIZE){finished=true;break;}
   }
   if(!finished)throw new Error('Clover order page limit reached; checkpoint was not advanced.');
   const checkpoint=Math.max(state.checkpoint,upper);
   await db.prepare('UPDATE clover_sync_state SET checkpoint=?,last_success=?,last_error=NULL WHERE company_id=? AND lease_until=?').bind(checkpoint,new Date().toISOString(),companyId,lease).run();
   return {scanned,created,held,duplicates,checkpoint:new Date(checkpoint).toISOString()};
  });
  return result;
 }catch(e){
  const message=e instanceof Error?e.message:'Clover sync failed.';
  await db.prepare('UPDATE clover_sync_state SET last_error=? WHERE company_id=? AND lease_until=?').bind(message.slice(0,300),companyId,lease).run();
  throw e;
 }finally{await db.prepare('UPDATE clover_sync_state SET lease_until=0 WHERE company_id=? AND lease_until=?').bind(companyId,lease).run();}
}
