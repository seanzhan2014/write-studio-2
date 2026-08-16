import path from "node:path";

const workspace = process.cwd();
const testDataDirectory = path.resolve(workspace, ".test-data");
const configuredDatabase = process.env.WRITER_STUDIO_DB_PATH?.trim()
  || path.join(testDataDirectory, "dev-test.sqlite");
const resolvedDatabase = path.resolve(workspace, configuredDatabase);
const relativeDatabase = path.relative(testDataDirectory, resolvedDatabase);

if (!relativeDatabase || relativeDatabase.startsWith("..") || path.isAbsolute(relativeDatabase)) {
  throw new Error(`Refusing to start a test server outside .test-data: ${resolvedDatabase}`);
}

process.env.WRITER_STUDIO_PORT ||= "3102";
process.env.WRITER_STUDIO_HOST ||= "127.0.0.1";
process.env.WRITER_STUDIO_DB_PATH = resolvedDatabase;
process.env.WRITER_STUDIO_TEST_MODE = "1";

await import("./dev-server.mjs");
