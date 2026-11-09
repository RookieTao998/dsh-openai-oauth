# Windows DSH Desktop plugin support

Status: implemented and automatically verified on Windows on 2026-11-09; real Desktop/OAuth acceptance remains pending.

## Goal

Make this standalone plugin usable inside Windows DSH Desktop `0.2.2-rc.1`, including its settings page, Browser PKCE and Device Code login, persistent refreshable credentials, model discovery/inference, and Codex native search. Keep the existing macOS/Linux and local Web/headless behavior. Deliver a normal plugin package, not a new desktop application.

## Boundaries

- Change only this plugin. Do not patch Harness, another plugin, another profile, or existing user credentials.
- Pin the tested Harness package contract to `0.2.2-rc.1`; do not assume older or later preview versions are compatible.
- Never expose credentials in the renderer, logs, error responses, command arguments, or tests. Tests use synthetic fixtures only.
- Do not start/stop/restart a user's running DSH instance. The user completes real ChatGPT authentication.

## Design

### Host and client

Reuse `AuthController` and the provider runtime. Add an authenticated private Connection-compatible RPC channel `/openai-oauth` with `status`, `start`, `cancel`, and `logout` endpoints. Require the owner principal, exact input shapes, bounded payloads, and fixed redacted errors. Dispose registrations with the plugin. Use the public client Connection service rather than relative `fetch` in the settings page. Preserve the existing local Web HTTP route and its trust checks.

The target's public `connection.rpc.handle()` fails at runtime: its provider accesses `webServer` without the injection declaration Cordis 4.1 requires. A real published-host smoke reproduced private RPC 405 with the existing plugin HTTP route still 200, and an independent in-memory test using the published `HostConnectionService` reproduced the injection error. For this exact version, register the private route through public `webServer.register`, authenticate through public `connection.admit`, and bridge the bounded Connection request/response envelope. This preserves the client API and security checks without modifying Harness. Revisit this compatibility adapter when upgrading to a host version whose registry is fixed.

Keep `dsh.client.platform: web`: Desktop loads Web client modules. Open validated OpenAI HTTPS authorization URLs directly through `window.open`/external links; Desktop forwards those to the system browser. Do not pre-open `about:blank` in Desktop. Retain an actionable link when popup opening is blocked.

### Credential storage

On POSIX, retain mode-based owner-only permissions. On Windows, use Windows filesystem ACLs to restrict the plugin-owned directory and credential files, including temporary files, before writing secret bytes. Validate permissions before reading, reject links/non-files and unsafe ACLs, fail closed with redacted diagnostics, and retain process-visible locking and atomic replacement. Do not change shared Harness directories' ACLs. Resolve Windows users by SID, not localized account names. Do not silently accept a filesystem that cannot enforce the protection.

### Packaging and installation

Update exact DSH dependencies, declarations, lockfile and generated library together. Package only the existing runtime whitelist plus any necessary runtime asset. Install Desktop plugins through the Desktop-provided `dsh` into `--profile desktop`, or its Plugins UI. Ordinary npm-installed DSH must not manage Desktop-owned state. Installation/reload is a separate user handoff; no running instance is restarted automatically.

## Acceptance

1. Typecheck, build, package and production dependency audit pass with the new exact host versions.
2. Automated tests cover credential create/read/replace/delete, unsafe permission rejection, concurrent updates, path safety, and RPC authorization/validation/error redaction. Windows checks exercise real ACLs, not mocked POSIX bits.
3. Linux checks retain POSIX behavior. Windows CI runs the package checks and isolated host smoke without live credentials.
4. Packed plugin registration, settings module and unauthenticated status can be exercised with an isolated published Harness host. Desktop manual acceptance covers browser/device login, cancellation, relaunch persistence, refresh, model inference and search.
5. State clearly which real Desktop/OAuth checks remain unperformed; compilation and mock-provider tests do not establish live account acceptance.

## Evidence

The supplied Windows report and local source baseline are commit `63c6b65dedd734406276cb79712e2b4fd056727b`. Desktop source was inspected at upstream tag `dsh-v0.2.2-rc.1`, commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`:

- `packages/client/connection/src/rpc.ts` and `rpc-host.ts`: public carrier-neutral RPC registration/calling and authentication.
- `apps/desktop/src/main.ts` and `web-document.ts`: `dsh-app://app`, authenticated Host forwarding, system-browser handling.
- `packages/client/modules/src/index.ts`: client modules continue to declare platform `web`.
- `apps/desktop/README.md#bundled-command-runtime`: Desktop owns its command runtime and `desktop` profile.
