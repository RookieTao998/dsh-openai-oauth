<p align="center">
  <img src="docs/assets/readme-header.svg" width="100%" alt="dsh-openai-oauth — DeepSeek Harness 的 OpenAI OAuth 社区插件">
</p>

<h1 align="center">dsh-openai-oauth</h1>

<p align="center"><strong>DeepSeek Harness 的 OpenAI OAuth 插件</strong></p>

<p align="center"><a href="README.md">English</a> | 中文</p>

在 DeepSeek Harness 中直接登录 ChatGPT 并使用可用的 Codex 模型，不需要 OpenAI API Key，也不依赖 Codex CLI。插件保留 DSH 原有的会话、工具、权限和模型选择。

## 能做什么

- 支持浏览器 PKCE 登录和设备代码登录
- 提供 Desktop、Web 设置页和 headless 登录命令
- 自动刷新登录凭据
- 登录后动态获取 Codex 模型目录及推理等级，并显示在 DSH 原生模型选择器中
- 通过 ChatGPT OAuth 使用 Codex 原生网页搜索，无需 DeepSeek API Key
- 凭据保存在本机 Harness 主目录

## 准备 DSH

- DeepSeek Harness 或 DSH Desktop `0.2.2-rc.1`
- Web/headless 或源码构建：Node.js `^22.19.0` 或 `>=24.0.0`，`pnpm` 已加入 `PATH`
- 当前具有 Codex 使用资格的 ChatGPT 账号

`0.4.0` 面向 Windows DSH Desktop，以及 macOS 和 Linux 上的本地 Web 和 headless 使用。真实 Desktop 与 OAuth 验收尚未完成，手动检查步骤见下文。

从插件 `0.1.x` 升级时，先升级 DSH，再重新安装插件并重启 DSH。已保存的 OAuth 凭据继续使用原来的位置。

## 安装

### 使用 Agent 安装（推荐）

向 Agent 提供本 checkout 的 [AGENTS.md](AGENTS.md) 和构建后的插件包路径，让它按照操作清单完成安装。

安装结束后，你只需决定是否重启 DSH，并亲自完成 ChatGPT 登录。

### 安装到 Windows DSH Desktop

Desktop 自带 Node 和 pnpm 运行时，无需另装。先启动一次 Desktop 以初始化 profile。在应用菜单的 **Manage dsh Command…（管理 dsh 命令）** 中安装命令，打开新终端并确认 `dsh --version` 是 `0.2.2-rc.1`，然后通过托盘菜单完全退出 Desktop；关闭窗口会继续在后台运行。从本项目根目录安装本地构建包：

```powershell
$pluginArchive = (Resolve-Path .\artifacts\dsh-openai-oauth-0.4.0.tgz).Path
dsh plugin --profile desktop add $pluginArchive
dsh plugin --profile desktop list
```

也可以在 Desktop 的 Plugins 界面安装：在“添加插件”输入框中粘贴 `.tgz` 的绝对路径，首尾不要加引号。例如本 checkout 使用：

```text
E:/workspeace/dsh-openai-oauth/artifacts/dsh-openai-oauth-0.4.0.tgz
```

Windows“复制文件地址”可能带上双引号；粘贴到界面后请去掉。界面会把引号当作地址的一部分，报“not a package name the registry accepts”。终端命令中的引号由 shell 处理，与界面输入不同。

不要使用普通 npm 安装的 `dsh` 管理 Desktop profile；可在命令管理对话框中检查实际命令路径。重新打开 Desktop 以加载插件。`0.4.0` 尚未发布到 npm，请使用本地包。

### DSH Web 命令安装

包发布后执行：

```sh
dsh plugin --profile web add dsh-openai-oauth@0.4.0
dsh --profile web --dump-config
```

### 从当前 checkout 安装到 Web

```sh
pnpm install --frozen-lockfile
pnpm run check
pnpm pack
dsh plugin --profile web add ./dsh-openai-oauth-0.4.0.tgz
dsh --profile web --dump-config
```

