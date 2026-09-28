import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {readBoundedUtf8,BodyTooLargeError} from '@/lib/bounded-body';
import {cloverConfig} from '@/lib/clover';
import {cloverSyncEnabled,syncClover} from '@/lib/clover-sync';
import {captureChallenge} from '@/lib/clover-webhook-challenge';
import {z} from 'zod';

const notification=z.object({appId:z.string(),merchants:z.record(z.array(z.object({objectId:z.string(),type:z.enum(['CREATE','UPDATE','DELETE']),ts:z.number().int()})))});
const B7_RETRY_COMPANY='eb05567b-e227-4f28-ae02-b81f55e6918c';
const B7_RETRY_MERCHANT='4ZJYT1HV8X6Y1';

async function retryProbe(companyId:string,merchantId:string,updates:z.infer<typeof notification>['merchants'][string]){
 const settings=env as unknown as {PANTRACK_CLOVER_RETRY_TEST_ORDER_ID?:string;PANTRACK_CLOVER_RETRY_TEST_FAIL?:string};
 const orderId=settings.PANTRACK_CLOVER_RETRY_TEST_ORDER_ID;
 if(cloverConfig().environment!=='sandbox'||companyId!==B7_RETRY_COMPANY||merchantId!==B7_RETRY_MERCHANT||!orderId||!updates.some(update=>update.objectId===`O:${orderId}`))return false;
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(orderId));
 const correlation=Array.from(new Uint8Array(digest)).map(byte=>byte.toString(16).padStart(2,'0')).join('').slice(0,16);
 const failing=settings.PANTRACK_CLOVER_RETRY_TEST_FAIL==='enabled';
 console.info('Clover B7 retry probe',{correlation,result:failing?'controlled_503':'passed_to_sync'});
 return failing;
}

function equal(left:string,right:string){
 const a=new TextEncoder().encode(left),b=new TextEncoder().encode(right);let diff=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]??0)^(b[i]??0);
 return diff===0;
}

export async function POST(req:Request){
 try{
  const body=JSON.parse(await readBoundedUtf8(req,50_000)) as unknown;
  // Clover's dashboard sends this unauthenticated challenge before it can send
  // authenticated order notifications. It cannot trigger a sales read and must
  // work while the separate sales-sync gate is still off during setup.
  const challenge=z.object({verificationCode:z.string().min(1).max(200)}).strict().safeParse(body);
  if(challenge.success){await captureChallenge(challenge.data.verificationCode);return Response.json({ok:true});}
  if(!cloverSyncEnabled())return new Response(null,{status:404});
  const code=(env as unknown as {CLOVER_WEBHOOK_AUTH_CODE?:string}).CLOVER_WEBHOOK_AUTH_CODE;
  if(!code||!equal(req.headers.get('X-Clover-Auth')??'',code))return new Response(null,{status:401});
  const data=notification.parse(body),config=cloverConfig();
  if(data.appId!==config.clientId)return new Response(null,{status:403});
  const db=database();
  for(const [merchantId,updates] of Object.entries(data.merchants)){
   if(!updates.some(update=>update.objectId.startsWith('O:')))continue;
   const connection=await db.prepare('SELECT company_id FROM clover_connections WHERE environment=? AND merchant_id=?').bind(config.environment,merchantId).first<{company_id:string}>();
   if(!connection)return new Response(null,{status:403});
   if(await retryProbe(connection.company_id,merchantId,updates))return new Response(null,{status:503});
   await syncClover(connection.company_id);
  }
  return Response.json({ok:true});
 }catch(error){
  if(error instanceof BodyTooLargeError)return new Response(null,{status:413});
  if(error instanceof SyntaxError||error instanceof z.ZodError)return new Response(null,{status:400});
  return new Response(null,{status:503});
 }
}
