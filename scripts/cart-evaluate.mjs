import {existsSync,readFileSync} from 'node:fs';
import {build} from 'esbuild';
if(!process.argv.includes('--ai'))throw Error('AI evaluation must be explicitly invoked with --ai.');
if(existsSync('.dev.vars.cart')){
  for(const line of readFileSync('.dev.vars.cart','utf8').split(/\r?\n/)){const m=line.match(/^(OPENAI_API_KEY|PANTRACK_CART_AI_MODEL|PANTRACK_CART_INPUT_USD_PER_MILLION|PANTRACK_CART_OUTPUT_USD_PER_MILLION|PANTRACK_CART_MANUAL_SECONDS)=(.*)$/);if(m&&!process.env[m[1]])process.env[m[1]]=m[2].replace(/^"(.*)"$/,'$1');}
}
await build({entryPoints:['scripts/cart-preview/evaluate.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/cart-evaluate.mjs'});
await import('../.sites-runtime/cart-evaluate.mjs');
