# Fast model selection verification — 2026-11-09

## Change

`CodexModels.getModel` resolves known metadata directly from the existing in-memory catalog; an empty cache still calls the unchanged authenticated discovery path. The cache no longer stores the unused credential identity. Explicit `getModels` remains a fresh discovery operation. Chat and native search still authenticate through `credential()` at request time. No Windows credential permission checks were removed.

The user approved the design and the explicit limitation that old metadata may remain resolvable after logout until catalog refresh/restart. It cannot authorize generation.

## Red/green evidence

All credentials and transport responses are synthetic. Tests replace persistence before first use and capture a stub fetch at runtime construction. They do not read installed credentials or call OpenAI.

1. `pnpm run build` — baseline build passed.
2. `node --test checks/model-selection.mjs` before the fix — 4 passed, 3 failed. Six known-model resolutions caused 12 credential reads rather than zero. Warm resolution also failed when the synthetic credential store threw. The third failure captured the newly approved stale-metadata behavior after logout.
3. `pnpm run check` after the fix — typecheck and build passed.
4. `node --test checks/model-selection.mjs` after the fix — 7 passed, 0 failed. Known selection performed zero additional credential reads, catalog HTTP requests, token refreshes, or generation requests.
5. `pnpm test` — 41 tests: 40 passed, 0 failed, 1 POSIX-only test skipped on Windows. Includes Windows owner-only storage checks, cross-process locking, OAuth and private RPC checks, existing generation request contracts, and all new selection checks. Duration approximately 46.8 seconds.
6. `git diff --check` — passed. The workspace contained pre-existing uncommitted changes; those were preserved and are not claimed as part of this implementation.

Regression coverage includes cold/concurrent discovery, hidden historical models, invalid providers and unknown IDs, explicit catalog replacement across synthetic accounts, logout/catalog clearing, signed-out request refusal despite cached metadata, deferred token refresh during generation, upstream error propagation without retry/fallback, and unchanged output/reasoning usage mapping.

## Limits

No real OAuth login, live model request, Desktop UI click timing, package installation, or Desktop restart was performed. The installed application does not automatically load this checkout's built plugin. The test proves elimination of the repeated I/O path, not a measured end-to-end GUI latency improvement.

## Independent verification

Independent verifier verdict: PASS, high confidence, no blockers. It freshly ran all 7 selection tests and TypeScript checking. Additional fully synthetic public `CodexSearchProvider` assertions verified signed-out search rejects with zero remote requests, expired-token search performs one refresh plus one search, and explicit discovery still refreshes expired tokens and fetches a replacement catalog. It did not modify files, access installed credentials, call OpenAI, rerun the build, or repeat the full test suite.
