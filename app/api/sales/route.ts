import {withCompanyRoute} from '@/lib/authorization';
import {importSales} from '@/lib/import-sales';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {companyAccess} from '@/lib/company-access';
import {database} from '@/db/raw';
import {type InventoryRecord} from '@/lib/inventory';
import {z} from 'zod';
async function handleGET(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 try{const companyId=new URL(req.url).searchParams.get('companyId');if(!await companyAccess(u.userId,companyId))return Response.json({error:'Company access denied.'},{status:403});const db=database();const [r,i,m]=await Promise.all([db.prepare('SELECT data FROM recipes WHERE company_id=?').bind(companyId).all<{data:string}>(),db.prepare('SELECT data FROM sales_imports WHERE company_id=? ORDER BY created DESC LIMIT 30').bind(companyId).all<{data:string}>(),db.prepare('SELECT data FROM register_mappings WHERE company_id=?').bind(companyId).all<{data:string}>()]);return Response.json({mappings:m.results.map(x=>JSON.parse(x.data)),recipes:r.results.map(x=>JSON.parse(x.data)),imports:i.results.map(x=>JSON.parse(x.data))},{headers:{'Cache-Control':'no-store'}});}catch{return Response.json({error:'Could not load recipes and sales.'},{status:503});}
}
type Recipe={id:string;name:string;ingredients:{productId:string;quantity:number;unit:string}[]};
async function handlePOST(req:Request){
 const u=await getChatGPTUser();if(!u)return Response.json({error:'Please sign in.'},{status:401});
 if(req.headers.get('sec-fetch-site')==='cross-site'||!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Invalid request.'},{status:403});
 try{
 const b=z.object({companyId:z.string().min(1),action:z.enum(['recipe','import','mapping','removeMapping']),mapping:z.object({provider:z.string().trim().min(1).max(60),location:z.string().trim().min(1).max(100),itemId:z.string().trim().min(1).max(150),name:z.string().trim().min(1).max(100),recipeId:z.string().uuid()}).optional(),mappingKey:z.string().min(1).max(500).optional(),recipe:z.object({id:z.string().uuid(),name:z.string().trim().min(1).max(100),ingredients:z.array(z.object({productId:z.string().min(1),quantity:z.number().positive().max(100000),unit:z.string().min(1)})).min(1).max(20)}).optional(),reference:z.string().trim().min(1).max(100).optional(),lines:z.array(z.object({recipeId:z.string().uuid().optional(),mappingKey:z.string().min(1).max(500).optional(),quantity:z.number().int().min(1).max(10000)}).refine(v=>!!v.recipeId!==!!v.mappingKey,'Choose a recipe or register mapping')).min(1).max(20).optional()}).parse(await req.json());
 const member=await companyAccess(u.userId,b.companyId);if(!member||!['owner','manager'].includes(member.role))return Response.json({error:'Company access denied.'},{status:403});
 const db=database(),rows=await db.prepare('SELECT data FROM inventory WHERE company_id=?').bind(b.companyId).all<{data:string}>(),records=rows.results.map(x=>JSON.parse(x.data) as InventoryRecord);
 if(b.action==='mapping'){
 if(!b.mapping)throw new Error('Enter register item details.');
 if(!await db.prepare('SELECT id FROM recipes WHERE company_id=? AND id=?').bind(b.companyId,b.mapping.recipeId).first())throw new Error('Choose a recipe belonging to this company.');
 const key=JSON.stringify([b.mapping.provider,b.mapping.location,b.mapping.itemId]);
 await db.prepare('INSERT INTO register_mappings(company_id,external_key,data) VALUES (?,?,?) ON CONFLICT(company_id,external_key) DO UPDATE SET data=excluded.data').bind(b.companyId,key,JSON.stringify({...b.mapping,key})).run();return Response.json({ok:true});
 }
 if(b.action==='removeMapping'){
 if(!b.mappingKey)throw new Error('Select a mapping.');
 await db.prepare('DELETE FROM register_mappings WHERE company_id=? AND external_key=?').bind(b.companyId,b.mappingKey).run();return Response.json({ok:true});
 }
 if(b.action==='recipe'){
 if(!b.recipe)throw new Error('Enter recipe ingredients.');
 if(new Set(b.recipe.ingredients.map(i=>i.productId)).size!==b.recipe.ingredients.length)throw new Error('Use each ingredient once per recipe.');
 for(const i of b.recipe.ingredients){const r=records.find(r=>r.productId===i.productId);if(!r||r.settings.unit!==i.unit)throw new Error('Configure inventory units before saving the recipe.');}
 await db.prepare('INSERT INTO recipes(company_id,id,data) VALUES (?,?,?) ON CONFLICT(company_id,id) DO UPDATE SET data=excluded.data').bind(b.companyId,b.recipe.id,JSON.stringify(b.recipe)).run();return Response.json({ok:true});
 }
 if(!b.reference||!b.lines)throw new Error('Enter a unique sales reference and quantities.');
 return Response.json(await importSales(b.companyId,b.reference,b.lines,u.email));
 }catch(e){return Response.json({error:e instanceof z.ZodError?'Check recipes and sales quantities.':e instanceof Error?e.message:'Could not save sales.'},{status:400});}
}
export const GET=withCompanyRoute('sales',handleGET);
export const POST=withCompanyRoute('sales',handlePOST);
