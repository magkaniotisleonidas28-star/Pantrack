import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {digest} from '@/lib/vendor-adapter';
import {callbackUrl,cloverConfig,cloverConnection,cloverJson,withClover} from '@/lib/clover';
import {cloverSyncEnabled,cloverSyncStatus,syncClover} from '@/lib/clover-sync';
import {z} from 'zod';
async function handleGET(req:Request){const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});try{const id=new URL(req.url).searchParams.get('companyId');if((await companyAccess(u.userId,id))?.role!=='owner')return Response.json({error:'Company owner access required.'},{status:403});const c=cloverConfig(),row=await cloverConnection(id!),db=database();const sync=row?await cloverSyncStatus(id!):null;const [items,modifiers,recipes,recipeModifiers]=row?await Promise.all([
 db.prepare('SELECT item_id,recipe_id FROM clover_item_mappings WHERE company_id=? AND environment=? AND merchant_id=?').bind(id,row.environment,row.merchant_id).all(),
 db.prepare('SELECT item_id,modifier_id,inventory_modifier_id FROM clover_modifier_mappings WHERE company_id=? AND environment=? AND merchant_id=?').bind(id,row.environment,row.merchant_id).all(),
 db.prepare("SELECT recipe_id,name FROM recipe_versions WHERE company_id=? AND status='active' ORDER BY name").bind(id).all(),
 db.prepare("SELECT v.recipe_id,v.modifier_id,l.name FROM recipe_modifier_versions v JOIN recipe_modifier_lineages l ON l.company_id=v.company_id AND l.recipe_id=v.recipe_id AND l.id=v.modifier_id WHERE v.company_id=? AND v.status='active' ORDER BY l.name").bind(id).all(),
 ]):[{results:[]},{results:[]},{results:[]},{results:[]}];return Response.json({ready:c.ready,environment:c.environment,connected:!!row,merchantId:row?.merchant_id,lastChecked:row?.last_checked,callbackUrl:callbackUrl(),syncEnabled:cloverSyncEnabled(),sync,itemMappings:items.results,modifierMappings:modifiers.results,recipes:recipes.results,recipeModifiers:recipeModifiers.results},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Could not load Clover connection.'},{status:503});}}
async function handlePOST(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site'||!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Invalid request.'},{status:403});
 try{const b=z.object({companyId:z.string().min(1),action:z.enum(['connect','disconnect','menu','modifiers','mapItem','mapModifier','sync']),offset:z.number().int().min(0).max(100000).default(0),itemId:z.string().min(1).max(200).optional(),modifierId:z.string().min(1).max(200).optional(),recipeId:z.string().min(1).max(200).optional(),inventoryModifierId:z.string().min(1).max(200).optional()}).parse(await req.json());if((await companyAccess(u.userId,b.companyId))?.role!=='owner')return Response.json({error:'Company owner access required.'},{status:403});const c=cloverConfig(),db=database();
 if(b.action==='disconnect'){const row=await cloverConnection(b.companyId);if(row&&row.lease_until>Date.now())throw new Error('Wait for the current Clover request to finish.');await db.batch([db.prepare('DELETE FROM clover_connections WHERE company_id=?').bind(b.companyId),db.prepare('DELETE FROM clover_oauth_states WHERE company_id=?').bind(b.companyId)]);return Response.json({message:'Clover disconnected from Pantrack. You can also revoke app access in Clover.'});}
 if(!c.ready)throw new Error('Clover developer app setup is required before connecting.');
 if(b.action==='connect'){
 const row=await cloverConnection(b.companyId);if(row&&row.lease_until>Date.now())throw new Error('Wait for the current Clover request to finish.');
 const state=crypto.randomUUID()+crypto.randomUUID();await db.batch([db.prepare('DELETE FROM clover_oauth_states WHERE company_id=? OR expires<?').bind(b.companyId,Date.now()),db.prepare('INSERT INTO clover_oauth_states(state_hash,company_id,user_id,environment,expires) VALUES (?,?,?,?,?)').bind(await digest(state),b.companyId,u.userId,c.environment,Date.now()+600000)]);
 const url=new URL(c.auth+'/oauth/v2/authorize');url.search=new URLSearchParams({client_id:c.clientId,response_type:'code',redirect_uri:callbackUrl(),state}).toString();return Response.json({url:url.href},{headers:{'Cache-Control':'no-store','Set-Cookie':'clover_oauth='+state+'; HttpOnly; Secure; SameSite=Lax; Path=/api/clover; Max-Age=600'}});
 }
 if(b.action==='sync'){if(!await cloverConnection(b.companyId))throw new Error('Connect Clover first.');return Response.json(await syncClover(b.companyId),{headers:{'Cache-Control':'no-store'}});}
 if(b.action==='mapItem'||b.action==='mapModifier'){
  const connection=await cloverConnection(b.companyId);if(!connection)throw new Error('Connect Clover first.');
  if(!b.itemId)throw new Error('Choose a Clover item.');
  if(b.action==='mapItem'){
   if(!b.recipeId||!await db.prepare("SELECT 1 FROM recipe_versions WHERE company_id=? AND recipe_id=? AND status='active'").bind(b.companyId,b.recipeId).first())throw new Error('Choose an active recipe.');
   await db.batch([
    db.prepare('DELETE FROM clover_modifier_mappings WHERE company_id=? AND environment=? AND merchant_id=? AND item_id=? AND EXISTS(SELECT 1 FROM clover_item_mappings WHERE company_id=? AND environment=? AND merchant_id=? AND item_id=? AND recipe_id<>?)').bind(b.companyId,connection.environment,connection.merchant_id,b.itemId,b.companyId,connection.environment,connection.merchant_id,b.itemId,b.recipeId),
    db.prepare('INSERT INTO clover_item_mappings(company_id,environment,merchant_id,item_id,recipe_id) VALUES (?,?,?,?,?) ON CONFLICT(company_id,environment,merchant_id,item_id) DO UPDATE SET recipe_id=excluded.recipe_id').bind(b.companyId,connection.environment,connection.merchant_id,b.itemId,b.recipeId),
   ]);
  }else{
   if(!b.modifierId||!b.inventoryModifierId)throw new Error('Choose a Clover modifier and recipe modifier.');
   const mapping=await db.prepare('SELECT recipe_id FROM clover_item_mappings WHERE company_id=? AND environment=? AND merchant_id=? AND item_id=?').bind(b.companyId,connection.environment,connection.merchant_id,b.itemId).first<{recipe_id:string}>();
   if(!mapping||!await db.prepare("SELECT 1 FROM recipe_modifier_versions WHERE company_id=? AND recipe_id=? AND modifier_id=? AND status='active'").bind(b.companyId,mapping.recipe_id,b.inventoryModifierId).first())throw new Error('Choose an active modifier for the mapped recipe.');
   await db.prepare('INSERT INTO clover_modifier_mappings(company_id,environment,merchant_id,item_id,modifier_id,inventory_modifier_id) VALUES (?,?,?,?,?,?) ON CONFLICT(company_id,environment,merchant_id,item_id,modifier_id) DO UPDATE SET inventory_modifier_id=excluded.inventory_modifier_id').bind(b.companyId,connection.environment,connection.merchant_id,b.itemId,b.modifierId,b.inventoryModifierId).run();
  }
  return Response.json({ok:true});
 }
 const result=await withClover(b.companyId,async(connection,token)=>{
 const url=c.api+'/v3/merchants/'+encodeURIComponent(connection.merchant_id)+(b.action==='modifiers'?'/modifiers':'/items')+'?limit=100&offset='+b.offset;
 const data=z.object({elements:z.array(z.object({id:z.string().min(1),name:z.string().optional(),deleted:z.boolean().optional(),hidden:z.boolean().optional()})).max(100)}).parse(await cloverJson(url,{headers:{Authorization:'Bearer '+token}}));
 return {merchantId:connection.merchant_id,items:data.elements.filter(i=>!i.deleted&&!i.hidden).map(i=>({id:i.id,name:i.name||i.id})),nextOffset:data.elements.length===100?b.offset+100:null};});return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Unexpected Clover data or invalid request.':e instanceof Error?e.message:'Clover request failed.'},{status:400});}
}
export const GET=withCompanyRoute('clover',handleGET);
export const POST=withCompanyRoute('clover',handlePOST);
