import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const toolRoot = fileURLToPath(new URL("../", import.meta.url));
const initialSnapshotId = "00000000-0000-0000-0000-000000000000";
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const sorted = (values) => values.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
const quote = (name) => `'${name.replaceAll("'", "''")}'`;

function fileHashes(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relative = `${prefix}${entry.name}`;
    const absolute = join(directory, entry.name);
    return entry.isDirectory()
      ? fileHashes(absolute, `${relative}/`)
      : [[relative, createHash("sha256").update(readFileSync(absolute)).digest("hex")]];
  }).sort(([left], [right]) => left.localeCompare(right));
}

function migrationHistory(migrations) {
  const journalPath = join(migrations, "meta", "_journal.json");
  assert.ok(existsSync(journalPath), "Missing drizzle/meta/_journal.json; commit the migration journal.");
  const journal = readJson(journalPath);
  assert.equal(journal.dialect, "sqlite", "The migration journal must use SQLite.");
  assert.ok(Array.isArray(journal.entries) && journal.entries.length > 0, "The migration journal must contain entries.");
  const expectedSql = [];
  const expectedSnapshots = [];
  let previousId = initialSnapshotId;
  let previousTimestamp = -1;
  let latestSnapshot;
  const snapshotIds = new Set();

  for (const [position, entry] of journal.entries.entries()) {
    assert.equal(entry.idx, position, "Migration indexes must be unique, contiguous, and ordered from zero.");
    const prefix = String(position).padStart(4, "0");
    assert.match(entry.tag, new RegExp(`^${prefix}_[a-zA-Z0-9_-]+$`), `Invalid migration tag at index ${position}.`);
    assert.ok(Number.isFinite(entry.when) && entry.when > previousTimestamp, "Migration timestamps must increase in journal order.");
    previousTimestamp = entry.when;
    expectedSql.push(`${entry.tag}.sql`);
    expectedSnapshots.push(`${prefix}_snapshot.json`);
    const sqlPath = join(migrations, `${entry.tag}.sql`);
    const snapshotPath = join(migrations, "meta", `${prefix}_snapshot.json`);
    assert.ok(existsSync(sqlPath), `Journaled migration ${entry.tag}.sql is missing.`);
    assert.ok(existsSync(snapshotPath), `Migration snapshot ${prefix}_snapshot.json is missing.`);
    assert.ok(readFileSync(sqlPath, "utf8").trim(), `Migration ${entry.tag}.sql is empty.`);
    latestSnapshot = readJson(snapshotPath);
    assert.equal(latestSnapshot.dialect, "sqlite", `Wrong dialect in ${prefix}_snapshot.json.`);
    assert.equal(latestSnapshot.prevId, previousId, `Broken snapshot ancestry at ${prefix}_snapshot.json.`);
    assert.ok(typeof latestSnapshot.id === "string" && latestSnapshot.id !== initialSnapshotId && !snapshotIds.has(latestSnapshot.id), "Snapshot IDs must be present and unique.");
    snapshotIds.add(latestSnapshot.id);
    previousId = latestSnapshot.id;
  }
  assert.deepEqual(readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort(), expectedSql.sort(), "Migration SQL files and journal entries differ; include every migration in the journal.");
  assert.deepEqual(readdirSync(join(migrations, "meta")).filter((name) => name.endsWith("_snapshot.json")).sort(), expectedSnapshots.sort(), "Migration snapshots and journal entries differ.");
  return { journal, latestSnapshot };
}