以上 Web 命令使用 `web` profile。如果 DSH Web 已经运行，安装后手动重启一次。

## 登录与使用

1. 打开 DSH 的**设置 → OpenAI OAuth**。
2. 选择**浏览器登录**或**设备代码**。
3. 登录具有 Codex 使用资格的 ChatGPT 账号。
4. 打开 **Models**，选择一个 `openai-codex` 模型。

浏览器登录会等待 `127.0.0.1:1455` 上的回调。端口不可用或浏览器位于另一台机器时，请使用设备代码。

在 headless profile 中使用：

```sh
dsh plugin --profile headless add ./dsh-openai-oauth-0.4.0.tgz
dsh plugin --profile headless exec dsh-openai-login
```

命令会询问登录方式。非交互终端需要明确传入 `--browser` 或 `--device-code`。

## Desktop 手动验收

在 Windows 的 DSH Desktop `0.2.2-rc.1` 中按上述步骤安装，检查“设置 → OpenAI OAuth”能否打开。亲自完成浏览器登录，检查取消和设备代码登录，再重启 Desktop 并检查登录状态是否保留。检查 token 刷新，选择 Codex 模型并发送请求，然后尝试网页搜索。这些检查需要真实账号，目前尚未完成。反馈结果时不要分享凭据或授权回调。

## 网页搜索

安装后，插件通过 DSH 现有扩展接口把网页搜索提供方设为 `openai-codex-search`，无需修改 Harness 源码。登录 ChatGPT 后，让 Agent 搜索网页即可；原有搜索工具会展示结果和来源链接，并将查询与结果记录在会话中。网页抓取仍使用 profile 原有的抓取提供方。

搜索使用 Codex 服务端的原生 `web_search`，每个查询会额外发起一次模型请求，占用当前 ChatGPT 账号的额度。搜索词会发送给 OpenAI；不会发送整段对话。搜索或授权失败时直接报错，不会回退到 DeepSeek API。

默认使用发起搜索的会话当前选择的 Codex 模型；其他模型会话或无会话调用则使用账号模型目录中的第一个可见模型。模型是否支持搜索取决于 OpenAI。需要固定搜索模型或调整超时时间时，在 profile 的用户配置中合并以下设置：

```yaml
- id: llm-openai-oauth
  config:
    searchModel: gpt-6.1-sol # 替换为当前账号可用且支持搜索的模型 ID
    searchTimeoutMs: 90000
```

`searchModel` 可省略，`searchTimeoutMs` 默认 90000 毫秒，最小 1000 毫秒。要继续使用其他搜索提供方，可在 profile 用户配置中覆盖 `web.config.searchProvider`；卸载插件后恢复原 profile 的选择。

## 更新与卸载

Desktop 请使用其 Plugins 界面，或使用自带 `dsh` 并指定 `--profile desktop`。Web 命令如下：

```sh
dsh plugin --profile web update dsh-openai-oauth
dsh plugin --profile web remove dsh-openai-oauth
```

安装、更新或卸载插件后需要重启 DSH。登录、退出登录和 token 刷新不需要重启。

如果还要删除保存的凭据，请在卸载前前往**设置 → OpenAI OAuth**退出登录；否则卸载会保留凭据。

## 说明

- 本插件把 ChatGPT 账号连接到 Codex 模型提供方，不会生成 OpenAI API Key。
- Web 集成只支持绑定到 `127.0.0.1` 的本地 DSH Host。
- 凭据以明文保存在 `$DSH_HOME/plugins/dsh-openai-oauth/credentials.json`，Windows 使用当前用户 ACL 保护，POSIX 使用仅所有者可访问的文件权限；不使用 DPAPI。
- 可用模型和额度取决于已登录的账号。
- OpenAI 可能独立修改 Codex OAuth 协议。
- 本项目为非官方社区项目，与 OpenAI、DeepSeek AI 无隶属或背书关系。

安全问题和部署说明见 [SECURITY.md](SECURITY.md)。

[MIT](LICENSE)
