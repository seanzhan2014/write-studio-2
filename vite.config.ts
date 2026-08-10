import vinext from "vinext";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@mantine/core", "@mantine/hooks"],
  },
  server: {
    // Writer Studio and its manager have fixed roles on 3002 and 3003.
    // Never let Vite silently move the application onto the manager port.
    strictPort: true,
    ...(isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : {}),
  },
  plugins: [vinext()],
});
