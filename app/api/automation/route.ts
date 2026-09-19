import {permitted} from '@/lib/authorization';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {state,runCheck,submit,reconcile} from '@/lib/purchasing-engine';
import {encrypt,decrypt,digest,adapter,publicEndpoint} from '@/lib/vendor-adapter';
import {defaultPolicy,purchasingBlockReason,type Vendor} from '@/lib/automation-types';
import {z} from 'zod';
const vendorSchema=z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),website:z.union([z.literal(''),z.string().url().refine(v=>/^https?:/.test(v))]),endpoint:z.string().max(1000).refine(v=>{if(!v)return true;try{publicEndpoint(v);return true;}catch{return false;}}),account:z.string().max(200),deliveryAddress:z.string().max(1000),notes:z.string().max(1000),enabled:z.boolean()});
const policySchema=z.object({mode:z.enum(['paused','review','automatic']),intervalHours:z.number().int().min(1).max(168),maxOrder:z.number().int().min(1).max(10000000),dailyLimit:z.number().int().min(1).max(10000000),priceTolerance:z.number().min(0).max(50),allowedProducts:z.array(z.string()).max(500)});
async function handleGET(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 try{const id=new URL(req.url).searchParams.get('companyId');const role=(await companyAccess(u.userId,id))?.role;if(!role||!permitted(role,'operate'))return Response.json({error:'Company owner access required.'},{status:403});const data=await state(id!);return Response.json(role==='owner'?data:{jobs:data.jobs,lastRun:data.lastRun,mode:data.policy.mode},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Could not load vendor automation.'},{status:503});}
}
async function handlePOST(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site'||!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Invalid request.'},{status:403});
 try{
 const b=z.object({companyId:z.string().min(1).max(200),action:z.enum(['vendor','policy','test','run','approve','reconcile','dismiss','received','scheduler','pause']),vendor:vendorSchema.optional(),token:z.string().max(4000).optional(),clearToken:z.boolean().optional(),policy:policySchema.optional(),id:z.string().uuid().optional()}).parse(await req.json());
 if(!await companyAccess(u.userId,b.companyId))return Response.json({error:'Company owner access required.'},{status:403});
 const db=database();
 if(b.action==='pause'){await db.prepare("INSERT INTO automation_settings(company_id,data) VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET data=json_set(automation_settings.data,'$.mode','paused')").bind(b.companyId,JSON.stringify({...defaultPolicy,mode:'paused'})).run();return Response.json({message:'Company automation paused.'});}
 if(b.action==='vendor'){
 if(!b.vendor)throw new Error('Vendor details required.');
 const all=await db.prepare('SELECT data FROM vendor_connections WHERE company_id=?').bind(b.companyId).all<{data:string}>();
 if(all.results.some(r=>{const v=JSON.parse(r.data);return v.id!==b.vendor!.id&&v.name===b.vendor!.name;}))throw new Error('A connection already exists for this supplier.');
 const held=await db.prepare("SELECT id FROM purchasing_jobs WHERE company_id=? AND json_extract(data,'$.vendorId')=? AND status IN ('review','sending','unknown','accepted') LIMIT 1").bind(b.companyId,b.vendor.id).first();
 if(held)throw new Error('Resolve or dismiss outstanding proposals before changing this vendor.');
 const previous=await db.prepare('SELECT secret FROM vendor_connections WHERE company_id=? AND id=?').bind(b.companyId,b.vendor.id).first<{secret:string}>();
 const secret=b.clearToken?'':b.token?await encrypt(b.token,b.companyId+':'+b.vendor.id):previous?.secret||'';
 await db.prepare('INSERT INTO vendor_connections(company_id,id,data,secret) VALUES (?,?,?,?) ON CONFLICT(company_id,id) DO UPDATE SET data=excluded.data,secret=excluded.secret').bind(b.companyId,b.vendor.id,JSON.stringify({...b.vendor,verified:false}),secret).run();
 return Response.json({message:'Vendor saved. Connector testing is available; supplier order submission remains disabled.'});
 }
 if(b.action==='policy'){
 if(!b.policy)throw new Error('Automation rules required.');
 if(b.policy.maxOrder>b.policy.dailyLimit)throw new Error('Per-order limit cannot exceed the daily limit.');
 if(b.policy.mode==='automatic')throw new Error(purchasingBlockReason);
 await db.prepare('INSERT INTO automation_settings(company_id,data) VALUES (?,?) ON CONFLICT(company_id) DO UPDATE SET data=excluded.data').bind(b.companyId,JSON.stringify(b.policy)).run();
 return Response.json({message:'Automation rules saved.'});
 }
 if(b.action==='test'){
 const r=await db.prepare('SELECT data,secret FROM vendor_connections WHERE company_id=? AND id=?').bind(b.companyId,b.id).first<{data:string;secret:string}>();if(!r)throw new Error('Vendor not found.');
 const v=JSON.parse(r.data) as Vendor;if(!v.endpoint||!v.account||!v.deliveryAddress)throw new Error('Enter the connector URL, account and delivery address first.');
 const response=await adapter(v,await decrypt(r.secret,b.companyId+':'+v.id),{action:'capabilities'});
 if(response.protocol!=='pantrack.vendor.v1'||response.quotes!==true||response.orders!==true||response.status_lookup!==true||response.idempotency!==true||response.enforces_max_total!==true||response.no_substitutions!==true)throw new Error('This service does not confirm the required ordering contract.');
 v.verified=true;await db.prepare('UPDATE vendor_connections SET data=? WHERE company_id=? AND id=?').bind(JSON.stringify(v),b.companyId,v.id).run();return Response.json({message:'Connector contract verified. No order was placed.'});
 }
 if(b.action==='run')return Response.json(await runCheck(b.companyId,true));
 if(b.action==='approve'){if(!b.id)throw new Error('Proposal required.');return Response.json({job:await submit(b.companyId,b.id),message:'Submission result recorded. Review its status below.'});}
 if(b.action==='reconcile'){if(!b.id)throw new Error('Order reference required.');return Response.json({job:await reconcile(b.companyId,b.id),message:'Vendor status checked.'});}
 if(b.action==='dismiss'||b.action==='received'){
 if(b.action==='received'){
 const jr=await db.prepare("SELECT data FROM purchasing_jobs WHERE company_id=? AND id=? AND status='accepted'").bind(b.companyId,b.id).first<{data:string}>();if(!jr)throw new Error('Accepted order required.');
 const job=JSON.parse(jr.data);
 const events=await db.prepare("SELECT data FROM inventory_events WHERE company_id=? AND created>=?").bind(b.companyId,job.created).all<{data:string}>();
 const receipts=events.results.map(e=>JSON.parse(e.data)).filter(e=>e.action==='receive'&&e.note===job.id);
 for(const item of job.items){const stock=await db.prepare('SELECT data FROM inventory WHERE company_id=? AND product_id=?').bind(b.companyId,item.id).first<{data:string}>();if(!stock||JSON.parse(stock.data).settings.unit!==item.stockUnit)throw new Error('Inventory units changed. Resolve the receipt before closing.');const count=receipts.filter(e=>e.productId===item.id).reduce((s,e)=>s+(e.quantity||0),0);if(!item.stockUnitsPerPack||count<item.quantity*item.stockUnitsPerPack)throw new Error('Record all actual received quantities in Inventory using this proposal ID as the delivery reference before closing.');}
 }
 const from=b.action==='dismiss'?'review':'accepted',to=b.action==='dismiss'?'dismissed':'received';
 const result=await db.prepare('UPDATE purchasing_jobs SET status=? WHERE company_id=? AND id=? AND status=?').bind(to,b.companyId,b.id,from).run();
 if(!result.meta.changes)throw new Error('Order status changed or this action is not allowed.');
 return Response.json({message:b.action==='received'?'Order closed as received. Record the actual delivery quantities in Inventory before running another check.':'Proposal dismissed. An unchanged inventory snapshot will not recreate it.'});
 }
 // A scheduler key authorizes only due checks for this company, never settings changes.
 const token=crypto.randomUUID()+crypto.randomUUID(),hash=await digest(token);
 await db.prepare('INSERT INTO automation_settings(company_id,data,scheduler_hash) VALUES (?,?,?) ON CONFLICT(company_id) DO UPDATE SET scheduler_hash=excluded.scheduler_hash').bind(b.companyId,JSON.stringify(defaultPolicy),hash).run();
 return Response.json({schedulerToken:token,schedulerUrl:new URL(req.url).origin+'/api/automation/tick?companyId='+encodeURIComponent(b.companyId),message:'Scheduler key created. Copy it now; generating another invalidates the previous key.'},{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Check vendor details and rule limits.':e instanceof Error?e.message:'Could not update automation.'},{status:400});}
}
export const GET=withCompanyRoute('automation',handleGET);
export const POST=withCompanyRoute('automation',handlePOST);
