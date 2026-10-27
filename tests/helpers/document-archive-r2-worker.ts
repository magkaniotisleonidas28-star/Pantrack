import {R2DocumentArchiveObjects} from '../../src/lib/r2-document-archive-objects';
import {DocumentArchiveError} from '../../src/lib/purchase-order-document-archive-contract';

// Ephemeral Miniflare fixture only. This is not an application endpoint or binding.
export default {async fetch(request:Request,env:{ARCHIVE:R2Bucket;ARCHIVE_TEST_TOKEN:string}){
  if(request.headers.get('x-archive-test-token')!==env.ARCHIVE_TEST_TOKEN)return new Response(null,{status:403});
  const url=new URL(request.url),objects=new R2DocumentArchiveObjects(env.ARCHIVE);
  try{
    if(request.method==='POST'&&url.pathname==='/put'){
      const result=await objects.putIfAbsent(url.searchParams.get('key')!,new Uint8Array(await request.arrayBuffer()));
      return Response.json({result},{headers:{'cache-control':'private, no-store'}});
    }
    if(request.method==='GET'&&url.pathname==='/read'){
      const result=await objects.read(url.searchParams.get('key')!,Number(url.searchParams.get('max')));
      return result?new Response(result.bytes===null?null:new Uint8Array(result.bytes),{headers:{'cache-control':'private, no-store','x-fixture-size':String(result.size),
        'x-fixture-body':result.bytes===null?'held':'complete'}}):new Response(null,{status:404});
    }
    return new Response(null,{status:404});
  }catch(error){return Response.json({code:error instanceof DocumentArchiveError?error.code:'fixture_error'},{status:409,headers:{'cache-control':'private, no-store'}});}
}};
