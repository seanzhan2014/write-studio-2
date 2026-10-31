import { readFile } from "node:fs/promises";
import ts from "typescript";

// Structural guards inspect a feature across its modules, independently of file size.
const features = {
  "app/WriterStudioApp.tsx": ["app/ui/studio/types.ts", "app/ui/studio/shared.tsx", "app/WriterStudioApp.tsx", ...["navigation", "naming", "workspace", "writing", "generation", "chat", "continuous", "search", "settings", "versions", "tasks", "article-dialogs"].map(name => `app/ui/studio/${name}.tsx`)],
  "app/studio-state.tsx": ["lib/studio-types.ts", "lib/studio-settings.ts", "lib/studio-entities.ts", "app/studio-demo-data.ts", "app/studio-context.ts", "app/studio-device-state.ts", "lib/studio-normalization.ts", "app/studio-state.tsx", "app/studio-actions.ts"],
  "db/runtime.ts": ["db/runtime.ts", "db/studio-state.ts", "db/schema-runtime.ts", "db/sql-helpers.ts", "lib/task-record.ts", "db/studio-serialization.ts"],
  "db/ai.ts": ["db/ai-models.ts", "db/ai-errors.ts", "db/ai-transport.ts", "db/ai-images.ts", "db/ai-prompts.ts", "db/ai.ts", "db/ai-naming.ts", "db/ai-review.ts", "db/ai-local.ts", "db/ai-chat.ts"],
  "app/api/ai/tasks/[taskId]/execute/route.ts": ["app/api/ai/tasks/[taskId]/execute/route.ts", "db/generate-task.ts"],
  "scripts/run-tests.mjs": ["scripts/run-tests.mjs", "scripts/test-server.mjs"],
  "scripts/run-ui-tests.mjs": ["scripts/run-ui-tests.mjs", "scripts/test-server.mjs"],
};

export async function readFeatureSource(path) {
  return (await Promise.all((features[path] ?? [path]).map(file => readFile(new URL(`../${file}`, import.meta.url), "utf8")))).join("\n\n");
}

export async function readFeatureFunction(path, name) {
  const source = await readFeatureSource(path);
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, path.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  return ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)?.getText(ast) ?? "";
}
