import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createShutdownMatrixController} from './po-cart-worker/shutdown-matrix-controller.mjs';
import {DiagnosisError} from './po-cart-worker/shutdown-observation-diagnosis.mjs';

export const matrixRoot='.sites-runtime/po-cart-workers/shutdown-observation-matrix-task-20261015';
export const matrixPolicy='isolated-shutdown-observation-matrix-20261015';
export const {createMatrixAttempt,consumeMatrix,runFreshMatrix}=createShutdownMatrixController({
 root:matrixRoot,policy:matrixPolicy,auditAdapter:'scripts/po-cart-worker/shutdown-observation-matrix-audit.py'});

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{if(!(await runFreshMatrix({args:process.argv.slice(2)})).passed)process.exitCode=1;}
 catch(error){console.error(error instanceof DiagnosisError?error.category:'matrix_operation_failed');process.exitCode=1;}
}
