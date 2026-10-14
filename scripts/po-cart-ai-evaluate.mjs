import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {loadAiConfig,modelConfig} from './cart-preview/ai-config.mjs';
import {writePrivate} from './po-cart-worker/private-files.mjs';
if(!process.argv.includes('--ai'))throw Error('Real AI requires the dedicated --ai evaluation command.');
try{loadAiConfig();modelConfig();}
catch{
 const report='.sites-runtime/po-cart-workers/ai-evaluation/pending-'+randomUUID()+'.json';
 writePrivate(report,{evidence:'pending',reason:'Private model configuration is absent or differs from the reviewed model/pricing.',realModelCalls:0,acceptanceComplete:false,actualBillingUsd:null,manualTimingComparison:'pending'});
 console.error('Real-AI evaluation pending: privately configure .dev.vars.cart (mode 0600). No model calls made. Report: '+report);process.exitCode=1;
}
if(!process.exitCode){
 await build({entryPoints:['scripts/po-cart-worker/ai-evaluate.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/po-cart-workers/ai-evaluate.mjs',logLevel:'silent'});
 // Keep the filesystem/CLI seeder unbundled: sites-env resolves the repository
 // relative to its own source URL and must not run from the generated module.
 const {seedLocalBrowserJob}=await import('./po-cart-worker/local-browser-fixture.mjs');
 const {runEvaluation}=await import('../.sites-runtime/po-cart-workers/ai-evaluate.mjs');
 await runEvaluation(seedLocalBrowserJob);
}
