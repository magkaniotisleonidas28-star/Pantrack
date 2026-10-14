import {AiBudgetLedger} from './ai-budget.mjs';
import {modelConfig} from './ai-config.mjs';
import {performance} from 'node:perf_hooks';
import type {Diagnostic} from '../po-cart-worker/browser-diagnostics';

export type StructuredRequest={instructions:string;input:unknown;format:{type:'json_schema';name:string;strict:true;schema:unknown}};
export type AiContext={caseId:string;phase:string;signal?:AbortSignal;diagnostic?:Diagnostic};
// Fixed identifiers only; no caller/page/provider string is written to diagnostics.
export const providerPhases=['baseline:Extraction','baseline:Metadata','product:DEMO-COFFEE:Extraction','product:DEMO-COFFEE:Metadata',
 'product:DEMO-OAT:Extraction','product:DEMO-OAT:Metadata','product:DEMO-CUPS:Extraction','product:DEMO-CUPS:Metadata','final:Extraction','final:Metadata'];
export class BoundedAiProvider {
  constructor(readonly ledger=new AiBudgetLedger(),readonly transport:typeof fetch=fetch,readonly timeoutMs=45000){}
  async request(request:StructuredRequest,context:AiContext){
    const started=performance.now(),phaseId=providerPhases.indexOf(context.phase);
    const emit=(event:string,fields:Record<string,number>={})=>{try{context.diagnostic?.(event,{phaseId:phaseId<0?10:phaseId,durationMs:Math.round(performance.now()-started),...fields});}catch{/* Logging cannot defeat cleanup/uncertainty handling. */}};
    const config=modelConfig(),outputCeiling=2048;
    // One UTF-8 byte per token plus envelope overhead is conservative for text.
    const inputCeiling=Buffer.byteLength(JSON.stringify(request),'utf8')+4096;
    if(inputCeiling>24000)throw Error('AI_INPUT_TOO_LARGE');
    context.signal?.throwIfAborted();
    const id=await this.ledger.reserve(Math.ceil(inputCeiling*config.inputRate+outputCeiling*config.outputRate),
      {caseId:context.caseId,phase:context.phase,model:config.model,inputCeiling,outputCeiling});
    emit('provider_reserved');
    // No SDK/provider retries. Reserve and fsync precede every possible request.
    const signal=AbortSignal.any([AbortSignal.timeout(this.timeoutMs),...(context.signal?[context.signal]:[])]);
    try{
      signal.throwIfAborted();
      emit('provider_start');
      const response=await this.transport('https://api.openai.com/v1/responses',{method:'POST',redirect:'error',signal,
        headers:{authorization:`Bearer ${config.key}`,'content-type':'application/json'},
        body:JSON.stringify({model:config.model,instructions:request.instructions,input:request.input,reasoning:{effort:'none'},
          max_output_tokens:outputCeiling,store:false,text:{format:request.format}})});
      emit('provider_headers',{status:response.status});
      if(!response.ok)throw Error('AI_PROVIDER_FAILED');
      if(!response.body)throw Error('AI_EMPTY_RESPONSE');
      const reader=response.body.getReader();let raw='',bytes=0;const decoder=new TextDecoder();
      try{while(true){signal.throwIfAborted();const {done,value}=await reader.read();if(done)break;
        bytes+=value.byteLength;if(bytes>65536)throw Error('AI_OUTPUT_TOO_LARGE');raw+=decoder.decode(value,{stream:true});}
      }finally{await reader.cancel().catch(()=>{});}
      signal.throwIfAborted();
      const data=JSON.parse(raw+decoder.decode());
      const content=data.output?.flatMap((o:any)=>o.content??[])??[];
      if(data.status!=='completed'||content.some((c:any)=>c.type==='refusal'))throw Error('AI_INCOMPLETE_RESPONSE');
      const texts=content.filter((c:any)=>c.type==='output_text');
      if(texts.length!==1||typeof texts[0].text!=='string'||Buffer.byteLength(texts[0].text)>16384)throw Error('AI_INVALID_RESPONSE');
      const value=JSON.parse(texts[0].text),u=data.usage;
      if(!u||![u.input_tokens,u.output_tokens].every(n=>Number.isSafeInteger(n)&&n>=0)
        ||u.input_tokens>inputCeiling||u.output_tokens>outputCeiling)throw Error('AI_USAGE_UNVERIFIED');
      const usage={inputTokens:u.input_tokens,outputTokens:u.output_tokens,totalTokens:u.input_tokens+u.output_tokens};
      await this.ledger.complete(id,usage);emit('provider_complete');return {value,usage};
    }catch{emit(signal.aborted?'provider_aborted':'provider_failed');throw Error('AI_READER_FAILED');} // Never persist provider bodies, URLs or credentials in worker errors.
  }
}
