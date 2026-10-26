import {z} from 'zod';

// Weekly PO draft schedules. A schedule names a supplier-list group, a weekday and local time in the
// company's time zone, a cap margin and a responsible owner or manager. It only ever creates a draft
// for review: never a cart, a spending approval or an order.
const id=z.string().trim().min(1).max(200);
const reason=z.string().trim().max(500);
export const saveScheduleSchema=z.object({
  action:z.literal('save'),companyId:id,scheduleId:id,expectedVersion:z.number().int().min(0).max(1_000_000),operationId:z.string().uuid(),
  supplierId:id,accountId:id,locationId:id,weekday:z.number().int().min(1).max(7),localTime:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/,'Enter a time such as 09:00.'),
  marginPercent:z.number().int().min(0).max(100),responsibleUserId:id,reason,
}).strict();
export const scheduleStatusSchema=z.object({
  action:z.enum(['pause','resume']),companyId:id,scheduleId:id,expectedVersion:z.number().int().min(1).max(1_000_000),operationId:z.string().uuid(),reason,
}).strict();
export type ScheduleStatus='active'|'paused';
export type OccurrenceState='running'|'retry'|'drafted'|'nothing_needed'|'skipped_paused'|'skipped_waiting'|'held'|'failed';
export const MAX_ATTEMPTS=3;
export class PoDraftScheduleError extends Error {
  constructor(public readonly code:'invalid_request'|'forbidden'|'missing'|'conflict'|'storage_failure',message:string){super(message);this.name='PoDraftScheduleError';}
}
export function scheduleFail(code:PoDraftScheduleError['code'],message:string):never{throw new PoDraftScheduleError(code,message);}

/** Local wall time `YYYY-MM-DDTHH:MM` of an instant. */
export function wallTime(ms:number,timeZone:string):string{
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date(ms)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
const offset=(ms:number,timeZone:string)=>Date.parse(wallTime(ms,timeZone)+':00Z')-Math.floor(ms/60_000)*60_000;
/**
 * The instant a local date and time happens. When clocks fall back and the time happens twice, the
 * first; when clocks spring forward and it never happens, the first instant after the gap.
 */
export function zonedInstant(date:string,time:string,timeZone:string):number{
  const target=`${date}T${time}`,naive=Date.parse(target+':00Z');
  const candidates=[...new Set([-1,0,1].map(d=>naive-offset(naive+d*86_400_000,timeZone)))].sort((a,b)=>a-b);
  const exact=candidates.find(t=>wallTime(t,timeZone)===target);
  if(exact!==undefined)return exact;
  let lo=candidates[0],hi=candidates[candidates.length-1];
  while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(wallTime(mid,timeZone)>=target)hi=mid;else lo=mid;}
  return hi;
}
const addDays=(date:string,days:number)=>new Date(Date.parse(date+'T00:00:00Z')+days*86_400_000).toISOString().slice(0,10);
/** The latest week whose local weekday and time have arrived. Missed earlier weeks are never returned. */
export function latestDue(nowMs:number,weekday:number,time:string,timeZone:string):{weekKey:string;dueAt:string}{
  const today=wallTime(nowMs,timeZone).slice(0,10),todayWeekday=(new Date(today+'T00:00:00Z').getUTCDay()+6)%7+1;
  let weekKey=addDays(today,-((todayWeekday-weekday+7)%7)),due=zonedInstant(weekKey,time,timeZone);
  if(due>nowMs){weekKey=addDays(weekKey,-7);due=zonedInstant(weekKey,time,timeZone);}
  return {weekKey,dueAt:new Date(due).toISOString()};
}
/** Proposed cap: the known estimated subtotal plus the margin, rounded up to the cent. */
export function proposedCap(knownMinor:bigint,marginPercent:number):bigint{
  return (knownMinor*BigInt(100+marginPercent)+BigInt(99))/BigInt(100);
}
