# dsh-openai-oauth Agent installation runbook

Follow this runbook to add the standalone `dsh-openai-oauth` package to an existing DeepSeek Harness installation. For DSH Desktop, use its `desktop` profile. For other installations, default to `web` unless the user names a different profile.

## Expected result

The task is complete when all of the following are true:

- the requested profile contains one `dsh-openai-oauth` installation;
- registration is confirmed in the intended profile;
- the composed `web` configuration selects `openai-codex-search`, unless the user explicitly configured another search provider;
- no Harness source file, other plugin, or other profile was changed;
- the user knows whether DSH must be restarted and where to finish OAuth login.

## Operating limits

- Treat DeepSeek Harness and this plugin as separate projects. Do not copy plugin files into Harness or edit Harness configuration and package-management files by hand.
- Leave profiles, unrelated plugins, and previously saved credentials intact.
- Never display OAuth tokens, authorization callbacks, account identifiers, or credential-file contents.
- The user must complete ChatGPT authentication. Do not authenticate on their behalf.
- Ask before stopping or restarting a running DSH process.

## Environment check

Confirm these prerequisites before making changes:

- Windows DSH Desktop, or macOS/Linux local Web or headless;
- DeepSeek Harness or DSH Desktop `0.2.2-rc.1`;
- for non-Desktop installations and source builds, Node.js `^22.19.0` or `>=24.0.0` and `pnpm` on `PATH`. Desktop supplies its own runtime.

For non-Desktop installations, inspect Node.js and pnpm versions and locate a usable DSH command. Prefer a globally available `dsh`; inside a DeepSeek Harness source checkout, use `pnpm dsh` for every DSH invocation. For Desktop, locate its bundled `dsh`; an ordinary npm-installed `dsh` cannot manage the Desktop profile. Report an unsupported platform or version instead of altering Harness for compatibility.

## Registration and inspection

For Windows DSH Desktop, first confirm the profile has been initialized by launching Desktop once. Its application menu's **Manage dsh Command…** installs the bundled command and shows its actual path; open a fresh terminal and verify its version. Ask before stopping a running instance, and use the tray's Quit command rather than closing its window. Use its Plugins UI or its bundled `dsh` to install the locally built `0.4.0` archive into `desktop`; this version has not been published to npm. From this checkout:

```powershell
$pluginArchive = (Resolve-Path .\artifacts\dsh-openai-oauth-0.4.0.tgz).Path
dsh plugin --profile desktop add $pluginArchive
dsh plugin --profile desktop list
```

For the Desktop Plugins UI, supply an absolute `.tgz` path without surrounding quotation marks, for example `E:/workspeace/dsh-openai-oauth/artifacts/dsh-openai-oauth-0.4.0.tgz`. The UI does not strip shell quotes: a quoted path falls through to registry package-name validation. Confirm the command is Desktop-owned rather than relying on its name on PATH. Do not boot the Desktop profile using ordinary npm-installed DSH. Reopen Desktop to load the plugin only with the user’s approval.

For the default non-Desktop `web` profile, install the corresponding local archive (or a published package once available):

```sh
dsh plugin --profile web add ./artifacts/dsh-openai-oauth-0.4.0.tgz
dsh --profile web --dump-config
```

Substitute the user-selected profile when necessary. Substitute `pnpm dsh` for `dsh` when using the source-checkout launcher. When the user specifies a tag or commit, use the corresponding GitHub package reference with `#<tag-or-commit>`.

Inspect the Desktop plugin list or the non-Desktop composed configuration and confirm that `dsh-openai-oauth` occurs once. Do not count a partial download or a package-manager entry as successful registration.

The plugin's bundle also selects Codex native web search. It requires ChatGPT sign-in, uses the account's quota, and needs no DeepSeek API key. Preserve an explicit user override of the search provider.

## User handoff

If port `3080` already belongs to a running DSH Web instance, do not launch another instance. Installation requires one DSH restart to load the new plugin; perform it only with the user's approval.

After Desktop reopens or DSH reloads, direct the user to **Settings -> OpenAI OAuth**. They can choose **Browser login** or **Device Code** and then authenticate their own ChatGPT account.

Report the profile, package reference, registration-check result, and restart status. Real Desktop and OAuth acceptance remains unverified; do not claim live validation from registration alone.

## Unsuccessful installation

Identify the command that failed and return its sanitized error output. Stop without modifying Harness source, deleting profiles, removing unrelated plugins, expanding filesystem access, weakening certificate checks, or approving unrelated lifecycle scripts.
