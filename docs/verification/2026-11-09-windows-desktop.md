# Windows Desktop plugin verification

Date: 2026-11-09. Plugin: `0.4.0`. Target: Windows DSH Desktop / published Harness `0.2.2-rc.1`. Source baseline: `63c6b65dedd734406276cb79712e2b4fd056727b`.

## Verified locally

Environment: Windows x64, NTFS, Node.js `26.12.1`, pnpm `11.1.3`. Target development dependencies include Cordis `4.1.0`, Schemastery `3.19.0`, and exact DSH `0.2.2-rc.1` packages.

| Check | Result |
| --- | --- |
| TypeScript typecheck | Passed |
| All three tsdown build targets | Passed |
| Node test suite | 27 checks: 26 passed, 1 POSIX-only check skipped, 0 failed |
| Real Windows ACL creation/read/replace/delete and parent ACL preservation | Passed |
| Concurrent modifications, malformed state, permissive ACLs, hard links and junction rejection | Passed |
| RPC owner guards, schemas, redaction and real HTTP boundary using published Connection admission | Passed |
| Synthetic Browser PKCE, Device Code pending/slow-down, refresh | Passed; no real account used |
| Production dependency audit | No known vulnerabilities found |
| `pnpm pack --pack-destination artifacts` | Passed; runtime whitelist inspected |
| Isolated published-Harness packed-artifact smoke | Passed |
| Independent security/integration review and scoped re-review | Passed after validation fixes |

The packed-artifact smoke installed the public Harness into a new temporary directory, added the local archive through the plugin manager, confirmed one composed plugin and its search provider, booted an owned loopback test instance, exchanged its launch credential without displaying it, and checked:

- the authenticated client graph discovers this module once with its declared dependencies;
- the exact revision URL serves the real client JavaScript;
- private RPC returns a disconnected state to the authenticated owner and refuses anonymous requests;
- the legacy local HTTP status route retains `no-store`;
- Web and headless login command help and plugin removal work.

The smoke stopped only its own test instance and removed only its checked `mkdtemp` child. It did not use an existing user profile or real OAuth credentials. Local tests needing NTFS links and loopback sockets ran outside the restricted tool sandbox, using only synthetic data and owned temporary paths.

## Target-version compatibility finding

The first packed-host regression correctly failed: `/openai-oauth/status` stayed HTTP 405 across 30 probes while the existing plugin HTTP route was HTTP 200. The published `connection.rpc.handle()` implementation accesses `webServer` through a provider context without the injection declaration required by Cordis 4.1. An independent in-memory reproduction using the actual published `HostConnectionService` confirmed this failure.

The plugin now uses public `webServer.register` plus public `connection.admit` to carry the same bounded Connection envelope. Owner checks occur before body parsing. Client code still calls the public Connection service. No Harness source or trust policy was patched. This workaround is specific to the pinned host; review it when upgrading.

## Not established by these checks

- Real installed Windows Desktop UI rendering and actual system-browser launch.
- Real ChatGPT Browser/Device Code login, expiry/refresh, Desktop relaunch persistence, model inference and web search. The user completes these in **Settings → OpenAI OAuth** and the normal model selector.
- Local Linux/macOS execution, or the Node 22.19 / Node 24 CI matrix. CI is configured for Windows/Linux and those Node versions but has not been dispatched from this local branch.
- Publishing to npm/GitHub or installing into the user's existing Desktop profile.

The pre-existing HTTP JSON reader safely rejects oversized chunked bodies by closing the connection in some cases, rather than returning a structured 413. This behavior was not changed in this adaptation; declared-length limits, request validation and credential redaction are covered.

## Install this build

Build output: `artifacts/dsh-openai-oauth-0.4.0.tgz` (local archive; not published to npm).

SHA-256: `5376ece8c8f3fc674cdea1f388f491586b7c67999490c80f357735fabf6888b0`.

Use Desktop's **Manage dsh Command…** to install its command, verify `dsh --version` is `0.2.2-rc.1`, and quit Desktop from its tray menu. From the repository root:

```powershell
dsh plugin --profile desktop add .\artifacts\dsh-openai-oauth-0.4.0.tgz
dsh plugin --profile desktop list
```

Reopen Desktop, then complete login yourself in **Settings → OpenAI OAuth**. Do not use an ordinary npm-installed `dsh` to manage the Desktop-owned profile. See `README.zh.md` for the full handoff.
