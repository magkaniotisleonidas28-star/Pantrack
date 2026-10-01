import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { build } from 'esbuild';
mkdirSync('.sites-runtime', { recursive: true });
for (const [name, path] of [['menu', 'src/lib/d1-menu-waste.ts'], ['stock', 'src/lib/d1-inventory-management.ts'], ['sales', 'src/lib/d1-sales-runtime.ts'], ['corrections', 'src/lib/d1-sales-corrections.ts']])
    await build({ entryPoints: [path], bundle: true, platform: 'node', format: 'esm', outfile: '.sites-runtime/w2-' + name + '.mjs' });
const { D1MenuWasteService } = await import('../.sites-runtime/w2-menu.mjs'), { D1InventoryManagementService } = await import('../.sites-runtime/w2-stock.mjs');
const { ingestLocalSale, localUserActor } = await import('../.sites-runtime/w2-sales.mjs'), { D1SalesCorrectionService } = await import('../.sites-runtime/w2-corrections.mjs');
const sql = new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys=ON');
for (const e of JSON.parse(readFileSync('drizzle/meta/_journal.json')).entries) {
    if (e.idx === 19) {
        sql.prepare('INSERT INTO companies VALUES (?,?,?)').run('older-w1', 'Older fictional café', '2026-01-01');
        sql.prepare('INSERT INTO products VALUES (?,?,?)').run('older-w1', 'original-croissant', '{"name":"Original croissant","unit":"box"}');
        sql.prepare('INSERT INTO orders VALUES (?,?,?,?)').run('older-w1', 'old-order', '{"status":"Prepared — not sent"}', '2026-01-01');
    }
    sql.exec(readFileSync('drizzle/' + e.tag + '.sql', 'utf8'));
}
assert.equal(sql.prepare("SELECT data FROM products WHERE owner='older-w1'").get().data, '{"name":"Original croissant","unit":"box"}');
assert.equal(sql.prepare("SELECT data FROM orders WHERE owner='older-w1'").get().data, '{"status":"Prepared — not sent"}');
assert.equal(sql.prepare('SELECT count(*) AS n FROM waste_menu_products').get().n, 0, 'Migration invents no café offerings or counts.');
class Statement {
    constructor(query, values = []) { Object.assign(this, { query, values }); }
    bind(...v) { return new Statement(this.query, v); }
    async first() { return sql.prepare(this.query).get(...this.values) || null; }
    async all() { return { results: sql.prepare(this.query).all(...this.values) }; }
    async run() { return this.runSync(); }
    runSync() { const s = sql.prepare(this.query); if (/^\s*SELECT\b/i.test(this.query))
        return { results: s.all(...this.values), meta: { changes: 0 } }; s.run(...this.values); return { results: [], meta: { changes: 99 } }; }
}
let lose = false, breakEntry = false, forceCas = false;
const db = { prepare: q => new Statement(q), async batch(statements) { if (forceCas) {
        forceCas = false;
        sql.prepare("UPDATE inventory_balances_exact SET version=version+1 WHERE company_id='a' AND product_id='croissant'").run();
    } sql.exec('BEGIN IMMEDIATE'); const results = []; try {
        for (const s of statements) {
            if (breakEntry && s.query.includes('INSERT OR IGNORE INTO waste_entries')) {
                breakEntry = false;
                throw Error('entry failed');
            }
            results.push(s.runSync());
        }
        sql.exec('COMMIT');
    }
    catch (e) {
        sql.exec('ROLLBACK');
        throw e;
    } if (lose) {
        lose = false;
        throw Error('lost acknowledgment');
    } return results; } };
for (const id of ['a', 'b'])
    sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(id, 'Fictional ' + id, '2026-01-01');
