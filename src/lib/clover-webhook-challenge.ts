import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {encrypt,decrypt} from '@/lib/vendor-adapter';

const lifetimeMs=10*60*1000;
const scope=(companyId:string)=>'clover:webhook-challenge:'+companyId;

export function setupCompanyId(){
 const values=env as unknown as {PANTRACK_CLOVER_WEBHOOK_SETUP_COMPANY_ID?:string;CLOVER_ENVIRONMENT?:string};
 const id=values.PANTRACK_CLOVER_WEBHOOK_SETUP_COMPANY_ID;
 return values.CLOVER_ENVIRONMENT==='sandbox'&&id&&/^[a-zA-Z0-9-]{1,100}$/.test(id)?id:null;
}

export async function captureChallenge(code:string){
 const companyId=setupCompanyId();
 if(!companyId)return;
 const db=database();
 const connection=await db.prepare("SELECT 1 FROM clover_connections WHERE company_id=? AND environment='sandbox'").bind(companyId).first();
 if(!connection)return;
 const now=Date.now();
 await db.batch([
  db.prepare('INSERT INTO clover_webhook_challenges(company_id,code_encrypted,captured_at,expires_at) VALUES (?,?,?,?) ON CONFLICT(company_id) DO UPDATE SET code_encrypted=excluded.code_encrypted,captured_at=excluded.captured_at,expires_at=excluded.expires_at')
   .bind(companyId,await encrypt(code,scope(companyId)),now,now+lifetimeMs),
  db.prepare('INSERT INTO security_audit(id,company_id,actor,action,target,created) VALUES (?,?,?,?,?,?)')
   .bind(crypto.randomUUID(),companyId,'clover-webhook','clover.webhook_challenge_captured','verification',now),
 ]);
}

export async function readChallenge(companyId:string){
 if(companyId!==setupCompanyId())return null;
 const db=database(),now=Date.now();
 await db.prepare('DELETE FROM clover_webhook_challenges WHERE company_id=? AND expires_at<=?').bind(companyId,now).run();
 const row=await db.prepare('SELECT code_encrypted,expires_at FROM clover_webhook_challenges WHERE company_id=?').bind(companyId).first<{code_encrypted:string;expires_at:number}>();
 return row?{verificationCode:await decrypt(row.code_encrypted,scope(companyId)),expiresAt:row.expires_at}:null;
}

export async function clearChallenge(companyId:string,actor:string){
 const db=database();
 await db.batch([
  db.prepare('DELETE FROM clover_webhook_challenges WHERE company_id=?').bind(companyId),
  db.prepare('INSERT INTO security_audit(id,company_id,actor,action,target,created) VALUES (?,?,?,?,?,?)')
   .bind(crypto.randomUUID(),companyId,actor,'clover.webhook_challenge_cleared','verification',Date.now()),
 ]);
}
