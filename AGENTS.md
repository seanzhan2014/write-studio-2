# Repository instructions

- After every code or content change, publish the resulting version to the OpenAI Site configured in `.openai/hosting.json`.
- Treat publishing as part of the change: run the relevant build checks, deploy, and verify the production deployment before finishing.
- Skip cloud publishing only when the user explicitly requests local-only work or asks not to deploy.
- If publishing cannot complete, preserve the local changes and clearly report the blocker.
