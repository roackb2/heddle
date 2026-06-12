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
  - [終端機程式開發](#終端機程式開發)
  - [模型供應商](#模型供應商)
  - [瀏覽器控制平面](#瀏覽器控制平面)
  - [工作階段與連續性](#工作階段與連續性)
  - [專案指令](#專案指令)
  - [知識持久化](#知識持久化)
  - [Agent Skills](#agent-skills)
  - [自訂代理](#自訂代理)
  - [瀏覽器自動化](#瀏覽器自動化)
  - [MCP 整合](#mcp-整合)
  - [心跳任務](#心跳任務)
  - [程式化執行環境](#程式化執行環境)
  - [語意漂移](#語意漂移)
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
- 執行有界驗證，例如建置、測試、程式碼庫審查
- 讓多步驟實作工作跨已儲存的工作階段持續進行
- 在接受變更前審查檔案差異、命令、核准、追蹤紀錄與語意活動
- 從瀏覽器控制平面切換本地工作區
- 讓代理隨著實際工作學習持久專案知識
- 只在工作區需要時啟用標準 Agent Skills
- 定義自訂代理，讓不同回合使用 Ask、Code、Review、文件撰寫、發版操作等角色
- 連接使用者設定的 MCP 伺服器，例如 Notion、Anytype、GitHub 或其他工具
- 選擇性啟用瀏覽器自動化，用於渲染後頁面檢查與使用者要求的網頁流程
- 透過 Heddle 的供應商轉接器使用託管模型、本地 Ollama 與 OpenAI-compatible 供應商
- 基於 Heddle 執行環境 API 建立自訂主機

如果你只需要非常簡單的單次提示執行工具，而且不在意 sessions、持久化、可觀測性或操作員控制，Heddle 可能不是最適合的工具。

## 實際運作畫面

終端機、瀏覽器、行動端介面可以同時觀察同一個即時 session：

![Heddle streams the same session across terminal, browser, and mobile](docs/images/heddle-cross-device-stream.gif)

你可以在控制平面裡審查與核准敏感操作，同時代理執行仍然保持可見：

![Heddle 在瀏覽器控制平面中的請求核准流程](docs/images/heddle-request-approval.gif)

瀏覽器與行動端可以檢查工作區差異，而同一個 conversation 仍然持續：

![Heddle 在瀏覽器與行動端審查差異](docs/images/heddle-diff-view.gif)

Heddle 也可以作為終端機優先的程式開發代理，顯示即時進度、工具活動、計畫與審查輸出：

![Heddle 終端機程式開發工作流程](docs/images/terminal-active-run.png)

終端機聊天與開發工作流程展示檔案編輯、行內差異輸出與以驗證為導向的後續處理：

![Heddle 終端機變更審查](docs/images/terminal-change-review.png)

預設的本地控制平面是由 `heddle daemon` 提供的 web-v2 瀏覽器客戶端：

![Heddle web-v2 控制平面](docs/images/control-plane-v2.png)

Task workbench 支援週期性 heartbeat tasks、即時執行狀態與執行結果審查：

![Heddle web-v2 heartbeat task workbench](docs/images/control-plane-v2-heartbeat-task.png)

同一個控制平面也支援行動版版面，提供工作階段列表、工作區與差異預覽的聚焦面板：

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

5. 試一個提示：

```text
Summarize this repository, show me the main build/test commands, and point out the likely entrypoints.
```

6. 如果也想使用瀏覽器監督 UI：

```bash
heddle daemon
```

從 daemon output 開啟瀏覽器控制平面。你可以在裡面使用 `Sessions`、`Tasks`、`Settings` 檢查目前工作區、繼續已儲存的工作階段、審查變更、檢查記憶狀態，或切換到其他本地專案。

如果想執行一次性 run，而不是進入互動式 chat：

```bash
heddle ask "Summarize this repository"
```

`ask` 會在一個提示後結束，但它仍會把執行記錄為 `.heddle/` 底下的一次性已儲存工作階段，讓追蹤紀錄、記憶維護與後續檢查都使用和一般工作階段相同的持久化對話路徑。

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

### 終端機程式開發

Heddle 的主要使用方式是在程式碼庫裡開啟互動式聊天：

```bash
heddle
```

在聊天裡，Heddle 可以檢查檔案、使用遵守忽略規則的備援搜尋、解釋程式碼、進行編輯、用正確核准模型執行 shell 命令，並讓任務跨多個回合持續前進。

終端機輸入框支援多行提示、提示復原與重做、提示歷史瀏覽、透過 `/model set` 選模型，以及透過 `/reasoning set` 選推理強度。執行時，Heddle 會串流可見活動，讓你知道它是在思考、搜尋、呼叫工具、更新計畫，還是在等待核准。

更多：[聊天與工作階段指南](docs/guides/chat-and-sessions.md)

### 模型供應商

Heddle 不綁定單一模型供應商。它透過供應商轉接器支援託管前沿模型、本地模型與 OpenAI-compatible 閘道，讓你可以依照每次工作選擇最合適的取捨：能力最強的託管模型、私有本地模型、自架推論伺服器，或路由閘道。

支援的供應商家族：

- OpenAI，包含 OpenAI account sign-in 與 Platform API-key mode
- Anthropic Claude API key
- Ollama 本地模型，使用 `ollama/` 前綴
- LM Studio 本地伺服器模型，使用 `lmstudio/` 前綴
- LiteLLM 閘道模型，使用 `litellm/` 前綴
- vLLM 自架 OpenAI-compatible 模型，使用 `vllm/` 前綴
- Hugging Face router 模型，使用 `huggingface/` 或 `hf/` 前綴
- OpenRouter 模型，使用 `openrouter/` 前綴
- Together AI 模型，使用 `together/` 前綴
- Groq 模型，使用 `groq/` 前綴

先啟動 Ollama，pull 或安裝支援聊天的模型，然後用 `ollama/` 模型前綴選擇它：

```bash
ollama list
heddle --model ollama/llama3.2:latest ask "Summarize this repository"
heddle chat --model ollama/llama3.2:latest
```

其他 OpenAI-compatible 供應商則用對應設定檔前綴選擇模型：

```bash
heddle --model lmstudio/local-model ask "Reply with exactly: ok"
heddle --model openrouter/meta-llama/llama-3.3-70b-instruct ask "Summarize this repository"
```

在終端機聊天裡，可以用 `/model set <query>` 搜尋可用模型。終端機選擇器與瀏覽器模型選擇器使用同一個模型選項服務：Ollama 會從本地 Ollama API 發現模型，其他 OpenAI-compatible 設定檔會在本地伺服器正在執行或託管 API key 已設定時從 `/models` 發現模型。

```text
/model set llama
/model ollama/llama3.2:latest
```

本地與閘道模型的品質差異很大。有些較小、較舊或經由供應商路由的模型不擅長工具呼叫，可能忽略工具結果，或給出有信心但錯誤的程式碼庫答案。請保留人工審查，對高風險工作維持核准提示，重要修改建議使用能力較強的模型。

更多：[模型供應商](docs/reference/model-providers.md) 與 [供應商與模型](docs/reference/providers-and-models.md)

### 瀏覽器控制平面

控制平面是 Heddle 的本地瀏覽器 UI：

```bash
heddle daemon
```

它提供瀏覽器介面，用來查看工作區、已儲存對話、即時助理串流、工具進度、核准、目前工作區差異、心跳任務、記憶健康狀態與設定。

工作區切換器與 `Settings > Workspace` 頁面讓你註冊本地專案、在控制平面裡切換專案、重新命名工作區項目，並從瀏覽器 UI 選擇專案資料夾。`Sessions` 區塊以目前工作為核心：審查從作用中工作區的即時 Git 工作樹開始，包含已變更檔案、結構化唯讀差異，以及當側邊面板太窄時使用的較大完整差異檢視器。

如果終端機聊天是執行介面，那控制平面就是監督介面。

更多：[控制平面指南](docs/guides/control-plane.md)

### 工作階段與連續性

Heddle 會把已儲存的工作階段放在 `.heddle/`，所以較長的工作不需要每次重新開始。目前版本把工作階段目錄存在 `.heddle/chat-sessions.catalog.json`，並把每個工作階段的內容存在 `.heddle/chat-sessions/`。

常用工作階段指令：

```text
/session list
/session switch <id>
/continue
/compact
/model set
/reasoning set
```

更多：[聊天與工作階段指南](docs/guides/chat-and-sessions.md)

### 專案指令

Heddle 可以在啟動時載入短的專案指令檔，讓新的工作階段一開始就有程式碼庫的操作脈絡。預設會依序尋找第一個非空檔案：`HEDDLE.md`、`AGENTS.md`、`CLAUDE.md`。

為了保留 context 空間，預設只載入一個檔案。如果專案需要不同路徑，或刻意想載入多個檔案，可以在 `.heddle/config.json` 設定 `agentContextPaths`。

更多：[Project config](docs/reference/config.md)

### 知識持久化

Heddle 可以在工作過程中學習持久專案知識。

當代理注意到可重用資訊，例如偏好的 ticket 格式、標準驗證命令、操作慣例、反覆出現的程式碼庫特性或穩定工作流程，它可以記錄記憶候選項，並讓專門的維護流程把這些知識整理進 `.heddle/memory/` 底下的目錄化 Markdown 筆記。

目標是實用回想：未來的工作階段應該知道要去哪裡找，而不是每次從頭重新探索相同脈絡。Heddle 透過明確目錄、可讀的本地筆記、維護記錄與記憶檢視指令達成，而不是不透明的擷取。

更多：[知識持久化指南](docs/guides/knowledge-persistence.md)

### Agent Skills

Heddle 支援標準 Agent Skills 資料夾格式，用於可重用、選用的代理工作流程。你可以把專案 skills 放在 `.agents/skills/<name>/SKILL.md`，或把使用者 skills 放在 `~/.agents/skills/<name>/SKILL.md`，然後從聊天管理工作區啟用狀態：

```text
/skills
/skills enable <name>
/skills disable <name>
```

Heddle 也會內建一些由 Heddle 擁有能力對應的 built-in skills。能力設定可以啟用這些 built-ins，不需要使用者另外安裝 skill files。

只有啟用中的 skills 會顯示給代理。Heddle 一開始只暴露精簡目錄，包含每個啟用中 skill 的名稱與描述；當某個 skill 相關時，代理可以呼叫 `read_agent_skill` 取得完整 `SKILL.md` 內容。啟用狀態存在 `.heddle/skills/activation.json`；skill 定義仍留在原本的資料夾。

Skills 是指令，不是權限。它們不會繞過 Heddle 的核准政策或工具安全檢查，所以使用者仍需要對自己啟用哪些專案或使用者 skills 負責。

更多：[Agent Skills 指南](docs/guides/agent-skills.md)

### 自訂代理

自訂代理讓你替特定回合選擇 Heddle 應該使用的角色。Heddle 內建的
Ask、Code、Review 模式本身就是自訂代理；你也可以定義自己的專案代理或使用者代理，
用於程式碼庫審查、文件撰寫、發版操作、事件調查等專門工作。

一個自訂代理是一個具名的執行設定檔：

- 提示詞附錄：附加在 Heddle 預設系統提示詞後面的額外指令
- 工具設定：該回合中模型可以看見哪些工具
- 核准設定：代理是唯讀、需要互動式核准，或使用可信任的自動核准動作
- 執行預設值：選用預設值，例如 `maxSteps`、模型或推理強度

代理選擇是以回合為範圍，不是以整個工作階段為範圍。在同一個已儲存工作階段裡，
你可以先用 Ask 問問題，再切到 Code 實作，最後切到 Review 做審查回饋。

專案代理放在 `.agents/agents/<id>/AGENT.md`；使用者代理放在
`~/.agents/agents/<id>/AGENT.md`。檔案以 YAML frontmatter 區塊開頭，Markdown 內文
會成為提示詞附錄：

```md
---
schemaVersion: 1
id: repo-reviewer
name: Repo Reviewer
description: Review repository changes without applying fixes.
modeAlias: review
runtime:
  maxSteps: 80
tools:
  preset: inspect
approval:
  preset: read_only
---

You are a repository review agent. Prioritize correctness, reliability, missing
tests, and maintainability. Do not edit files or run mutation commands.
```

在瀏覽器控制平面裡，可以用 Settings -> Agents 建立或檢視專案代理。
在聊天輸入框的加號選單中，可以為下一個提示選擇 Ask、Code、Review 或自訂代理。
一次性的終端機使用方式：

```bash
heddle ask --agent repo-reviewer "Review the current workspace changes"
heddle ask --mode review "Review the current diff"
```

自訂代理是角色設定檔；Agent Skills 則是代理在相關任務中可以載入的可重用指令。
當自訂代理的工具設定包含 `read_agent_skill` 時，它仍然可以使用已啟用的 Agent Skills。

更多：[自訂代理指南](docs/guides/custom-agents.md)

### 瀏覽器自動化

瀏覽器自動化是選用功能，用於代理需要看見或操作真實網頁，而不能只依賴程式碼檢查、測試或一般網路搜尋的任務。

適合在你希望 Heddle 做這些事時使用：

- 在本地 UI 變更後目視檢查前端
- 擷取頁面快照或截圖作為證據
- 與使用者指定的網站互動
- 比較可見的商品頁或列表頁
- 使用靜態檔案或 API 看不到的渲染後 DOM 狀態

瀏覽器自動化預設關閉。可以從 Settings -> Browser Automation 或聊天中啟用：

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

啟用瀏覽器自動化會啟用 Heddle 套件內建的 `browser-automation` Agent Skill，並把以下工具加入未來預設的代理回合：

```text
browser_open
browser_snapshot
browser_click
browser_screenshot
browser_close
```

內建 skill 會教代理什麼時候適合使用瀏覽器自動化，以及什麼時候 `web_search` 只適合用來發現起始 URL。瀏覽器政策仍然是最終邊界：不安全操作、跨網域導覽、語意不明的 JavaScript-only 點擊可能被阻擋或要求核准。

目前行為：

- 如果沒有明確的網域允許清單，第一個 `browser_open` URL 會建立該瀏覽器工作階段的同網域瀏覽邊界
- 快照會回傳作用範圍限定的 refs，供安全的 `browser_click` 呼叫使用
- 截圖與瀏覽器證據會存放在 Heddle 狀態目錄
- Settings -> Browser Automation 與 `/browser profile <id>` 可選擇 Heddle 管理的瀏覽器設定檔，位置在 `.heddle/browser-profiles/`
- Settings -> Browser Automation 與 `/browser channel <chromium|chrome|msedge>` 可選擇之後代理執行與手動設定檔視窗使用的 Playwright 瀏覽器通道
- `/browser headed` 會讓之後的瀏覽器執行顯示 Playwright 視窗，方便你先手動登入；`/browser headless` 則會在不顯示視窗的狀態下重用該設定檔
- Settings -> Browser Automation 與 `/browser open-profile [url]` 可用可見的手動視窗開啟選定設定檔，供你登入或管理工作階段；請在要求代理使用同一設定檔前，用 `/browser close-profile` 關閉它
- 需要登入的網站要求目前選定的瀏覽器設定檔已經有有效的登入狀態

瀏覽器自動化待辦方向：

- 增加表單安全的瀏覽器工具，例如 `browser_type`、`browser_fill`、`browser_press`
- 在控制平面顯示瀏覽器證據與截圖
- 設計即時瀏覽器預覽路徑，較可能基於截圖或 CDP screencast，而不是嵌入 Playwright 原生可見視窗
- 為無害的同源 UI 點擊加上更完整的政策與核准流程

### MCP 整合

Heddle 可以連接使用者設定的 Model Context Protocol 伺服器，讓代理透過 Heddle 的核准與追蹤路徑使用生態系工具，例如 Notion、Anytype、GitHub 或其他 MCP 整合。

你可以把標準 `mcpServers` JSON 文件貼到 Settings -> MCP、直接編輯 `.heddle/mcp.json`，或在聊天裡用 `/mcp config` 開啟該檔案。伺服器設定與工作區啟用狀態是分開的：儲存設定後，仍需要明確啟用並重新整理伺服器，未來代理回合才能看到已快取的工具。

```text
/mcp
/mcp config
/mcp enable <server>
/mcp refresh <server>
/mcp disable <server>
```

重新整理已啟用的伺服器會把工具目錄快取到 `.heddle/mcp/`。未來代理回合可以透過 `mcp_list_tools` 檢查 MCP 工具，並透過需要核准的 MCP 工具轉接器呼叫它們。

更多：[MCP 整合](docs/reference/mcp.md)

### 心跳任務

Heartbeat 是 Heddle 的有界自主喚醒週期模型。

不只是在人類輸入提示時執行，心跳任務讓 Heddle 可以依照排程喚醒、做有限範圍的工作、建立檢查點結果，並決定要繼續、暫停、完成或升級處理。

範例指令：

```bash
heddle heartbeat start --every 30m
heddle heartbeat task add --id repo-gardener --task "Check for safe maintenance work" --every 1h
heddle heartbeat task list
```

它存在的理由是：有些代理工作不是單一互動式聊天。你可能需要週期性程式碼庫檢查、定期維護檢查、排程摘要，或能在有限步驟中恢復工作的主機。

更多：[心跳任務指南](docs/guides/heartbeat.md)

### 程式化執行環境

Heddle 不只是 CLI。npm 套件暴露兩個主要程式化層級：

- `createConversationEngine`：alpha API，用於持久化的多回合工作階段，包含工作階段儲存、壓縮、核准、追蹤紀錄、語意活動，以及自訂前端或本地主機
- `AgentLoopRuntimeService.run(...)`：較低階的單次執行迴圈，適合不需要持久化聊天或工作階段行為的主機

進階主機也可以重用較低階的 class API，例如 `ToolRegistry`、`ToolExecutionService`、`TraceRecorder`、`TraceConsoleFormatter`、`ReviewDiffParser`，在需要時組裝自訂執行環境或審查介面。

其他匯出的基礎能力包含 `HeartbeatRunnerAgent.run`、`HeartbeatSchedulerService.runDueTasks` 與 `FileHeartbeatTaskService`，用於排程或自訂主機工作流程。

更多：[程式化使用指南](docs/guides/programmatic-use.md)

### 語意漂移

語意漂移是選用遙測，用來幫助你觀察助理回應是否似乎偏離對話最近的語意軌跡。

搭配 optional [CyberLoop](https://www.npmjs.com/package/cyberloop) integration 時，Heddle 可以顯示 drift levels，例如：

- `drift=unknown`
- `drift=low`
- `drift=medium`
- `drift=high`

這是可觀測性功能，不是正確性保證。它的目的，是讓操作員注意到執行可能變得比較不貼近最近的方向。

更多：[語意漂移](docs/guides/semantic-drift.md)

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

- [文件總覽](docs/README.md)
- [執行環境主機模型](docs/guides/runtime-host-model.md)
- [聊天與工作階段指南](docs/guides/chat-and-sessions.md)
- [供應商與模型](docs/reference/providers-and-models.md)
- [CLI 參考](docs/reference/cli.md)

功能指南：

- [控制平面](docs/guides/control-plane.md)
- [心跳任務](docs/guides/heartbeat.md)
- [Agent Skills](docs/guides/agent-skills.md)
- [自訂代理](docs/guides/custom-agents.md)
- 瀏覽器自動化：請看上方瀏覽器自動化章節
- [MCP 整合](docs/reference/mcp.md)
- [知識持久化](docs/guides/knowledge-persistence.md)
- [語意漂移](docs/guides/semantic-drift.md)
- [程式化使用方式](docs/guides/programmatic-use.md)

貢獻者：

- [代理開發脈絡](docs/agent-context.md)
- [專案定位](docs/project-posture.md)
- [開發與貢獻](docs/guides/development.md)
- [發版慣例](docs/releases/README.md)
- [框架願景](docs/strategy/framework-vision.md)
- [程式開發代理路線圖](docs/strategy/coding-agent-roadmap.md)

## 專案狀態

Heddle 已經能用於真實程式開發代理工作流程，但仍在演進。

目前強項包含：

- 終端機優先的程式開發與程式碼庫工作流程
- 自主、以目錄管理的工作區記憶，讓代理從一般使用中學習
- 標準 Agent Skills 支援，包含工作區層級啟用與漸進式揭露
- 自訂代理，用於以回合為範圍的角色、工具、核准與執行設定
- 選用瀏覽器自動化，包含瀏覽器快照、截圖、政策檢查與公開的下一步清單
- MCP 整合支援，可連接使用者設定的生態系工具
- 明確的追蹤紀錄、核准預覽、差異審查與本地工作區狀態
- 透過控制平面進行瀏覽器監督與工作區切換
- 本機優先的心跳任務基礎能力，用於排程代理工作
- 可用於自訂主機的實用程式化 hooks

目前限制包含：

- 瀏覽器控制平面對檔案審查仍是唯讀；尚未是可編輯的 IDE-like 差異環境
- 瀏覽器自動化仍需要設定檔管理、表單安全操作與更完整的瀏覽器證據介面
- 有些進階工作流程在原始碼與範例中已有記錄，但產品 UX 文件仍需要打磨
- 隨著執行環境成熟，專案介面仍在變動

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

完整貢獻流程請見 [開發與貢獻](docs/guides/development.md)。

## 授權

Heddle 使用 MIT License。詳見 [LICENSE](LICENSE)。
