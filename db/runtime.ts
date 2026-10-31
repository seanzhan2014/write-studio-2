// Register startup without opening a database when build tools import this module.
import { startGenerateReviewRunner } from "./generate-runner";
import { registerDatabaseReadyListener } from "./schema-runtime";

registerDatabaseReadyListener(startGenerateReviewRunner);

export * from "./studio-state";
