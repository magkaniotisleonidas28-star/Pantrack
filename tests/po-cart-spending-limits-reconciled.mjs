import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {randomUUID} from 'node:crypto';
import {reconciliationFixture} from './helpers/po-cart-reconciliation.mjs';
import {command} from './helpers/po-cart-authorizations.mjs';

await build({stdin:{contents:"export * from './src/lib/d1-po-cart-spending-limits.ts';export * from './src/lib/po-cart-spending-limits-contract.ts';",
  resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/po-cart-spending-limits-reconciled-tests.mjs'});
const {D1PoCartSpendingLimits,spendingWindow}=await import('../.sites-runtime/po-cart-spending-limits-reconciled-tests.mjs');

// Started work released by reconciliation still used the day's and month's budget.
const f=await reconciliationFixture();
const s=await f.open([f.full[0]]);await f.close(s,[f.full[0]]);await f.reconcile().decide(await f.body(s,'abandonVerifiedCart'));
const done=(await f.current()).authorization;
assert.ok(done.authorization.startedAt&&done.authorization.releasedAt,'Started and released');assert.equal(done.reservation.state,'released');
const spent=done.reservation.totalMinor,limits=new D1PoCartSpendingLimits(f.db,{clock:f.options.clock,
  identity:async()=>({userId:'owner',reauthenticatedAt:f.options.clock.now().getTime()-1000})});
await limits.setTimeZone({action:'set_time_zone',companyId:'a',operationId:randomUUID(),expectedVersion:0,timeZone:'UTC'});
const version=(await limits.get({companyId:'a'})).limits.version;
await limits.setLimits({action:'set_limits',companyId:'a',operationId:randomUUID(),expectedVersion:version,perOrderMinor:spent,
  perDayMinor:spent+999,perMonthMinor:spent+999,outstandingMinor:1_000_000});
const usage=(await limits.get({companyId:'a'})).usage;
assert.deepEqual([usage.dayMinor,usage.monthMinor,usage.outstandingMinor],[spent,spent,0],'Released started work counts for the day and month, not in progress');
f.setUser('manager');
await assert.rejects(f.service().authorize(command(await f.reviewed({capMinor:'1000'}))),e=>e.code==='limit_exceeded'&&e.message.includes('daily'));
const bypass=f.service();bypass.ownerLimits=async(_c,_a,_p,_cap,at)=>spendingWindow(at,'UTC',1);
await assert.rejects(bypass.authorize(command(await f.reviewed({capMinor:'1000'}))),e=>e.code==='conflict','The reservation guard counts it too');
assert.ok(await f.service().authorize(command(await f.reviewed({capMinor:'999'}))),'Exactly the remaining budget is allowed');
console.log('PASS: started work released by reconciliation still counts against the café day and month, in the pre-check and the reservation guard.');
