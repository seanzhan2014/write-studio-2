import vinext from "vinext";
import { defineConfig } from "vite";
import hostingConfig from "./.openai/hosting.json";
import { sites } from "./build/sites-vite-plugin";

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";
const { d1, r2 } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async ({ command }) => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const cloudflarePlugin = command === "build"
    ? (await import("@cloudflare/vite-plugin")).cloudflare({
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        config: {
          main: "./worker/index.ts",
          compatibility_flags: ["nodejs_compat"],
          d1_databases: d1 ? [{ binding: d1, database_name: "writer-studio-d1", database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID }] : [],
          r2_buckets: r2 ? [{ binding: r2, bucket_name: "writer-studio-r2" }] : [],
        },
      })
    : null;

  return {
    environments: {
      client: {
        build: {
          // Keep a stable cache namespace while ensuring browsers never reuse
          // the broken pre-fix asset URLs served by Vinext on Windows.
          rolldownOptions: {
            output: {
              entryFileNames: "assets/[name]-static-v2-[hash].js",
              chunkFileNames: "assets/[name]-static-v2-[hash].js",
              assetFileNames: "assets/[name]-static-v2-[hash][extname]",
            },
          },
        },
      },
    },
    optimizeDeps: {
      exclude: ["@mantine/core", "@mantine/hooks"],
    },
    server: {
      // Writer Studio and its manager have fixed roles on 3002 and 3003.
      // Never let Vite silently move the application onto the manager port.
      strictPort: true,
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
    },
    plugins: [
      vinext(),
      sites(),
      cloudflarePlugin,
    ],
  };
});
