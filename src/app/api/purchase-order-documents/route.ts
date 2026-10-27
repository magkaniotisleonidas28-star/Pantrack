import {env} from 'cloudflare:workers';
import {database} from '@/db/raw';
import {withCompanyRoute} from '@/lib/authorization';
import {getChatGPTUser} from '@/lib/chatgpt-auth';
import {PurchaseOrderDocumentArchive} from '@/lib/purchase-order-document-archive';
import {D1DocumentArchiveJournal} from '@/lib/d1-document-archive-journal';
import {D1DocumentArchiveCatalog} from '@/lib/d1-document-archive-catalog';
import {D1DocumentArchiveSources,renderDocumentArchive} from '@/lib/purchase-order-document-archive-sources';
import {R2DocumentArchiveObjects} from '@/lib/r2-document-archive-objects';
import {archiveCatalogQuery,archiveReadQuery,archiveFilename} from '@/lib/purchase-order-archive-app-contract';
import {documentArchiveRequest,DocumentArchiveError,archiveFail,archiveMediaType} from '@/lib/purchase-order-document-archive-contract';

type Bindings={PANTRACK_DOCUMENT_ARCHIVE_PREVIEW?:string;DOCUMENT_ARCHIVE?:R2Bucket;ASSETS?:Fetcher};
const bindings=()=>env as unknown as Bindings;
const identity=async()=>(await getChatGPTUser())?.userId??null;
async function actor(){const user=await identity();if(!user)archiveFail('forbidden');return user;}
async function font(request:Request){
  const assets=bindings().ASSETS;if(!assets)archiveFail('generation_failed');
  // Fixed asset path through the internal binding; preserve the app origin for local Vite.
  const response=await assets.fetch(new Request(new URL('/fonts/NotoSans-Regular.ttf',request.url)));
  if(!response.ok)archiveFail('generation_failed');const bytes=new Uint8Array(await response.arrayBuffer());
  if(!bytes.length||bytes.length>2_000_000)archiveFail('generation_failed');return bytes;
}
async function handle(req:Request){
  if(bindings().PANTRACK_DOCUMENT_ARCHIVE_PREVIEW!=='enabled')return Response.json({error:'Saved copies are unavailable.'},{status:404});
  try{
    const bucket=bindings().DOCUMENT_ARCHIVE;if(!bucket)archiveFail('storage_unavailable');
    const db=database(),journal=new D1DocumentArchiveJournal(db);
    const saveIdentity=async()=>{const user=await identity();if(req.method==='POST'&&(!user||req.headers.get('X-Pantrack-Archive-Viewer')!==user))archiveFail('forbidden');return user;};
    const service=new PurchaseOrderDocumentArchive({identity:saveIdentity,journal,objects:new R2DocumentArchiveObjects(bucket),sources:new D1DocumentArchiveSources(db),
      render:(source,format,template)=>renderDocumentArchive(source,format,template,()=>font(req))});
    if(req.method==='POST'){
      const body=await req.text();if(body.length>16384)archiveFail('invalid_request');
      const parsed=documentArchiveRequest.safeParse(JSON.parse(body));if(!parsed.success)archiveFail('invalid_request');
      return Response.json({artifact:await service.save(parsed.data)});
    }
    if(req.url.length>8192)archiveFail('invalid_request');const params=new URL(req.url).searchParams;
    if([...params.keys()].some(key=>params.getAll(key).length!==1))archiveFail('invalid_request');
    if(params.get('view')==='list'){
      params.delete('view');const parsed=archiveCatalogQuery.safeParse(Object.fromEntries(params));if(!parsed.success)archiveFail('invalid_request');
      const viewerId=await actor(),catalog=await new D1DocumentArchiveCatalog(db).list(parsed.data,viewerId);
      if(await actor()!==viewerId)archiveFail('forbidden');return Response.json(catalog);
    }
    const parsed=archiveReadQuery.safeParse(Object.fromEntries(params));if(!parsed.success)archiveFail('invalid_request');
    const {companyId,id,view}=parsed.data;
    if(view==='metadata'){
      const viewerId=await actor(),artifact=await journal.open(companyId,id,viewerId);
      if(await actor()!==viewerId)archiveFail('forbidden');return Response.json({artifact,viewerId});
    }
    const {artifact,bytes}=await service.read({companyId,id});
    return new Response(new Uint8Array(bytes),{headers:{'Content-Type':archiveMediaType(artifact.format),'Content-Length':String(artifact.size),
      'Content-Disposition':`attachment; filename="${archiveFilename(artifact)}"`,'X-Pantrack-Document-Id':artifact.id,'X-Pantrack-Document-Sha256':artifact.sha256,'X-Pantrack-Document-Size':String(artifact.size)}});
  }catch(error){
    const code=error instanceof SyntaxError?'invalid_request':error instanceof DocumentArchiveError?error.code:'storage_unavailable';
    const safe=new DocumentArchiveError(code);return Response.json({error:safe.message,code},{status:
      code==='invalid_request'?400:code==='forbidden'?403:code==='missing'?404:['storage_unavailable','generation_failed'].includes(code)?503:409});
  }
}
const authorized=withCompanyRoute('purchasing',handle);
async function respond(req:Request){const response=await authorized(req);response.headers.set('Cache-Control','private, no-store');
  response.headers.set('Pragma','no-cache');response.headers.set('X-Content-Type-Options','nosniff');return response;}
export const GET=respond;
export const POST=respond;
