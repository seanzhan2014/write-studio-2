import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { readFile, lstat, readlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);

export async function git(workspace, args) {
  const { stdout } = await execFile("git", args, { cwd: workspace, windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trimEnd();
}

// Git commits happen after the Site helper builds. Hash the actual source files
// so both that archive and a subsequent local checkout identify the same code.
export async function sourceIdentity(workspace) {
  const files = [...new Set((await git(workspace, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"])).split("\0").filter(Boolean))].sort();
  const hash = createHash("sha256");
  for (const name of files) {
    const filename = path.join(workspace, name);
    let bytes;
    try {
      const details = await lstat(filename);
      bytes = details.isSymbolicLink() ? Buffer.from(await readlink(filename)) : await readFile(filename);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    // A Windows main checkout may use CRLF while its worktree uses LF.
    if (!bytes.includes(0)) {
      try { bytes = Buffer.from(new TextDecoder("utf-8", { fatal: true }).decode(bytes).replaceAll("\r\n", "\n")); }
      catch { /* Binary assets retain their original bytes. */ }
    }
    hash.update(name).update("\0").update(String(bytes.length)).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}
