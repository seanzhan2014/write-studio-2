import path from "node:path";

// A separate SQLite database protects the normal app even if a user visits its
// other routes on this preview server. The interactive demo uses its own browser
// storage and never starts real AI tasks or sends model requests.
process.env.WRITER_STUDIO_PORT = "3003";
process.env.WRITER_STUDIO_HOST = "0.0.0.0";
process.env.WRITER_STUDIO_DB_PATH = path.resolve(".test-data/task-interaction-preview.sqlite");
process.env.WRITER_STUDIO_TEST_MODE = "1";
process.env.WRITER_STUDIO_RUNTIME_MODE = "development";

await import("./dev-server.mjs");
