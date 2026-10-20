import {gateActive} from './po-cart-worker/full-gate-runtime.mjs';
if(gateActive())await import('./po-cart-worker/offline-boundary.mjs');
import {build} from 'esbuild';
await build({entryPoints:['scripts/cart-preview/browser-check.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/cart-browser-check.mjs'});
await import('../.sites-runtime/cart-browser-check.mjs');
