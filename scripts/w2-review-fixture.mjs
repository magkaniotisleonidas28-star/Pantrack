import assert from 'node:assert/strict';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
const mode = process.argv[2];
assert.ok(['seed', 'verify', 'role', 'sale'].includes(mode), 'Use seed, verify, role owner|manager|employee, or sale.');
const directory = '.sites-runtime/w2-review-state/v3/d1/miniflare-D1DatabaseObject';
const files = readdirSync(directory).filter(name => name.endsWith('.sqlite') && name !== 'metadata.sqlite');
assert.equal(files.length, 1);
const sql = new DatabaseSync(join(directory, files[0]));
sql.exec('PRAGMA foreign_keys=ON');
const companyId = 'w2-fictional-cafe', person = 'local_seedy';
const db = { prepare(query) { let values = []; return { bind(...v) { values = v; return this; }, async first() { return sql.prepare(query).get(...values) || null; }, async all() { return { results: sql.prepare(query).all(...values) }; }, async run() { const statement = sql.prepare(query); if (/^\s*SELECT\b/i.test(query))
            return { results: statement.all(...values), meta: { changes: 0 } }; const result = statement.run(...values); return { results: [], meta: { changes: Number(result.changes) } }; } }; }, async batch(statements) { sql.exec('BEGIN IMMEDIATE'); try {
        const results = [];
        for (const s of statements)
            results.push(await s.run());
        sql.exec('COMMIT');
        return results;
    }
    catch (e) {
        sql.exec('ROLLBACK');
        throw e;
    } } };
mkdirSync('.sites-runtime', { recursive: true });
if (mode === 'seed' || mode === 'sale')
    await build({ entryPoints: ['src/lib/d1-menu-waste.ts', 'src/lib/d1-inventory-management.ts', 'src/lib/d1-sales-runtime.ts'], bundle: true, platform: 'node', format: 'esm', outdir: '.sites-runtime/w2-fixture' });
async function sale() { const { ingestLocalSale, localUserActor } = await import('../.sites-runtime/w2-fixture/d1-sales-runtime.js'); return ingestLocalSale({ db, companyId, source: 'manual', reference: 'fictional-w2-' + crypto.randomUUID(), occurredAt: new Date().toISOString(), lines: [{ recipeId: 'latte', quantity: 1 }], actor: localUserActor({ userId: person }, companyId, 'owner') }); }
if (mode === 'seed') {
    assert.equal(sql.prepare('SELECT count(*) AS n FROM companies').get().n, 0, 'Use a fresh isolated W2 fixture; never overwrite review data.');
    const { D1InventoryManagementService } = await import('../.sites-runtime/w2-fixture/d1-inventory-management.js');
    const { D1MenuWasteService } = await import('../.sites-runtime/w2-fixture/d1-menu-waste.js');
    sql.prepare('INSERT INTO companies VALUES (?,?,?)').run(companyId, 'W2 fictional café — menu waste', '2026-01-01');
    sql.prepare('INSERT INTO memberships VALUES (?,?,?)').run(person, companyId, 'owner');
    const stock = new D1InventoryManagementService(db, { clock: { now: () => new Date('2026-01-02T00:00:00Z') } });
    for (const [id, name, unit, opening, pack] of [['croissant', 'Croissant (fictional)', 'each', '20', '12'], ['milk', 'Milk (fictional)', 'mL', '5000', '1000'], ['beans', 'Espresso beans (fictional)', 'g', '1000', '1000'], ['cups', 'Cups (fictional)', 'each', '100', '100']]) {
        sql.prepare('INSERT INTO products VALUES (?,?,?)').run(companyId, id, JSON.stringify({ id, name, supplier: 'Fictional supplier', sku: 'W2-' + id, pack: 'practice box', unit: 'box', price: 0, category: 'Test only', url: '', sample: true }));
        await stock.configure({ companyId, productId: id, operationId: 'w2-config-' + id, actor: person, stockUnit: { kind: 'curated', id: unit }, purchaseUnitLabel: 'box', purchaseAmount: pack, openingAmount: opening, effectiveAt: '2026-01-01T00:00:00Z' });
    }
    sql.prepare('INSERT INTO products VALUES (?,?,?)').run(companyId, 'bagel', JSON.stringify({ id: 'bagel', name: 'New bagel (fictional)', supplier: 'Fictional supplier', sku: 'W2-bagel', pack: '12 per box', unit: 'box', price: 0, category: 'Test only', url: '', sample: true }));
    await new D1MenuWasteService(db).setup({ companyId, productId: 'croissant', offered: true, expectedRevision: 0, operationId: crypto.randomUUID() }, person);
    await stock.saveRecipeDraft({ companyId, recipeId: 'latte', draftId: 'latte-v1', actor: person, name: 'Latte (fictional)', ingredients: [{ productId: 'milk', unitId: 'mL', amount: '200' }, { productId: 'beans', unitId: 'g', amount: '18' }, { productId: 'cups', unitId: 'each', amount: '1' }] });
    await stock.activateRecipe({ companyId, recipeId: 'latte', versionId: 'latte-v1', actor: person, expectedActiveVersionId: null });
    await stock.saveModifierDraft({ companyId, recipeId: 'latte', modifierId: 'shot', draftId: 'shot-v1', actor: person, name: 'Extra shot', deltas: [{ productId: 'beans', unitId: 'g', amount: '18', signed: false }] });
    await stock.activateModifier({ companyId, recipeId: 'latte', modifierId: 'shot', versionId: 'shot-v1', actor: person, expectedActiveVersionId: null });
    const applied = await sale();
    assert.equal(applied.state, 'applied');
    console.log('PASS: isolated fictional café, purchased croissants, unconfigured bagel, latte/shot recipe and one local manual sale. No provider accessed.');
}
else if (mode === 'role') {
    const role = process.argv[3];
    assert.ok(['owner', 'manager', 'employee'].includes(role));
    sql.prepare('INSERT OR IGNORE INTO memberships VALUES (?,?,?)').run('w2-fixture-owner', companyId, 'owner');
    sql.prepare('UPDATE memberships SET role=? WHERE user_id=? AND company_id=?').run(role, person, companyId);
    console.log('Local fictional role: ' + role);
}
else if (mode === 'sale') {
    const result = await sale();
    assert.equal(result.state, 'applied');
    console.log('Local fictional manual sale applied: ' + result.eventKey);
}
else {
    assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
    assert.equal(sql.prepare('SELECT count(*) AS n FROM orders WHERE owner=?').get(companyId).n, 0);
    const entries = sql.prepare('SELECT item_name,quantity,reason,mode,status FROM waste_entries WHERE company_id=? ORDER BY recorded_at').all(companyId);
    const balances = sql.prepare('SELECT product_id,on_hand_minor,version FROM inventory_balances_exact WHERE company_id=?').all(companyId);
    const allocations = sql.prepare('SELECT capacity,claimed FROM waste_sale_allocations WHERE company_id=?').all(companyId);
    assert.ok(allocations.every(a => a.claimed >= 0 && a.claimed <= a.capacity));
    console.log(JSON.stringify({ entries, balances, allocations, links: sql.prepare('SELECT count(*) AS n FROM waste_sale_links WHERE company_id=?').get(companyId).n }));
}
sql.close();
