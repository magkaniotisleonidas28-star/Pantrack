import {build} from 'esbuild';
await build({entryPoints:['scripts/cart-preview/browser-check.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/cart-browser-check.mjs'});
await import('../.sites-runtime/cart-browser-check.mjs');
