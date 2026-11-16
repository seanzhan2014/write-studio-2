# Repository instructions

- After every code or content change, publish the resulting version to the OpenAI Site configured in `.openai/hosting.json`.
- Treat publishing as part of the change: run the relevant build checks, deploy, and verify the production deployment before finishing.
- Skip cloud publishing only when the user explicitly requests local-only work or asks not to deploy.
- If publishing cannot complete, preserve the local changes and clearly report the blocker.
- The user's phone accesses the local production service at `http://100.116.48.68:3002`, managed by `http://127.0.0.1:3003`. Cloud publication alone does not complete a change. Deployment targets are declared in `.openai/deployment.json`.
- After Site publication commits/pushes the verified source, run `npm run deploy:local -- --commit <exact published commit SHA>` from that clean checkout. This must safely fast-forward the main checkout, rebuild/restart through 3003, and verify the build fingerprint served by the actual phone address. Then run `npm run verify:local -- --commit <same SHA>`. Do not report completion unless both the Site deployment and local verification succeed.
- Never assume 3003 synchronizes worktrees or pulls cloud source. Never use reset/force checkout to synchronize, overwrite uncommitted work, or seed test data into production. If synchronization or either target fails, preserve changes and report the specific incomplete target.
- For phone UI changes, verify the requested behavior on the configured 3002 address at a phone viewport. Tests against a temporary server or the cloud Site do not establish that the phone's service was updated. An open port or HTTP 200 alone is not a version check.
- Skip a configured target only when the user explicitly excludes it (for example, cloud-only or local-only work).
- Keep all current and future pages, dialogs, and settings free of standalone text that merely introduces or explains a feature. Do not add feature introductions, section descriptions, or redundant helper copy, and do not restore copy removed for this reason.
- Retain control labels, user content, meaningful status and empty-state messages, validation errors, and instructions or warnings necessary to complete an operation correctly. Before finishing any UI change, review its copy and remove nonessential feature explanations.
