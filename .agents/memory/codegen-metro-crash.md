---
name: Codegen + Metro crash
description: Why Metro crashes after codegen runs and how to prevent/fix it
---

## Permanent fix (already applied)
`lib/api-spec/orval.config.ts` has `clean: false` on both outputs. Orval overwrites files in place rather than deleting them first, so Metro never sees the generated folder disappear.

## Rule
Do NOT change `clean` back to `true` in orval.config.ts. If it is ever set back to true, the Metro crash below will recur.

**Why:** With `clean: true`, Orval deletes `lib/api-client-react/src/generated/` before regenerating it. Metro watches the filesystem and caches the "Unable to resolve ./generated/api" error during the brief deletion window. The cached error persists even after the files come back, crashing the app.

**How to apply:** After any schema change, just run codegen and restart the Expo workflow — no cache clearing needed as long as `clean: false` stays in place.

## Recovery if the crash does recur
1. Re-run `pnpm --filter @workspace/api-spec run codegen` to restore the files.
2. `rm -rf /tmp/metro-*` to clear Metro's transform cache.
3. Restart the `artifacts/recipe-roulette: expo` workflow.
