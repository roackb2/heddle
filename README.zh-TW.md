# Heddle

[English](README.md) | [繁體中文](README.zh-TW.md)

Heddle 是一個開源的 AI coding agent runtime，也是 terminal-first 的 workspace，目標是支援真實專案工作。

官方網站：[heddleagent.com](https://heddleagent.com)

> **Terminal UI v2 已是預設介面。** 執行 `heddle` 或 `heddle chat` 會使用 API-backed 的 terminal experience。訊息、run events 與 agent response streams 現在都會走 shared control-plane path，因此 terminal、browser 與 mobile clients 可以同時跟進同一份工作，讓跨裝置工作流程更順。

## Agenda

- [看 Heddle 實際運作](#看-heddle-實際運作)
- [為什麼試試 Heddle](#為什麼試試-heddle)
- [Heddle 能做什麼](#heddle-能做什麼)
- [Programmatic Use Layers](#programmatic-use-layers)
- [介面展示](#介面展示)
- [兩分鐘快速開始](#兩分鐘快速開始)
- [主要功能](#主要功能)
- [安裝](#安裝)
- [需求](#需求)
- [文件](#文件)
- [專案狀態](#專案狀態)
- [開發](#開發)

## 看 Heddle 實際運作

Terminal、browser 與 mobile surfaces 可以同時觀察同一個 live session：

![Heddle streams the same session across terminal, browser, and mobile](docs/images/heddle-cross-device-stream.gif)

在 control plane 中 review 與 approve sensitive actions，同時讓 agent run 持續可見：

![Heddle request approval flow in the browser control plane](docs/images/heddle-request-approval.gif)

同一個 conversation 繼續進行時，也可以從 browser 與 mobile 檢查 workspace diffs：

![Heddle diff review across browser and mobile](docs/images/heddle-diff-view.gif)

Heddle 是為這類 workflow 設計：agent 需要檢查 live repository、做有邊界的修改、驗證結果、跨 sessions 保持 continuity，並且讓 operator 能看清楚它正在做什麼。Heddle 支援 OpenAI 與 Anthropic models，會把 local workspace state 存在 `.heddle/`，包含 terminal chat experience 與 browser control plane，能在工作時學習 durable workspace knowledge，也提供 file diffs、commands、approvals 與 traces 的 review path。

白話來說：Heddle 適合想要 AI coding assistant 真正進入專案工作、逐漸學會每個 project 的 operating knowledge、能在 local workspaces 之間切換，而且保持可檢查、不像黑盒的人。

## 為什麼試試 Heddle

Heddle 是給想要超越一次性 coding chat wrapper 或 stateless AI code assistant 的人。

如果你想要以下能力，Heddle 會很適合：

- terminal-first 的 coding agent，可以在真實 repository 裡工作
- agent 能在工作時學習 durable project knowledge，並使用可檢查的 local memory
- 標準 Agent Skills 支援，可用於 opt-in reusable workflows 與 tool-use instructions
- opt-in Browser Automation，可用於 rendered page inspection 與使用者要求的網站工作流程
- 明確 traces、approvals 與可 review 的 workflow artifacts
- browser control plane，可用於 local oversight、workspace switching 與 session review
- 從 interactive use 延伸到 programmatic 與 scheduled agent workflows 的路徑

如果你只想要非常簡單的一次性 prompt runner，而且不在意 sessions、persistence、observability 或 operator control，那 Heddle 可能不是最適合的工具。

## Heddle 能做什麼

概略來說，Heddle 可以協助：

- 理解陌生 repositories
- 在真實 workspace 裡修改 code 或 docs
- 執行 bounded verification，例如 builds、tests 與 repo review
- 讓多步驟工作跨 sessions 延續，而不是每次重新開始
- 從 browser control plane 在 local workspaces 之間切換
- 從真實使用中學習 durable facts、preferences 與 workflows
- 啟用 workspace-approved Agent Skills，讓 agent 只在需要時載入 specialized instructions
- 啟用 Browser Automation，讓 agent 在需要時檢查、截圖或操作真實網頁
- 提供比黑盒 chat tool 更多 operator visibility

如果你想要一個 terminal-first coding agent，具有 local state、review traces、workspace memory，並且能往 longer-running workflows 發展，那就是 Heddle 想解決的問題。

## Programmatic Use Layers

Heddle 目前有兩個主要 programmatic layers：

- `createConversationEngine`：alpha API，用於 persisted multi-turn sessions，包含 session storage、compaction、approvals、traces、semantic activity，以及 custom frontends 或 local hosts
- `AgentLoopRuntimeService.run(...)`：較低階的 single-run execution loop，適合不需要 persisted chat 或 session behavior 的 hosts

Advanced hosts 也可以重用較低階 class APIs，例如 `ToolRegistry`、`ToolExecutionService`、`TraceRecorder`、`TraceConsoleFormatter` 與 `ReviewDiffParser`，在明確需要 custom runtime 或 review surfaces 時自行組裝。

如果你想使用 programmatic surface，請從 [Programmatic use guide](docs/guides/programmatic-use.md) 開始。

給 contributors 的 compact architecture map 在 [Core Layering](docs/architecture/core-layering.md) 與 [Chat Layering](docs/architecture/chat-layering.md)。

## 介面展示

### Terminal coding workflow

Heddle 在 terminal 中顯示 live progress、tool activity、plans 與 review output：

![Heddle terminal coding workflow](docs/images/terminal-active-run.png)

Heddle 可以 inspect files、用 ignore-aware fallbacks 搜尋、解釋 code、做 edits、以正確 approval model 執行 shell commands，並跨多輪完成任務。Terminal chat 會用 tool activity、dim `Thinking:` progress text、real-time assistant markdown，以及更清楚的 repeated command/search approval prompts 讓 long-running turns 保持可見。

### Terminal change review

Terminal chat/dev workflow 顯示 file edits、inline diff output，以及 verification-oriented follow-through：

![Heddle terminal change review](docs/images/terminal-change-review.png)

### Browser control plane overview

預設 local control plane 是由 `heddle daemon` 提供的 web-v2 browser client。它是 coding sessions、workspace state、current changes、heartbeat tasks 與 settings 的 oversight surface：

![Heddle web-v2 control plane](docs/images/control-plane-v2.png)

web-v2 client 包含：

- `Sessions`：saved conversations、live assistant streaming、tool progress、approvals 與 current workspace diff review。
- `Composer controls`：model 與 reasoning settings、semantic drift controls、`@file` mentions，以及會保存為 local paths 給 `view_image` 使用的 image attachments。
- `Workspace switching`：sidebar workspace selection，以及 `Settings > Workspace` 中註冊、重新命名與切換 local projects。
- `Tasks`：heartbeat task creation、edit、enable/disable、run、resume、delete、live run state 與 saved run records。
- `Settings`：language preferences、workspace management、memory status，以及 catalog health、note counts、pending candidates 與 latest maintenance run。
- `Mobile`：針對 session list、conversation workbench、task detail、settings 與 diff review 的 focused panels。

Task workbench 涵蓋 recurring heartbeat tasks、live run state 與 run result review：

![Heddle web-v2 heartbeat task workbench](docs/images/control-plane-v2-heartbeat-task.png)

同一個 control plane 支援 mobile layouts，session list、workbench 與 diff preview 都會以 focused panels 呈現：

<p>
  <img src="docs/images/control-plane-v2-session-list.PNG" alt="Heddle web-v2 mobile session list" width="220">
  <img src="docs/images/control-plane-v2-workbench.PNG" alt="Heddle web-v2 mobile workbench" width="220">
  <img src="docs/images/control-plane-v2-diff-view.PNG" alt="Heddle web-v2 mobile diff preview" width="220">
</p>

## 兩分鐘快速開始

1. 安裝 Heddle：

```bash
npm install -g @roackb2/heddle
```

2. 設定 provider access。

OpenAI 可以用你自己的 ChatGPT/Codex account 登入：

```bash
heddle auth login openai
```

或使用 Platform API key：

```bash
export OPENAI_API_KEY=your_key_here
```

如果你同時保留 OpenAI OAuth credential 與 API key 方便測試，可以明確讓本次 run 偏好 API key：

```bash
heddle --prefer-api-key
heddle --prefer-api-key ask "Summarize this repository"
heddle --prefer-api-key daemon
```

Anthropic 使用 API key：

```bash
export ANTHROPIC_API_KEY=your_key_here
```

OpenAI account sign-in 是 experimental、由使用者自行選擇的 transport。它不是 OpenAI 官方支援；Heddle 與 OpenAI 沒有從屬、背書或贊助關係。使用 OpenAI 服務仍需遵守 OpenAI 的 terms 與 policies。

3. 進入任何你想 inspect 的 repository：

```bash
cd /path/to/project
```

4. 開始 chat：

```bash
heddle
```

5. 試試這個 prompt：

```text
Summarize this repository, show me the main build/test commands, and point out the likely entrypoints.
```

6. 如果你也想使用 browser oversight UI：

```bash
heddle daemon
```

從 daemon output 打開 browser control plane。你可以在那裡使用 `Sessions`、`Tasks` 與 `Settings` 檢查 active workspace、continue saved sessions、review changes、inspect memory status，或切換到另一個 local project。

如果你偏好一次性的 CLI run，而不是 interactive chat，可以用：

```bash
heddle ask "Summarize this repository"
```

`ask` 仍會在一個 prompt 後結束，但它現在會把 run 記錄成 `.heddle/` 下的一個 one-off saved session，所以 traces、memory maintenance 與後續 inspection 會使用和 normal sessions 相同的 persisted conversation path。

Terminal chat footer 與 control-plane session composer 都會顯示 selected model 的 active auth source，所以你可以知道 session 正在使用 OpenAI account sign-in、API-key mode，或是缺少 credentials。

### Try The Learning Loop

當 Heddle 學會 reusable preference 並在之後套用時，它會更有用。你可以在 chat 裡教它一個 ticket format：

```text
Whenever I ask you to create a ticket, use these sections: problem statement, proposed approach, considered alternatives, conclusion.
```

然後開一個 fresh session 並詢問：

```text
Create a ticket for maintaining doc consistency after feature updates.
```

Heddle 應該會從 local memory catalog 找回這個 preference，並用指定結構產出 ticket。你可以用以下指令檢查它學到了什麼：

```bash
heddle memory status
heddle memory list
heddle memory search ticket
```

## 主要功能

### Terminal chat for real coding work

Heddle 的主要使用方式是在 repository 中進行 interactive chat：

```bash
heddle
```

在這裡，Heddle 可以 inspect files、explain code、make edits、用正確 approval model 執行 shell commands，並跨多輪完成任務。

這是核心功能。如果你只把 Heddle 當成 terminal 裡的 coding agent 使用，這就是你最需要關心的部分。

Terminal composer 支援 multiline prompts、prompt undo/redo、prompt history navigation、用 `/model set` 選 model，以及用 `/reasoning set` 選 reasoning effort。Run 進行中，Heddle 會 streaming visible activity，讓你看見它是在 thinking、searching、calling tools、updating a plan，還是 waiting for approval。

更多：[Chat and sessions guide](docs/guides/chat-and-sessions.md)

### Terminal UI v2 is the default

預設 terminal chat 現在是 API-backed 的 `cli-v2` experience。從 project 中執行 `heddle` 或 `heddle chat` 就能開始。

v2 terminal UI 使用和 browser UI 相同的 local control-plane API，不會直接碰 core services。對使用者來說，目標是在所有 interfaces 中保持同一套 behavior model。Saved conversation、selected model、reasoning setting、approval state 與 live run status 應該不管從 terminal、browser control plane，或另一台連到同一 local control-plane server 的裝置看，都會是一致的。Messages、tool events、approval waits 與 streamed agent responses 會透過 shared session event path 傳遞，因此多個 devices 可以同時 observe 與 continue 同一份工作，而不是等待某個 surface 完成或 refresh。

對 contributors 來說，目標是更乾淨的 implementation path：TUI-specific rendering 與 keyboard behavior 留在 `cli-v2`，shared semantics 留在 core 與 server-owned control-plane APIs，future advanced features 可以建立在 maintainable API-first foundation 上，而不是在每個 interface 裡重複 command/session logic。

### Project instructions

Heddle 啟動時可以載入短的 project instruction file，讓 fresh session 一開始就知道 repository operating context。預設會依序讀取第一個非空檔案：`HEDDLE.md`、`AGENTS.md`、`CLAUDE.md`。

為了保留 context space，預設只讀一個 default file。如果 project 需要不同路徑，或明確想讀多個 files，可以在 `.heddle/config.json` 設定 `agentContextPaths`。

更多：[Project config](docs/reference/config.md)

### Agent Skills

Heddle 支援標準 Agent Skills folder format，可用於 reusable、opt-in agent workflows。把 project skills 放在 `.agents/skills/<name>/SKILL.md`，或把 user skills 放在 `~/.agents/skills/<name>/SKILL.md`，再從 chat 管理 workspace activation：

```text
/skills
/skills enable <name>
/skills disable <name>
```

Heddle 也會內建一些 Heddle-owned capabilities 的 skills。Capability settings 可以啟用這些 built-ins，不需要使用者另外安裝 skill files。

只有 active skills 會提供給 agent。Heddle 一開始只會把每個 active skill 的 name 與 description 放進 compact catalog；agent 判斷某個 skill 相關時，才會呼叫 `read_agent_skill` 讀取完整 `SKILL.md` body。Activation state 存在 `.heddle/skills/activation.json`；skill definitions 仍留在原本 folders。

Skills 是 instructions，不是 permissions。它們不會繞過 Heddle 的 approval policy 或 tool safety checks，所以使用者仍需自行負責啟用哪些 project 或 user skills。

更多：[Agent Skills guide](docs/guides/agent-skills.md)

### Browser Automation

Browser Automation 是一個 opt-in capability，適合 agent 需要看見或操作真實網頁，而不是只依賴 code inspection、tests 或 plain web search 的任務。

適合在這些情境啟用：

- frontend UI 修改後，需要 visual inspection
- 需要擷取 page snapshots 或 screenshots 作為 evidence
- 使用者要求 agent 瀏覽或操作某個網站
- 需要比較可見的商品頁、listing 或搜尋結果
- 任務依賴 rendered DOM state，而不是 static files 或 APIs 就能回答

Browser Automation 預設關閉。你可以從 Settings -> Browser Automation，或在 chat 中使用以下指令啟用：

```text
/browser
/browser enable
/browser disable
```

啟用 Browser Automation 會啟用 Heddle package-owned 的 `browser-automation` Agent Skill，並讓未來 default agent turns 可以使用：

```text
browser_open
browser_snapshot
browser_click
browser_screenshot
browser_close
```

內建 skill 會教 agent 什麼時候適合使用 browser automation，以及什麼時候 `web_search` 只適合用來尋找起始 URL。Browser policy 仍然是最終邊界：unsafe actions、off-domain navigation、模糊的 JavaScript-only clicks 都可能被 block 或要求 approval。

#### Browser Automation 目前行為

- 如果沒有明確設定 domain allowlist，第一個 `browser_open` URL 會成為該 browser session 的 same-domain browsing boundary
- snapshots 會回傳 scoped refs，供安全的 `browser_click` 使用
- screenshots 與 browser evidence 會存放在 Heddle state 底下
- 需要登入狀態的網站仍然需要 persistent browser profile 與有效 session

#### Browser Automation 下一步

- 在 Settings 加入 profile management，包括 selected profile、Chrome channel、headless/headed mode、profile path visibility
- 加入「open profile for login」流程，讓使用者可以手動準備 logged-in sessions，再讓 agent 重用
- 加入 form-safe browser tools，例如 `browser_type`、`browser_fill`、`browser_press`
- 在 control plane 顯示 browser evidence 與 screenshots
- 設計 live browser preview，方向比較可能是 screenshot/CDP screencast，而不是嵌入 Playwright native headed window
- 加入更細緻的 policy 與 approval flows，支援 harmless same-origin UI clicks

### MCP integrations

Heddle 可以連接使用者設定的 Model Context Protocol servers，讓 agent 透過 Heddle 的 approval 與 trace path 使用 Notion、Anytype、GitHub 或其他 MCP 生態系工具。

你可以在 Settings -> MCP 貼上標準 `mcpServers` JSON document，也可以直接編輯 `.heddle/mcp.json`，或在 chat 中用 `/mcp config` 打開這個檔案。Server config 與 workspace activation 是分開的：儲存 config 後，仍然需要明確 enable 並 refresh server，未來 agent turns 才能看到 cached tools。

```text
/mcp
/mcp config
/mcp enable <server>
/mcp refresh <server>
/mcp disable <server>
```

刷新已啟用 server 會把 tool catalog cache 到 `.heddle/mcp/`。未來 agent turns 可以用 `mcp_list_tools` inspect MCP tools，並透過 approval-gated MCP tool adapters 呼叫它們。

更多：[MCP integrations](docs/reference/mcp.md)

### Sessions and continuity

Heddle 會把 saved sessions 存在 `.heddle/`，讓較長工作不必每次重新開始。目前版本把 session catalog 存在 `.heddle/chat-sessions.catalog.json`，per-session bodies 存在 `.heddle/chat-sessions/`。這表示你可以回到中斷的 task、繼續之前的 debugging thread，或跨 runs 保留 project-specific context。

如果你在做真實的 multi-step work，而不是 one-shot prompts，這點會很重要。

常用 session commands 包含：

- `/session list`
- `/session switch <id>`
- `/continue`
- `/compact`
- `/model set`
- `/reasoning set`

更多：[Chat and sessions guide](docs/guides/chat-and-sessions.md)

### Knowledge Persistence: Heddle Learns While It Works

Heddle 可以在工作時學習 durable project knowledge。

當 agent 注意到 reusable information，例如 preferred ticket format、canonical verification command、operational convention、recurring repo quirk，或 stable workflow pattern，它可以記錄 memory candidate，並讓 dedicated maintainer path 把這些 knowledge 整理成 `.heddle/memory/` 底下 cataloged markdown notes。

目標是 practical recall：future sessions 應該知道從哪裡找，而不是每次重新探索相同 context。Heddle 透過 explicit catalogs、readable local notes、maintenance logs 與 memory visibility commands 完成這件事，而不是依賴 opaque retrieval。

Learning loop 是刻意具體化的：

- 在正常工作中注意 durable facts 與 preferences
- 不打斷使用者就記錄 memory candidates
- 透過 maintainer path 把 candidates 整理進 cataloged markdown
- 讓 future sessions 透過 explicit discovery paths 找回 context
- 讓 users 用 `heddle memory status/list/read/search/validate` audit memory

你可以在真實 project 上嘗試：告訴 Heddle 一個 durable preference，或讓它發現 stable workflow detail，然後開一個 fresh session，看它透過 memory catalog 找回 context。

例如，先告訴 Heddle 你偏好的 ticket template，再在新 session 中請它產 ticket。重點不只是存一份 note，而是讓 future work 從你已經教過 agent 的 operating knowledge 開始。

更多：[Knowledge persistence](docs/guides/knowledge-persistence.md)

### Control plane and workspaces

Control plane 是 Heddle 的 local browser UI：

```bash
heddle daemon
```

它會啟動 local server，讓你：

- 查看 saved sessions
- 觀察 active runs
- review current workspace changes
- 切換 registered workspaces
- 檢查 memory status
- 管理 heartbeat tasks

Control plane 的目標不是取代 IDE，而是提供 agent work 的 operator view。

更多：[Control plane](docs/guides/control-plane.md)

### Runtime host model

Heddle 的核心不只是 CLI。它也可以被當成 runtime host foundation。

Host model 把幾個 concerns 拆開：

- conversation/session persistence
- model/provider resolution
- tools and approvals
- trace recording
- memory maintenance
- UI/control-plane presentation

這讓未來可以建立不同 agent surfaces，而不需要重寫整個 runtime。

更多：[Runtime host model](docs/guides/runtime-host-model.md)

### Heartbeat

Heartbeat 是 Heddle 對 recurring 或 long-running bounded agent work 的模型。

Heartbeat task 可以：

- 週期性執行
- reuse checkpoint state
- 在 budget 內做一小段 work
- 決定 pause、continue、complete 或 escalate

這不是 hidden daemon magic；它是 explicit local state 與 scheduler-friendly APIs 的組合。

常用 commands：

```bash
heddle heartbeat start --every 30m --task "Check for safe repository maintenance work"
heddle heartbeat task list
heddle heartbeat run --task repo-gardener
heddle heartbeat runs show latest --task repo-gardener
```

更多：[Heartbeat](docs/guides/heartbeat.md)

### Semantic drift

Heddle 可以選擇性顯示 semantic drift telemetry，協助你觀察 agent run 是否開始偏離目前 task。

在 chat 中：

```text
/drift
/drift on
/drift off
```

Footer 會顯示：

- `drift=off`
- `drift=stable`
- `drift=medium`
- `drift=high`

這是 observability feature，不是 magic correctness guarantee。它的目標是幫助 operator 注意到 run 可能開始偏離最近方向。

如果你只是想找 coding agent，day one 不需要在意這個功能。如果你關心 agent observability 與 runtime behavior，它是 Heddle 比較有特色的功能之一。

更多：[Semantic drift](docs/guides/semantic-drift.md)

### Programmatic runtime APIs

Heddle 不只是 CLI。npm package 也 expose runtime primitives，例如 `createConversationEngine`、`AgentLoopRuntimeService.run(...)`、`HeartbeatRunnerAgent.run`、`HeartbeatSchedulerService.runDueTasks` 與 `FileHeartbeatTaskService`，讓其他 hosts 可以建立在它之上。

這是給想建立自己的 agent hosts、schedulers 或 control surfaces 的人，而不只是使用 packaged CLI。

更多：[Programmatic use](docs/guides/programmatic-use.md)

## 安裝

全域安裝：

```bash
npm install -g @roackb2/heddle
```

不全域安裝也可以執行：

```bash
npx @roackb2/heddle
```

安裝後的 CLI command 是 `heddle`。

## 需求

- Node.js 20+
- 至少要能存取一個 supported provider：
  - 透過 `heddle auth login openai` 使用 OpenAI account sign-in，或設定 `OPENAI_API_KEY`
  - Anthropic models 使用 `ANTHROPIC_API_KEY`

Heddle 刻意不支援 Anthropic consumer subscription OAuth。除非 Anthropic 提供 approved third-party auth route，否則請使用 Anthropic API-key access。

## Optional CyberLoop Integration

如果你想在 chat 中使用 semantic drift telemetry，請在和 Heddle 相同的 environment 安裝 `cyberloop`：

```bash
npm install -g cyberloop
# or for project-local usage
npm install cyberloop
```

如果不想全域安裝，也可以一次性使用：

```bash
npx -p @roackb2/heddle -p cyberloop heddle
```

## 文件

### 從這裡開始

- [Documentation hub](docs/README.md)
- [Runtime host model](docs/guides/runtime-host-model.md)
- [Chat and sessions guide](docs/guides/chat-and-sessions.md)
- [CLI reference](docs/reference/cli.md)

### Feature guides

- [Runtime host model](docs/guides/runtime-host-model.md)
- [Control plane](docs/guides/control-plane.md)
- [Control plane](docs/guides/control-plane.md)
- [Heartbeat](docs/guides/heartbeat.md)
- [Agent Skills](docs/guides/agent-skills.md)
- Browser Automation：請看上方 Browser Automation section
- [MCP integrations](docs/reference/mcp.md)
- [Knowledge persistence](docs/guides/knowledge-persistence.md)
- [Semantic drift](docs/guides/semantic-drift.md)
- [Programmatic use](docs/guides/programmatic-use.md)

### Contributors

- [Agent context](docs/agent-context.md)
- [Project posture](docs/project-posture.md)
- [Development and contributing](docs/guides/development.md)
- [Release convention](docs/releases/README.md)
- [Framework Vision](docs/strategy/framework-vision.md)
- [Coding Agent Roadmap](docs/strategy/coding-agent-roadmap.md)

## 專案狀態

Heddle 已經能用於真實 coding-agent workflows，但仍在持續演進。

目前強項包括：

- terminal-first coding 與 repository workflows
- autonomous、catalog-backed workspace memory，能讓 agent 從正常使用中學習
- 標準 Agent Skills 支援，包含 workspace-level activation 與 progressive disclosure
- opt-in Browser Automation，包含 browser snapshots、screenshots、policy checks 與公開 next-step agenda
- explicit traces、approval previews、diff review 與 local workspace state
- 透過 control plane 進行 browser-based oversight 與 workspace switching
- local-first heartbeat primitives，可用於 scheduled agent work
- practical programmatic hooks，可用於 custom hosts

目前限制包括：

- browser control plane 對 file review 仍是 read-only；還不是 editable IDE-like diff environment
- 某些 advanced workflows 在 source 與 examples 中比 polished product UX 更完整
- 隨著 runtime 成熟，project surface 仍在變動

## 開發

如果你想開發 Heddle 本身：

```bash
yarn install
yarn build
yarn test
```

常見 entrypoints：

- `src/cli-v2/`：目前預設 terminal UI
- `src/server/`：local control-plane API
- `src/web-v2/`：browser control-plane client
- `src/core/chat/engine/`：persisted conversation/session engine
- `src/core/runtime/`：programmatic runtime host layer
- `src/core/tools/`：built-in tools and toolkits
- `src/core/memory/`：workspace memory system
- `src/core/heartbeat/`：heartbeat task/run services
- `docs/`：user 與 contributor documentation

請先閱讀 [Agent context](docs/agent-context.md) 與 [Project posture](docs/project-posture.md)，再進行 non-trivial changes。

## 授權

MIT
