import { D1InventoryConsumptionPort } from './d1-inventory-consumption';
import { InventoryManagementError } from './d1-inventory-management';
import { INVENTORY_CONSUMPTION_CONTRACT, type InventoryConsumptionApplied, type SelectedRecipeVersion } from './inventory-consumption-contract';
import { menuWasteSubmission, menuWasteSetup, menuWasteReview, type MenuWasteSubmission, type MenuWasteItem, type MenuWasteOptions, type MenuWasteReceipt, type WasteSaleChoice } from './menu-waste-contract';
type EntryRow = {
    id: string;
    fingerprint: string;
    request_json: string;
    item_name: string;
    actor: string;
    result_json: string;
    status: string;
};
type SaleRow = {
    application_key: string;
    result_json: string;
    event_key: string;
    occurred_at: string;
};
type SaleProof = {
    row: SaleRow;
    line: SelectedRecipeVersion;
    capacity: string;
    name: string;
    modifiers: string[];
};
function fail(code: string, message: string): never { throw new InventoryManagementError(code, message); }
function json<T>(value: string): T { try {
    return JSON.parse(value);
}
catch {
    return fail('corrupt_store', 'A saved record needs repair.');
} }
async function hash(value: string) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)); return [...new Uint8Array(d)].map(v => v.toString(16).padStart(2, '0')).join(''); }
function validTime(value: string) {
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
    if (!match)
        fail('invalid_time', 'The entry time must be valid and not in the future.');
    const [year, month, day, hour, minute, second, offsetHour = 0, offsetMinute = 0] = match.slice(1).map(v => Number(v ?? 0));
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0), days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59 || offsetHour > 23 || offsetMinute > 59 || !Number.isFinite(Date.parse(value)) || Date.parse(value) > Date.now())
        fail('invalid_time', 'The entry time must be valid and not in the future.');
    return new Date(value).toISOString();
}
export class D1MenuWasteService {
    constructor(private readonly db: D1Database) { }
    async options(companyId: string, manager = false): Promise<MenuWasteOptions> {
        const [products, recipes, modifiers] = await Promise.all([
            this.db.prepare(`SELECT p.id,p.data,m.offered,m.revision,b.config_id,b.latest_count_effective_at,c.status,c.stock_unit_id,u.kind AS unit_kind,u.dimension,u.numerator,u.denominator
    FROM products p LEFT JOIN waste_menu_products m ON m.company_id=p.owner AND m.product_id=p.id
    LEFT JOIN inventory_balances_exact b ON b.company_id=p.owner AND b.product_id=p.id
    LEFT JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
    LEFT JOIN product_unit_versions u ON u.company_id=c.company_id AND u.product_id=c.product_id AND u.unit_id=c.stock_unit_id AND u.version=c.stock_unit_version WHERE p.owner=?`).bind(companyId).all<{
                id: string;
                data: string;
                offered: number | null;
                revision: number | null;
                config_id: string | null;
                latest_count_effective_at: string | null;
                status: string | null;
                stock_unit_id: string | null;
                unit_kind: string | null;
                dimension: string | null;
                numerator: string | null;
                denominator: string | null;
            }>(),
            this.db.prepare(`SELECT r.recipe_id,r.id,r.name,r.status,
     CASE WHEN r.status='active' AND r.legacy=0 AND EXISTS(SELECT 1 FROM recipe_version_ingredients i WHERE i.company_id=r.company_id AND i.recipe_id=r.recipe_id AND i.version_id=r.id)
     AND NOT EXISTS(SELECT 1 FROM recipe_version_ingredients i LEFT JOIN inventory_balances_exact b ON b.company_id=i.company_id AND b.product_id=i.product_id
       LEFT JOIN inventory_config_versions c ON c.company_id=b.company_id AND c.product_id=b.product_id AND c.id=b.config_id
       WHERE i.company_id=r.company_id AND i.recipe_id=r.recipe_id AND i.version_id=r.id AND (b.config_id IS NULL OR b.latest_count_effective_at IS NULL OR c.status<>'active' OR i.dimension IS NULL OR i.dimension<>b.dimension)) THEN 1 ELSE 0 END AS ready
     FROM recipe_versions r WHERE r.company_id=? AND (r.status='active' OR (r.status='draft' AND NOT EXISTS(SELECT 1 FROM recipe_versions a WHERE a.company_id=r.company_id AND a.recipe_id=r.recipe_id AND a.status='active')))
     ORDER BY r.version DESC`).bind(companyId).all<{
                recipe_id: string;
                id: string;
                name: string;
                status: string;
                ready: number;
            }>(),
            this.db.prepare("SELECT v.recipe_id,v.modifier_id,v.id,l.name FROM recipe_modifier_versions v JOIN recipe_modifier_lineages l ON l.company_id=v.company_id AND l.recipe_id=v.recipe_id AND l.id=v.modifier_id WHERE v.company_id=? AND v.status='active'").bind(companyId).all<{
                recipe_id: string;
                modifier_id: string;
                id: string;
                name: string;
            }>(),
        ]);
        const items: MenuWasteItem[] = products.results.filter(p => manager || p.offered === 1).map(p => { const ready = p.status === 'active' && p.stock_unit_id === 'each' && p.unit_kind === 'curated' && p.dimension === 'count' && p.numerator === '1' && p.denominator === '1' && !!p.latest_count_effective_at; return { kind: 'product', id: p.id, name: json<{
                name?: string;
            }>(p.data).name || p.id, version: p.config_id || 'unconfigured', ready: p.offered === 1 && ready, issue: p.offered !== 1 ? 'Choose Bought ready-made to offer this café item.' : !ready ? 'Needs inventory setup: count individual items using each.' : null, offered: p.offered === 1, revision: p.revision ?? 0, modifiers: [] }; });
        const choiceRows=await this.db.prepare('SELECT recipe_id,version_id,groups_json FROM recipe_version_choices WHERE company_id=?').bind(companyId).all<{recipe_id:string;version_id:string;groups_json:string}>();
        const seen = new Set<string>();
        for (const r of recipes.results) {
            if (seen.has(r.recipe_id))
                continue;
            seen.add(r.recipe_id);
            items.push({ kind: 'recipe', id: r.recipe_id, name: r.name, version: r.id, ready: r.ready === 1, issue: r.ready === 1 ? null : 'Needs an active recipe and ingredient opening counts.', offered: true, revision: 0, choices:JSON.parse(choiceRows.results.find(c=>c.recipe_id===r.recipe_id&&c.version_id===r.id)?.groups_json??'[]'), modifiers: modifiers.results.filter(m => m.recipe_id === r.recipe_id).map(m => ({ id: m.modifier_id, versionId: m.id, name: m.name })) });
        }
        return { enabled: true, serverNow: new Date().toISOString(), items: items.sort((a, b) => a.name.localeCompare(b.name)) };
    }
    async setup(input: unknown, actor: string) {
        const b = menuWasteSetup.parse(input);
        const prior = await this.db.prepare('SELECT product_id,offered,revision FROM waste_menu_products WHERE company_id=? AND operation_id=?').bind(b.companyId, b.operationId).first<{
            product_id: string;
            offered: number;
            revision: number;
        }>();
        const verify = (p: {
            product_id: string;
            offered: number;
            revision: number;
        }) => { if (p.product_id !== b.productId || p.offered !== Number(b.offered) || p.revision !== b.expectedRevision + 1)
            fail('operation_conflict', 'That setup reference has different details.'); };
        if (prior) {
            verify(prior);
            return { revision: prior.revision };
        }
        await this.db.prepare(`INSERT INTO waste_menu_products(company_id,product_id,offered,revision,operation_id,updated_by,updated_at)
    SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM products WHERE owner=? AND id=?) AND COALESCE((SELECT revision FROM waste_menu_products WHERE company_id=? AND product_id=?),0)=?
    ON CONFLICT(company_id,product_id) DO UPDATE SET offered=excluded.offered,revision=excluded.revision,operation_id=excluded.operation_id,updated_by=excluded.updated_by,updated_at=excluded.updated_at
    WHERE waste_menu_products.revision=?`).bind(b.companyId, b.productId, Number(b.offered), b.expectedRevision + 1, b.operationId, actor, new Date().toISOString(), b.companyId, b.productId, b.companyId, b.productId, b.expectedRevision, b.expectedRevision).run();
        const saved = await this.db.prepare('SELECT product_id,offered,revision FROM waste_menu_products WHERE company_id=? AND operation_id=?').bind(b.companyId, b.operationId).first<{
            product_id: string;
            offered: number;
            revision: number;
        }>();
        if (!saved)
            fail('concurrent_update', 'The product or setup changed. Refresh and try again.');
        verify(saved);
        return { revision: saved.revision };
    }
    private async entry(companyId: string, id: string) { return this.db.prepare('SELECT id,fingerprint,request_json,item_name,actor,result_json,status FROM waste_entries WHERE company_id=? AND id=?').bind(companyId, id).first<EntryRow>(); }
    private async receipt(row: EntryRow, companyId: string): Promise<MenuWasteReceipt> {
        const linked = await this.db.prepare('SELECT result_json FROM waste_sale_links WHERE company_id=? AND entry_id=?').bind(companyId, row.id).first<{
            result_json: string;
        }>();
        return json<MenuWasteReceipt>(linked?.result_json ?? row.result_json);
    }
    private insertEntry(b: MenuWasteSubmission, actor: string, fingerprint: string, itemName: string, result: MenuWasteReceipt, claimToken: string, consumptionKey: string | null, guard = '1', values: unknown[] = []) {
        return this.db.prepare(`INSERT OR IGNORE INTO waste_entries(company_id,id,fingerprint,request_json,source_kind,source_id,item_name,quantity,reason,mode,actor,occurred_at,recorded_at,status,result_json,claim_token,consumption_key)
    SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(b.companyId, b.operationId, fingerprint, JSON.stringify(b), b.sourceKind, b.sourceId, itemName, b.quantity, b.reason, b.mode, actor, b.effectiveAt, new Date().toISOString(), result.status, JSON.stringify(result), claimToken, consumptionKey, ...values);
    }
    private base(b: MenuWasteSubmission, name: string, status: MenuWasteReceipt['status'], message: string): MenuWasteReceipt { return { operationId: b.operationId, itemName: name, quantity: b.quantity, reason: b.reason, mode: b.mode, effectiveAt: b.effectiveAt, status, message, selectedVersions: [], effects: [] }; }
    async record(input: unknown, actor: string): Promise<MenuWasteReceipt> {
        const b = menuWasteSubmission.parse(input);
        b.effectiveAt = validTime(b.effectiveAt);
        b.modifiers.sort((a, c) => a.id.localeCompare(c.id));
        const fingerprint = await hash(JSON.stringify({ actor, request: b })), prior = await this.entry(b.companyId, b.operationId);
        if (prior) {
            if (prior.fingerprint !== fingerprint)
                fail('operation_conflict', 'That save reference has different details.');
            return this.receipt(prior, b.companyId);
        }
        const item = (await this.options(b.companyId, true)).items.find(i => i.kind === b.sourceKind && i.id === b.sourceId);
        if (!item || (item.kind === 'product' && !item.offered))
            fail('not_found', 'Ask a manager to set up this café item.');
        if (b.mode === 'sold')
            return this.classify(b, actor, fingerprint, item.name);
        if (!item.ready)
            fail('invalid_input', item.issue || 'This item needs setup.');
        const guards: Array<{
            sql: string;
            values: unknown[];
        }> = [];
        if (b.sourceKind === 'product') {
            if (item.version !== b.sourceVersion)
                fail('concurrent_update', 'The stock unit changed. Refresh this entry.');
            guards.push({ sql: "EXISTS(SELECT 1 FROM waste_menu_products m JOIN inventory_balances_exact b ON b.company_id=m.company_id AND b.product_id=m.product_id WHERE m.company_id=? AND m.product_id=? AND m.offered=1 AND b.config_id=?)", values: [b.companyId, b.sourceId, b.sourceVersion] });
        }
        else {
            const versionGuard = (table: string, version: string, modifier?: string) => ({ sql: `EXISTS(SELECT 1 FROM ${table} WHERE company_id=? AND recipe_id=? AND id=? ${modifier ? 'AND modifier_id=?' : ''} AND status IN ('active','archived') AND julianday(active_from)<=julianday(?) AND (active_to IS NULL OR julianday(active_to)>julianday(?)))`, values: [b.companyId, b.sourceId, version, ...(modifier ? [modifier] : []), b.effectiveAt, b.effectiveAt] });
            guards.push(versionGuard('recipe_versions', b.sourceVersion));
            for (const m of b.modifiers)
                guards.push(versionGuard('recipe_modifier_versions', m.versionId, m.id));
            for (const g of guards) {
                if (!await this.db.prepare('SELECT 1 AS valid WHERE ' + g.sql).bind(...g.values).first())
                    fail('concurrent_update', 'The recipe or modifier changed. Refresh this entry.');
            }
        }
        const key = 'waste:' + b.operationId;
        const result = await new D1InventoryConsumptionPort(this.db).consumeWaste({ contract: INVENTORY_CONSUMPTION_CONTRACT, companyId: b.companyId, idempotencyKey: key, occurredAt: b.effectiveAt, lines: [{ lineId: 'waste-item', recipeId: b.sourceId, quantity: String(b.quantity), modifiers: b.modifiers.map(m => ({ modifierId: m.id, quantity: String(m.perItem * b.quantity) })) }] }, { actor, reason: b.reason, fingerprint, directProductId: b.sourceKind === 'product' ? b.sourceId : undefined, guards,
            statements: (applied, token) => {
                const receipt = { ...this.base(b, item.name, 'deducted', 'Waste recorded. Stock was deducted once.'), selectedVersions: applied.selectedVersions, effects: applied.changes.map(c => ({ productId: c.productId, minor: c.consumed.minor, dimension: c.consumed.dimension })) };
                return [this.insertEntry(b, actor, fingerprint, item.name, receipt, token, key, "EXISTS(SELECT 1 FROM inventory_consumption_applications WHERE company_id=? AND idempotency_key=? AND json_extract(result_json,'$._claimToken')=?)", [b.companyId, key, token])];
            } });
        if (result.status !== 'applied')
            fail(result.issues.some(i => i.code === 'idempotency_conflict') ? 'operation_conflict' : result.issues.some(i => i.code === 'before_count_cutoff') ? 'before_count_cutoff' : result.status === 'rejected' ? 'invalid_quantity' : 'invalid_input', result.issues[0]?.message || 'This item needs manager review. Nothing was deducted.');
        const saved = await this.entry(b.companyId, b.operationId);
        if (!saved || saved.fingerprint !== fingerprint)
            fail('corrupt_store', 'The save needs confirmation. Retry the same entry.');
        return this.receipt(saved, b.companyId);
    }
    private async saleProof(companyId: string, sourceKind: string, sourceId: string, sale: {
        applicationKey: string;
        lineId: string;
    }): Promise<SaleProof | null> {
        const row = await this.db.prepare(`SELECT e.application_key,e.event_key,e.occurred_at,a.result_json FROM sales_events e
    JOIN inventory_consumption_applications a ON a.company_id=e.company_id AND a.idempotency_key=e.application_key
    JOIN sales_event_states s ON s.company_id=e.company_id AND s.event_key=e.event_key AND s.state='applied'
    WHERE e.company_id=? AND e.application_key=? AND NOT EXISTS(SELECT 1 FROM sales_event_corrections c WHERE c.company_id=e.company_id AND c.event_key=e.event_key)`).bind(companyId, sale.applicationKey).first<SaleRow>();
        if (!row)
            return null;
        const applied = json<InventoryConsumptionApplied>(row.result_json);
        if (applied.status !== 'applied' || applied.companyId !== companyId || applied.idempotencyKey !== sale.applicationKey || !Array.isArray(applied.selectedVersions))
            return fail('corrupt_store', 'The linked consumption record needs repair.');
        const line = applied.selectedVersions.find(l => l.lineId === sale.lineId);
        if (!line || !/^[1-9]\d{0,18}$/.test(line.quantity) || BigInt(line.quantity) > BigInt('9223372036854775807'))
            return null;
        if (sourceKind === 'recipe' && line.recipeId !== sourceId)
            return null;
        if (sourceKind === 'product') {
            const ingredient = await this.db.prepare("SELECT 1 AS valid FROM recipe_version_ingredients WHERE company_id=? AND recipe_id=? AND version_id=? AND product_id=? AND dimension='count' AND quantity_minor='1'").bind(companyId, line.recipeId, line.recipeVersionId, sourceId).first();
            if (!ingredient || line.modifiers.length)
                return null;
        }
        // Mixed modifier counts do not prove which individual drink was discarded.
        if (line.modifiers.some(m => !/^[1-9]\d{0,18}$/.test(m.quantity) || BigInt(m.quantity) % BigInt(line.quantity) !== BigInt(0)))
            return null;
        const recipe = await this.db.prepare('SELECT name FROM recipe_versions WHERE company_id=? AND recipe_id=? AND id=?').bind(companyId, line.recipeId, line.recipeVersionId).first<{
            name: string;
        }>();
        const labels: string[] = [];
        for (const m of line.modifiers) {
            const found = await this.db.prepare('SELECT l.name FROM recipe_modifier_versions v JOIN recipe_modifier_lineages l ON l.company_id=v.company_id AND l.recipe_id=v.recipe_id AND l.id=v.modifier_id WHERE v.company_id=? AND v.recipe_id=? AND v.modifier_id=? AND v.id=?').bind(companyId, line.recipeId, m.modifierId, m.modifierVersionId).first<{
                name: string;
            }>();
            if (!found)
                return null;
            labels.push(found.name);
        }
        return { row, line, capacity: line.quantity, name: recipe?.name || sourceId, modifiers: labels };
    }
    async sales(companyId: string, sourceKind: string, sourceId: string): Promise<WasteSaleChoice[]> {
        const rows = await this.db.prepare('SELECT e.application_key,a.result_json FROM sales_events e JOIN inventory_consumption_applications a ON a.company_id=e.company_id AND a.idempotency_key=e.application_key WHERE e.company_id=? ORDER BY e.occurred_at DESC LIMIT 50').bind(companyId).all<{
            application_key: string;
            result_json: string;
        }>();
        const choices: WasteSaleChoice[] = [];
        for (const row of rows.results)
            for (const line of json<InventoryConsumptionApplied>(row.result_json).selectedVersions) {
                const proof = await this.saleProof(companyId, sourceKind, sourceId, { applicationKey: row.application_key, lineId: line.lineId });
                if (!proof)
                    continue;
                const allocated = await this.db.prepare('SELECT CAST(claimed AS TEXT) AS claimed FROM waste_sale_allocations WHERE company_id=? AND application_key=? AND line_id=?').bind(companyId, row.application_key, line.lineId).first<{
                    claimed: string;
                }>();
                const available = BigInt(proof.capacity) - BigInt(allocated?.claimed ?? '0');
                if (available <= 0)
                    continue;
                choices.push({ applicationKey: row.application_key, lineId: line.lineId, name: proof.name, occurredAt: proof.row.occurred_at, available: Number(available > BigInt(999) ? BigInt(999) : available), modifiers: proof.modifiers });
            }
        return choices;
    }
    private async classify(b: MenuWasteSubmission, actor: string, fingerprint: string, name: string): Promise<MenuWasteReceipt> {
        if (b.sale) {
            const proof = await this.saleProof(b.companyId, b.sourceKind, b.sourceId, b.sale);
            if (proof) {
                await this.link(b, actor, fingerprint, name, proof, false);
                const saved = await this.entry(b.companyId, b.operationId);
                if (saved) {
                    if (saved.fingerprint !== fingerprint)
                        fail('operation_conflict', 'That save reference has different details.');
                    return this.receipt(saved, b.companyId);
                }
            }
        }
        const receipt = this.base(b, name, 'held', 'Saved for manager review. Stock was not deducted; link the existing sale after it is confirmed.');
        await this.insertEntry(b, actor, fingerprint, name, receipt, crypto.randomUUID(), null).run();
        const saved = await this.entry(b.companyId, b.operationId);
        if (!saved || saved.fingerprint !== fingerprint)
            fail('operation_conflict', 'That save reference has different details.');
        return this.receipt(saved, b.companyId);
    }
    private async link(b: MenuWasteSubmission, actor: string, fingerprint: string, name: string, proof: SaleProof, review: boolean, reviewOperation?: string) {
        const sale = { applicationKey: proof.row.application_key, lineId: proof.line.lineId }, token = crypto.randomUUID();
        const receipt = { ...this.base(b, name, 'classified', 'Waste recorded against an existing sale. No additional stock was deducted.'), selectedVersions: [proof.line] };
        const available = `EXISTS(SELECT 1 FROM waste_sale_allocations WHERE company_id=? AND application_key=? AND line_id=? AND capacity-claimed>=?)
    AND EXISTS(SELECT 1 FROM sales_event_states WHERE company_id=? AND event_key=? AND state='applied') AND NOT EXISTS(SELECT 1 FROM sales_event_corrections WHERE company_id=? AND event_key=?)`;
        const values = [b.companyId, sale.applicationKey, sale.lineId, b.quantity, b.companyId, proof.row.event_key, b.companyId, proof.row.event_key];
        const statements = [this.db.prepare('INSERT OR IGNORE INTO waste_sale_allocations(company_id,application_key,line_id,capacity,claimed) VALUES (?,?,?,?,0)').bind(b.companyId, sale.applicationKey, sale.lineId, proof.capacity)];
        if (review) {
            statements.push(this.db.prepare(`INSERT OR IGNORE INTO waste_sale_links(company_id,entry_id,application_key,line_id,operation_id,fingerprint,result_json,claim_token,linked_by,linked_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE ${available} AND EXISTS(SELECT 1 FROM waste_entries WHERE company_id=? AND id=? AND status='held')`).bind(b.companyId, b.operationId, sale.applicationKey, sale.lineId, reviewOperation!, fingerprint, JSON.stringify(receipt), token, actor, new Date().toISOString(), ...values, b.companyId, b.operationId));
        }
        else
            statements.push(this.insertEntry(b, actor, fingerprint, name, receipt, token, null, available, values));
        const claim = review ? 'waste_sale_links' : 'waste_entries', key = review ? 'entry_id' : 'id';
        statements.push(this.db.prepare(`UPDATE waste_sale_allocations SET claimed=claimed+? WHERE company_id=? AND application_key=? AND line_id=? AND capacity-claimed>=? AND EXISTS(SELECT 1 FROM ${claim} WHERE company_id=? AND ${key}=? AND claim_token=?)`).bind(b.quantity, b.companyId, sale.applicationKey, sale.lineId, b.quantity, b.companyId, b.operationId, token));
        if (!review)
            statements.push(this.db.prepare(`INSERT OR IGNORE INTO waste_sale_links(company_id,entry_id,application_key,line_id,operation_id,fingerprint,result_json,claim_token,linked_by,linked_at)
    SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM waste_entries WHERE company_id=? AND id=? AND claim_token=?)`).bind(b.companyId, b.operationId, sale.applicationKey, sale.lineId, b.operationId, fingerprint, JSON.stringify(receipt), token, actor, new Date().toISOString(), b.companyId, b.operationId, token));
        await this.db.batch(statements);
    }
    async review(input: unknown, actor: string) {
        const b = menuWasteReview.parse(input), fingerprint = await hash(JSON.stringify({ actor, request: b }));
        const prior = await this.db.prepare('SELECT entry_id,fingerprint,result_json FROM waste_sale_links WHERE company_id=? AND operation_id=?').bind(b.companyId, b.operationId).first<{
            entry_id: string;
            fingerprint: string;
            result_json: string;
        }>();
        if (prior) {
            if (prior.entry_id !== b.entryId || prior.fingerprint !== fingerprint)
                fail('operation_conflict', 'That review reference has different details.');
            return json<MenuWasteReceipt>(prior.result_json);
        }
        const entry = await this.entry(b.companyId, b.entryId);
        if (!entry || entry.status !== 'held')
            fail('invalid_input', 'Only a held entry may be linked by a manager.');
        const request = json<MenuWasteSubmission>(entry.request_json), proof = await this.saleProof(b.companyId, request.sourceKind, request.sourceId, b.sale);
        if (!proof)
            fail('invalid_input', 'That sale does not yet prove this item was counted. Stock remains unchanged.');
        await this.link(request, actor, fingerprint, entry.item_name, proof, true, b.operationId);
        const saved = await this.db.prepare('SELECT fingerprint,result_json FROM waste_sale_links WHERE company_id=? AND entry_id=?').bind(b.companyId, b.entryId).first<{
            fingerprint: string;
            result_json: string;
        }>();
        if (!saved)
            fail('concurrent_update', 'The sold quantity was already classified or the sale changed. Choose another confirmed sale.');
        if (saved.fingerprint !== fingerprint)
            fail('operation_conflict', 'This entry was already linked by another review.');
        return json<MenuWasteReceipt>(saved.result_json);
    }
    async held(companyId: string) { const rows = await this.db.prepare(`SELECT e.id,e.item_name,e.quantity,e.reason,e.occurred_at,e.source_kind,e.source_id FROM waste_entries e WHERE e.company_id=? AND e.status='held' AND NOT EXISTS(SELECT 1 FROM waste_sale_links l WHERE l.company_id=e.company_id AND l.entry_id=e.id) ORDER BY e.recorded_at DESC LIMIT 50`).bind(companyId).all<{
        id: string;
        item_name: string;
        quantity: number;
        reason: string;
        occurred_at: string;
        source_kind: string;
        source_id: string;
    }>(); return rows.results.map(r => ({ id: r.id, name: r.item_name, quantity: r.quantity, reason: r.reason, occurredAt: r.occurred_at, sourceKind: r.source_kind, sourceId: r.source_id })); }
}
