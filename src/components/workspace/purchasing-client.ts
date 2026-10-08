import type {SupplierProfile} from '@/lib/purchasing-supplier-contract';
export function emailAcceptanceLabel(status:SupplierProfile['emailAcceptance']['status']){
  return {unknown:'Unknown',not_accepted:'Not accepted',manager_reported_accepted:'Manager-reported accepted'}[status];
}
export class PurchasingRequestError extends Error {constructor(message:string,public status:number){super(message);}}
export async function supplierRequest<T>(companyId:string,query='',body?:Record<string,unknown>):Promise<T>{
  const response=await fetch(`/api/purchasing-suppliers?companyId=${encodeURIComponent(companyId)}${query}`,body?
    {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{cache:'no-store'});
  const data=await response.json() as T&{error?:string};
  if(!response.ok)throw new PurchasingRequestError(data.error??'Could not load purchasing suppliers.',response.status);return data;
}
export function purchasingCents(value:string):string{
  const text=value.trim();if(!/^\d{1,10}(\.\d{1,2})?$/.test(text))throw new Error('Enter USD with at most two decimal places.');
  const [whole,fraction='']=text.split('.');return (BigInt(whole)*BigInt(100)+BigInt(fraction.padEnd(2,'0'))).toString();
}
export function purchasingDollars(value:string|null){if(value===null)return '';const text=value.padStart(3,'0');return `${text.slice(0,-2)}.${text.slice(-2)}`;}
