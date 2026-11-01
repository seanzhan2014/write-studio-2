import { lstat, readdir, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const day = 24 * 60 * 60 * 1000;
const protectedName = /(?:backup|before|recovery|maintenance)/i;
const databaseFile = /\.(?:sqlite3?|db)(?:-(?:wal|shm))?$/i;
const wranglerTest = /^(?:test|playwright|browser|(?:[\w-]*-)?audit)-(?:state|registry)(?:-|$)/;

function within(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function inspect(target) {
  let details;
  try { details = await lstat(target); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
  // Never follow links/junctions, including links inside generated directories.
  if (details.isSymbolicLink()) return null;
  if (!details.isDirectory()) return details.isFile() ? { bytes: details.size, newest: details.mtimeMs } : null;
  let bytes = 0;
  let newest = details.mtimeMs;
  for (const name of await readdir(target)) {
    const child = await inspect(path.join(target, name));
    if (!child) return null;
    bytes += child.bytes;
    newest = Math.max(newest, child.newest);
  }
  return { bytes, newest };
}

async function children(workspace, directory) {
  const target = path.join(workspace, directory);
  try {
    if ((await lstat(target)).isSymbolicLink()) return [];
    return (await readdir(target)).map(name => ({ name, relative: path.join(directory, name) }));
  } catch (error) { if (error.code === "ENOENT") return []; throw error; }
}

export async function cleanWorkspace(workspace, { days = 7, apply = false, now = Date.now() } = {}) {
  if (!Number.isFinite(days) || days < 0) throw new Error("days must be a non-negative number");
  const root = await realpath(workspace);
  const candidates = [".npm-cache", "test-results", "playwright-report"].map(relative => ({ relative, days }));
  for (const directory of [".test-data", "outputs", "work"]) {
    for (const entry of await children(root, directory)) {
      if (protectedName.test(entry.name) || databaseFile.test(entry.name)) continue;
      candidates.push({ relative: entry.relative, days });
    }
  }
  for (const entry of await children(root, ".wrangler")) {
    // Keep the old business database in .wrangler/state and current deploy data.
    if (wranglerTest.test(entry.name)) candidates.push({ relative: entry.relative, days });
  }
  for (const entry of await children(root, "logs")) {
    if (/^(?:dev|prod)-\d+-(?:service|access)-\d{4}-\d{2}-\d{2}\.log$/.test(entry.name)) {
      candidates.push({ relative: entry.relative, days: Math.max(30, days) });
    }
  }
  for (const entry of await children(root, ".")) {
    if (/^\.writer-studio-restart-[\w-]+$/.test(entry.name)) candidates.push({ relative: entry.name, days });
  }

  const selected = [];
  const failed = [];
  for (const candidate of candidates) {
    const target = path.resolve(root, candidate.relative);
    if (!within(root, target)) throw new Error(`Unsafe cleanup target: ${candidate.relative}`);
    const details = await inspect(target);
    if (!details || details.newest > now - candidate.days * day) continue;
    // Resolve the final path again immediately before a recursive removal.
    if (!within(root, await realpath(target))) throw new Error(`Cleanup target escapes workspace: ${candidate.relative}`);
    if (apply) {
      try { await rm(target, { recursive: true, force: false, maxRetries: 2 }); }
      catch (error) { failed.push({ path: candidate.relative, error: error.code ?? error.message }); continue; }
    }
    selected.push({ path: candidate.relative, bytes: details.bytes });
  }
  return { apply, days, bytes: selected.reduce((sum, entry) => sum + entry.bytes, 0), selected, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== "--apply" && !/^--days=\d+(?:\.\d+)?$/.test(arg))) {
    throw new Error("Usage: npm run clean:workspace -- [--apply] [--days=7]");
  }
  const days = Number(args.find(arg => arg.startsWith("--days="))?.slice(7) ?? 7);
  const result = await cleanWorkspace(fileURLToPath(new URL("..", import.meta.url)), { days, apply: args.includes("--apply") });
  const groups = {};
  for (const entry of result.selected) {
    const group = entry.path.split(path.sep)[0];
    groups[group] ??= { entries: 0, bytes: 0 };
    groups[group].entries += 1;
    groups[group].bytes += entry.bytes;
  }
  console.log(JSON.stringify({ mode: result.apply ? "removed" : "dry-run", days, entries: result.selected.length, bytes: result.bytes, groups, failed: result.failed }, null, 2));
  if (!result.apply) console.log("Preview only. Add --apply to remove these generated files after stopping tests and builds.");
  if (result.failed.length) process.exitCode = 1;
}
