import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';

// Cloudflare D1 rejects LIKE/GLOB patterns over 50 bytes ("pattern too complex");
// node:sqlite allows 50,000, so offline suites cannot see it. Check every active
// trigger, view and table definition after all migrations.
const LIMIT=50;
const entries=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8')).entries;
const sql=new DatabaseSync(':memory:');
for(const e of entries)sql.exec(readFileSync(`drizzle/${e.tag}.sql`,'utf8'));
const objects=sql.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND type IN ('trigger','view','table')").all();
const over=[];
for(const {type,name,sql:text} of objects)
  for(const m of text.matchAll(/\b(?:NOT\s+)?(?:GLOB|LIKE)\s+'((?:[^']|'')*)'/gi)){
    const bytes=Buffer.byteLength(m[1].replaceAll("''","'"));if(bytes>LIMIT)over.push(`${type} ${name}: ${bytes} bytes`);
  }
assert.deepEqual(over,[],'Active LIKE/GLOB patterns must fit D1\'s 50-byte limit');
assert.ok(objects.some(o=>o.name==='po_cart_reservation_guard'),'The check reads the current schema');
sql.close();
console.log('PASS: every active LIKE/GLOB pattern fits Cloudflare D1\'s 50-byte pattern limit.');
