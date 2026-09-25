import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {readBoundedUtf8,BodyTooLargeError} from '@/lib/bounded-body';
import {cloverConfig} from '@/lib/clover';
import {cloverSyncEnabled,syncClover} from '@/lib/clover-sync';
import {z} from 'zod';

const notification=z.object({appId:z.string(),merchants:z.record(z.array(z.object({objectId:z.string(),type:z.enum(['CREATE','UPDATE','DELETE']),ts:z.number().int()})))});

function equal(left:string,right:string){
 const a=new TextEncoder().encode(left),b=new TextEncoder().encode(right);let diff=a.length^b.length;
 for(let i=0;i<Math.max(a.length,b.length);i++)diff|=(a[i]??0)^(b[i]??0);
 return diff===0;
}

export async function POST(req:Request){
 if(!cloverSyncEnabled())return new Response(null,{status:404});
 try{
  const body=JSON.parse(await readBoundedUtf8(req,50_000)) as unknown;
  // Clover's dashboard sends this unauthenticated challenge before it can send
  // authenticated order notifications. It cannot trigger a sales read.
  if(z.object({verificationCode:z.string().min(1).max(200)}).safeParse(body).success)return Response.json({ok:true});
  const code=(env as unknown as {CLOVER_WEBHOOK_AUTH_CODE?:string}).CLOVER_WEBHOOK_AUTH_CODE;
  if(!code||!equal(req.headers.get('X-Clover-Auth')??'',code))return new Response(null,{status:401});
  const data=notification.parse(body),config=cloverConfig();
  if(data.appId!==config.clientId)return new Response(null,{status:403});
  const db=database();
  for(const [merchantId,updates] of Object.entries(data.merchants)){
   if(!updates.some(update=>update.objectId.startsWith('O:')))continue;
   const connection=await db.prepare('SELECT company_id FROM clover_connections WHERE environment=? AND merchant_id=?').bind(config.environment,merchantId).first<{company_id:string}>();
   if(!connection)return new Response(null,{status:403});
   await syncClover(connection.company_id);
  }
  return Response.json({ok:true});
 }catch(error){
  if(error instanceof BodyTooLargeError)return new Response(null,{status:413});
  if(error instanceof SyntaxError||error instanceof z.ZodError)return new Response(null,{status:400});
  return new Response(null,{status:503});
 }
}
