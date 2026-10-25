import {rejectBaselineArguments,runObservationBaseline,baselineRoot} from './po-cart-worker/observation-baseline.mjs';

rejectBaselineArguments(process.argv.slice(2));
const control={stopping:false},interrupted=()=>{control.stopping=true;};
process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
try{
 const report=await runObservationBaseline({control});
 console.log(`${report.passed?'PASS':'BLOCKED'} observation baseline. Private evidence: ${baselineRoot}/report.json`);
 if(!report.passed)process.exitCode=1;
}finally{
 process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);
}