const stock = new D1InventoryManagementService(db, { clock: { now: () => new Date('2026-01-02T00:00:00Z') } }), menu = new D1MenuWasteService(db);
for (const [id, unit, amount] of [['croissant', 'each', '20'], ['milk', 'mL', '5000'], ['beans', 'g', '1000'], ['cups', 'each', '100']]) {
    sql.prepare('INSERT INTO products VALUES (?,?,?)').run('a', id, JSON.stringify({ id, name: 'Fictional ' + id, price: 99999, supplier: 'private-supplier' }));
    await stock.configure({ companyId: 'a', productId: id, operationId: crypto.randomUUID(), actor: 'manager', stockUnit: { kind: 'curated', id: unit }, purchaseUnitLabel: 'box', purchaseAmount: amount, openingAmount: amount, effectiveAt: '2026-01-01T00:00:00Z' });
}
sql.prepare('INSERT INTO products VALUES (?,?,?)').run('a', 'new-croissant', JSON.stringify({ name: 'New croissant' }));
const initial = await menu.options('a', true);
assert.equal(initial.items.find(i => i.id === 'new-croissant').ready, false);
assert.match(initial.items.find(i => i.id === 'new-croissant').issue, /ready-made/);
assert.ok(!/99999|private-supplier|onHand/.test(JSON.stringify(initial)));
const setup = { companyId: 'a', productId: 'croissant', offered: true, expectedRevision: 0, operationId: crypto.randomUUID() };
await menu.setup(setup, 'manager');
await menu.setup(setup, 'manager');
await assert.rejects(menu.setup({ ...setup, offered: false }, 'manager'), e => e.code === 'operation_conflict');
assert.deepEqual((await menu.options('a')).items.map(i => i.id), ['croissant']);
await stock.saveRecipeDraft({ companyId: 'a', recipeId: 'latte', draftId: 'latte-v1', actor: 'manager', name: 'Fictional latte', ingredients: [{ productId: 'milk', unitId: 'mL', amount: '200' }, { productId: 'beans', unitId: 'g', amount: '18' }, { productId: 'cups', unitId: 'each', amount: '1' }] });
await stock.activateRecipe({ companyId: 'a', recipeId: 'latte', versionId: 'latte-v1', actor: 'manager', expectedActiveVersionId: null });
await stock.saveModifierDraft({ companyId: 'a', recipeId: 'latte', modifierId: 'shot', draftId: 'shot-v1', actor: 'manager', name: 'Extra shot', deltas: [{ productId: 'beans', unitId: 'g', amount: '18', signed: false }] });
await stock.activateModifier({ companyId: 'a', recipeId: 'latte', modifierId: 'shot', versionId: 'shot-v1', actor: 'manager', expectedActiveVersionId: null });
const balance = id => sql.prepare('SELECT on_hand_minor,version FROM inventory_balances_exact WHERE company_id=? AND product_id=?').get('a', id);
const request = async (kind = 'recipe', id = 'latte', extra = {}) => ({ companyId: 'a', operationId: crypto.randomUUID(), sourceKind: kind, sourceId: id, sourceVersion: (await menu.options('a', true)).items.find(i => i.kind === kind && i.id === id).version, quantity: 1, reason: 'spilled', note: '', mode: 'unsold', effectiveAt: '2026-02-01T00:00:00Z', modifiers: [], ...extra });
const pastry = await request('product', 'croissant', { quantity: 2, reason: 'end_of_day' });
assert.equal((await menu.record(pastry, 'employee')).status, 'deducted');
assert.equal(balance('croissant').on_hand_minor, '18');
await menu.record(pastry, 'employee');
assert.equal(balance('croissant').on_hand_minor, '18');
for (const changes of [{ reason: 'spoiled' }, { quantity: 3 }])
    await assert.rejects(menu.record({ ...pastry, ...changes }, 'employee'), e => e.code === 'operation_conflict');
