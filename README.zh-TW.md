# Heddle

[English](README.md) | [繁體中文](README.zh-TW.md)

**把 agentic experience 帶進你的產品，同時保有架構主導權。**

Heddle 是開源的 TypeScript agent runtime 與 SDK，提供可持久化對話、tool
與 MCP 執行、approval、artifact、可追蹤的 activity，以及可重新連線的
hosted run。

你的產品仍掌控 identity、資料關係、API policy、部署、transport 與 UI。
可以先建立一個可運作的對話，再依產品需求逐層採用 Heddle。

想先看看 runtime 實際如何運作，再決定是否嵌入產品？Heddle 的本機 coding
agent、terminal UI 與 browser control plane，都建立在 SDK 對外提供的同一套
conversation 與 run 基礎之上。

官方網站：[heddleagent.com](https://heddleagent.com)

從這裡開始：
[SDK 快速入門](docs/guides/programmatic/quickstart.md) ·
[複製 starter recipe](docs/guides/programmatic/starter-recipes.md) ·
[選擇整合層級](docs/guides/programmatic/integration-layers.md) ·
[可執行的 SDK 範例](examples/sdk/README.md) ·
[試用 coding agent](#將-heddle-當作-coding-agent-試用)

## 為什麼選 Heddle

呼叫模型並註冊一個 tool，只是 agentic product 的起點。真正困難的產品工程，
通常從對話必須跨多個 turn、顯示可理解的 activity、等待 approval、跨越單一
HTTP request 的生命週期、在瀏覽器重新整理後重新連線，並在不洩漏內部狀態的
前提下套用結果開始。

Heddle 負責這些可重用的 runtime mechanics，同時把產品決策留在產品內：

- 可持久化的多輪對話、continuation、compaction 與 lease；
- 原生 tool、Agent Skills，以及經過挑選的 MCP-backed host extension；
- approval request、semantic activity、trace、artifact 與 typed turn result；
- 可定址的 active run、排序過的 event、bounded replay、cancellation、
  approval resolution，以及唯一 terminal outcome；
- runtime-validated remote envelope、cursor 推進、duplicate/gap handling，
  與 bounded reconnect calculation；
- file-backed 本機預設值，以及 host capability、storage、output、policy 與
  transport 的明確擴充點。

Heddle 適合以 TypeScript 建置文件 agent、研究助理、內部 copilot、營運 agent
或其他產品體驗的團隊，尤其是重視可檢查性與 host control，而不只需要一次性
chat endpoint 的情境。

## 開始建置

### 最快的 SDK 評估方式

安裝 Node runtime package：

```bash
npm install @roackb2/heddle
```

接著透過可持久化對話送出一個 structured turn：

```ts
import { ConversationAgentService } from '@roackb2/heddle'

const agent = new ConversationAgentService()
try {
  const result = await agent.send({
    prompt: '整理這個專案，並指出主要的驗證路徑。',
  })

  console.log(result.summary)
  console.log(result.activities)
} finally {
  await agent.close()
}
```

Headless service 會解析 workspace、本機 state root、已設定的 model 與
credential，race-safe 地 ensure 一個穩定的 durable session，並回傳
structured activities 與 Heddle 原本的 turn result。它不會替產品選擇 UI、
transport、auth system 或 product transaction。One-shot host 必須 await
`close()`；長時間運行的 host 則應在關閉應用程式時 await 它。

在此 repository 中執行對應範例：

```bash
yarn example:sdk:headless "What does this project do?"
```

如果還希望 Heddle 暫時提供 terminal prompt loop 與 text rendering，可使用
`runQuickstartConversationCli()`。兩條路徑請參考
[SDK 快速入門](docs/guides/programmatic/quickstart.md)。

### 掌控 presentation 與 turn lifecycle

當產品需要自行掌控 rendering、command、approval 或 session browsing 時，
改用 `createConversationEngine`：

```ts
import { join } from 'node:path'
import {
  createConversationEngine,
  createConversationTextHost,
} from '@roackb2/heddle'

const workspaceRoot = process.cwd()

const engine = createConversationEngine({
  workspaceRoot,
  stateRoot: join(workspaceRoot, '.heddle'),
  model: process.env.HEDDLE_MODEL ?? 'gpt-5.4',
})

const session = await engine.sessions.create({
  name: 'Product assistant',
})

const textHost = createConversationTextHost({
  output: (text) => process.stdout.write(text),
})

const result = await engine.turns.submit({
  sessionId: session.id,
  prompt: 'Summarize this workspace and identify the main verification path.',
  host: textHost.host,
})

textHost.renderTurnResult(result)
```

Text host 提供一個可運作的 output surface。當產品擁有自己的 UI 時，可將它
替換成產品的 activity、approval、telemetry 與 result handler。若 turn 必須
超過單一 request 的生命週期，或支援 remote reconnect，請繼續閱讀
[hosted agent stack](examples/sdk/05-hosted-agent/README.md)。

## 重用 Runtime，產品仍由你掌控

Heddle 刻意不是一個完整 application framework：

```text
你的產品
  UI state 與 result application
          |
  @roackb2/heddle-remote + optional HTTP/SSE client
          |
  你的 API、authentication、public schema 與 product state
========================= HEDDLE SDK =========================
  ConversationRunService
  run identity、ordered activity、replay、cancel、approvals
          |
  ConversationEngine
  sessions、turns、compaction、traces、artifacts
          |
  models、tools、host extensions、MCP
```

| 關注點 | Heddle 負責 | 你的產品負責 |
| --- | --- | --- |
| Conversation | Message、turn、continuation、compaction、lease 與 persisted session behavior | 穩定的 product conversation ID、access rule 與產品資料關係 |
| Execution | Model/tool loop、tool execution、host extension、trace、activity 與 artifact | Product tool、system context、model choice、credential 與 capability policy |
| Approvals | Request/resolution lifecycle 與 run integration | 誰能批准、approval policy 與 approval UI |
| Active runs | Run ID、ordered sequence、bounded replay、cancellation 與 terminal settlement | Process lifetime、routing、draining 與 multi-process delivery |
| Remote clients | Runtime envelope validation、cursor/duplicate/gap rule、terminal detection 與 reconnect calculation | Public payload schema、timer、UI state、retry UX 與 result presentation |
| Persistence | File-backed 預設值與可注入的 session/artifact repository boundary | Production adapter、retention、encryption、backup、tenancy 與 product record |
| API 與 UI | 選用的 Node HTTP/SSE 與 browser transport mechanics | Server framework、route、auth、CORS、limit、error 與所有視覺決策 |

完整的責任邊界請參考
[選擇 Programmatic Integration Layer](docs/guides/programmatic/integration-layers.md)。

## 選擇整合深度

Heddle 的 public entry point 會明確表達各層假設。選擇已經涵蓋 host 所需
mechanics 的最低層即可：

| Host 需求 | 從這裡開始 | 增加的能力 |
| --- | --- | --- |
| Structured 本機對話 | `ConversationAgentService` | Runtime defaults、stable session ensure、structured activities 與 turn result |
| Terminal SDK 評估 | `runQuickstartConversationCli` | Prompt loop、persisted session、credential 與 text output |
| 自訂 output、tool 或 session UX | `@roackb2/heddle` | Conversation engine、host extension、tool、MCP、approval、artifact 與 turn result |
| Server、worker 或 Electron backend | `@roackb2/heddle/hosted` | 可定址的 process-local run、replay、cancellation 與 approval resolution |
| 一般 Node HTTP/SSE | `@roackb2/heddle/hosted/http-sse` | Replay cursor parsing、SSE framing、backpressure 與 disconnect cleanup |
| Remote browser 或 client | `@roackb2/heddle-remote` | Browser-safe protocol validation 與 transport-neutral run consumption |
| 一般 browser REST/SSE | `@roackb2/heddle-remote/http-sse` | Authenticated fetch、incremental SSE parsing 與 transport validation |
| 更底層的 runtime 組裝 | `@roackb2/heddle/advanced` | Model adapter、individual tool、trace、memory、heartbeat 與 core runtime service |

既有的 tRPC、Fastify、Hono、Nest、WebSocket、IPC、queue、React 或其他技術棧，
通常應保留原本的選擇，再銜接最接近的 transport-neutral Heddle layer。不要
只因 reference example 使用 Express 或 React，就在產品中加入它們。

## 漸進式 SDK 範例

可執行的範例會以小步驟教你逐層客製：

1. [Headless conversation](examples/sdk/01-headless-conversation.ts) — 透過
   persisted session 送出 structured turn；需要 terminal loop 時則使用
   [interactive chat](examples/sdk/01-interactive-chat.ts)。
2. [Add a tool](examples/sdk/02-add-a-tool.ts) — 暴露產品原生能力。
3. [Add an MCP server](examples/sdk/03-add-an-mcp-server.ts) — 不複製 schema，
   直接準備經過挑選的 MCP-backed capability。
4. [Custom output](examples/sdk/04-custom-output.ts) — 保留 conversation
   semantics，同時替換 presentation。
5. [Hosted agent stack](examples/sdk/05-hosted-agent/README.md) — 從
   transport-neutral service，逐步走到選用的 HTTP/SSE API、browser client
   與 React reference。

每個階段都會說明假設與責任邊界。只複製符合產品架構的 layer。

## 核心能力

### 對話與結果

- 可持久化 session，包含 create、resume、continue、rename、archive 與
  compaction path；
- text、tool、approval、lifecycle 與 progress 的 structured conversation
  activity；
- 包含 trace、tool outcome、artifact 與安全 typed model failure 的 turn
  summary；
- 產出文件與大型 tool result 的 artifact capture，包含 stateless MCP tool
  的 mirror workflow。

### 能力與控制

- Host-owned `ToolDefinition` capability 與可重用 tool registry；
- 支援 workspace activation 與 progressive disclosure 的 Agent Skills；
- 支援 curated exposure、override 與 result-artifact rule 的 prepared MCP
  host extension；
- approval policy chain 與 host-owned approval decision；
- OpenAI、Anthropic、Ollama 與 OpenAI-compatible provider profile。

### Hosted 與 remote runs

- 每個 host-defined conversation address 僅有一個 active run；
- stable run ID、ordered event sequence、bounded replay、explicit
  cancellation 與 approval resolution；
- 在 success terminal 對外可見前，等待 product result projection 完成；
- 安全的 public error projection，讓 provider 與 persistence diagnostic 留在
  host；
- 輕量 browser package，不帶入 Heddle 的 Node runtime、CLI、model
  provider、server 與 control plane。

完整內容請參考
[programmatic guide index](docs/guides/programmatic/README.md)。

## 將 Heddle 當作 Coding Agent 試用

Coding agent 是把 Heddle runtime 當成完整 product host 體驗的最快方式。

安裝 CLI：

```bash
npm install -g @roackb2/heddle
```

設定一個 provider。使用 OpenAI Platform API key：

```bash
export OPENAI_API_KEY=your_key_here
```

或選擇實驗性的 OpenAI account sign-in：

```bash
heddle auth login openai
```

接著開啟任何 repository：

```bash
cd /path/to/project
heddle
```

試著輸入：

```text
Summarize this repository, identify its main entrypoints, and show me the
commands used to build and test it.
```

執行一次性的 saved run：

```bash
heddle ask "Review the current repository and identify the highest-risk change."
```

從 browser 與 mobile 監看同一組對話：

```bash
heddle daemon
```

![Heddle 在 terminal、browser 與 mobile 同步串流同一個 session](docs/images/heddle-cross-device-stream.gif)

Reference product 也包含 saved session、reviewable diff、workspace memory、
Agent Skills、custom agent、MCP integration、heartbeat task，以及 opt-in
Browser Automation。它們既是實用產品功能，也會持續驗證同一套可重用 runtime
boundary。

延伸閱讀：

- [Chat 與 session](docs/guides/chat-and-sessions.md)
- [Control plane](docs/guides/control-plane.md)
- [Provider 與 model](docs/reference/providers-and-models.md)
- [Capability 與 Browser Automation](docs/reference/capabilities.md)
- [Agent Skills](docs/guides/agent-skills.md)
- [Custom agents](docs/guides/custom-agents.md)
- [Knowledge persistence](docs/guides/knowledge-persistence.md)
- [Heartbeat](docs/guides/heartbeat.md)
- [MCP integration](docs/reference/mcp.md)

OpenAI account sign-in 是 Heddle 實驗性、由使用者主動選擇的 transport。它不
代表 OpenAI 官方支援；Heddle 與 OpenAI 無隸屬、背書或贊助關係。使用 OpenAI
服務仍須遵守 OpenAI 的條款與政策。

## Production 使用邊界

Heddle 刻意讓假設與限制保持可見：

- Curated SDK 的目標 host 為 Node.js 20+ TypeScript/ESM；
- conversation state 會透過設定的 repository 持久化，但 active-run handle
  與 replay 為 process-local 且有界；
- multi-process routing 與 durable in-flight delivery，需要由 host 選擇並
  提供基礎設施；
- session 與 artifact repository 可注入，但 production retention、
  encryption、backup、tenancy 與 adapter operation 仍由 host 負責；
- trace、compaction archive、memory 與部分 supporting state 仍是
  local/path-oriented，除非 host 明確提供其他 integration path；
- HTTP/SSE helper 負責 wire correctness，不負責 route registration、
  authentication、authorization、CORS、limit、billing 或 deployment；
- `@roackb2/heddle-remote` 會驗證 run protocol，但不負責 product
  message、UI state、authentication 或 result rendering；
- SDK 仍持續演進，升級 public API 前請先閱讀
  [release notes](docs/releases/README.md)。

Heddle 不是 hosted agent SaaS，也不要求產品採用特定 identity provider、
database、server framework、transport、UI framework 或 deployment platform。

## 文件

### 使用 SDK 建置

- [Programmatic hosts](docs/guides/programmatic/README.md)
- [SDK 快速入門](docs/guides/programmatic/quickstart.md)
- [Integration-layer chooser](docs/guides/programmatic/integration-layers.md)
- [Conversation engine](docs/guides/programmatic/conversation-engine.md)
- [Host extensions](docs/guides/programmatic/host-extensions.md)
- [MCP host extensions](docs/guides/programmatic/mcp-host-extensions.md)
- [Remote conversation runs](docs/guides/programmatic/remote-runs.md)
- [Result artifacts](docs/guides/programmatic/result-artifacts.md)
- [可執行的 SDK 範例](examples/sdk/README.md)

### 在本機使用 Heddle

- [文件入口](docs/README.md)
- [Runtime host model](docs/guides/runtime-host-model.md)
- [Chat 與 session](docs/guides/chat-and-sessions.md)
- [Control plane](docs/guides/control-plane.md)
- [CLI reference](docs/reference/cli.md)
- [Project configuration](docs/reference/config.md)

### 參與貢獻

- [Agent context](docs/agent-context.md)
- [Project posture](docs/project-posture.md)
- [開發指南](docs/guides/development.md)
- [Core layering](docs/architecture/core-layering.md)
- [Framework vision](docs/strategy/framework-vision.md)

## 開發

```bash
git clone https://github.com/roackb2/heddle.git
cd heddle
yarn install
yarn build
yarn test
```

`yarn test` 會執行預設 unit 與 integration suites。Browser integration
coverage 位於 `src/__tests__/browser-integration`。

## 授權

Heddle 採用 MIT License。詳見 [LICENSE](LICENSE)。
