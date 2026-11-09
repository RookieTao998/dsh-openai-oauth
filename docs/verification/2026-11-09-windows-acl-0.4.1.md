# Windows ACL regression verification — 0.4.1

## Reported behavior and diagnosis

After the user completed Device Code authorization in Windows DSH Desktop `0.2.2-rc.1`, the model picker reported unsafe credential permissions. Read-only inspection confirmed the installed `0.4.0` library matched the built library. Only ACL metadata was inspected: both the plugin state directory and credential file had the current-user owner, protected DACL, and a sole current-user FullControl Allow entry. No credential contents or account identifiers were read or printed; no user-state permissions were changed.

Two defects were reproduced using synthetic directories:

1. Concurrent first reads from independent store objects/processes could observe the new directory between `mkdir` and asynchronous ACL protection. The directory was later private, while earlier calls had already failed. The original tests covered concurrent modification only after initialization and missed this cold-start race.
2. An inherited uppercase `PSMODULEPATH` could win over the helper's `PSModulePath` override when Node de-duplicated Windows environment keys. With a Core-only PowerShell module path, Windows PowerShell failed module autoload. The helper incorrectly reported execution failures as unsafe ACLs. This environment condition was reproduced; it was not established for the user's running Host.

The cold-start race is consistent with the reported error and later safe ACLs, but the exact cached model-picker error still requires a user retry to correlate conclusively. Actual credential permissions were not loosened as a workaround.

## Fix

- Acquire the existing `proper-lockfile` lock before creating, protecting or validating the plugin-owned directory. Windows reads use the same lock; no recursive lock acquisition was added. POSIX reads retain their previous unlocked atomic-file behavior.
- Remove all case variants of the inherited PowerShell module-path key before setting the system Windows PowerShell path.
- Distinguish verified ACL rejection from checker execution failure with fixed exit codes and `WINDOWS_CREDENTIAL_CHECK_FAILED`. Missing/failed verification still refuses access and never reflects raw stderr.
- Retain the credential envelope and path, existing-file rejection rules, shared-parent ACL preservation, atomic file replacement and refresh serialization.

## Verification

The new cold-read, independent-process, environment-case and checker-failure tests were observed failing against `0.4.0` before the fix.

| Check | Result |
| --- | --- |
| TypeScript typecheck and all tsdown targets | Passed |
| Complete suite under the user's installed Desktop executable in hidden Electron RunAsNode mode, Node `24.21.0` | 32 tests: 31 passed, 1 POSIX-only skipped, 0 failed |
| Six fresh-directory concurrency rounds, four independent stores each | Passed |
| Independent Node processes initializing the same store | Passed |
| Checker execution failure with saved synthetic credentials retained | Passed |
| Uppercase module-path environment and genuine additional-principal rejection | Passed |
| Existing unsafe ACLs, links/junctions, hard links, malformed state and concurrent refresh replacement | Passed |
| Packed `0.4.1` in isolated published Harness `0.2.2-rc.1`: registration, composition, client graph/resource, authenticated RPC, CLI and removal | Passed |
| Independent focused security/concurrency review | Approved; no Important or Critical findings |

The Electron test process did not start a DSH Host or UI. The published-host smoke started and stopped only its isolated test instance. Existing Desktop processes, profiles and credentials were left unchanged. Dependency versions are unchanged from `0.4.0`.

## Handoff

Install `artifacts/dsh-openai-oauth-0.4.1.tgz` through Desktop's plugin manager using its unquoted absolute path, or Desktop's own `dsh plugin --profile desktop add` command. Fully quit and reopen Desktop to load it. The existing credential file remains in place.

Archive SHA-256: `a90c75c7f46410f4bfdc9118fc98cc8904d207802724a65dcfbdd0b957e844fe`.

The user's real model-list recovery, inference and web search after loading this package remain unverified. The earlier OpenAI browser-login HTTP 400 remains a separate unresolved issue; this patch does not change OAuth request parameters.