function assertAppliedSchema(database, snapshot) {
  const tables = Object.values(snapshot.tables);
  const actualNames = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((row) => row.name).sort();
  assert.deepEqual(actualNames, tables.map((table) => table.name).sort(), "Applied migration tables differ from the latest snapshot.");

  for (const table of tables) {
    const primaryKey = Object.values(table.compositePrimaryKeys).flatMap((key) => key.columns);
    const expectedColumns = sorted(Object.values(table.columns).map((column) => ({
      name: column.name,
      type: column.type.toLowerCase(),
      notNull: column.notNull,
      default: column.default == null ? null : String(column.default),
      primaryKey: primaryKey.length ? primaryKey.indexOf(column.name) + 1 : Number(column.primaryKey),
    })));
    const actualColumns = sorted(database.prepare(`PRAGMA table_info(${quote(table.name)})`).all().map((column) => ({
      name: column.name,
      type: column.type.toLowerCase(),
      notNull: Boolean(column.notnull),
      default: column.dflt_value,
      primaryKey: column.pk,
    })));
    assert.deepEqual(actualColumns, expectedColumns, `Applied columns, defaults, or primary key differ for ${table.name}.`);

    const foreignKeys = new Map();
    for (const key of database.prepare(`PRAGMA foreign_key_list(${quote(table.name)})`).all()) {
      const combined = foreignKeys.get(key.id) ?? { table: key.table, from: [], to: [], onUpdate: key.on_update.toLowerCase(), onDelete: key.on_delete.toLowerCase() };
      combined.from[key.seq] = key.from;
      combined.to[key.seq] = key.to;
      foreignKeys.set(key.id, combined);
    }
    const expectedForeignKeys = Object.values(table.foreignKeys).map((key) => ({ table: key.tableTo, from: key.columnsFrom, to: key.columnsTo, onUpdate: key.onUpdate ?? "no action", onDelete: key.onDelete ?? "no action" }));
    assert.deepEqual(sorted([...foreignKeys.values()]), sorted(expectedForeignKeys), `Applied foreign keys differ for ${table.name}.`);

    const actualIndexes = database.prepare(`PRAGMA index_list(${quote(table.name)})`).all().filter((index) => index.origin !== "pk");
    const expectedIndexes = Object.values(table.indexes);
    const expectedUnique = Object.values(table.uniqueConstraints);
    assert.equal(actualIndexes.length, expectedIndexes.length + expectedUnique.length, `Applied index count differs for ${table.name}.`);
    for (const expected of expectedIndexes) {
      const actual = actualIndexes.find((index) => index.name === expected.name);
      assert.ok(actual, `Missing index ${expected.name}.`);
      assert.equal(Boolean(actual.unique), expected.isUnique, `Index uniqueness differs for ${expected.name}.`);
      const columns = database.prepare(`PRAGMA index_info(${quote(actual.name)})`).all().map((column) => column.name);
      assert.deepEqual(columns, expected.columns, `Index columns differ for ${expected.name}.`);
      assert.equal(Boolean(actual.partial), Boolean(expected.where), `Partial index differs for ${expected.name}.`);
    }
    const actualUnique = actualIndexes.filter((index) => index.origin === "u").map((index) => database.prepare(`PRAGMA index_info(${quote(index.name)})`).all().map((column) => column.name));
    assert.deepEqual(sorted(actualUnique), sorted(expectedUnique.map((constraint) => constraint.columns)), `Unique constraints differ for ${table.name}.`);

    // SQLite does not expose CHECK expressions through a pragma. Fail closed if
    // a new schema needs validation this baseline checker cannot yet provide.
    assert.equal(Object.keys(table.checkConstraints ?? {}).length, 0, `Add CHECK-constraint validation before introducing checks on ${table.name}.`);
  }
  assert.deepEqual(database.prepare("PRAGMA foreign_key_check").all(), [], "Applied migrations contain foreign-key violations.");
  assert.equal(database.prepare("PRAGMA integrity_check").get().integrity_check, "ok", "Applied migrations fail SQLite integrity validation.");
}

export function checkMigrations({ projectRoot = toolRoot, log = console.log } = {}) {
  const migrations = join(projectRoot, "drizzle");
  const { journal, latestSnapshot } = migrationHistory(migrations);
  const temporary = mkdtempSync(join(tmpdir(), "pantrack-migrations-"));
  try {
    const copiedMigrations = join(temporary, "drizzle");
    cpSync(migrations, copiedMigrations, { recursive: true });
    const before = fileHashes(copiedMigrations);
    const config = join(temporary, "drizzle.config.cjs");
    // Drizzle treats schema paths as glob expressions, which use forward slashes
    // on Windows as well as Unix.
    // Drizzle 0.31 prepends cwd when reading snapshots, even for absolute out
    // paths. Run inside the temporary directory with a relative output path.
    writeFileSync(config, `module.exports = ${JSON.stringify({ dialect: "sqlite", schema: join(projectRoot, "src", "db", "schema.ts").replaceAll("\\", "/"), out: "./drizzle" })};\n`);
    const generated = spawnSync(process.execPath, [join(toolRoot, "node_modules", "drizzle-kit", "bin.cjs"), "generate", "--config", config], { cwd: temporary, encoding: "utf8", timeout: 90_000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    if (generated.error) throw generated.error;
    assert.equal(generated.status, 0, `Drizzle generation failed.\n${generated.stdout}\n${generated.stderr}`);
    assert.deepEqual(fileHashes(copiedMigrations), before, "Schema drift detected: run pnpm db:generate and commit its new SQL, snapshot, and journal.");
    // Some Drizzle failures exit zero. Require explicit success as well as an
    // unchanged migration directory, including when an interactive diff stalls.
    assert.match(generated.stdout, /No schema changes, nothing to migrate/, `Drizzle did not confirm an unchanged schema.\n${generated.stdout}\n${generated.stderr}`);

    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      for (const entry of journal.entries) {
        try {
          database.exec(readFileSync(join(migrations, `${entry.tag}.sql`), "utf8"));
        } catch (error) {
          throw new Error(`Migration ${entry.tag}.sql failed on a fresh SQLite database.`, { cause: error });
        }
      }
      assertAppliedSchema(database, latestSnapshot);
    } finally {
      database.close();
    }
    log(`PASS: ${journal.entries.length} ordered migrations match the schema and apply to a fresh SQLite database.`);
    return { migrations: journal.entries.length, tables: Object.keys(latestSnapshot.tables).length };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    checkMigrations();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}
