import {randomUUID} from 'node:crypto';
import {historicalProfilesPreflight} from './po-cart-worker/profile-preservation-preflight.mjs';
import {sourceSnapshot} from './po-cart-worker/acceptance-gate.mjs';
import {writePrivate} from './po-cart-worker/private-files.mjs';

if(process.argv.length!==2)throw Error('Read-only profile preflight accepts no arguments or cleanup actions.');
const report={...historicalProfilesPreflight(),source:sourceSnapshot()};
const path='.sites-runtime/po-cart-workers/profile-preservation-preflight/'+randomUUID()+'.json';
writePrivate(path,report);
console.log(`${report.passed?'PASS':'BLOCKED'} historical profile preservation: ${report.status}; ${report.processes.length} processes; ${report.liveLocks.length} live locks.`);
console.log('Private profile preflight report: '+path);
if(!report.passed)process.exitCode=1;
