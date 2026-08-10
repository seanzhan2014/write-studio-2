import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const workspace = process.cwd();

function option(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(entryPath) : [entryPath];
  });
}

function containsWriterStudioSchema(filePath) {
  try {
    const database = new DatabaseSync(filePath, { readOnly: true });
    const row = database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='articles'").get();
    database.close();
    return Boolean(row);
  } catch {
    return false;
  }
}

function discoverSource() {
  const d1Directory = path.join(workspace, ".wrangler", "state", "v3", "d1");
  const candidates = walk(d1Directory)
    .filter((filePath) => filePath.endsWith(".sqlite") && path.basename(filePath) !== "metadata.sqlite")
    .filter(containsWriterStudioSchema)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  if (candidates.length === 1) return candidates[0];
  if (candidates.length > 1) {
    throw new Error(`Found multiple legacy D1 databases. Re-run with --source and one of:\n${candidates.join("\n")}`);
  }
  throw new Error("No legacy Writer Studio D1 database was found. Pass its SQLite file with --source.");
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

const source = path.resolve(workspace, option("--source") ?? discoverSource());
const target = path.resolve(workspace, option("--target") ?? process.env.WRITER_STUDIO_DB_PATH ?? path.join("data", "writer-studio.sqlite"));

if (!existsSync(source)) throw new Error(`Source database does not exist: ${source}`);
if (source === target) throw new Error("Source and target database paths must be different");
if (existsSync(target)) throw new Error(`Target database already exists; refusing to overwrite it: ${target}`);

mkdirSync(path.dirname(target), { recursive: true });
const sourceDatabase = new DatabaseSync(source);
try {
  sourceDatabase.exec(`VACUUM INTO ${sqlString(target)}`);
} finally {
  sourceDatabase.close();
}

const targetDatabase = new DatabaseSync(target, { readOnly: true });
try {
  const integrity = targetDatabase.prepare("PRAGMA integrity_check").get();
  const articleCount = targetDatabase.prepare("SELECT COUNT(*) AS count FROM articles").get();
  if (integrity?.integrity_check !== "ok") throw new Error(`Migrated database failed integrity check: ${JSON.stringify(integrity)}`);
  process.stdout.write(`Migrated ${articleCount?.count ?? 0} article(s)\nSource: ${source}\nTarget: ${target}\n`);
  process.stdout.write("Keep the same AI_SECRET_KEY when moving encrypted model credentials, or enter those credentials again.\n");
} finally {
  targetDatabase.close();
}
