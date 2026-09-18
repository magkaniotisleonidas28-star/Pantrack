import {database} from '@/db/raw';
import {recommendation,type InventoryRecord} from '@/lib/inventory';
import type {Product} from '@/lib/pantry';
import {defaultPolicy,purchasingBlockReason,type Policy,type Vendor,type Job} from './automation-types';
import {adapter,decrypt,digest} from './vendor-adapter';
import {z} from 'zod';
export async function state(companyId:string){
 const db=database();const [v,s,j]=await Promise.all([db.prepare('SELECT data,secret FROM vendor_connections WHERE company_id=?').bind(companyId).all<{data:string;secret:string}>(),db.prepare('SELECT data,last_run,scheduler_hash,lease_until FROM automation_settings WHERE company_id=?').bind(companyId).first<{data:string;last_run:string|null;scheduler_hash:string|null;lease_until:string|null}>(),db.prepare('SELECT data,status,amount FROM purchasing_jobs WHERE company_id=? ORDER BY created DESC LIMIT 100').bind(companyId).all<{data:string;status:string;amount:number}>()]);
 const savedPolicy=s?JSON.parse(s.data) as Policy:defaultPolicy;
 // Old or directly written automatic settings must remain safe to load and run.
 const policy:Policy={...savedPolicy,mode:savedPolicy.mode==='paused'?'paused':'review'};
 return {vendors:v.results.map(r=>({...JSON.parse(r.data),hasToken:!!r.secret})),policy,purchasingEnabled:false,purchasingBlockReason,lastRun:s?.last_run,schedulerConfigured:!!s?.scheduler_hash,jobs:j.results.map(r=>({...JSON.parse(r.data),status:r.status,amount:r.amount}))};
}
async function loadJob(companyId:string,id:string){const row=await database().prepare('SELECT data,status,amount FROM purchasing_jobs WHERE company_id=? AND id=?').bind(companyId,id).first<{data:string;status:string;amount:number}>();if(!row)throw new Error('Order attempt not found.');return {...JSON.parse(row.data),status:row.status,amount:row.amount} as Job;}
async function saveJob(companyId:string,job:Job){await database().prepare('UPDATE purchasing_jobs SET data=?,status=?,amount=? WHERE company_id=? AND id=?').bind(JSON.stringify(job),job.status,job.amount,companyId,job.id).run();}
function requireAuthorizedPilot():void{
 // Intentionally unconditional: neither connector verification, approval, nor an
 // environment flag constitutes the real supplier and pilot evidence required.
 throw new Error(purchasingBlockReason);
}
export async function submit(companyId:string,id:string){
 requireAuthorizedPilot();
 const db=database(),job=await loadJob(companyId,id);
 if(job.status!=='review')throw new Error('Only an unsent review proposal can be submitted.');
 const config=await state(companyId),policy=config.policy;
 if(policy.mode==='paused')throw new Error('Automation is paused. Choose review or automatic mode first.');
 const vr=await db.prepare('SELECT data,secret FROM vendor_connections WHERE company_id=? AND id=?').bind(companyId,job.vendorId).first<{data:string;secret:string}>();
 if(!vr)throw new Error('Vendor connection not found.');const vendor=JSON.parse(vr.data) as Vendor;
 if(!vendor.enabled||!vendor.verified)throw new Error('Enable and test the vendor connection first.');
 if(job.items.some(p=>p.sample||!policy.allowedProducts.includes(p.id)||p.supplier!==vendor.name))throw new Error('Only explicitly allowed real products may be ordered.');
 const now=Date.now(),inventory=await db.prepare('SELECT data FROM inventory WHERE company_id=?').bind(companyId).all<{data:string}>(),records=inventory.results.map(r=>JSON.parse(r.data) as InventoryRecord);
 for(const item of job.items){const r=records.find(r=>r.productId===item.id);if(!r)throw new Error('Inventory missing.');if(r.settings.unit!==item.stockUnit||r.settings.unitsPerPack!==item.stockUnitsPerPack)throw new Error('Inventory units changed. Generate a new proposal.');const p=recommendation(r,now);if(p.needsCheck||p.stale||p.expired||p.packs<item.quantity)throw new Error('Inventory or replenishment need changed. Dismiss this proposal and run a fresh check.');}
 const token=await decrypt(vr.secret,companyId+':'+vendor.id);
 const raw=await adapter(vendor,token,{action:'quote',reference:job.id,currency:'USD',delivery_address:vendor.deliveryAddress,items:job.items.map(p=>({sku:p.sku,unit:p.unit,quantity:p.quantity}))});
 const quote=z.object({quote_id:z.string().min(1).max(200),currency:z.literal('USD'),total_cents:z.number().int().nonnegative(),expires_at:z.string().datetime(),items:z.array(z.object({sku:z.string(),unit:z.string(),quantity:z.number().int().positive(),unit_price_cents:z.number().int().nonnegative()}))}).parse(raw);
 if(Date.parse(quote.expires_at)<Date.now()+10000)throw new Error('Quote is expired or expires too soon.');
 if(quote.items.length!==job.items.length||new Set(quote.items.map(i=>i.sku)).size!==quote.items.length)throw new Error('Quote does not match the requested products.');
 for(const item of job.items){const q=quote.items.find(i=>i.sku===item.sku&&i.unit===item.unit&&i.quantity===item.quantity);if(!q||q.unit_price_cents>item.price*(1+policy.priceTolerance/100))throw new Error('Quoted item or price exceeds the approved rules.');}
 const baseline=job.items.reduce((s,p)=>s+p.price*p.quantity,0);
 if(quote.total_cents>policy.maxOrder||quote.total_cents>baseline*(1+policy.priceTolerance/100))throw new Error('The delivered total exceeds your order limit or price tolerance.');
 const day=new Date().toISOString().slice(0,10);
 // Reserve spend before the external action. Sending/unknown orders keep their budget reservation.
 const reserved=await db.prepare("UPDATE purchasing_jobs SET status='sending',amount=?,spend_day=? WHERE company_id=? AND id=? AND status='review' AND ?+COALESCE((SELECT SUM(amount) FROM purchasing_jobs WHERE company_id=? AND status IN ('sending','unknown','accepted','received') AND (spend_day=? OR status IN ('sending','unknown'))),0)<=?").bind(quote.total_cents,day,companyId,id,quote.total_cents,companyId,day,policy.dailyLimit).run();
 if(!reserved.meta.changes)throw new Error('Daily limit reached or this order is already being processed.');
 job.status='sending';job.amount=quote.total_cents;job.message='Submission started. Do not repeat this purchase.';
 await saveJob(companyId,job);
 try{
 const response=await adapter(vendor,token,{action:'order',reference:job.id,idempotency_key:job.id,quote_id:quote.quote_id,max_total_cents:quote.total_cents,allow_substitutions:false});
 if(response.status==='accepted'&&typeof response.order_id==='string'&&response.order_id.length>0){job.status='accepted';job.vendorOrderId=response.order_id;job.message='Vendor confirmed this order.';}
 else if(response.status==='rejected'){job.status='rejected';job.message='Vendor rejected this order.';}
 else{job.status='unknown';job.message='Acceptance could not be confirmed. Reconcile before placing another order.';}
 }catch{job.status='unknown';job.message='The connection ended without confirmation. Do not resubmit; reconcile with the vendor.';}
 await saveJob(companyId,job);
 return job;
}
export async function runCheck(companyId:string,force=false){
 const db=database();const data=await state(companyId),policy=data.policy;
 if(policy.mode==='paused')return {message:'Automation is paused.',created:0};
 const now=new Date(),last=data.lastRun?Date.parse(data.lastRun):0;
 if(!force&&now.getTime()-last<policy.intervalHours*3600000)return {message:'Next check is not due yet.',created:0};
 const lease=await db.prepare('UPDATE automation_settings SET lease_until=? WHERE company_id=? AND (lease_until IS NULL OR lease_until<?)').bind(new Date(now.getTime()+300000).toISOString(),companyId,now.toISOString()).run();
 if(!lease.meta.changes)return {message:'A check is already running.',created:0};
 try{
 const [ps,rs,holds]=await Promise.all([db.prepare('SELECT data FROM products WHERE owner=?').bind(companyId).all<{data:string}>(),db.prepare('SELECT data FROM inventory WHERE company_id=?').bind(companyId).all<{data:string}>(),db.prepare("SELECT data FROM purchasing_jobs WHERE company_id=? AND status IN ('review','sending','unknown','accepted')").bind(companyId).all<{data:string}>()]);
 const products=ps.results.map(r=>JSON.parse(r.data) as Product),records=rs.results.map(r=>JSON.parse(r.data) as InventoryRecord),held=new Set(holds.results.flatMap(r=>(JSON.parse(r.data) as Job).items.map(p=>p.id)));
 let created=0;
 for(const vendor of data.vendors as Vendor[]){
 if(!vendor.enabled)continue;
 const items=products.filter(p=>p.supplier===vendor.name&&policy.allowedProducts.includes(p.id)&&!held.has(p.id)).flatMap(p=>{const r=records.find(r=>r.productId===p.id);if(!r)return [];const rec=recommendation(r);return rec.packs>0&&!rec.stale?[{...p,quantity:rec.packs,stockUnitsPerPack:r.settings.unitsPerPack,stockUnit:r.settings.unit}]:[];});
 if(!items.length)continue;
 const fingerprint=await digest(vendor.id+':'+items.map(p=>p.id+':'+p.quantity+':'+records.find(r=>r.productId===p.id)!.version).sort().join('|'));
 const job:Job={id:crypto.randomUUID(),fingerprint,vendorId:vendor.id,vendorName:vendor.name,status:'review',amount:items.reduce((a,p)=>a+p.price*p.quantity,0),created:now.toISOString(),message:'Prepared by replenishment rules. Nothing sent.',items};
 const inserted=await db.prepare('INSERT OR IGNORE INTO purchasing_jobs(company_id,id,fingerprint,status,amount,data,created) VALUES (?,?,?,?,?,?,?)').bind(companyId,job.id,fingerprint,job.status,job.amount,JSON.stringify(job),job.created).run();
 if(inserted.meta.changes)created++;
 }
 await db.prepare('UPDATE automation_settings SET last_run=? WHERE company_id=?').bind(now.toISOString(),companyId).run();
 return {message:created?created+' proposal(s) created.':'No new eligible replenishment proposals.',created};
 }finally{await db.prepare('UPDATE automation_settings SET lease_until=NULL WHERE company_id=?').bind(companyId).run();}
}
export async function reconcile(companyId:string,id:string){
 const job=await loadJob(companyId,id);if(!['sending','unknown','accepted'].includes(job.status))throw new Error('This order does not need reconciliation.');
 const row=await database().prepare('SELECT data,secret FROM vendor_connections WHERE company_id=? AND id=?').bind(companyId,job.vendorId).first<{data:string;secret:string}>();if(!row)throw new Error('Vendor connection missing.');
 const vendor=JSON.parse(row.data) as Vendor,result=await adapter(vendor,await decrypt(row.secret,companyId+':'+vendor.id),{action:'status',reference:job.id});
 if(result.status==='accepted'&&typeof result.order_id==='string'){job.status='accepted';job.vendorOrderId=result.order_id;job.message='Vendor acceptance confirmed.';}
 else if(result.status==='rejected'||result.status==='canceled'){job.status='rejected';job.message='Vendor confirmed that this purchase will not be fulfilled.';}
 else{job.message='Vendor status remains uncertain. Keep this order on hold.';}
 await saveJob(companyId,job);return job;
}
