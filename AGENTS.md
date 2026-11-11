# Repository instructions

- After every code or content change, publish the resulting version to the OpenAI Site configured in `.openai/hosting.json`.
- Treat publishing as part of the change: run the relevant build checks, deploy, and verify the production deployment before finishing.
- Skip cloud publishing only when the user explicitly requests local-only work or asks not to deploy.
- If publishing cannot complete, preserve the local changes and clearly report the blocker.
- Keep all current and future pages, dialogs, and settings free of standalone text that merely introduces or explains a feature. Do not add feature introductions, section descriptions, or redundant helper copy, and do not restore copy removed for this reason.
- Retain control labels, user content, meaningful status and empty-state messages, validation errors, and instructions or warnings necessary to complete an operation correctly. Before finishing any UI change, review its copy and remove nonessential feature explanations.
