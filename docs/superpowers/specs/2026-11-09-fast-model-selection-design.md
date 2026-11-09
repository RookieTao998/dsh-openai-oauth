# Fast model and reasoning selection

## Approved direction

Selecting a known model or reasoning effort uses already-discovered metadata, without re-reading credentials or making an OpenAI confirmation request. Actual generation continues to read and validate credentials and refresh expiring tokens. The user approved this direction on 2026-11-09.

## Scope and options

1. Recommended: make `CodexModels.getModel` reuse its existing catalog. Keep `getModels` as the explicit discovery/refresh path. This removes repeated credential checks from both selection and per-model catalog expansion without changing the host.
2. Add credential caching or weaken Windows permission checks. Rejected: changes a security boundary unnecessarily.
3. Replace the host selection UI or invent a static model catalog. Rejected: larger change and stale/unsupported capability risk.

## Behavior

- Cold metadata lookup performs the existing authenticated catalog discovery; concurrent discovery continues to share one remote fetch.
- Warm metadata lookup returns the known model (including hidden historical models) directly from memory. Repeated selection must perform zero credential reads, token refreshes, or catalog fetches.
- Explicit `getModels` discovery still reads current credentials, replaces metadata for the current account, filters hidden models, and clears the catalog when signed out. No background polling, TTL, new dependency, or persistent catalog is added.
- Cached model names and capabilities are advisory, not authorization. A known model may remain resolvable after logout or an external credential change until explicit discovery or process restart. Sending chat or search still uses the durable credential and cannot succeed while signed out. Invalid model/effort responses remain errors; no fallback model or silent retry is added.
- Existing provider checks, response validation, permission checks, and token refresh behavior remain intact.

## Verification

Use the public runtime/adapter with synthetic credentials and a stubbed catalog transport, never installed credentials. Assert that selecting multiple known models and reasoning efforts after initial discovery adds no credential reads or HTTP requests, even if storage becomes unavailable. Verify cold/concurrent discovery, explicit refreshed capabilities, hidden models, unknown IDs, wrong providers, logout and expired-token generation, and upstream failures. Run existing tests, typecheck, and build.

## Delivery boundaries

Do not change DSH source, installed profiles, credentials, or running processes. Build the plugin in this checkout; installed Desktop does not automatically load these edits. Installation/restart is a separate authorized step. Token throughput investigation is read-only and must distinguish source-level formula findings from measurements of this session.
