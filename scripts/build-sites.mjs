import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

// Local production and Sites use different entry points in vite.config.ts.
const child = spawn(process.execPath, [fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url)), "build"], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, WRITER_STUDIO_BUILD_TARGET: "sites" },
  stdio: "inherit",
});
const [code] = await once(child, "exit");
process.exitCode = code ?? 1;
