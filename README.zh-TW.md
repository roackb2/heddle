# Heddle

[English](README.md) | [繁體中文](README.zh-TW.md)

Heddle 是開源 AI 程式開發代理執行環境，也是以終端機為優先，協助你開發功能、修正錯誤、維護軟體，並保留可審查代理執行過程的工作區。

官方網站：[heddleagent.com](https://heddleagent.com)

> **Terminal UI v2 現在是預設介面。** 執行 `heddle` 或 `heddle chat` 會進入 API-backed 終端機體驗。訊息、執行事件、代理回應串流會走同一條 shared control-plane path，讓終端機、瀏覽器、行動端可以同時追蹤同一個工作。

## 目錄

- [Heddle 能做什麼](#heddle-能做什麼)
- [實際運作畫面](#實際運作畫面)
- [快速開始](#快速開始)
- [核心工作流程](#核心工作流程)
- [本地模型](#本地模型)
- [安裝](#安裝)
- [需求](#需求)
- [選用 CyberLoop 整合](#選用-cyberloop-整合)
- [文件](#文件)
- [專案狀態](#專案狀態)
- [開發](#開發)
- [授權](#授權)

## Heddle 能做什麼

Heddle 適合想讓 AI 程式開發助理參與日常軟體開發，同時保留本地工作脈絡與可審查執行過程的工程師、維護者、個人專案開發者。

它適合用來：

- 檢查與理解陌生程式碼庫
- 為工作或個人專案開發新的產品功能
- 建立前端頁面、後端服務、CLI 工具、文件與測試
- 修正錯誤、調查退化問題，並解釋陌生程式路徑
- 重構既有模組，同時保留可審查的差異
- 執行有界驗證，例如建置、測試、程式碼庫 review
- 讓多步驟實作工作跨已儲存的 sessions 持續進行
- 在接受變更前審查檔案差異、命令、approvals、traces、semantic activity
- 從瀏覽器 control plane 切換本地工作區
- 讓 agent 隨著實際工作學習持久專案知識
- 只在工作區需要時啟用標準 Agent Skills
- 連接使用者設定的 MCP servers，例如 Notion、Anytype、GitHub 或其他工具
- 選擇性啟用 Browser Automation，用於渲染後頁面檢查與使用者要求的網頁流程
- 透過 Heddle 的 provider adapters 使用 hosted models 或本地 Ollama models
- 基於 Heddle runtime APIs 建立自訂 host

如果你只需要非常簡單的單次提示執行工具，而且不在意 sessions、持久化、可觀測性或操作員控制，Heddle 可能不是最適合的工具。

## 實際運作畫面

終端機、瀏覽器、行動端介面可以同時觀察同一個即時 session：

![Heddle streams the same session across terminal, browser, and mobile](docs/images/heddle-cross-device-stream.gif)

你可以在 control plane 裡審查與核准敏感操作，同時 agent run 仍然保持可見：

![Heddle request approval flow in the browser control plane](docs/images/heddle-request-approval.gif)

瀏覽器與行動端可以檢查工作區差異，而同一個 conversation 仍然持續：

![Heddle diff review across browser and mobile](docs/images/heddle-diff-view.gif)

Heddle 也可以作為 terminal-first coding agent，顯示即時進度、工具活動、plans 與審查輸出：

![Heddle terminal coding workflow](docs/images/terminal-active-run.png)

Terminal chat/dev workflow 展示檔案編輯、inline diff output 與以驗證為導向的後續處理：

![Heddle terminal change review](docs/images/terminal-change-review.png)

預設的本地 control plane 是由 `heddle daemon` 提供的 web-v2 瀏覽器 client：

![Heddle web-v2 control plane](docs/images/control-plane-v2.png)

Task workbench 支援週期性 heartbeat tasks、即時執行狀態與執行結果審查：

![Heddle web-v2 heartbeat task workbench](docs/images/control-plane-v2-heartbeat-task.png)

同一個 control plane 也支援行動版 layout，提供 session list、workbench 與 diff preview 的 focused panels：

<p>
  <img src="docs/images/control-plane-v2-session-list.PNG" alt="Heddle web-v2 mobile session list" width="220">
  <img src="docs/images/control-plane-v2-workbench.PNG" alt="Heddle web-v2 mobile workbench" width="220">
  <img src="docs/images/control-plane-v2-diff-view.PNG" alt="Heddle web-v2 mobile diff preview" width="220">
</p>

## 快速開始

1. 安裝 Heddle：

```bash
npm install -g @roackb2/heddle
```

2. 設定 provider 存取權。

OpenAI 可以使用自己的 ChatGPT/Codex account 登入：

```bash
heddle auth login openai
```

也可以使用 Platform API key：

```bash
export OPENAI_API_KEY=your_key_here
```

如果你同時保留 OpenAI OAuth credential 和 API key 用於測試，可以明確要求某次執行優先使用 API key：

```bash
heddle --prefer-api-key
heddle --prefer-api-key ask "Summarize this repository"
heddle --prefer-api-key daemon
```

Anthropic 使用 API key：

```bash
export ANTHROPIC_API_KEY=your_key_here
```

本地模型可安裝並啟動 [Ollama](https://ollama.com)，再用 `ollama/` prefix 選擇已安裝的 chat model：

```bash
ollama list
heddle --model ollama/llama3.2:latest ask "Reply with exactly: ok"
```

Ollama 不需要 hosted provider API key。Heddle 預設使用 Ollama 的本地 OpenAI-compatible endpoint：`http://127.0.0.1:11434/v1`。

OpenAI account sign-in 是 Heddle 提供的實驗性、由使用者選擇的傳輸方式。這不是 OpenAI 官方支援，Heddle 與 OpenAI 沒有 affiliation、endorsement 或 sponsorship。使用 OpenAI 服務仍受 OpenAI terms and policies 約束。

3. 進入你想檢查的程式碼庫：

```bash
cd /path/to/project
```

4. 啟動 chat：

```bash
heddle
```

5. 試一個 prompt：

```text
Summarize this repository, show me the main build/test commands, and point out the likely entrypoints.
```

6. 如果也想使用瀏覽器監督 UI：

```bash
heddle daemon
```

從 daemon output 開啟瀏覽器 control plane。你可以在裡面使用 `Sessions`、`Tasks`、`Settings` 檢查目前工作區、繼續已儲存的 sessions、審查變更、檢查 memory status，或切換到其他本地專案。

如果想執行一次性 run，而不是進入互動式 chat：

```bash
heddle ask "Summarize this repository"
```

`ask` 會在一個 prompt 後結束，但它仍會把 run 記錄為 `.heddle/` 底下的一次性 saved session，讓 traces、memory maintenance 與後續檢查都使用和一般 session 相同的 persisted conversation path。

### 試試 Learning Loop

當 Heddle 學會可重用偏好並在之後套用時，它會變得更有用。你可以在 chat 裡教它 ticket 格式：

```text
Whenever I ask you to create a ticket, use these sections: problem statement, proposed approach, considered alternatives, conclusion.
```

然後開一個新的 session 並詢問：

```text
Create a ticket for maintaining doc consistency after feature updates.
```

Heddle 應該會從本地 memory catalog 取回這個偏好，並用該結構產生 ticket。你可以用以下指令檢查它學到了什麼：

```bash
heddle memory status
heddle memory list
heddle memory search ticket
```

## 核心工作流程

### Terminal Coding

Heddle 的主要使用方式是在程式碼庫裡開啟互動式 chat：

```bash
heddle
```

在 chat 裡，Heddle 可以檢查檔案、使用 ignore-aware fallbacks 搜尋、解釋程式碼、進行編輯、用正確 approval model 執行 shell commands，並讓任務跨多個 turns 持續前進。

Terminal composer 支援多行 prompts、prompt undo/redo、prompt history navigation、透過 `/model set` 選 model，以及透過 `/reasoning set` 選 reasoning effort。Run 進行時，Heddle 會串流可見活動，讓你知道它是在思考、搜尋、呼叫工具、更新 plan，還是在等待 approval。

更多：[Chat and sessions guide](docs/guides/chat-and-sessions.md)

## 本地模型

Heddle 除了 hosted OpenAI 與 Anthropic models，也可以使用本地 Ollama models。當你想要 local-first 工作流程、想避免把 model prompt 送到 hosted provider，或想測試特定本地模型的 agent 行為時，這會很有用。

先啟動 Ollama，pull 或安裝 chat-capable model，然後用 `ollama/` model prefix 選擇它：

```bash
ollama list
heddle --model ollama/llama3.2:latest ask "Summarize this repository"
heddle chat --model ollama/llama3.2:latest
```

在 terminal chat 裡，可以用 `/model set <query>` 搜尋可用 models。當 Ollama 正在執行時，terminal picker 與 browser model selector 會從本地 Ollama API 發現已安裝的 Ollama chat models，所以你不需要記住每個 model name。

```text
/model set llama
/model ollama/llama3.2:latest
```

本地模型品質差異很大。有些較小或較舊的 local models 不擅長 tool calling，可能忽略 tool results，或給出有信心但錯誤的程式碼庫答案。請保留人工 review，對高風險工作維持 approval prompts，重要修改建議使用能力較強的 model。

更多：[Providers and models](docs/reference/providers-and-models.md)

### Browser Control Plane

Control plane 是 Heddle 的本地瀏覽器 UI：

```bash
heddle daemon
```

它提供瀏覽器介面，用來查看工作區、已儲存 conversations、即時 assistant 串流、工具進度、approvals、目前工作區差異、heartbeat tasks、memory health 與 settings。

Workspace switcher 與 `Settings > Workspace` page 讓你註冊本地專案、在 control plane 裡切換專案、重新命名 workspace entries，並從瀏覽器 UI 選擇專案資料夾。`Sessions` section 以目前工作為核心：審查從 active workspace 的即時 Git working tree 開始，包含 changed files、structured read-only diffs，以及當 side panel 太窄時使用的 larger full-diff viewer。

如果 terminal chat 是執行介面，那 control plane 就是監督介面。

更多：[Control plane guide](docs/guides/control-plane.md)

### Sessions And Continuity

Heddle 會把已儲存的 sessions 放在 `.heddle/`，所以較長的工作不需要每次重新開始。目前版本把 session catalog 存在 `.heddle/chat-sessions.catalog.json`，並把每個 session 的內容存在 `.heddle/chat-sessions/`。

常用 session commands：

```text
/session list
/session switch <id>
/continue
/compact
/model set
/reasoning set
```

更多：[Chat and sessions guide](docs/guides/chat-and-sessions.md)

### Project Instructions

Heddle 可以在啟動時載入短的 project instruction file，讓新的 session 一開始就有程式碼庫的操作脈絡。預設會依序尋找第一個非空檔案：`HEDDLE.md`、`AGENTS.md`、`CLAUDE.md`。

為了保留 context 空間，預設只載入一個檔案。如果專案需要不同路徑，或刻意想載入多個檔案，可以在 `.heddle/config.json` 設定 `agentContextPaths`。

更多：[Project config](docs/reference/config.md)

### Knowledge Persistence

Heddle 可以在工作過程中學習持久專案知識。

當 agent 注意到可重用資訊，例如偏好的 ticket 格式、標準驗證命令、操作慣例、反覆出現的程式碼庫特性或穩定工作流程，它可以記錄 memory candidate，並讓專門的維護流程把這些知識整理進 `.heddle/memory/` 底下的 cataloged markdown notes。

目標是 practical recall：future sessions 應該知道要去哪裡找，而不是每次從頭重新探索相同脈絡。Heddle 透過明確 catalogs、可讀的本地 notes、maintenance logs 與 memory visibility commands 達成，而不是不透明 retrieval。

更多：[Knowledge persistence](docs/guides/knowledge-persistence.md)

### Agent Skills

Heddle 支援 standard Agent Skills folder format，用於可重用、opt-in 的 agent workflows。你可以把專案 skills 放在 `.agents/skills/<name>/SKILL.md`，或把使用者 skills 放在 `~/.agents/skills/<name>/SKILL.md`，然後從 chat 管理 workspace activation：

```text
/skills
/skills enable <name>
/skills disable <name>
```

Heddle 也會內建一些 Heddle-owned capabilities 的 built-in skills。Capability settings 可以啟用這些 built-ins，不需要使用者另外安裝 skill files。

只有 active skills 會顯示給 agent。Heddle 一開始只 expose compact catalog，包含每個 active skill 的名稱與描述；當某個 skill relevant 時，agent 可以呼叫 `read_agent_skill` 取得完整 `SKILL.md` body。Activation state 存在 `.heddle/skills/activation.json`；skill definitions 仍留在原本的 folders。

Skills 是 instructions，不是 permissions。它們不會繞過 Heddle 的 approval policy 或 tool safety checks，所以使用者仍需要對自己啟用哪些 project/user skills 負責。

更多：[Agent Skills guide](docs/guides/agent-skills.md)

### Browser Automation

Browser Automation 是 opt-in capability，用於 agent 需要看見或操作真實網頁，而不能只依賴程式碼檢查、測試或一般 web search 的任務。

適合在你希望 Heddle 做這些事時使用：

- 在本地 UI 變更後目視檢查前端
- 擷取 page snapshots 或截圖作為證據
- 與使用者指定的網站互動
- 比較可見的商品頁或列表頁
- 使用 static files 或 APIs 看不到的渲染後 DOM 狀態

Browser Automation 預設關閉。可以從 Settings -> Browser Automation 或 chat 啟用：

```text
/browser
/browser enable
/browser disable
/browser headed
/browser headless
/browser profile <id>
/browser channel <chromium|chrome|msedge>
/browser open-profile [url]
/browser close-profile
```

啟用 Browser Automation 會 activate Heddle package-owned `browser-automation` Agent Skill，並把以下工具加入未來預設的 agent turns：

```text
browser_open
browser_snapshot
browser_click
browser_screenshot
browser_close
```

Built-in skill 會教 agent 什麼時候適合使用 browser automation，以及什麼時候 `web_search` 只適合用來發現起始 URL。Browser policy 仍然是最終邊界：不安全操作、off-domain navigation、ambiguous JavaScript-only clicks 可能被阻擋或要求 approval。

目前行為：

- 如果沒有明確的網域允許清單，第一個 `browser_open` URL 會建立該瀏覽器工作階段的同網域瀏覽邊界
- 快照會回傳作用範圍限定的 refs，供安全的 `browser_click` 呼叫使用
- 截圖與瀏覽器證據會存放在 Heddle 狀態目錄
- Settings -> Browser Automation 與 `/browser profile <id>` 可選擇 Heddle 管理的 profile，位置在 `.heddle/browser-profiles/`
- Settings -> Browser Automation 與 `/browser channel <chromium|chrome|msedge>` 可選擇之後 agent 執行與手動 profile 視窗使用的 Playwright 瀏覽器 channel
- `/browser headed` 會讓之後的瀏覽器執行顯示 Playwright 視窗，方便你先手動登入；`/browser headless` 則會在不顯示視窗的狀態下重用該 profile
- Settings -> Browser Automation 與 `/browser open-profile [url]` 可用可見的手動視窗開啟選定 profile，供你登入或管理工作階段；請在要求 agent 使用同一 profile 前，用 `/browser close-profile` 關閉它
- 需要登入的網站要求目前選定的瀏覽器 profile 已經有有效的登入狀態

Browser Automation agenda：

- 增加表單安全的 browser tools，例如 `browser_type`、`browser_fill`、`browser_press`
- 在 control plane 顯示瀏覽器證據與截圖
- 設計即時瀏覽器預覽路徑，較可能基於截圖或 CDP screencast，而不是嵌入 Playwright 原生可見視窗
- 為無害的同源 UI 點擊加上更完整的 policy 與 approval 流程

### MCP Integrations

Heddle 可以連接使用者設定的 Model Context Protocol servers，讓 agent 透過 Heddle 的 approval 與 trace path 使用生態系工具，例如 Notion、Anytype、GitHub 或其他 MCP integrations。

你可以把 standard `mcpServers` JSON document 貼到 Settings -> MCP、直接編輯 `.heddle/mcp.json`，或在 chat 裡用 `/mcp config` 開啟該檔案。Server config 與 workspace activation 是分開的：儲存 config 後，仍需要明確 enable 並 refresh server，未來 agent turns 才能看到 cached tools。

```text
/mcp
/mcp config
/mcp enable <server>
/mcp refresh <server>
/mcp disable <server>
```

Refresh enabled server 會把 tool catalog cache 到 `.heddle/mcp/`。未來 agent turns 可以透過 `mcp_list_tools` 檢查 MCP tools，並透過 approval-gated MCP tool adapters 呼叫它們。

更多：[MCP integrations](docs/reference/mcp.md)

### Heartbeat

Heartbeat 是 Heddle 的有界自主喚醒週期模型。

不只是在人類輸入 prompt 時執行，heartbeat task 讓 Heddle 可以依照排程喚醒、做有限範圍的工作、checkpoint result，並決定要 continue、pause、complete 或 escalate。

範例指令：

```bash
heddle heartbeat start --every 30m
heddle heartbeat task add --id repo-gardener --task "Check for safe maintenance work" --every 1h
heddle heartbeat task list
```

它存在的理由是：有些 agent work 不是單一互動式 chat。你可能需要週期性程式碼庫檢查、定期維護檢查、排程摘要，或能在 bounded steps 中 resume work 的 host。

更多：[Heartbeat guide](docs/guides/heartbeat.md)

### Programmatic Runtime

Heddle 不只是 CLI。npm package expose 兩個主要 programmatic layers：

- `createConversationEngine`：alpha API，用於 persisted multi-turn sessions，包含 session storage、compaction、approvals、traces、semantic activity，以及 custom frontends 或 local hosts
- `AgentLoopRuntimeService.run(...)`：較低階的 single-run execution loop，適合不需要 persisted chat 或 session behavior 的 hosts

Advanced hosts 也可以重用較低階的 class APIs，例如 `ToolRegistry`、`ToolExecutionService`、`TraceRecorder`、`TraceConsoleFormatter`、`ReviewDiffParser`，在需要時組裝 custom runtime 或 review surfaces。

其他 exported primitives 包含 `HeartbeatRunnerAgent.run`、`HeartbeatSchedulerService.runDueTasks` 與 `FileHeartbeatTaskService`，用於 scheduled 或 custom host workflows。

更多：[Programmatic use](docs/guides/programmatic-use.md)

### Semantic Drift

Semantic drift 是 optional telemetry，用來幫助你觀察 assistant responses 是否似乎偏離 conversation 最近的語意軌跡。

搭配 optional [CyberLoop](https://www.npmjs.com/package/cyberloop) integration 時，Heddle 可以顯示 drift levels，例如：

- `drift=unknown`
- `drift=low`
- `drift=medium`
- `drift=high`

這是 observability feature，不是正確性保證。它的目的，是讓 operator 注意到 run 可能變得比較不貼近最近的方向。

更多：[Semantic drift](docs/guides/semantic-drift.md)

## 安裝

Global install：

```bash
npm install -g @roackb2/heddle
```

不安裝 global package 也可以執行：

```bash
npx @roackb2/heddle
```

安裝後的 CLI command 是 `heddle`。

## 需求

- Node.js 20+
- 至少一個 supported provider：
  - OpenAI account sign-in：`heddle auth login openai`，或 `OPENAI_API_KEY`
  - Anthropic models 使用 `ANTHROPIC_API_KEY`
  - 本地 Ollama server，用於 `ollama/<model>` models

Heddle 不支援 Anthropic consumer subscription OAuth。除非 Anthropic 提供 approved third-party auth route，請使用 Anthropic API-key access。

## 選用 CyberLoop 整合

如果你想在 chat 裡使用 semantic drift telemetry，請在和 Heddle 相同的 environment 安裝 `cyberloop`：

```bash
npm install -g cyberloop
# or for project-local usage
npm install cyberloop
```

如果只想一次性使用而不 global install：

```bash
npx -p @roackb2/heddle -p cyberloop heddle
```

## 文件

從這裡開始：

- [Documentation hub](docs/README.md)
- [Runtime host model](docs/guides/runtime-host-model.md)
- [Chat and sessions guide](docs/guides/chat-and-sessions.md)
- [Providers and models](docs/reference/providers-and-models.md)
- [CLI reference](docs/reference/cli.md)

功能指南：

- [Control plane](docs/guides/control-plane.md)
- [Heartbeat](docs/guides/heartbeat.md)
- [Agent Skills](docs/guides/agent-skills.md)
- Browser Automation：請看上方 Browser Automation section
- [MCP integrations](docs/reference/mcp.md)
- [Knowledge persistence](docs/guides/knowledge-persistence.md)
- [Semantic drift](docs/guides/semantic-drift.md)
- [Programmatic use](docs/guides/programmatic-use.md)

貢獻者：

- [Agent context](docs/agent-context.md)
- [Project posture](docs/project-posture.md)
- [Development and contributing](docs/guides/development.md)
- [Release convention](docs/releases/README.md)
- [Framework Vision](docs/strategy/framework-vision.md)
- [Coding Agent Roadmap](docs/strategy/coding-agent-roadmap.md)

## 專案狀態

Heddle 已經能用於真實 coding-agent workflows，但仍在演進。

目前強項包含：

- terminal-first coding 與程式碼庫 workflows
- autonomous、catalog-backed workspace memory，讓 agent 從一般使用中學習
- standard Agent Skills support，包含 workspace-level activation 與 progressive disclosure
- opt-in Browser Automation，包含 browser snapshots、screenshots、policy checks 與 published next-step agenda
- MCP integration support，可連接使用者設定的生態系工具
- explicit traces、approval previews、diff review 與 local workspace state
- 透過 control plane 進行瀏覽器監督與 workspace switching
- local-first heartbeat primitives，用於 scheduled agent work
- 可用於 custom hosts 的 practical programmatic hooks

目前限制包含：

- browser control plane 對 file review 是 read-only；尚未是可編輯的 IDE-like diff environment
- Browser Automation 仍需要 profile 管理、表單安全操作與更完整的 browser evidence surfaces
- 有些 advanced workflows 在 source 與 examples 中已有記錄，但 product UX 文件仍需要打磨
- 隨著 runtime 成熟，project surface 仍在變動

## 開發

如果你想開發 Heddle 本身：

```bash
git clone https://github.com/roackb2/heddle.git
cd heddle
yarn install
yarn build
yarn test
```

`yarn test` 會執行預設 unit 與 integration suites。Browser integration coverage 位於 `src/__tests__/browser-integration`，並會在 PRs 中執行；本地可以用 `yarn test:browser-integration` 執行。

完整 contributor workflow 請見 [Development and contributing](docs/guides/development.md)。

## 授權

Heddle 使用 MIT License。詳見 [LICENSE](LICENSE)。
