<p align="center">
  <img src="docs/assets/readme-header.svg" width="100%" alt="dsh-openai-oauth — OpenAI OAuth community plugin for DeepSeek Harness">
</p>

<h1 align="center">dsh-openai-oauth</h1>

<p align="center"><strong>OpenAI OAuth for DeepSeek Harness</strong></p>

<p align="center">English | <a href="README.zh.md">中文</a></p>

Sign in to ChatGPT from DeepSeek Harness and use available Codex models without an OpenAI API key or Codex CLI. The plugin keeps the standard DSH sessions, tools, permissions, and model selector.

## Features

- Browser login with PKCE or Device Code login
- Desktop and Web settings, and a headless login command
- Automatic token refresh
- Models and reasoning levels discovered from the signed-in account’s Codex catalog
- Codex native web search through ChatGPT OAuth, without a DeepSeek API key
- Credentials stored locally under the Harness home

## Requirements

- DeepSeek Harness or DSH Desktop `0.2.2-rc.1`
- For Web/headless or source builds: Node.js `^22.19.0` or `>=24.0.0`, and `pnpm` on `PATH`
- A ChatGPT account with Codex access

Version `0.4.0` targets Windows DSH Desktop as well as local Web and headless use on macOS and Linux. Real Desktop and OAuth acceptance has not yet been completed; see the manual checks below.

When upgrading from plugin `0.1.x`, upgrade DSH first, reinstall the plugin, then restart DSH. Saved OAuth credentials remain in the same location.

## Install

### Install with an Agent (recommended)

Give an Agent this checkout's [AGENTS.md](AGENTS.md) and the built plugin package path, and ask it to follow the runbook.

When it finishes, you only need to approve any DSH restart and complete the ChatGPT login yourself.

### Install in Windows DSH Desktop

Desktop includes its Node and pnpm runtime. Start Desktop once to initialize its profile. Use the application menu's **Manage dsh Command…** to install the command, open a new terminal, and confirm `dsh --version` is `0.2.2-rc.1`. Quit Desktop through its tray menu; closing the window keeps it running. From this project's root, install the locally built package:

```powershell
$pluginArchive = (Resolve-Path .\artifacts\dsh-openai-oauth-0.4.0.tgz).Path
dsh plugin --profile desktop add $pluginArchive
dsh plugin --profile desktop list
```

You can also install through Desktop's Plugins UI: paste the archive's absolute path into **Add plugin**, without surrounding quotation marks. For this checkout:

```text
E:/workspeace/dsh-openai-oauth/artifacts/dsh-openai-oauth-0.4.0.tgz
```

Windows **Copy as path** may add quotation marks; remove them after pasting into the UI. The UI treats them as part of the address and reports “not a package name the registry accepts”. A terminal shell handles command-line quotes separately.

Do not use an ordinary npm-installed `dsh` to manage the Desktop profile; check the command's actual location in its management dialog. Reopen Desktop to load the plugin. Version `0.4.0` has not been published to npm; use the local archive.

### Install with DSH Web

After the package is published:

```sh
dsh plugin --profile web add dsh-openai-oauth@0.4.0
dsh --profile web --dump-config
```

### Install Web from the current checkout

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
dsh plugin --profile web add ./dsh-openai-oauth-0.4.0.tgz
dsh --profile web --dump-config
```

These Web commands use the `web` profile. Restart a running DSH Web process after installation.

## Login and use

1. Open **Settings → OpenAI OAuth**.
2. Choose **Browser login** or **Device Code**.
3. Sign in with a ChatGPT account that has Codex access.
4. Open **Models** and select an `openai-codex` model.

Browser login waits for a callback on `127.0.0.1:1455`. Use Device Code when that port is unavailable or the browser is on another machine.

For a headless profile:

```sh
dsh plugin --profile headless add ./dsh-openai-oauth-0.4.0.tgz
dsh plugin --profile headless exec dsh-openai-login
```

The command asks which login method to use. Non-interactive terminals must pass `--browser` or `--device-code`.

## Manual Desktop acceptance

On Windows with DSH Desktop `0.2.2-rc.1`, install as above and check that Settings → OpenAI OAuth opens. Complete Browser login yourself, verify cancellation and Device Code login, then restart Desktop and verify the sign-in persists. Exercise token refresh, select a Codex model, send a request, and try web search. These checks require a real account and have not yet been completed. Never share credentials or authorization callbacks when reporting results.

## Web search

The bundle selects `openai-codex-search` through the existing DSH web provider interface, without changing Harness source. After ChatGPT sign-in, ask the Agent to search the web. The standard search tool displays results and source links and records the query and result in the Session. Web fetching keeps the profile's existing fetch provider.

Each query makes an additional Codex model request with the native server-side `web_search` tool and uses the signed-in ChatGPT account's quota. Queries are sent to OpenAI; the full conversation is not sent. Search and authentication failures are reported directly, without falling back to DeepSeek API access.

Search follows the initiating Session's selected Codex model. Other model routes and calls outside a Session use the first visible model in the account catalog. Search availability depends on OpenAI and the selected model. To pin a search model or change the timeout, merge these settings into the profile's user configuration:

```yaml
- id: llm-openai-oauth
  config:
    searchModel: gpt-6.1-sol # Replace with an available model that supports search
    searchTimeoutMs: 90000
```

`searchModel` is optional. `searchTimeoutMs` defaults to 90000 milliseconds, with a minimum of 1000. To retain a different search provider, override `web.config.searchProvider` in the profile's user configuration. Uninstalling restores the original profile selection.

## Update and uninstall

For Desktop, use its Plugins UI or its bundled `dsh` with `--profile desktop`. For Web:

```sh
dsh plugin --profile web update dsh-openai-oauth
dsh plugin --profile web remove dsh-openai-oauth
```

Restart DSH after installing, updating, or removing the plugin. Login, logout, and token refresh do not require a restart.

Sign out in **Settings → OpenAI OAuth** before uninstalling if the stored credential should also be deleted. Uninstalling the package otherwise preserves it.

## Notes

- This connects a ChatGPT account to the Codex model provider; it does not create an OpenAI API key.
- The Web integration supports only a local DSH Host bound to `127.0.0.1`.
- Credentials are stored in plaintext at `$DSH_HOME/plugins/dsh-openai-oauth/credentials.json`, protected by current-user ACLs on Windows and owner-only filesystem modes on POSIX. They are not protected by DPAPI.
- Model availability and quota depend on the signed-in account.
- OpenAI may change the Codex OAuth protocol independently of this plugin.
- This is an unofficial community project and is not affiliated with or endorsed by OpenAI or DeepSeek AI.

See [SECURITY.md](SECURITY.md) for security reporting and deployment notes.

[MIT](LICENSE)
