import assert from 'node:assert/strict';
import {readPrivate} from './private-files.mjs';
import {setTimeout as delayMs} from 'node:timers/promises';

// Explicit offline dependency injection shared by the served acceptance checks.
export function mockedReader({StagehandCartReader,BoundedAiProvider,fixtureCatalog},f,ledger,delay=0,beforeRequest){
 return new StagehandCartReader({request:async(request,context)=>{
  if(beforeRequest)await beforeRequest(context);context.signal?.throwIfAborted();
  const session=f.readSession(),phase=context.phase.replace(/:(Extraction|Metadata)$/,'');
  const value=context.phase.endsWith(':Metadata')?{completed:true,progress:'Fictional extraction complete.'}:phase.startsWith('product:')?
   {candidates:fixtureCatalog(session).map((p,index)=>({index,sku:p.sku,unitLabel:p.unitLabel,unitMinor:p.unitMinor,available:!(f.scenario==='unavailable'&&index===0)})).filter(p=>p.sku===phase.slice(8))}:{entries:session.entries};
  return new BoundedAiProvider(ledger,async(url,options)=>{
   assert.equal(url,'https://api.openai.com/v1/responses');assert.ok(!options.body.includes(session.token));
   for(const file of f.credentialFiles)assert.ok(!options.body.includes(readPrivate(file).secret));
   if(delay)await delayMs(delay,undefined,{signal:options.signal});
   return Response.json({status:'completed',usage:{input_tokens:100,output_tokens:100},output:[{content:[{type:'output_text',text:JSON.stringify(value)}]}]});
  }).request(request,context);
 }});
}
