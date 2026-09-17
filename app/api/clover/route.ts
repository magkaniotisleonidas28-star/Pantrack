import {getChatGPTUser} from '@/app/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {digest} from '@/lib/vendor-adapter';
import {callbackUrl,cloverConfig,cloverConnection,cloverJson,withClover} from '@/lib/clover';
import {z} from 'zod';
export async function GET(req:Request){const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});try{const id=new URL(req.url).searchParams.get('companyId');if((await companyAccess(u.userId,id))?.role!=='owner')return Response.json({error:'Company owner access required.'},{status:403});const c=cloverConfig(),row=await cloverConnection(id!);return Response.json({ready:c.ready,environment:c.environment,connected:!!row,merchantId:row?.merchant_id,lastChecked:row?.last_checked,callbackUrl},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Could not load Clover connection.'},{status:503});}}
export async function POST(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site'||!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Invalid request.'},{status:403});
 try{const b=z.object({companyId:z.string().min(1),action:z.enum(['connect','disconnect','menu']),offset:z.number().int().min(0).max(100000).default(0)}).parse(await req.json());if((await companyAccess(u.userId,b.companyId))?.role!=='owner')return Response.json({error:'Company owner access required.'},{status:403});const c=cloverConfig(),db=database();
 if(b.action==='disconnect'){const row=await cloverConnection(b.companyId);if(row&&row.lease_until>Date.now())throw new Error('Wait for the current Clover request to finish.');await db.batch([db.prepare('DELETE FROM clover_connections WHERE company_id=?').bind(b.companyId),db.prepare('DELETE FROM clover_oauth_states WHERE company_id=?').bind(b.companyId)]);return Response.json({message:'Clover disconnected from Pantrack. You can also revoke app access in Clover.'});}
 if(!c.ready)throw new Error('Clover developer app setup is required before connecting.');
 if(b.action==='connect'){
 const row=await cloverConnection(b.companyId);if(row&&row.lease_until>Date.now())throw new Error('Wait for the current Clover request to finish.');
 const state=crypto.randomUUID()+crypto.randomUUID();await db.batch([db.prepare('DELETE FROM clover_oauth_states WHERE company_id=? OR expires<?').bind(b.companyId,Date.now()),db.prepare('INSERT INTO clover_oauth_states(state_hash,company_id,user_id,environment,expires) VALUES (?,?,?,?,?)').bind(await digest(state),b.companyId,u.userId,c.environment,Date.now()+600000)]);
 const url=new URL(c.auth+'/oauth/v2/authorize');url.search=new URLSearchParams({client_id:c.clientId,response_type:'code',redirect_uri:callbackUrl,state}).toString();return Response.json({url:url.href},{headers:{'Cache-Control':'no-store','Set-Cookie':'clover_oauth='+state+'; HttpOnly; Secure; SameSite=Lax; Path=/api/clover; Max-Age=600'}});
 }
 const result=await withClover(b.companyId,async(connection,token)=>{
 const url=c.api+'/v3/merchants/'+encodeURIComponent(connection.merchant_id)+'/items?limit=100&offset='+b.offset;
 const data=z.object({elements:z.array(z.object({id:z.string().min(1),name:z.string().optional(),deleted:z.boolean().optional(),hidden:z.boolean().optional()})).max(100)}).parse(await cloverJson(url,{headers:{Authorization:'Bearer '+token}}));
 return {merchantId:connection.merchant_id,items:data.elements.filter(i=>!i.deleted&&!i.hidden).map(i=>({id:i.id,name:i.name||i.id})),nextOffset:data.elements.length===100?b.offset+100:null};});return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Unexpected Clover data or invalid request.':e instanceof Error?e.message:'Clover request failed.'},{status:400});}
}
