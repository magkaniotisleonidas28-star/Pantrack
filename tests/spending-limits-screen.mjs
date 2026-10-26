import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// Wiring pins for the owner spending-limits screen. Real behavior is proved by the served
// browser check (pnpm cart:spending-limits:check) against the fictional local preview.
const panel=readFileSync('src/components/workspace/spending-limits.tsx','utf8'),workspace=readFileSync('src/components/workspace/workspace.tsx','utf8');
assert.match(workspace,/\.\.\.\(role==='owner'&&limitsEnabled\?\[\{value:'spending-limits',label:'Spending limits',icon:Gauge\}\]:\[\]\)/,'Menu entry for owners with the preview on only');
assert.match(workspace,/\{role==='owner'&&<SpendingLimitsPanel key=\{companyId\+'limits'\} companyId=\{companyId\} active=\{tab==='spending-limits'\} onEnabledChange=\{setLimitsEnabled\} onDirtyChange=\{setLimitsDirty\}\/>\}/,'Mounted for owners only');
assert.match(workspace,/registryDirty\|\|limitsDirty\|\|/,'Unsaved limits count as unsaved work');
assert.match(panel,/fetch\(`\/api\/po-cart-spending-limits\?companyId=\$\{encodeURIComponent\(companyId\)\}`/);
assert.match(panel,/if\(!\(e instanceof LimitsRequestError&&\[403,404\]\.includes\(e\.status\)\)\)setError/,'Preview off or non-owner hides the screen quietly');
// Password confirmation reuses the existing endpoint, then resends the identical request.
assert.match(panel,/fetch\('\/api\/auth',\{method:'POST',headers:\{'Content-Type':'application\/json'\},body:JSON\.stringify\(\{action:'reauthenticate',password\}\)\}\)/);
assert.match(panel,/if\(failure\.code==='reauthentication_required'\)\{setConfirming\(failure\.message\);return;\}/);
assert.match(panel,/if\(confirmed&&pending\.current\)await send\(pending\.current\);/,'Same operation identity after confirmation');
assert.match(panel,/finally\{setPassword\(''\);/,'The password is cleared after every attempt');
assert.match(panel,/autoComplete="current-password"/);
// An uncertain save is retried with the same body, never a new operation identity.
assert.match(panel,/onClick=\{\(\)=>pending\.current&&void send\(pending\.current\)\}>Retry the same save/);
assert.equal((panel.match(/operationId:crypto\.randomUUID\(\)/g)??[]).length,2,'New identities only for new limit and time-zone saves');
assert.doesNotMatch(panel,/localStorage|sessionStorage/,'No limits or passwords kept in browser storage');
// The screen states that Pantrack cannot limit a supplier's own checkout.
assert.match(panel,/\{status\?\.notice\}/);
console.log('PASS: spending-limits screen is owner-only and preview-gated, reuses password confirmation with the same request, clears the password, retries uncertain saves exactly and stores nothing in the browser.');
