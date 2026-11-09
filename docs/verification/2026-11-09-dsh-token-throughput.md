# DSH token throughput audit — 2026-11-09

## Evidence and limits

DSH evidence comes from read-only parsing of the installed Desktop archive `E:/DeepSeek_Herness/resources/app.asar`, not an editable source checkout. The virtual member prefix is `dsh/node_modules/@deepseek-ai/`. No archive extraction or host changes were made. The plugin usage mapping was inspected in this project's source; the exact plugin build loaded by the running session was not independently verified.

The current GUI address is `http://127.0.0.1:51885`. An initial unauthenticated HEAD probe of `/api/session/projections` returned HTTP 401. Subsequently the user identified the target as the chat-bottom cumulative tok/s. The lead obtained the current session ID from the shell's managed `DSH_SESSION_ID` and read only that session's local compressed log for statistics. The JSONL was decompressed in memory; output was restricted to structural keys, token counts, and timestamps, never conversation text. No OAuth credentials, account identifiers, or provider raw HTTP responses were read. The snapshot below is a direct local-log recomputation, not a browser screenshot or proof of provider-internal generation timing.

## Confirmed formula

Chat-bottom throughput is the cumulative weighted mean of settled paired samples, not the current response's instantaneous text speed:

```text
R = sum(outputTokens_i) / (sum(max(0, messageTime_i - firstTokenTime_i)) / 1000)
```

Only settled assistant messages with a valid output-token count and a first-token timestamp contribute to the paired sample. Token counts are provider usage, not delta counts or character estimates.

Archive evidence (raw member line numbers):

- `dsh-session-stats/lib/index.js:94-123`: retains first token from attempts; assistant-message settlement accumulates decode tokens and duration.
- `dsh-client-ui-chat/lib/client.js:9559-9565`: prefers the sessionStats projection and computes `decodeTokens / (decodeMs / 1000)`.
- `dsh-client-ui-chat/lib/client.js:5881-5883`: display rounds values at least 10 to integers and lower values to one decimal place.
- `dsh-client-ui-trajectory/lib/client.js:4948-4955`: per-step throughput uses output divided by completed-minus-first-token duration; incomplete steps remain pending.
- `dsh-experimental-client-ui-stats/lib/client.js:2766-2775,3854`: step and session throughput follow the corresponding decode-duration definitions.

## Timing boundaries

- First token means the first nonempty text/reasoning delta or a tool-call delta containing arguments or a name. It is not response creation, HTTP headers, or block start: `dsh-llm/lib/index.js:1306-1318,1381-1385`.
- Timestamps are observed locally: chunk receipt in `dsh-agent-loop/lib/index.js:395-407`; settled assistant-message event gets `Date.now()` in `dsh-session/lib/index.js:1524-1539`.
- Decode duration excludes pre-first-output waiting, but includes subsequent network gaps, provider pauses, and terminal usage/finish processing.
- Normal DSH external-tool execution occurs after assistant-message settlement (`dsh-agent-loop/lib/index.js:949-961`) and is not included. Provider-side internal tool delays cannot be separately removed by this formula.
- Running UI may still show only previously settled steps. It is not a live token-per-second estimate for an unfinished response.

## Output and reasoning tokens

The plugin reads `output_tokens` directly and reports `output_tokens_details.reasoning_tokens` separately (`src/codex-models.ts:237-250`, `src/stream.ts:13-20`). It does not add reasoning tokens to output again. The packaged OpenAI SDK describes output details as a breakdown (`openai/src/resources/responses/responses.ts:8512-8535,8560-8567`), and DSH validates reasoning does not exceed output (`dsh-client-ui-chat/lib/client.js:13045-13050`). Consequently the numerator includes reasoning as a subset of provider output; it is not just visible final-answer tokens.

## Accuracy assessment

The formula and units are consistent for locally observed throughput after first output. It is not a pure model decoder benchmark, visible-text speed, or end-to-end task speed.

Hidden reasoning before the first visible reasoning summary/text delta can be counted in output while its elapsed time is excluded from the denominator. Batched chunks or short answers can similarly inflate the displayed rate. Terminal tail latency and retries can reduce it. The local-log snapshot below confirms a retry and missing paired samples in this conversation, but cannot establish the amount of hidden-reasoning or network timing bias.

Retry nuance: token-meter totals may include failed-attempt usage (`dsh-token-meter/lib/index.js:369-373,390-415`), while sessionStats uses the final assistant message's output and can retain the earliest attempt's first-token time. Do not reproduce cumulative speed by dividing the usage panel's total output by total time minus a single TTFT.

A separate boundary risk exists in the experimental per-turn table: `dsh-experimental-client-ui-stats/lib/client.js:3500-3503,3545` independently sums output and decode duration. If a row has usage but no first-token timestamp, the aggregate samples may not pair. The main sessionStats projection pairs its samples; this is not evidence of a universal throughput bug.

## Current-session local-log snapshot

Sampled at **2026-11-09 16:28:08 Asia/Shanghai**, last persisted event sequence 460. Source was the current managed session's `session.v4.jsonl.zstd`, decompressed in memory with Node's built-in Zstandard support. The command evaluated the actual installed archive's `sessionStats` init/apply fold and its `assistantStreamFirstTokenTime` helper over the stored events, rather than inventing a different throughput formula. It emitted only aggregate metadata.

| Field | Snapshot value |
| --- | ---: |
| Completed step boundaries | 51 |
| Paired settled throughput samples | 46 |
| Paired output tokens | 19,340 |
| Paired decode duration | 291.150 s |
| Raw cumulative throughput | 66.42624076936288 tok/s |
| Expected chat-bottom rounded reading at snapshot | 66 tok/s |
| All settled message output tokens | 20,323 |
| Reported reasoning-token subset across settled messages | 6,518 |
| Messages reporting reasoning usage | 43 |
| Reported retry events | 1 |
| Summed settled model duration | 1,118.450 s |
| Summed measured TTFT | 752.973 s |

Arithmetic cross-check: `19340 / 291.15 = 66.42624076936288`. The expected display is **66 tok/s**, not a claim that the GUI was observed rendering that value. Subsequent assistant steps change the cumulative figure, and the displayed browser may lag or show another selected session. Total output does not equal the speed numerator here: 983 output tokens were outside paired speed samples. There was also a retry, so dividing total usage by model duration minus TTFT need not reproduce the bottom pill.

This confirms the local calculation for the snapshot, not OpenAI's private generation timing or visible final-answer speed.

## How to compare with the GUI

For one completed step, obtain a redacted screenshot or statistics export showing output tokens, reasoning tokens, TTFT, generation/decode duration, displayed throughput, and whether it retried or was interrupted. Then compare `output / decodeSeconds` and allow display rounding. For cumulative chat speed, use paired settled-step output and decode durations rather than the last step or retry-inclusive total usage. No need to disclose account information or conversation text.
