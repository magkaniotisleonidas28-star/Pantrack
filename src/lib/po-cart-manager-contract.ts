import type {SessionReceipt,browserSessionSummary} from './po-cart-browser-session-contract';
import type {CartAuthorizationStatus} from './po-cart-authorization-contract';
import type {CartJobStatus} from './po-cart-job-contract';
import type {CartAuthorizationReceipt} from './po-cart-authorization-contract';
import type {CartJobReceipt} from './po-cart-job-contract';
import type {ReconciliationReceipt,reconciliationSummary} from './po-cart-reconciliation-contract';

export function managerCartReceipt(receipt:CartAuthorizationReceipt|CartJobReceipt|SessionReceipt|ReconciliationReceipt){
  return {operationId:receipt.operationId,action:receipt.action,revision:receipt.revision,at:receipt.at,
    ...('jobId' in receipt?{jobId:receipt.jobId}:{authorizationId:receipt.authorizationId})};
}

// Explicit manager projection. Private observations, worker identities and browser material stay out.
export function managerCartView(actorId:string,authorization:CartAuthorizationStatus,status:CartJobStatus|null,session:Awaited<ReturnType<typeof browserSessionSummary>>=null,now=new Date().toISOString(),reconciliation:Awaited<ReturnType<typeof reconciliationSummary>>|null=null){
  const a=authorization.authorization;
  const sessionStale=session?.active&&(session.expiresAt<=now||!!session.leaseUntil&&session.leaseUntil<=now);

  return {actorId,authorization:a?{id:a.id,revision:a.revision,status:a.status,valid:authorization.valid,
    reason:authorization.reason,capMinor:a.inputs.preflight.capMinor,reservation:authorization.reservation,
    incomingLines:authorization.commitments.filter(c=>c.active).length,started:a.startedAt!==null}:null,
    job:status?{id:status.job.id,revision:status.job.revision,state:status.job.state,valid:status.valid&&!sessionStale,
      reason:sessionStale?'Practice browser access expired without a verified close. Review is required.':status.job.state==='review_needed'?status.events.at(-1)?.reason??status.reason:status.reason,browser:status.job.browser,updatedAt:status.job.updatedAt,
      session,reconciliation,eligibility:{inspect:!!status.job.browser&&(['ready','review_needed'].includes(status.job.state)||status.job.state==='canceled'&&a?.releasedAt===null)&&!session?.active&&status.ownership?.jobId===status.job.id&&status.ownership?.workerId===null,
        accept:status.job.state==='review_needed'&&authorization.valid&&!!reconciliation?.evidence?.current&&reconciliation.evidence.finalVerified,
        abandon:['review_needed','ready','canceled'].includes(status.job.state)&&a?.releasedAt===null&&!!reconciliation?.evidence?.current&&reconciliation.evidence.baselineVerified,
        signIn:!!status.job.browser&&status.job.state==='review_needed'&&status.events.at(-1)?.kind==='hold'&&status.events.at(-1)?.reason==='sign_in_required'
          &&status.attempts.length===0&&authorization.valid&&a?.startedAt===null&&status.ownership?.jobId===status.job.id&&status.ownership?.workerId===null&&!session?.active,
        resume:status.job.state==='review_needed'&&status.events.at(-1)?.kind==='hold'&&status.events.at(-1)?.reason==='sign_in_required'&&status.attempts.length===0&&authorization.valid&&a?.startedAt===null
          &&status.ownership?.jobId===status.job.id&&status.ownership?.workerId===null&&session?.purpose==='sign_in'&&session.state==='closed'&&!!session.closedAt&&session.expiresAt>now
          &&session.verification.some(o=>o.phase==='close'&&o.verified)},
      holdReason:status.job.state==='review_needed'&&status.events.at(-1)?.kind==='hold'?status.events.at(-1)!.reason:null,
      attempted:status.attempts.length,leaseExpired:status.job.state==='preparing'&&!status.valid&&
        !!status.ownership?.leaseUntil&&Date.parse(status.ownership.leaseUntil)<=Date.now(),
      lines:status.job.inputs.preflight.lines.map(line=>({lineId:line.lineId,sku:line.sku,description:line.description,
        unitLabel:line.unitLabel,packs:line.packs,verified:status.attempts.some(attempt=>attempt.lineId===line.lineId&&
          status.results.some(result=>result.attemptId===attempt.id&&result.outcome==='verified'))||status.job.state==='ready'&&reconciliation?.decision?.action==='acceptVerifiedCart'})),
      verification:[...status.browserEvidence.map(e=>({kind:e.kind,verified:e.verified,reason:e.reason,at:e.at})),
        ...(status.job.state==='ready'&&reconciliation?.decision?.action==='acceptVerifiedCart'?[{kind:'final' as const,verified:true,reason:'manager_reconciled',at:reconciliation.decision.at}]:[])]}:null};
}
export type ManagerCartView=ReturnType<typeof managerCartView>&{mode:'durable'|'preview'};
