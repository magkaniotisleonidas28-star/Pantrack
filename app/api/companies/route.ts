import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/app/chatgpt-auth';
import {database} from '@/db/raw';
import {companyAccess} from '@/lib/company-access';
import {samples} from '@/lib/pantry';
import {z} from 'zod';
async function handleGET(){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Please sign in.'},{status:401});
 try{
 const db=database();
 const rows=await db.prepare('SELECT c.id,c.name,m.role FROM companies c JOIN memberships m ON m.company_id=c.id WHERE m.user_id=? ORDER BY c.created,c.id').bind(user.userId).all();
 return Response.json({companies:rows.results},{headers:{'Cache-Control':'no-store'}});
 }catch(e){console.error(e);return Response.json({error:'Could not load companies. Please retry.'},{status:503});}
}
async function handlePOST(req:Request){
 const user=await getChatGPTUser();if(!user)return Response.json({error:'Please sign in.'},{status:401});
 if(!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'JSON required'},{status:415});
 if(req.headers.get('sec-fetch-site')==='cross-site')return Response.json({error:'Invalid request origin'},{status:403});
 try{
 const b=z.discriminatedUnion('action',[
 z.object({action:z.literal('create'),id:z.string().uuid(),name:z.string().trim().min(1).max(100)}),
 z.object({action:z.literal('rename'),id:z.string().min(1).max(200),name:z.string().trim().min(1).max(100)})
 ]).parse(await req.json());
 const db=database();
 if(b.action==='rename'){
 const membership=await companyAccess(user.userId,b.id);
 if(membership?.role!=='owner')return Response.json({error:'Only the company owner can rename this workspace.'},{status:403});
 await db.prepare('UPDATE companies SET name=? WHERE id=?').bind(b.name,b.id).run();
 }else{
 const existing=await db.prepare('SELECT id FROM companies WHERE id=?').bind(b.id).first();
 if(existing){if(!(await companyAccess(user.userId,b.id)))return Response.json({error:'Company identifier unavailable.'},{status:409});}
 else await db.batch([
 db.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').bind(b.id,b.name,new Date().toISOString()),
 db.prepare('INSERT INTO memberships(user_id,company_id,role) VALUES (?,?,?)').bind(user.userId,b.id,'owner'),
 ...samples.map(p=>db.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').bind(b.id,p.id,JSON.stringify(p)))
 ]);
 }
 const company=await db.prepare('SELECT c.id,c.name,m.role FROM companies c JOIN memberships m ON m.company_id=c.id WHERE c.id=? AND m.user_id=?').bind(b.id,user.userId).first();
 return Response.json({company});
 }catch(e){console.error(e);return Response.json({error:e instanceof z.ZodError?'Enter a company name (up to 100 characters).':'Could not save the company. Please retry.'},{status:e instanceof z.ZodError?400:503});}
}
export const GET=withCompanyRoute('companies',handleGET);
export const POST=withCompanyRoute('companies',handlePOST);
