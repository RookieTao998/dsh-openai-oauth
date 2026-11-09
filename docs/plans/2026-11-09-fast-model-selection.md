# Fast Model Selection Implementation Plan

> **执行方式：** 当前 DSH 会话内逐步实施；用户已批准设计及实施。使用本环境提供的文件和测试工具，不依赖未提供的 ZCode 工具。

**Goal:** Resolve known models and reasoning efforts without credential I/O or network confirmation.

**Architecture:** Reuse `CodexModels.catalog` in `getModel`. Keep `getModels` as authenticated discovery and keep `streamSimple`/native search credential validation intact.

**Tech Stack:** TypeScript, Node built-in test/assert, existing pnpm build.

## Global Constraints

- No new dependency, background polling, TTL, or persistent catalog.
- Do not change DSH source, installed profiles, credentials, or running processes.
- Preserve Windows permission checks and actual generation token refresh.
- Preserve unrelated uncommitted changes; no implementation commit containing pre-existing edits.

---

### Task 1: Cached metadata resolution and regression coverage

**Files:**
- Create `checks/model-selection.mjs`: offline public-runtime regression checks.
- Modify `src/codex-models.ts`: only `getModel` and its comment.
- Modify `package.json`: include new check in existing test command.
- Modify `README.md` and `README.zh.md`: document selection cache/refresh boundary.
- Regenerate existing `lib` artifacts with the standard build.

**Interfaces:**
- Consumes `createPluginRuntime().models`, `.adapter`, and injectable `credentials.read/modify` with synthetic credentials; stub transport before runtime creation.
- Produces unchanged `getModel(provider: string, id: string): Promise<Model | undefined>` and unchanged adapter metadata.

- [x] Build baseline with `pnpm run build`; add offline fixture returning two visible models and one hidden model. Instrument credential reads, catalog fetches, generation requests, and token refresh. Never access real credential files.
- [x] Reproduce with `node --test checks/model-selection.mjs`. After `adapter.listModels(provider)`, reset counters and run repeated `adapter.resolveModel(provider, model)`. Assert `reads === 0` and `catalogRequests === 0`; baseline must fail on nonzero reads. Also set the stub credential reader to throw to demonstrate that warm selection must not depend on storage availability.
- [x] Replace metadata resolution with:

```ts
  /** Resolve advisory metadata from memory; authentication happens when sending requests. */
  async getModel(provider: string, id: string): Promise<Model | undefined> {
    if (provider !== OPENAI_CODEX_PROVIDER) return undefined
    if (this.catalog === undefined) await this.getModels(provider)
    return this.catalog?.find(model => model.id === id)
  }
```

- [x] Cover cold/concurrent discovery, hidden/unknown IDs and wrong providers, explicit capability replacement, signed-out catalog clearing, stale metadata followed by signed-out generation refusal, expired token refresh on generation, and upstream generation rejection. All transports remain synthetic and assert exact request counts and failure codes.
- [x] Append `checks/model-selection.mjs` to the `test` script; preserve all other package fields and tests.
- [x] Document: known model/effort selection uses memory; initial discovery and explicit catalog refresh contact OpenAI; cached metadata is advisory and actual sending still authenticates.
- [x] Run `pnpm run check` and `pnpm test`. Inspect `git diff` and ensure unrelated changes are preserved. Do not install or restart Desktop.
- [x] Record red/green counts, build/typecheck results, and real Desktop validation limitations in `docs/verification/2026-11-09-fast-model-selection.md`.

### Read-only parallel audit

A separate agent inspects packaged DSH throughput formulas and, if safely identifiable, this session's statistics. Keep audit conclusions separate from changes to the plugin. Do not claim a measured live throughput without session-specific evidence.