await assert.rejects(menu.record(pastry, 'other-worker'), e => e.code === 'operation_conflict');
const latte = await request();
const saved = await menu.record(latte, 'employee');
assert.equal(saved.effects.length, 3);
assert.equal(balance('milk').on_hand_minor, '4800000000');
assert.equal(balance('beans').on_hand_minor, '982000000');
assert.equal(balance('cups').on_hand_minor, '99');
assert.equal(sql.prepare("SELECT count(*) AS n FROM inventory_events_exact WHERE actor='employee' AND action='waste' AND waste_reason='spilled'").get().n, 3);
const extra = await request('recipe', 'latte', { quantity: 2, modifiers: [{ id: 'shot', versionId: 'shot-v1', perItem: 1 }] });
await menu.record(extra, 'employee');
assert.equal(balance('beans').on_hand_minor, '910000000');
const before = JSON.stringify(['milk', 'beans', 'cups'].map(balance));
await assert.rejects(menu.record(await request('recipe', 'latte', { quantity: 999 }), 'employee'), e => e.code === 'invalid_quantity');
assert.equal(JSON.stringify(['milk', 'beans', 'cups'].map(balance)), before);
await assert.rejects(menu.record(await request('recipe', 'latte', { sourceVersion: 'stale' }), 'employee'), e => e.code === 'concurrent_update');
await assert.rejects(menu.record(await request('product', 'croissant', { effectiveAt: '2026-01-01T00:00:00Z' }), 'employee'), e => e.code === 'before_count_cutoff');
await assert.rejects(menu.record(await request('product', 'croissant', { effectiveAt: '2026-02-30T00:00:00Z' }), 'employee'), e => e.code === 'invalid_time');
const same = await request('product', 'croissant');
const race = await Promise.allSettled([menu.record(same, 'employee'), menu.record(same, 'employee')]);
assert.ok(race.every(r => r.status === 'fulfilled'));
assert.equal(balance('croissant').on_hand_minor, '17');
const changed = await request('product', 'croissant');
const conflict = await Promise.allSettled([menu.record(changed, 'employee'), menu.record({ ...changed, reason: 'other' }, 'employee')]);
assert.deepEqual(conflict.map(r => r.status).sort(), ['fulfilled', 'rejected']);
assert.equal(balance('croissant').on_hand_minor, '16');
const unknown = await request();
lose = true;
await assert.rejects(menu.record(unknown, 'employee'), /lost acknowledgment/);
const once = balance('milk').on_hand_minor;
await menu.record(unknown, 'employee');
assert.equal(balance('milk').on_hand_minor, once);
const rollback = await request();
breakEntry = true;
await assert.rejects(menu.record(rollback, 'employee'), /entry failed/);
assert.equal(balance('milk').on_hand_minor, once);
assert.equal(sql.prepare('SELECT count(*) AS n FROM inventory_consumption_applications WHERE idempotency_key=?').get('waste:' + rollback.operationId).n, 0, 'Entry failure rolls back every stock effect.');
const sale = async (reference) => ingestLocalSale({ db, companyId: 'a', source: 'manual', reference, occurredAt: '2026-03-01T12:00:00Z', lines: [{ recipeId: 'latte', quantity: 1 }], actor: localUserActor({ userId: 'manager' }, 'a', 'manager') });
const sale1 = await sale('already-sold');
const choices = await menu.sales('a', 'recipe', 'latte');
assert.equal(choices.length, 1);
assert.ok(!/price|actor|customer|balance/.test(JSON.stringify(choices)));
const sold = await request('recipe', 'latte', { mode: 'sold', sale: { applicationKey: choices[0].applicationKey, lineId: choices[0].lineId } }), soldBefore = balance('milk').on_hand_minor;
assert.equal((await menu.record(sold, 'employee')).status, 'classified');
await menu.record(sold, 'employee');
assert.equal(balance('milk').on_hand_minor, soldBefore);
assert.equal((await menu.record({ ...sold, operationId: crypto.randomUUID() }, 'employee')).status, 'held', 'An already allocated sold unit is held, never deducted again.');
await assert.rejects(new D1SalesCorrectionService(db).request('a', sale1.eventKey, { userId: 'manager', role: 'manager', email: 'manager@example.test' }, 'correct'), e => e.code === 'invalid_state', 'A linked waste unit cannot be silently restored by a sales correction.');
await menu.record(await request('recipe', 'latte', { mode: 'replacement' }), 'employee');
assert.equal(balance('milk').on_hand_minor, String(BigInt(soldBefore) - BigInt(200000000)));
const delayed = await request('recipe', 'latte', { mode: 'sold' });
const delayedBefore = balance('milk').on_hand_minor;
assert.equal((await menu.record(delayed, 'employee')).status, 'held');
assert.equal(balance('milk').on_hand_minor, delayedBefore);
await sale('delayed-sale');
const afterSale = balance('milk').on_hand_minor, newChoice = (await menu.sales('a', 'recipe', 'latte'))[0];
const review = { companyId: 'a', entryId: delayed.operationId, operationId: crypto.randomUUID(), sale: { applicationKey: newChoice.applicationKey, lineId: newChoice.lineId } };
assert.equal((await menu.review(review, 'manager')).status, 'classified');
await menu.review(review, 'manager');
assert.equal(balance('milk').on_hand_minor, afterSale);
assert.equal((await menu.record(delayed, 'employee')).status, 'classified');
await assert.rejects(menu.review({ ...review, sale: { ...review.sale, lineId: 'wrong' } }, 'manager'), e => e.code === 'operation_conflict');
await sale('allocation-race');
const next = (await menu.sales('a', 'recipe', 'latte'))[0], r1 = await request('recipe', 'latte', { mode: 'sold', sale: { applicationKey: next.applicationKey, lineId: next.lineId } }), r2 = { ...r1, operationId: crypto.randomUUID() };
const allocated = await Promise.all([menu.record(r1, 'employee'), menu.record(r2, 'employee')]);
assert.deepEqual(allocated.map(r => r.status).sort(), ['classified', 'held']);
assert.equal((await menu.sales('b', 'recipe', 'latte')).length, 0);
await assert.rejects(menu.record({ ...latte, companyId: 'b', operationId: crypto.randomUUID() }, 'employee'), e => e.code === 'not_found');
// A stock CAS loser stays uncertain until the SAME identity is confirmed.
const independent1 = await request('product', 'croissant'), independent2 = await request('product', 'croissant');
const priorCount = BigInt(balance('croissant').on_hand_minor);
const stockRace = await Promise.allSettled([menu.record(independent1, 'employee'), menu.record(independent2, 'employee')]);
for (const [index, result] of stockRace.entries())
    if (result.status === 'rejected')
        await menu.record(index === 0 ? independent1 : independent2, 'employee');
