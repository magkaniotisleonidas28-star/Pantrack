import {build} from 'esbuild';
import {loadAiConfig} from './cart-preview/ai-config.mjs';
if(!process.argv.includes('--ai'))throw Error('AI evaluation must be explicitly invoked with --ai.');
loadAiConfig();
await build({entryPoints:['scripts/cart-preview/evaluate.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/cart-evaluate.mjs'});
await import('../.sites-runtime/cart-evaluate.mjs');
