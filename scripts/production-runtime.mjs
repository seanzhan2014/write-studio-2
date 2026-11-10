import { access, cp, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

// Vinext imports route chunks lazily. A running server must retain the complete
// build it started with even when another build replaces the workspace's dist.
export async function prepareProductionRuntime(workspace) {
  const root = path.resolve(workspace);
  const source = path.join(root, "dist");
  await access(path.join(source, "server", "index.js"));
  const directory = await mkdtemp(path.join(root, ".writer-studio-runtime-"));
  const outDir = path.join(directory, "dist");
  const cleanup = () => {
    if (path.dirname(directory) !== root) throw new Error("Unsafe production runtime directory");
    return rm(directory, { recursive: true, force: true });
  };
  try {
    await cp(source, outDir, { recursive: true });
    return { outDir, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
