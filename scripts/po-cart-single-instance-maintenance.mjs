import {rejectSingleArguments,runSingleMaintenance,singleRoot} from './po-cart-worker/single-instance-maintenance.mjs';

rejectSingleArguments(process.argv.slice(2));
const control={stopping:false},interrupted=()=>{control.stopping=true;};
process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
try{
 const report=await runSingleMaintenance({control});
 console.log(`${report.passed?'PASS':'BLOCKED'} single-instance maintenance. Private evidence: ${singleRoot}/report.json`);
 if(!report.passed)process.exitCode=1;
}finally{
 process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);
}
