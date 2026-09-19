import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {digest} from '@/lib/vendor-adapter';
import {defaultRegister,registerProviders} from '@/lib/register-providers';
import {z} from 'zod';
async function handleGET(req:Request){const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});try{const id=new URL(req.url).searchParams.get('companyId');if(!await companyAccess(u.userId,id))return Response.json({error:'Company access denied.'},{status:403});const row=await database().prepare('SELECT data,token_hash,last_received FROM register_settings WHERE company_id=?').bind(id).first<{data:string;token_hash:string|null;last_received:string|null}>();return Response.json({settings:row?JSON.parse(row.data):defaultRegister,bridgeEnabled:!!row?.token_hash,lastReceived:row?.last_received||null},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Could not load register settings.'},{status:503});}}
async function handlePOST(req:Request){const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});if(req.headers.get('sec-fetch-site')==='cross-site'||!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Invalid request.'},{status:403});try{
 const b=z.object({companyId:z.string().min(1),action:z.enum(['save','token','revoke']),settings:z.object({provider:z.string().refine(v=>registerProviders.some(p=>p.id===v)),customName:z.string().trim().max(60),location:z.string().trim().max(100)}).refine(v=>v.provider!=='other'||v.customName.length>0).optional()}).parse(await req.json());if((await companyAccess(u.userId,b.companyId))?.role!=='owner')return Response.json({error:'Company owner access required.'},{status:403});const db=database();
 if(b.action==='save'){if(!b.settings)throw new Error('Enter register settings.');await db.prepare('INSERT INTO register_settings(company_id,data) VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET data=excluded.data').bind(b.companyId,JSON.stringify(b.settings)).run();return Response.json({ok:true});}
 if(b.action==='revoke'){await db.prepare('UPDATE register_settings SET token_hash=NULL WHERE company_id=?').bind(b.companyId).run();return Response.json({ok:true});}
 const token=crypto.randomUUID()+crypto.randomUUID();await db.prepare('INSERT INTO register_settings(company_id,data,token_hash) VALUES (?,?,?) ON CONFLICT(company_id) DO UPDATE SET token_hash=excluded.token_hash').bind(b.companyId,JSON.stringify(defaultRegister),await digest(token)).run();return Response.json({token},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Check the register settings.':e instanceof Error?e.message:'Could not save settings.'},{status:400});}}
export const GET=withCompanyRoute('register',handleGET);
export const POST=withCompanyRoute('register',handlePOST);
