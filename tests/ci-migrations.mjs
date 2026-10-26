import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkMigrations } from "../scripts/check-migrations.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtime = join(root, ".sites-runtime");
mkdirSync(runtime, { recursive: true });

function fixture(action) {
  // Keep the fixture under the checkout so schema imports resolve installed
  // dependencies without copying node_modules or changing the real schema.
  const directory = mkdtempSync(join(runtime, "ci-migrations-"));
  try {
    cpSync(join(root, "drizzle"), join(directory, "drizzle"), { recursive: true });
    cpSync(join(root, "src", "db"), join(directory, "src", "db"), { recursive: true });
    action(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

checkMigrations();

fixture((directory) => {
  rmSync(join(directory, "drizzle", "meta", "_journal.json"));
  assert.throws(() => checkMigrations({ projectRoot: directory }), /Missing drizzle\/meta\/_journal.json/);
});

fixture((directory) => {
  const path = join(directory, "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(path, "utf8"));
  journal.entries.pop();
  writeFileSync(path, JSON.stringify(journal));
  assert.throws(() => checkMigrations({ projectRoot: directory }), /SQL files and journal entries differ/);
});

fixture((directory) => {
  const path = join(directory, "src", "db", "schema.ts");
  writeFileSync(path, `${readFileSync(path, "utf8")}\nexport const missingCiMigration = sqliteTable('missing_ci_migration', { id: text('id').primaryKey() });\n`);
  const originalJournal = readFileSync(join(directory, "drizzle", "meta", "_journal.json"), "utf8");
  assert.throws(() => checkMigrations({ projectRoot: directory }), /Schema drift detected/);
  assert.equal(readFileSync(join(directory, "drizzle", "meta", "_journal.json"), "utf8"), originalJournal, "Drift detection must not modify migrations.");
});

fixture((directory) => {
  const journal = JSON.parse(readFileSync(join(directory, "drizzle", "meta", "_journal.json"), "utf8"));
  const path = join(directory, "drizzle", `${journal.entries[0].tag}.sql`);
  writeFileSync(path, `${readFileSync(path, "utf8")}\nALTER TABLE products ADD COLUMN unexpected_ci_column text;\n`);
  assert.throws(() => checkMigrations({ projectRoot: directory }), /Applied columns, defaults, or primary key differ/);
});

for (const alteration of ['missing-check','changed-check']) fixture((directory) => {
  const journal = JSON.parse(readFileSync(join(directory, 'drizzle', 'meta', '_journal.json'), 'utf8'));
  const entry = journal.entries.find(e => e.tag.endsWith('_document_archive_journal'));
  const path = join(directory, 'drizzle', `${entry.tag}.sql`), original = readFileSync(path, 'utf8');
  const needle = "IN ('reserved','prepared','held','ready')";
  assert.equal(original.split(needle).length-1, 1);
  const changed = alteration === 'missing-check' ? original.split('\n').filter(line => !line.includes('CONSTRAINT "document_archive_state"')).join('\n') :
    original.replace(needle, "IN ('reserved','prepared','held','ready','unexpected')");
  writeFileSync(path, changed);
  assert.throws(() => checkMigrations({ projectRoot: directory }), /Applied CHECK constraints differ for document_archive_intents/);
});

console.log("PASS: migration checks reject a missing journal, unjournaled SQL, missing generated migrations, SQL/snapshot mismatch and missing/changed CHECK constraints without changing source migrations.");
