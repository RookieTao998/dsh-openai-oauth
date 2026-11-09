# Auto-review request compatibility — 0.4.2

## Report and evidence

The user confirmed that Codex inference and tool execution work in Windows DSH Desktop `0.2.2-rc.1` with the Workspace modification preset, but Auto review fails before tool bodies run. The reported error is `auto-review: reviewer ended with error CODEX_ERROR: OpenAI Codex request failed.`

At the exact Harness commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`, [auto-review/src/index.ts, lines 682–692](https://github.com/deepseek-ai/deepseek-harness/blob/66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db/packages/experimental/auto-review/src/index.ts#L682-L692) sends a separate reviewer request with the active provider/model, policy system prompt, user-role text messages, `temperature: 0`, session ID, purpose and signal. It supplies no tools, reasoning effort, maxTokens or stop option. The error is produced before decision JSON parsing and tool execution.

Plugin `0.4.1` forwarded temperature through both its adapter and its Codex request body. [OpenAI Docs: Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations) requires omitting temperature for ChatGPT plan usage. That page describes the newer `api.openai.com/v1` route, rather than directly documenting this plugin's legacy `chatgpt.com/backend-api/codex/responses` endpoint. This is supporting contract evidence; no live upstream error body was inspected, so temperature has not been proven to be the sole cause of the user's failure.

## Change

Remove temperature from the plugin's internal stream options, adapter forwarding and request serialization. Harness may still supply the option; it is omitted on this Codex route for every purpose, including Auto review. Codex controls sampling, so a Harness temperature setting does not guarantee deterministic generation here.

No Harness source or review policy was changed. Allow and deny decisions remain model output handled by Harness; no default approval, fallback reviewer or review bypass was added. Credential persistence, OAuth parameters and tool execution rules are unchanged.

## Verification

`checks/codex-requests.mjs` drives the public runtime's real adapter and transport with a captured synthetic fetch and an in-memory synthetic credential reader. It never reads installed credentials or makes network requests. The strict endpoint fixture returns HTTP 400 when temperature is present and complete SSE text otherwise.

- Before the fix, both new tests failed against the built `0.4.1` code with the reported `CODEX_ERROR` when temperature reached the fixture.
- After the fix, reviewer-shaped requests with fixed temperature 0 complete, preserve the system prompt, input and session, and preserve both allow and deny JSON decisions.
- Ordinary tool declarations, reasoning settings, streamed tool calls, call identifiers and subsequent function outputs round trip. A nonzero Harness temperature is omitted as well.

| Check | Result |
| --- | --- |
| TypeScript typecheck and all tsdown build targets | Passed, local Node `26.12.1` |
| New adapter/transport contract tests | 2 passed |
| Full suite in installed Desktop's Node `24.21.0`, hidden Electron RunAsNode, waited for exit | 34 tests: 33 passed, 1 POSIX-only skipped, 0 failed |
| Focused independent review of source, fixtures and generated library | No specific defects found |
| Archive contents | 15 files; package `0.4.2`; no credentials or test state |
| Packed archive in isolated published Harness `0.2.2-rc.1` | Passed: registration, configuration, served client module, authenticated RPC, Web status, CLI help and removal |

The initial restricted-sandbox full run encountered filesystem `EPERM` and loopback `EACCES`; the complete suite passed outside that restriction without changing product code. The Desktop executable was used only as a Node test runner, not to open or restart the application. Tests used temporary state only.

The local pnpm launcher attempted to resolve its pinned version through an unavailable registry connection. Packaging used `npm pack --ignore-scripts --pack-destination artifacts` after the successful build. Dependencies and their lockfile are unchanged.

## Manual handoff and remaining acceptance

Archive: `artifacts/dsh-openai-oauth-0.4.2.tgz`, 62,101 bytes.

SHA-256: `63b6b97e7e3186fa69b9044ada0aeeb3ef2cea57c15ce2ec45290d2403a764cb`.

In Desktop's plugin manager, add `E:/workspeace/dsh-openai-oauth/artifacts/dsh-openai-oauth-0.4.2.tgz` without surrounding quotes. Fully quit Desktop through the tray and reopen it, confirm plugin version `0.4.2`, then retry a harmless tool request in Auto mode. The user requested manual replacement; this task did not install into the user's profile or restart their DSH.

The offline tests begin at `adapter.stream`, not the complete Harness `ctx.llm.stream` / decision parser / pre-execution gate. Real Auto review with the user's account remains pending. The earlier browser-login HTTP 400 remains a separate unresolved issue; this package does not change that login flow.
