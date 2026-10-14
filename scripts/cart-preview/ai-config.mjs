import {existsSync,lstatSync,readFileSync} from 'node:fs';

export function loadAiConfig(){
  const file='.dev.vars.cart';
  if(existsSync(file)){
    const s=lstatSync(file);
    if(!s.isFile()||s.isSymbolicLink()||(process.platform!=='win32'&&(s.mode&0o077)))throw Error('Private model configuration must have mode 0600.');
    for(const line of readFileSync(file,'utf8').split(/\r?\n/)){
      const m=line.match(/^(OPENAI_API_KEY|PANTRACK_CART_AI_MODEL|PANTRACK_CART_INPUT_USD_PER_MILLION|PANTRACK_CART_OUTPUT_USD_PER_MILLION|PANTRACK_CART_MANUAL_SECONDS)=(.*)$/);
      if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^"(.*)"$/,'$1');
    }
  }
}

export function modelConfig(){
  const key=process.env.OPENAI_API_KEY,model=process.env.PANTRACK_CART_AI_MODEL||'gpt-5.4-mini-2026-03-17';
  const inputRate=Number(process.env.PANTRACK_CART_INPUT_USD_PER_MILLION||'0.75'),outputRate=Number(process.env.PANTRACK_CART_OUTPUT_USD_PER_MILLION||'4.50');
  if(!key)throw Error('AI evaluation pending: privately configure the model API key.');
  // Changing the model/prices needs a new reviewed reservation bound.
  if(model!=='gpt-5.4-mini-2026-03-17'||inputRate!==0.75||outputRate!==4.5)throw Error('AI evaluation model/pricing differs from the reviewed configuration.');
  return {key,model,inputRate,outputRate};
}