assert.equal(balance('croissant').on_hand_minor, String(priorCount - BigInt(2)));
const forcedCasRequest = await request('product', 'croissant');
const forcedBefore = balance('croissant').on_hand_minor;
forceCas = true;
await assert.rejects(menu.record(forcedCasRequest, 'employee'), /changed before commit/);
assert.equal(balance('croissant').on_hand_minor, forcedBefore);
await menu.record(forcedCasRequest, 'employee');
assert.equal(balance('croissant').on_hand_minor, String(BigInt(forcedBefore) - BigInt(1)));
await assert.rejects(menu.record(await request('recipe', 'latte', { modifiers: [{ id: 'shot', versionId: 'wrong-version', perItem: 1 }] }), 'employee'), e => e.code === 'concurrent_update');
// A classification acknowledgment can be lost without claiming the sale twice.
await sale('classification-lost-ack');
const lostChoice = (await menu.sales('a', 'recipe', 'latte'))[0];
const classifiedUnknown = await request('recipe', 'latte', { mode: 'sold', sale: { applicationKey: lostChoice.applicationKey, lineId: lostChoice.lineId } });
lose = true;
await assert.rejects(menu.record(classifiedUnknown, 'employee'), /lost acknowledgment/);
const allocationOnce = sql.prepare('SELECT claimed FROM waste_sale_allocations WHERE application_key=?').get(lostChoice.applicationKey).claimed;
assert.equal((await menu.record(classifiedUnknown, 'employee')).status, 'classified');
assert.equal(sql.prepare('SELECT claimed FROM waste_sale_allocations WHERE application_key=?').get(lostChoice.applicationKey).claimed, allocationOnce);
// Cross-company links are held with zero use, never trusted on their identifiers.
const crossLink = await request('recipe', 'latte', { mode: 'sold', sale: { applicationKey: 'another-company-sale', lineId: 'line' } });
const crossBefore = balance('milk').on_hand_minor;
assert.equal((await menu.record(crossLink, 'employee')).status, 'held');
assert.equal(balance('milk').on_hand_minor, crossBefore);
// Correction and allocation cannot both win a race.
const correctionSale = await sale('correction-race'), correctionChoice = (await menu.sales('a', 'recipe', 'latte'))[0];
const correctionWaste = await request('recipe', 'latte', { mode: 'sold', sale: { applicationKey: correctionChoice.applicationKey, lineId: correctionChoice.lineId } });
const racedCorrection = await Promise.allSettled([menu.record(correctionWaste, 'employee'), new D1SalesCorrectionService(db).request('a', correctionSale.eventKey, { userId: 'manager', role: 'manager', email: 'manager@example.test' }, 'race check')]);
const isClassified = racedCorrection[0].status === 'fulfilled' && racedCorrection[0].value.status === 'classified';
const correctionExists = sql.prepare('SELECT count(*) AS n FROM sales_event_corrections WHERE event_key=?').get(correctionSale.eventKey).n;
assert.ok(!(isClassified && correctionExists));
// Receipt retries remain exact after recipe setup changes; no current version is re-consumed.
await stock.archiveRecipe({ companyId: 'a', recipeId: 'latte', versionId: 'latte-v1', actor: 'manager' });
const historicalBalance = balance('milk').on_hand_minor;
assert.deepEqual(await menu.record(latte, 'employee'), saved);
assert.equal(balance('milk').on_hand_minor, historicalBalance);
assert.throws(() => sql.prepare('UPDATE waste_sale_allocations SET claimed=capacity+1').run(), /Invalid waste allocation/);
assert.throws(() => sql.prepare('UPDATE waste_sale_allocations SET capacity=capacity+1').run(), /Invalid waste allocation/);
assert.throws(() => sql.prepare("UPDATE waste_entries SET reason='other' WHERE id=?").run(pastry.operationId), /immutable/);
assert.throws(() => sql.prepare('DELETE FROM waste_sale_links').run(), /immutable/);
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
sql.close();
console.log('PASS: W2 café-item setup, exact atomic waste, modifiers, bounds, idempotency/races, lost responses, sold-unit allocation, delayed-sale review, correction guard, privacy, and immutable records.');
