# Security policy

## Reporting a vulnerability

Use GitHub private vulnerability reporting when it is enabled for the repository. If it is unavailable, open a public issue asking the maintainer to establish a private channel, without vulnerability details. Never post access tokens, refresh tokens, authorization codes, credential files, raw OAuth responses, or unredacted logs in a public issue.

Include the plugin version, DeepSeek Harness version, operating system, affected login method, impact, and a reproduction with every secret replaced. The maintainer will acknowledge the report and provide coordination details through the private channel.

## Supported security posture

Version `0.4.0` targets Windows DSH Desktop `0.2.2-rc.1`, a local Web Host bound to `127.0.0.1`, and a local headless CLI. Desktop uses the public authenticated Connection RPC; its client module remains on the `web` platform. Remote, proxied, and container-forwarded transports remain outside the supported security posture. Real Desktop and OAuth acceptance has not yet been completed.

The credential file is plaintext, protected by current-user filesystem ACLs on Windows and owner-only filesystem modes on POSIX; it is not encrypted with DPAPI. The Web route returns no credential value, accepts requests only from loopback with a local Host header, and requires same-origin browser metadata for mutations. These controls do not protect an already-compromised operating-system account or process with access to the Harness home.

Native web search sends the query and a fixed search instruction to the same ChatGPT Codex endpoint used for inference, with the plugin's OAuth credentials. It does not send conversation history or use a DeepSeek API key. Search has a configurable timeout and supports cancellation. Search sources are external, untrusted content; the existing Harness web tool labels the returned content accordingly. The plugin returns HTTP(S) source URLs without locally fetching them.
