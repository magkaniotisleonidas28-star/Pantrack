import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
assert.equal(journal.entries[11]?.tag,'0011_slimy_vargas','A4 guardrails must remain the generated 0011 migration.');
const sql=new DatabaseSync(':memory:');
sql.exec('PRAGMA foreign_keys = ON');
for(const entry of journal.entries.slice(0,11))sql.exec(readFileSync(`drizzle/${entry.tag}.sql`,'utf8'));

const at='2026-01-01T00:00:00.000Z';
sql.prepare('INSERT INTO companies(id,name,created) VALUES (?,?,?)').run('company-a','A',at);
sql.prepare('INSERT INTO products(owner,id,data) VALUES (?,?,?)').run('company-a','milk','{"id":"milk","name":"Milk"}');
sql.prepare(`INSERT INTO product_unit_versions(company_id,product_id,unit_id,version,kind,dimension,label,numerator,denominator,created_by,created_at,retired_at)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)`).run('company-a','milk','mL',1,'curated','volume','mL','1','1','fixture',at);
sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)`).run('company-a','milk','config-1',1,'active','mL',1,'carton','1000000000',at,'fixture',at);
sql.prepare('INSERT INTO recipe_lineages(company_id,id,created_by,created_at) VALUES (?,?,?,?)').run('company-a','latte','fixture',at);
sql.prepare(`INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,active_from,active_to,legacy,created_by,created_at)
  VALUES (?,?,?,?,?,?,?,?,0,?,?)`).run('company-a','latte','latte-v1',1,'active','Latte',at,null,'fixture',at);
sql.prepare(`INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id,legacy_unit_label)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)`).run('company-a','latte','latte-v1',0,'milk','mL',1,'volume','100000000','100','mL');
sql.prepare('INSERT INTO recipe_modifier_lineages(company_id,recipe_id,id,name,created_by,created_at) VALUES (?,?,?,?,?,?)').run('company-a','latte','extra','Extra','fixture',at);
sql.prepare(`INSERT INTO recipe_modifier_versions(company_id,recipe_id,modifier_id,id,version,status,active_from,active_to,created_by,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,?)`).run('company-a','latte','extra','extra-v1',1,'active',at,null,'fixture',at);
sql.prepare(`INSERT INTO recipe_modifier_deltas(company_id,recipe_id,modifier_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run('company-a','latte','extra','extra-v1',0,'milk','mL',1,'volume','10000000','10','mL');

const before={
  configs:sql.prepare('SELECT * FROM inventory_config_versions').all(),
  versions:sql.prepare('SELECT * FROM recipe_versions').all(),
  ingredients:sql.prepare('SELECT * FROM recipe_version_ingredients').all(),
  modifierVersions:sql.prepare('SELECT * FROM recipe_modifier_versions').all(),
  modifierDeltas:sql.prepare('SELECT * FROM recipe_modifier_deltas').all(),
};
sql.exec(readFileSync(`drizzle/${journal.entries[11].tag}.sql`,'utf8'));
assert.deepEqual(sql.prepare('SELECT * FROM inventory_config_versions').all(),before.configs);
assert.deepEqual(sql.prepare('SELECT * FROM recipe_versions').all(),before.versions);
assert.deepEqual(sql.prepare('SELECT * FROM recipe_version_ingredients').all(),before.ingredients);
assert.deepEqual(sql.prepare('SELECT * FROM recipe_modifier_versions').all(),before.modifierVersions);
assert.deepEqual(sql.prepare('SELECT * FROM recipe_modifier_deltas').all(),before.modifierDeltas);

const indexes=sql.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(row=>row.name);
for(const name of ['inventory_config_one_active','recipe_version_one_active','modifier_version_one_active'])assert.ok(indexes.includes(name),`${name} missing`);
const triggers=sql.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all().map(row=>row.name);
for(const name of ['recipe_version_immutable_update','recipe_version_immutable_delete','recipe_ingredient_draft_insert','recipe_ingredient_draft_update','recipe_ingredient_draft_delete','modifier_version_immutable_update','modifier_version_immutable_delete','modifier_delta_draft_insert','modifier_delta_draft_update','modifier_delta_draft_delete'])assert.ok(triggers.includes(name),`${name} missing`);

assert.throws(()=>sql.prepare(`INSERT INTO inventory_config_versions(company_id,product_id,id,version,status,stock_unit_id,stock_unit_version,purchase_unit_label,purchase_quantity_minor,legacy_units_per_pack,effective_from,replaced_at,created_by,created_at)
  VALUES (?,?,?,?,?,?,?,?,?,NULL,?,NULL,?,?)`).run('company-a','milk','config-2',2,'active','mL',1,'carton','1000000000',at,'fixture',at),/UNIQUE/);
assert.throws(()=>sql.prepare("UPDATE recipe_versions SET name='Changed' WHERE company_id='company-a' AND recipe_id='latte' AND id='latte-v1'").run(),/immutable/);
assert.throws(()=>sql.prepare("DELETE FROM recipe_version_ingredients WHERE company_id='company-a' AND recipe_id='latte' AND version_id='latte-v1'").run(),/drafts/);
assert.throws(()=>sql.prepare("UPDATE recipe_modifier_deltas SET quantity_minor='2' WHERE company_id='company-a' AND recipe_id='latte' AND modifier_id='extra' AND version_id='extra-v1'").run(),/drafts/);
sql.prepare(`INSERT INTO recipe_versions(company_id,recipe_id,id,version,status,name,active_from,active_to,legacy,created_by,created_at)
  VALUES (?,?,?,?,'draft',?,NULL,NULL,0,?,?)`).run('company-a','latte','latte-v2',2,'Large latte','fixture',at);
sql.prepare(`INSERT INTO recipe_version_ingredients(company_id,recipe_id,version_id,position,product_id,unit_id,unit_version,dimension,quantity_minor,entered_amount,entered_unit_id,legacy_unit_label)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,NULL)`).run('company-a','latte','latte-v2',0,'milk','mL',1,'volume','120000000','120','mL');
sql.prepare("UPDATE recipe_versions SET status='archived',active_to=? WHERE company_id='company-a' AND recipe_id='latte' AND id='latte-v1'").run('2026-02-01T00:00:00.000Z');
sql.prepare("UPDATE recipe_versions SET status='active',active_from=? WHERE company_id='company-a' AND recipe_id='latte' AND id='latte-v2'").run('2026-02-01T00:00:00.000Z');
assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
sql.close();
console.log('PASS: A4 migration preserves existing rows, enforces one active version, keeps drafts editable, and makes activated recipe/modifier history immutable.');
