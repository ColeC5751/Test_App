---
name: Codegen + Metro crash
description: Why Metro crashes after codegen runs and how to fix it
---

## Rule
After running `pnpm --filter @workspace/api-spec run codegen`, always restart the `artifacts/recipe-roulette: expo` workflow before assuming the app is healthy.

**Why:** Orval's codegen deletes the output folder (`lib/api-client-react/src/generated/`) before regenerating it. If a git checkpoint is created or Metro is watching during the brief window when the files are deleted, Metro caches an "Unable to resolve" error for `./generated/api`. The next bundle request then crashes the app even though the files exist on disk.

**How to apply:** After any codegen run, immediately restart the Expo workflow. If the app crashes with "Unable to resolve ./generated/api", re-run codegen and restart Expo — do not chase the error in the source files.
