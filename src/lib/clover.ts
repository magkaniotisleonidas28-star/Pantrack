import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {encrypt,decrypt} from '@/lib/vendor-adapter';
import {z} from 'zod';
import {appOrigin} from '@/lib/auth';
export const cloverOrigin=appOrigin;
export const callbackUrl=()=>cloverOrigin()+'/api/clover/callback';
export function cloverConfig(){const e=env as unknown as Record<string,string|undefined>;const environment=e.CLOVER_ENVIRONMENT||'sandbox';if(!['sandbox','production'].includes(environment))throw new Error('Invalid Clover environment.');return {environment,clientId:e.CLOVER_CLIENT_ID||'',clientSecret:e.CLOVER_CLIENT_SECRET||'',ready:!!(e.CLOVER_CLIENT_ID&&e.CLOVER_CLIENT_SECRET&&e.VENDOR_ENCRYPTION_KEY),api:environment==='production'?'https://api.clover.com':'https://apisandbox.dev.clover.com',auth:environment==='production'?'https://www.clover.com':'https://sandbox.dev.clover.com'};}
const tokens=z.object({access_token:z.string().min(1).max(20000),refresh_token:z.string().min(1).max(20000),access_token_expiration:z.number().positive(),refresh_token_expiration:z.number().positive()});
export class CloverHttpError extends Error{constructor(public readonly status:number){super(status===401?'Clover authorization expired. Reconnect your account.':status===403?'Clover permissions are missing. Check the app permissions and reconnect.':status===429?'Clover is busy. Wait a moment and try again.':'Clover could not complete this request. Try again.');}}
export async function cloverJson(url:string,init:RequestInit={}){const r=await fetch(url,{...init,redirect:'error',headers:{'User-Agent':'Pantrack/1.0',...init.headers},signal:AbortSignal.timeout(15000)});if(!r.ok)throw new CloverHttpError(r.status);const text=await r.text();if(text.length>2000000)throw new Error('Clover response is too large.');return JSON.parse(text) as unknown;}
export async function tokenExchange(body:object){const c=cloverConfig();return tokens.parse(await cloverJson(c.api+'/oauth/v2/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:c.clientId,client_secret:c.clientSecret,...body})}));}
async function refreshTokens(refreshToken:string){
 const c=cloverConfig(),body=JSON.stringify({client_id:c.clientId,refresh_token:refreshToken});
 const response=await fetch(c.api+'/oauth/v2/refresh',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json','User-Agent':'Pantrack/1.0'},body,signal:AbortSignal.timeout(15000)});
 if(response.ok)return tokens.parse(await response.json());
 if(response.status===401&&response.headers.get('X-Clover-Recovery-Available')==='true'){
  return tokens.parse(await cloverJson(c.api+'/oauth/v2/recovery',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_id:c.clientId,client_secret:c.clientSecret,recovery_token:refreshToken})}));
 }
 throw new Error('Clover authorization expired. Reconnect your account.');
}
export type Connection={company_id:string;merchant_id:string;environment:string;secret:string;connected:string;last_checked:string|null;lease_until:number};
export async function cloverConnection(companyId:string){return database().prepare('SELECT * FROM clover_connections WHERE company_id=?').bind(companyId).first<Connection>();}
export async function withClover<T>(companyId:string,fn:(c:Connection,token:string)=>Promise<T>):Promise<T>{
 const db=database(),now=Date.now(),lease=now+120000;
 const c=await db.prepare('UPDATE clover_connections SET lease_until=? WHERE company_id=? AND lease_until<? RETURNING *').bind(lease,companyId,now).first<Connection>();
 if(!c)throw new Error('Connect Clover first, or wait for the current request to finish.');
 try{const config=cloverConfig();if(c.environment!==config.environment)throw new Error('Clover environment changed. Disconnect and reconnect.');
 const scope='clover:'+companyId;let t=tokens.parse(JSON.parse(await decrypt(c.secret,scope)));
 if(t.access_token_expiration*1000<Date.now()+60000){if(t.refresh_token_expiration*1000<Date.now())throw new Error('Clover authorization expired. Reconnect your account.');t=await refreshTokens(t.refresh_token);const saved=await db.prepare('UPDATE clover_connections SET secret=? WHERE company_id=? AND lease_until=?').bind(await encrypt(JSON.stringify(t),scope),companyId,lease).run();if((saved.meta?.changes??(saved as unknown as {changes:number}).changes)!==1)throw new Error('Clover token rotation could not be saved.');}
 const result=await fn(c,t.access_token);await db.prepare('UPDATE clover_connections SET last_checked=? WHERE company_id=? AND lease_until=?').bind(new Date().toISOString(),companyId,lease).run();return result;
 }finally{await db.prepare('UPDATE clover_connections SET lease_until=0 WHERE company_id=? AND lease_until=?').bind(companyId,lease).run();}
}
