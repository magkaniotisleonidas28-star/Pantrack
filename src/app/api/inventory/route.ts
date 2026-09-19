import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {defaultSettings,type InventoryRecord} from '@/lib/inventory';
import {z} from 'zod';
const amount=z.number().finite().min(0).max(10000000).multipleOf(.001);
const settings=z.object({targetStock:amount.nullable().optional().default(null),variancePct:z.number().min(0).max(100),unit:z.string().trim().min(1).max(40),unitsPerPack:z.number().finite().positive().max(1000000),dailyUse:amount,leadDays:z.number().int().min(0).max(365),safety:amount,reviewDays:z.number().int().min(1).max(365),countEveryDays:z.number().int().min(1).max(365),location:z.string().trim().min(1).max(100),capacity:amount.nullable(),shelfDays:z.number().int().min(1).max(3650).nullable(),expiry:z.string().refine(v=>v===''||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v))});
async function handleGET(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 try{const companyId=new URL(req.url).searchParams.get('companyId');if(!(await companyAccess(u.userId,companyId)))return Response.json({error:'Company access denied.'},{status:403});
 const db=database();const [r,e]=await Promise.all([db.prepare('SELECT data FROM inventory WHERE company_id=?').bind(companyId).all<{data:string}>(),db.prepare('SELECT data FROM inventory_events WHERE company_id=? ORDER BY created DESC LIMIT 100').bind(companyId).all<{data:string}>()]);
 return Response.json({records:r.results.map(x=>JSON.parse(x.data)),events:e.results.map(x=>JSON.parse(x.data))},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Could not load inventory. Please retry.'},{status:503});}
}
async function handlePOST(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Invalid origin'},{status:403});
 if(!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'JSON required'},{status:415});
 try{
 const b=z.object({companyId:z.string().min(1).max(200),productId:z.string().min(1).max(100),id:z.string().uuid(),version:z.number().int().min(0),action:z.enum(['settings','count','receive','use','waste','incoming']),quantity:amount.optional(),settings:settings.optional(),note:z.string().trim().max(300).default(''),fromIncoming:z.boolean().optional()}).strict().parse(await req.json());
 const member=await companyAccess(u.userId,b.companyId);if(!member||!['owner','manager'].includes(member.role))return Response.json({error:'You cannot update this company’s inventory.'},{status:403});
 const db=database();if(!await db.prepare('SELECT id FROM products WHERE owner=? AND id=?').bind(b.companyId,b.productId).first())return Response.json({error:'Product not found.'},{status:404});
 const prior=await db.prepare('SELECT product_id FROM inventory_events WHERE company_id=? AND id=?').bind(b.companyId,b.id).first<{product_id:string}>();
 if(prior){if(prior.product_id!==b.productId)return Response.json({error:'Update reference already used.'},{status:409});return Response.json({ok:true,replayed:true});}
 const old=await db.prepare('SELECT data,version FROM inventory WHERE company_id=? AND product_id=?').bind(b.companyId,b.productId).first<{data:string;version:number}>();
 if((old?.version||0)!==b.version)return Response.json({error:'Stock changed in another session. Close this form, refresh inventory, and retry.'},{status:409});
 if(!old&&b.action!=='settings')return Response.json({error:'Set up inventory for this product first.'},{status:400});
 const now=new Date().toISOString();const r:InventoryRecord=old?JSON.parse(old.data):{productId:b.productId,settings:defaultSettings,onHand:0,incoming:0,lastCount:null,updated:now,version:0,estimatedUsed:0};
 if(b.action==='settings'){
 if(!b.settings)return Response.json({error:'Inventory settings are required.'},{status:400});
 if(old&&r.settings.unit!==b.settings.unit&&(r.onHand>0||r.incoming>0))return Response.json({error:'Record zero stock and zero incoming before changing the stock unit.'},{status:409});
 if(old&&r.settings.unit!==b.settings.unit){r.lastCount=null;r.estimatedUsed=0;}
 r.settings=b.settings;
 }else{
 if(b.quantity===undefined)return Response.json({error:'Enter a quantity.'},{status:400});
 if(['receive','use','waste'].includes(b.action)&&b.quantity===0)return Response.json({error:'Quantity must be greater than zero.'},{status:400});
 if(b.action==='count'){r.onHand=b.quantity;r.lastCount=now;r.estimatedUsed=0;}
 if(b.action==='incoming')r.incoming=b.quantity;
 if(b.action==='receive'){r.onHand+=b.quantity;if(b.fromIncoming)r.incoming=Math.max(0,r.incoming-b.quantity);}
 if(b.action==='use'||b.action==='waste'){if(b.quantity>r.onHand)return Response.json({error:'Quantity exceeds recorded stock. Record a fresh count first.'},{status:400});r.onHand-=b.quantity;}
 }
 r.onHand=Math.round(r.onHand*1000)/1000;r.incoming=Math.round(r.incoming*1000)/1000;
 if(r.onHand>10000000)return Response.json({error:'Stock exceeds the supported quantity.'},{status:400});
 r.version=b.version+1;r.updated=now;
 const event={id:b.id,productId:b.productId,action:b.action,quantity:b.quantity??null,note:b.note,created:now,actor:u.email};
 await db.batch([
 db.prepare('INSERT OR IGNORE INTO inventory_events(company_id,id,product_id,data,created) SELECT ?,?,?,?,? WHERE COALESCE((SELECT version FROM inventory WHERE company_id=? AND product_id=?),0)=?').bind(b.companyId,b.id,b.productId,JSON.stringify(event),now,b.companyId,b.productId,b.version),
 db.prepare('INSERT INTO inventory(company_id,product_id,data,version) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM inventory_events WHERE company_id=? AND id=?) AND COALESCE((SELECT version FROM inventory WHERE company_id=? AND product_id=?),0)=? ON CONFLICT(company_id,product_id) DO UPDATE SET data=excluded.data,version=excluded.version WHERE inventory.version=?').bind(b.companyId,b.productId,JSON.stringify(r),r.version,b.companyId,b.id,b.companyId,b.productId,b.version,b.version)
 ]);
 if(!await db.prepare('SELECT id FROM inventory_events WHERE company_id=? AND id=?').bind(b.companyId,b.id).first())return Response.json({error:'Inventory changed. Refresh and retry.'},{status:409});
 return Response.json({ok:true});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Check quantities, dates, and required settings.':'Could not save inventory. Please retry.'},{status:e instanceof z.ZodError?400:503});}
}
export const GET=withCompanyRoute('inventory',handleGET);
export const POST=withCompanyRoute('inventory',handlePOST);
