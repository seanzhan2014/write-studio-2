import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";

// Node preserves variables already supplied by the shell or parent process.
loadEnvFile(fileURLToPath(new URL("../writer-studio.env", import.meta.url)));
