import {database} from '@/db/raw';
import {BodyTooLargeError,readBoundedUtf8} from '@/lib/bounded-body';
import {digest} from '@/lib/vendor-adapter';
import {importSales} from '@/lib/import-sales';
import {bridgeActor,ingestLocalSale} from '@/lib/d1-sales-runtime';
import {exactInventoryPreviewEnabled} from '@/lib/exact-inventory-gate';
import {z} from 'zod';
export async function POST(req:Request){
 try{const companyId=new URL(req.url).searchParams.get('companyId'),auth=req.headers.get('authorization');if(!companyId||!auth?.startsWith('Bearer ')||auth.length>300)return Response.json({error:'Unauthorized.'},{status:401});
 const db=database(),hash=await digest(auth.slice(7));if(!await db.prepare('SELECT company_id FROM register_settings WHERE company_id=? AND token_hash=?').bind(companyId,hash).first())return Response.json({error:'Unauthorized.'},{status:401});
 if(!req.headers.get('content-type')?.startsWith('application/json'))return Response.json({error:'Use application/json.'},{status:415});
 let text:string;try{text=await readBoundedUtf8(req,50000)}catch(e){if(e instanceof BodyTooLargeError)return Response.json({error:'Batch too large.'},{status:413});throw e;}
 const b=z.object({schemaVersion:z.literal('pantrack.bridge.v1').optional(),reference:z.string().trim().min(1).max(80),occurredAt:z.string().min(20).max(35).optional(),lines:z.array(z.object({provider:z.string().trim().min(1).max(60),location:z.string().trim().min(1).max(100),itemId:z.string().trim().min(1).max(150),quantity:z.number().int().min(1).max(10000)})).min(1).max(20)}).refine(value=>!value.occurredAt||value.schemaVersion==='pantrack.bridge.v1','Occurrence time requires pantrack.bridge.v1.').parse(JSON.parse(text));
 const lines=b.lines.map(l=>({mappingKey:JSON.stringify([l.provider,l.location,l.itemId]),quantity:l.quantity}));
 const result=exactInventoryPreviewEnabled()?await ingestLocalSale({db,companyId,source:'bridge',reference:b.reference,occurredAt:b.occurredAt,lines,actor:bridgeActor(companyId)}):await importSales(companyId,'bridge:'+b.reference,lines,'Register bridge');
 await db.prepare('UPDATE register_settings SET last_received=? WHERE company_id=?').bind(new Date().toISOString(),companyId).run();return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e){return Response.json({error:e instanceof z.ZodError||e instanceof SyntaxError?'Invalid sales payload.':e instanceof Error?e.message:'Could not import sales.'},{status:422});}
}
