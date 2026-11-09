# Windows Desktop Plugin Implementation Plan

> **执行方式：** 在当前 checkout 的 `codex/windows-desktop-support` 分支实施；按用户要求并行派发互不修改同一文件的任务，主代理统一集成和验证。用户已确认完整方案，无需逐项再次审批。

**Goal:** Support the existing plugin inside Windows DSH Desktop `0.2.2-rc.1`.

**Architecture:** Keep the existing OAuth state machine and provider. Add owner-authorized Connection RPC for the Desktop renderer, real Windows ACL protection for the existing credential envelope, and exact-version host packaging.

**Tech Stack:** TypeScript, Node.js, React, Cordis, DSH public Connection API, Windows PowerShell ACL APIs, Node test runner.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-11-09-windows-desktop-design.md`.
- Harness `0.2.2-rc.1`; Node `^22.19.0 || >=24.0.0`; existing pnpm pin.
- No Harness source changes, live credentials, user-profile mutations, or DSH restart.
- Keep client `platform: web`; private RPC channel `/openai-oauth`; require `peer.principal.kind === 'owner'`.
- No new third-party runtime dependency for ACLs or tests. Preserve POSIX behavior and existing Web checks.
- Tests must run on synthetic fixtures and isolated temporary directories. Do not log credential payloads or identities.

## Task 1: Windows credential protection

**Files:** `src/credential-store.ts`, new `src/credential-access.ts` if needed, `checks/credential-store.mjs`.

**Consumes:** Existing `SecureCredentialStore(dshHome)` and `OAuthCredential` envelope.

**Produces:** Same store interface, enforcing platform-native access controls before secret writes and reads.

- [x] Add a real-filesystem regression test using `node:test`; create a store in a temporary path with spaces and Unicode, write a synthetic OAuth fixture, read it back, replace it and delete it. Run against the baseline to observe the Windows permission rejection.
- [x] Add secure ACL creation/verification using current-user SID and fixed PowerShell code with data supplied outside shell source. Protect temporary files before content, preserve locking/rename, and reject unsafe paths and unsafe existing file ACLs. Keep shared Harness parent ACLs unchanged.
- [x] Add failure tests for permissive ACLs/modes, symlinks/junctions, malformed envelopes and concurrent modifications. Run the focused checks.

## Task 2: Desktop authorization transport

**Files:** new `src/oauth-rpc.ts`, `src/index.ts`, `src/client/index.tsx`, optional focused client helper, `checks/oauth-rpc.mjs`.

**Consumes:** Existing `AuthController`, public `webServer.register` and `connection.admit`, and the public client `connection.rpc.call`.

**Produces:** `/openai-oauth` endpoints `status/start/cancel/logout`, same redacted `AuthStatus`, and an operational settings page using the shared Connection service.

- [x] Add failing behavioral tests for non-owner access, unknown endpoint, malformed input, valid state transitions, and redacted storage failures. Use the real controller with synthetic provider/store boundaries.
- [x] Register a disposable private RPC handler and verify owner before any controller call; use exact per-endpoint schemas and bounded input. Preserve the old Web HTTP route and local Host assertion.
- [x] Pass the public Connection caller into the settings section, replacing raw `fetch`. Open a validated HTTPS login URL directly and keep manual continuation links. Retain the existing controller and user-selected login method.
- [x] Run focused tests and host/client typecheck against the target package versions.

## Task 3: Version integration, checks, and CI

**Files:** `package.json`, `pnpm-lock.yaml`, `.github/workflows/verify.yml`, `.github/workflows/published-harness-smoke.yml`, `checks/` shared runner/host smoke as required, generated `lib/`.

- [x] Upgrade all exact DSH pins to `0.2.2-rc.1` and declare the Connection peer/dev contract. Refresh the lockfile with the existing pnpm version. Resolve actual TypeScript/API changes without widening the compatibility range.
- [x] Run the Node checks after building, using explicit `checks/*.mjs` files so the current ignored test directory patterns cannot hide them.
- [x] Add Windows and Linux CI checks; replace Unix-only smoke assumptions with a cross-platform runner or a Windows-specific equivalent. Exercise packed artifact registration, settings asset loading, unauthenticated status, CLI help and removal in an isolated DSH home.
- [x] Run typecheck/build, focused/full checks, production audit and `pnpm pack`; inspect archive contents and independently review security/integration changes.

## Task 4: Installation and acceptance handoff

**Files:** `README.md`, `README.zh.md`, `SECURITY.md`, `AGENTS.md`, this plan and design status.

- [x] Document the exact supported host version, Windows protection, Desktop-owned command/profile and restart/login handoff. Preserve explicit Web/headless instructions with their corresponding profiles.
- [x] Record automated verification results, package path and remaining live Desktop/OAuth checks. Do not claim real account login, refresh or inference without observing them.

## Progress and decisions

- 2026-11-09: User approved the complete Windows Desktop plugin scope, targeting DSH Desktop `0.2.2-rc.1`.
- Current checkout was clean at `63c6b65`; reuse it on a dedicated branch as required by the app's workspace preference.
- Public custom RPC channels are forwarded by Desktop; do not occupy the shared `/api` interceptor slot.
- User approval covers the matching written spec and implementation plan; no second approval loop is needed.
- Implementation: credential protection, private RPC, client browser flow, exact host pins, Windows/Linux CI and Desktop-owned installation docs are implemented.
- Local evidence: Node 26.12.1; target typecheck/build/pack and production audit passed. Windows checks: 21 passed, 1 POSIX-only skipped, 0 failed; real ACL/link/concurrency checks included.
- Review: no important runtime/security defects; fixed CI native-command exit masking and replaced on-disk client banner check with authenticated Host graph/resource checks.
- Published-host smoke reached authenticated launch but private RPC stayed 405 across 30 probes while the old route returned 200. Independent published-service reproduction confirmed an upstream Cordis injection defect in `rpc.handle`, rather than a readiness race.
- Compatibility fix in progress: public `webServer.register` + public `connection.admit`, preserving bounded Connection envelopes, the client caller, owner checks, and no Harness changes. Remove this adapter only after verifying a later host registry implementation.
- Real Desktop/OAuth remains a manual acceptance boundary.
- Final verification: 27 checks, 26 passed, 1 POSIX-only skipped, 0 failed on Windows. Published Harness `0.2.2-rc.1` packed-artifact smoke passed registration, composition, real client discovery/resource serving, authenticated private RPC, anonymous rejection, legacy status, Web/headless CLI help and removal. Independent scoped re-review passed.
- Existing oversized chunked-body parsing may close the connection rather than return structured 413. It still rejects the body; this pre-existing HTTP behavior was not expanded in the Windows adaptation. Content-Length limits and safe rejection are covered. No credential disclosure is involved.
