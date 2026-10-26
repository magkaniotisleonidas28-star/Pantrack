import {z} from 'zod';

// Owner spending limits for fictional cart preparation. Local groundwork for C7/M10:
// no payment data, no supplier checkout control and no real purchasing.
export const SPENDING_LIMIT_NOTICE='Pantrack limits only the carts it prepares. It cannot limit spending at a supplier\'s own checkout.';
const id=z.string().trim().min(1).max(200);
const minor=z.number().int().min(1).max(1_000_000_000);
const version=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const spendingLimitsQuerySchema=z.object({companyId:id}).strict();
export const setSpendingLimitsSchema=z.object({action:z.literal('set_limits'),companyId:id,operationId:z.string().uuid(),
  expectedVersion:version,perOrderMinor:minor,perDayMinor:minor,perMonthMinor:minor.nullable(),outstandingMinor:minor}).strict()
  .refine(v=>v.perOrderMinor<=v.perDayMinor&&(v.perMonthMinor===null||v.perDayMinor<=v.perMonthMinor)&&v.perOrderMinor<=v.outstandingMinor,
    'Per order must not exceed per day or in progress, and per day must not exceed per month.');
export const setCompanyTimeZoneSchema=z.object({action:z.literal('set_time_zone'),companyId:id,operationId:z.string().uuid(),
  expectedVersion:version,timeZone:z.string().min(1).max(64)}).strict();
export type SetSpendingLimits=z.infer<typeof setSpendingLimitsSchema>;
export type SpendingLimits=Readonly<{version:number;perOrderMinor:number;perDayMinor:number|null;perMonthMinor:number|null;
  outstandingMinor:number;ownerSet:boolean;actor:string|null;createdAt:string|null}>;
export type CompanyTimeZone=Readonly<{version:number;timeZone:string;actor:string;createdAt:string}>;
export type SpendingWindow=Readonly<{timeZone:string;timeZoneVersion:number;dayStart:string;dayEnd:string;monthStart:string;monthEnd:string}>;
export type SpendingUsage=Readonly<{window:SpendingWindow;dayMinor:number;monthMinor:number;outstandingMinor:number}>;
export type SpendingLimitsReceipt=Readonly<{operationId:string;action:'set_limits'|'set_time_zone';version:number;actor:string;at:string}>;
export type SpendingLimitsStatus=Readonly<{limits:SpendingLimits|null;timeZone:CompanyTimeZone|null;usage:SpendingUsage|null;
  history:readonly SpendingLimits[];timeZoneHistory:readonly CompanyTimeZone[];notice:string}>;
export type SpendingLimitsResult=Readonly<{receipt:SpendingLimitsReceipt;current:SpendingLimitsStatus}>;
export class SpendingLimitError extends Error {
  constructor(public readonly code:'invalid_request'|'forbidden'|'conflict'|'reauthentication_required'|'time_zone_required'|'storage_failure',message:string){
    super(message);this.name='SpendingLimitError';
  }
}
export function spendingLimitFail(code:SpendingLimitError['code'],message:string):never {throw new SpendingLimitError(code,message);}

/** IANA names in their standard capitalized form (links such as Asia/Kolkata included), stored exactly as given. */
export function validTimeZone(value:string):boolean {
  if(!/^[A-Z][A-Za-z0-9_+-]*(?:\/[A-Z0-9][A-Za-z0-9_+-]*)*$/.test(value)||value.length>64)return false;
  try {new Intl.DateTimeFormat('en-US',{timeZone:value});return true;} catch {return false;}
}
function localDate(ms:number,timeZone:string):string {
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hourCycle:'h23'})
    .formatToParts(new Date(ms)).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const calendar=(y:number,m:number,d:number)=>new Date(Date.UTC(y,m-1,d)).toISOString().slice(0,10);
/** First instant whose local date is on or after `date`. Exact across DST, including skipped midnights. */
function startOf(date:string,timeZone:string):number {
  const [y,m,d]=date.split('-').map(Number),guess=Date.UTC(y,m-1,d);
  let lo=guess-36*3600_000,hi=guess+36*3600_000;
  while(hi-lo>1){const mid=Math.floor((lo+hi)/2);if(localDate(mid,timeZone)>=date)hi=mid;else lo=mid;}
  return hi;
}
export function spendingWindow(at:string,timeZone:string,timeZoneVersion:number):SpendingWindow {
  const today=localDate(Date.parse(at),timeZone),[y,m,d]=today.split('-').map(Number);
  const iso=(date:string)=>new Date(startOf(date,timeZone)).toISOString();
  return {timeZone,timeZoneVersion,dayStart:iso(today),dayEnd:iso(calendar(y,m,d+1)),monthStart:iso(calendar(y,m,1)),monthEnd:iso(calendar(y,m+1,1))};
}
/** Tightening never asks for the password; anything else is loosening. */
export function loosens(previous:SpendingLimits|null,next:SetSpendingLimits):boolean {
  if(!previous?.ownerSet)return true;
  return next.perOrderMinor>previous.perOrderMinor||next.perDayMinor>(previous.perDayMinor??0)||next.outstandingMinor>previous.outstandingMinor
    ||previous.perMonthMinor!==null&&(next.perMonthMinor===null||next.perMonthMinor>previous.perMonthMinor);
}
export const dollars=(minorUnits:number)=>'$'+(minorUnits/100).toFixed(2);
/** Same exposure rule as the reservation guard: canceled-before-start work is excluded. */
export function usageSql(bound:'day'|'month'){
  const keys:readonly ('dayStart'|'dayEnd'|'monthStart'|'monthEnd')[]=bound==='day'?['dayStart','dayEnd']:['monthStart','monthEnd'];
  return {sql:`SELECT COALESCE(SUM(r.total_minor),0) AS used FROM po_cart_reservations r JOIN po_cart_authorizations x
    ON x.company_id=r.company_id AND x.id=r.authorization_id WHERE r.company_id=? AND x.created_at>=? AND x.created_at<?
    AND NOT (x.started_at IS NULL AND x.released_at IS NOT NULL)`,keys};
}
