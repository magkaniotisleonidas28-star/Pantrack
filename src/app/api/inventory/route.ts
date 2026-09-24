import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {defaultSettings,type InventoryRecord} from '@/lib/inventory';
import {D1InventoryManagementService,InventoryManagementError} from '@/lib/d1-inventory-management';
import {exactInventoryPreviewEnabled} from '@/lib/exact-inventory-gate';
import {CURATED_UNIT_IDS,QuantityError} from '@/lib/inventory-quantities';
import {z} from 'zod';
const amount=z.number().finite().min(0).max(10000000).multipleOf(.001);
const settings=z.object({targetStock:amount.nullable().optional().default(null),variancePct:z.number().min(0).max(100),unit:z.string().trim().min(1).max(40),unitsPerPack:z.number().finite().positive().max(1000000),dailyUse:amount,leadDays:z.number().int().min(0).max(365),safety:amount,reviewDays:z.number().int().min(1).max(365),countEveryDays:z.number().int().min(1).max(365),location:z.string().trim().min(1).max(100),capacity:amount.nullable(),shelfDays:z.number().int().min(1).max(3650).nullable(),expiry:z.string().refine(v=>v===''||(/^\d{4}-\d{2}-\d{2}$/.test(v)&&!isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v))});
const identity=z.string().trim().min(1).max(200);
const decimal=z.string().min(1).max(128).regex(/^-?(?:0|[1-9]\d*)(?:\.\d{1,6})?$/);
const occurrence=z.string().min(20).max(35);
function matchesInventoryRequest(data:string,request:object){
 try{const event=JSON.parse(data) as {request?:unknown};return JSON.stringify(event.request)===JSON.stringify(request);}
 catch{return false;}
}
const exactUnit=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('curated'),id:z.enum(CURATED_UNIT_IDS)}).strict(),
 z.object({kind:z.literal('custom'),id:identity,label:z.string().trim().min(1).max(200),dimension:z.enum(['count','mass','volume']),numerator:z.string().regex(/^[1-9]\d*$/).max(128),denominator:z.string().regex(/^[1-9]\d*$/).max(128)}).strict(),
]);
const recipeAmount=z.object({productId:identity,amount:decimal,unitId:identity}).strict();
const exactMutation=z.discriminatedUnion('action',[
 z.object({action:z.literal('configureExact'),companyId:identity,productId:identity,operationId:identity,stockUnit:exactUnit,purchaseUnitLabel:z.string().trim().min(1).max(200),purchaseAmount:decimal,openingAmount:decimal.optional(),effectiveAt:occurrence}).strict(),
 z.object({action:z.literal('movementExact'),companyId:identity,productId:identity,operationId:identity,expectedVersion:z.number().int().min(0),movement:z.enum(['receive','use','waste','incoming']),amount:decimal,unitId:identity,effectiveAt:occurrence,note:z.string().trim().max(300),fromIncoming:z.boolean().optional()}).strict(),
 z.object({action:z.literal('countExact'),companyId:identity,productId:identity,operationId:identity,expectedVersion:z.number().int().min(0),amount:decimal,unitId:identity,effectiveAt:occurrence,note:z.string().trim().max(300)}).strict(),
 z.object({action:z.literal('saveRecipeDraftExact'),companyId:identity,recipeId:identity,draftId:identity,name:z.string().trim().min(1).max(100),ingredients:z.array(recipeAmount).min(1).max(50)}).strict(),
 z.object({action:z.literal('activateRecipeExact'),companyId:identity,recipeId:identity,versionId:identity,expectedActiveVersionId:identity.nullable()}).strict(),
 z.object({action:z.literal('archiveRecipeExact'),companyId:identity,recipeId:identity,versionId:identity}).strict(),
 z.object({action:z.literal('saveModifierDraftExact'),companyId:identity,recipeId:identity,modifierId:identity,draftId:identity,name:z.string().trim().min(1).max(100),deltas:z.array(recipeAmount.extend({signed:z.boolean()})).min(1).max(50)}).strict(),
 z.object({action:z.literal('activateModifierExact'),companyId:identity,recipeId:identity,modifierId:identity,versionId:identity,expectedActiveVersionId:identity.nullable()}).strict(),
 z.object({action:z.literal('archiveModifierExact'),companyId:identity,recipeId:identity,modifierId:identity,versionId:identity}).strict(),
]);
async function handleGET(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 try{const companyId=new URL(req.url).searchParams.get('companyId');if(!(await companyAccess(u.userId,companyId)))return Response.json({error:'Company access denied.'},{status:403});
 const db=database();const enabled=exactInventoryPreviewEnabled();const [r,e,exact]=await Promise.all([db.prepare('SELECT data FROM inventory WHERE company_id=?').bind(companyId).all<{data:string}>(),db.prepare('SELECT data FROM inventory_events WHERE company_id=? ORDER BY created DESC LIMIT 100').bind(companyId).all<{data:string}>(),enabled?new D1InventoryManagementService(db).read(companyId!):null]);
 return Response.json({records:r.results.map(x=>JSON.parse(x.data)),events:e.results.map(x=>JSON.parse(x.data)),exactEnabled:enabled,exact},{headers:{'Cache-Control':'no-store'}});
 }catch{return Response.json({error:'Could not load inventory. Please retry.'},{status:503});}
}
async function handlePOST(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Invalid origin'},{status:403});
 if(!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'JSON required'},{status:415});
 try{
 const body:unknown=await req.json();
 if(exactInventoryPreviewEnabled()){
  const b=exactMutation.parse(body);
  const member=await companyAccess(u.userId,b.companyId);if(!member||!['owner','manager'].includes(member.role))return Response.json({error:'You cannot update this company’s inventory.'},{status:403});
  const service=new D1InventoryManagementService(database());
  let result;
  if(b.action==='configureExact')result=await service.configure({...b,actor:u.email});
  else if(b.action==='movementExact')result=await service.recordMovement({companyId:b.companyId,productId:b.productId,operationId:b.operationId,expectedVersion:b.expectedVersion,actor:u.email,action:b.movement,amount:b.amount,unitId:b.unitId,effectiveAt:b.effectiveAt,note:b.note,fromIncoming:b.fromIncoming});
  else if(b.action==='countExact')result=await service.recordCount({...b,actor:u.email});
  else if(b.action==='saveRecipeDraftExact')result=await service.saveRecipeDraft({...b,actor:u.email});
  else if(b.action==='activateRecipeExact')result=await service.activateRecipe({...b,actor:u.email});
  else if(b.action==='archiveRecipeExact')result=await service.archiveRecipe({...b,actor:u.email});
  else if(b.action==='saveModifierDraftExact')result=await service.saveModifierDraft({...b,actor:u.email});
  else if(b.action==='activateModifierExact')result=await service.activateModifier({...b,actor:u.email});
  else result=await service.archiveModifier({...b,actor:u.email});
  return Response.json({ok:true,result});
 }
 const b=z.object({companyId:z.string().min(1).max(200),productId:z.string().min(1).max(100),id:z.string().uuid(),version:z.number().int().min(0),action:z.enum(['settings','count','receive','use','waste','incoming']),quantity:amount.optional(),settings:settings.optional(),note:z.string().trim().max(300).default(''),fromIncoming:z.boolean().optional()}).strict().parse(body);
 const member=await companyAccess(u.userId,b.companyId);if(!member||!['owner','manager'].includes(member.role))return Response.json({error:'You cannot update this company’s inventory.'},{status:403});
 const db=database();if(!await db.prepare('SELECT id FROM products WHERE owner=? AND id=?').bind(b.companyId,b.productId).first())return Response.json({error:'Product not found.'},{status:404});
 const request={productId:b.productId,version:b.version,action:b.action,quantity:b.quantity??null,settings:b.settings??null,note:b.note,fromIncoming:b.fromIncoming??false};
 const prior=await db.prepare('SELECT data FROM inventory_events WHERE company_id=? AND id=?').bind(b.companyId,b.id).first<{data:string}>();
 if(prior){if(!matchesInventoryRequest(prior.data,request))return Response.json({error:'Update reference already used with different details.'},{status:409});return Response.json({ok:true,replayed:true});}
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
 const event={id:b.id,productId:b.productId,action:b.action,quantity:b.quantity??null,note:b.note,created:now,actor:u.email,request};
 await db.batch([
 db.prepare('INSERT OR IGNORE INTO inventory_events(company_id,id,product_id,data,created) SELECT ?,?,?,?,? WHERE COALESCE((SELECT version FROM inventory WHERE company_id=? AND product_id=?),0)=?').bind(b.companyId,b.id,b.productId,JSON.stringify(event),now,b.companyId,b.productId,b.version),
 db.prepare('INSERT INTO inventory(company_id,product_id,data,version) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM inventory_events WHERE company_id=? AND id=?) AND COALESCE((SELECT version FROM inventory WHERE company_id=? AND product_id=?),0)=? ON CONFLICT(company_id,product_id) DO UPDATE SET data=excluded.data,version=excluded.version WHERE inventory.version=?').bind(b.companyId,b.productId,JSON.stringify(r),r.version,b.companyId,b.id,b.companyId,b.productId,b.version,b.version)
 ]);
 const savedEvent=await db.prepare('SELECT data FROM inventory_events WHERE company_id=? AND id=?').bind(b.companyId,b.id).first<{data:string}>();
 if(!savedEvent)return Response.json({error:'Inventory changed. Refresh and retry.'},{status:409});
 if(!matchesInventoryRequest(savedEvent.data,request))return Response.json({error:'Update reference already used with different details.'},{status:409});
 return Response.json({ok:true});
 }catch(e){
  if(e instanceof z.ZodError)return Response.json({error:'Check quantities, dates, and required settings.'},{status:400});
  if(e instanceof InventoryManagementError||e instanceof QuantityError){
   const conflict=['concurrent_update','operation_conflict','immutable_version','unit_incompatible'].includes(e.code);
   const missing=e.code==='not_found';
   return Response.json({error:e.message,code:e.code},{status:missing?404:conflict?409:400});
  }
  return Response.json({error:'Could not save inventory. Please retry.'},{status:503});
 }
}
export const GET=withCompanyRoute('inventory',handleGET);
export const POST=withCompanyRoute('inventory',handlePOST);
