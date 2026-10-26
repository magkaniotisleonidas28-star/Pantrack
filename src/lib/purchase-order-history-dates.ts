import {spendingWindow} from './po-cart-spending-limits-contract';

export const HISTORY_DATE_MIN='1900-01-01',HISTORY_DATE_MAX='9998-12-31';
export const HISTORY_DATE_TIME_ZONES=['America/New_York','UTC'] as const;
export type HistoryDateTimeZone=typeof HISTORY_DATE_TIME_ZONES[number];
export type HistoryDates={from?:string;to?:string;timeZone?:HistoryDateTimeZone};

export function validHistoryDate(value:string):boolean{
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||value<HISTORY_DATE_MIN||value>HISTORY_DATE_MAX)return false;
  const at=new Date(value+'T12:00:00.000Z');return !Number.isNaN(at.getTime())&&at.toISOString().slice(0,10)===value;
}
/** Call with validated dates. Reuse the existing pure calendar/DST calculation, without reading or changing budgets.
 * Noon UTC is on the requested calendar day in both supported zones; adding 24 hours would break DST days. */
export function historyDateBounds({from,to,timeZone}:HistoryDates):{start?:string;before?:string}{
  if(!from&&!to)return {};
  if(!timeZone)throw new Error('A date range requires its time zone.');
  const window=(date:string)=>spendingWindow(date+'T12:00:00.000Z',timeZone,1);
  const first=from?window(from):undefined,last=to?(to===from?first:window(to)):undefined;
  return {start:first?.dayStart,before:last?.dayEnd};
}
