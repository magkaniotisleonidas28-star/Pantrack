import {validateMetadataAllowance,consumeMetadataAllowance,paidAllowanceFile,priorPaidAllowanceFile} from './metadata-allowance.mjs';
export {paidAllowanceFile} from './metadata-allowance.mjs';

export const matrixReservationMicros=1_959_552; // 72 × (24,000 × .75 + 2,048 × 4.50).
export class EvaluationPreflightError extends Error {constructor(code){super(code);this.code=code;}}

// Only bounded loopback readiness checks. No fixtures, model connection check,
// cookies, credentials or provider requests are needed for this preflight.
export async function evaluationPreflight(ledger,transport=fetch){
 let budget;try{budget=await ledger.snapshot();}catch{throw new EvaluationPreflightError('budget_unavailable');}
 if(!Number.isSafeInteger(budget.reservedMicros)||budget.reservedMicros<0||5_000_000-budget.reservedMicros<matrixReservationMicros)
  throw new EvaluationPreflightError('matrix_budget_unavailable');
 const checks=await Promise.allSettled([
  transport('http://127.0.0.1:5181/api/internal/po-cart-worker',{redirect:'error',signal:AbortSignal.timeout(5000)}),
  transport('http://127.0.0.1:5182/cart',{redirect:'error',signal:AbortSignal.timeout(5000)})]);
 let failure;
 for(const [i,check] of checks.entries()){
  const reason=i===0?'application_unavailable':'storefront_unavailable';
  if(check.status==='rejected'){failure??=reason;continue;}
  const r=check.value,ready=r.status===401&&r.headers.get('content-type')?.includes(i===0?'application/json':'text/html');
  await r.body?.cancel();if(!ready)failure??=reason;
 }
 if(failure)throw new EvaluationPreflightError(failure);
 return {passed:true,remainingMicros:5_000_000-budget.reservedMicros,requiredMicros:matrixReservationMicros};
}

// The task-specific allowance is separate from both the monetary ledger and
// the previous task's exhausted retry. Fsync consumption before any paid call.
export function validatePaidAllowance(path=paidAllowanceFile,priorPath=priorPaidAllowanceFile){
 try{return validateMetadataAllowance(path,priorPath);}catch{throw new EvaluationPreflightError('paid_allowance_unavailable');}
}
export function consumePaidAllowance(runId,path=paidAllowanceFile,priorPath=priorPaidAllowanceFile){
 try{return consumeMetadataAllowance(runId,path,priorPath);}catch{throw new EvaluationPreflightError('paid_allowance_unavailable');}
}
