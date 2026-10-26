import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {archiveFixture,openArchiveContext} from './document-archive.mjs';
await build({stdin:{contents:['d1-document-archive-journal','d1-document-archive-source-guard','purchase-order-document-archive',
  'purchase-order-document-archive-contract','purchase-order-document-archive-sources','d1-purchase-order-history-exports',
].map(name=>`export * from './src/lib/${name}.ts';`).join('\n'),resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.sites-runtime/document-archive-d1-core.mjs'});
export const core=await import('../../.sites-runtime/document-archive-d1-core.mjs');
export function requireJournalMigration(sql){
  assert.equal(sql.prepare("SELECT count(*) n FROM sqlite_master WHERE type='table' AND name IN ('document_archive_intents','document_archive_leases','document_archive_observations')").get().n,3,
    'The application migration must supply the complete archive schema.');
}
export function attachArchiveD1(c){
  requireJournalMigration(c.sql);const hooks={},metrics={batches:0,maximumBindings:0};
  c.sql.exec('CREATE TABLE IF NOT EXISTS document_archive_test_clock(at TEXT NOT NULL)');
  c.sql.exec('DELETE FROM document_archive_test_clock');c.sql.prepare('INSERT INTO document_archive_test_clock VALUES(?)').run(c.state.at);
  const db={prepare:query=>c.db.prepare(query),batch:async statements=>{
    metrics.batches++;for(const s of statements)metrics.maximumBindings=Math.max(metrics.maximumBindings,s.values.length);
    const query=statements[0].query;
    const phase=query.includes("SET manifest_json=")?'prepare':query.includes("SET artifact_json=")?'publish':query.includes('INSERT INTO document_archive_intents')?'begin':
      query.includes('INSERT INTO document_archive_observations')?'observe':null;
    const hook=hooks[phase];if(hook){delete hooks[phase];await hook();}
    c.sql.prepare('UPDATE document_archive_test_clock SET at=?').run(c.state.at);return c.db.batch(statements);
  }};
  const journal=new core.D1DocumentArchiveJournal(db,{clock:{...c.clock,sqlNow:'(SELECT at FROM document_archive_test_clock)'}}),sources=new core.D1DocumentArchiveSources(db);
  const dependencies={...c.dependencies,journal,sources:{load:async(...args)=>{c.stats.sourceReads++;return sources.load(...args);}},
    render:async(...args)=>{c.stats.renders++;return core.renderDocumentArchive(...args,async()=>new Uint8Array(readFileSync('public/fonts/NotoSans-Regular.ttf')));}};
  return {...c,journal,hooks,metrics,dependencies,service:overrides=>new core.PurchaseOrderDocumentArchive({...dependencies,...overrides}),
    row:id=>c.sql.prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND id=?').get('a',id),
    intent:operationId=>c.sql.prepare('SELECT * FROM document_archive_intents WHERE company_id=? AND operation_id=?').get('a',operationId),
    business:()=>JSON.stringify(c.sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'document_archive_%' AND name NOT LIKE 'archive_contract_%' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all().map(({name})=>[name,c.sql.prepare(`SELECT * FROM "${name}"`).all()]))};
}
export const d1ArchiveFixture=async()=>attachArchiveD1(await archiveFixture());
export const reopenArchiveD1=(databasePath,objectRoot,state)=>attachArchiveD1(openArchiveContext(databasePath,objectRoot,state));
