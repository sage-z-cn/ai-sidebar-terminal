# OpenCode Server API / SSE 事件参考

供本扩展对接 OpenCode 时查阅。基于：

- 官方文档：https://opencode.ai/docs/server/
- 类型：`@opencode-ai/sdk@1.18.30`（`types.gen.d.ts`）
- 本地运行时可打开：`http://localhost:<port>/doc`（OpenAPI 3.1）

> OpenCode 版本升级可能增删路由/事件；以运行中实例的 `/doc` 为准。

---

## 连接模型

| 通道 | 协议 | 用途 |
|------|------|------|
| PTY（node-pty） | 终端 I/O | TUI 本体：spawn `opencode`，键盘输入 / 屏幕输出 |
| HTTP | REST | 健康检查、注入 prompt、会话/文件/配置等 |
| SSE | `GET /event`、`GET /global/event` | 实时 bus 事件推送（**无需轮询**） |
| WebSocket | Claude Code IDE 协议 | 编辑器上下文（selection / @mention），**不是** OpenCode 主 API |

本扩展当前实现：

- `OpenCodeApiClient`：`GET /global/health`、`POST /tui/append-prompt`
- `IdeContextServer`：独立 WS（`~/.claude/ide/<port>.lock`），与下文 HTTP/SSE 无关

### 端口与寻址

- 扩展为 OpenCode 分配临时端口（`16384-65535`），经环境变量注入；TUI 自选端口时也可用。
- **Instance 级路由**（`/tui/*`、`/session/*` 等）需要二选一：
  - Header：`x-opencode-directory: <workspace path>`
  - Query：`?directory=<workspace path>`
- 省略时服务端回退到自身 `process.cwd()`，多项目下不可靠，客户端应始终带上 directory。

### 认证（可选）

设置 `OPENCODE_SERVER_PASSWORD` 后启用 HTTP Basic Auth（默认用户名 `opencode`）。

### 重要路径说明

- 健康检查必须用 **`GET /global/health`**，不要用 `/health`（会落到 SPA index）。
- 完整规格：`GET /doc`。

---

## HTTP API

### Global

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| GET | `/global/health` | 健康与版本 | `{ healthy: boolean, version?: string }` |
| GET | `/global/event` | 全局 SSE（带 directory） | `{ directory, payload: Event }` 流 |

### Project / Path / VCS

| Method | Path | Description |
|--------|------|-------------|
| GET | `/project` | 列出项目 |
| GET | `/project/current` | 当前项目 |
| GET | `/path` | 当前路径 |
| GET | `/vcs` | 当前项目 VCS 信息（分支等） |

### Instance

| Method | Path | Description |
|--------|------|-------------|
| POST | `/instance/dispose` | 释放当前实例 |

### Config / Provider

| Method | Path | Description |
|--------|------|-------------|
| GET | `/config` | 读配置 |
| PATCH | `/config` | 改配置 |
| GET | `/config/providers` | 提供商与默认模型 |
| GET | `/provider` | 全部提供商 |
| GET | `/provider/auth` | 认证方式 |
| POST | `/provider/{id}/oauth/authorize` | OAuth 授权 |
| POST | `/provider/{id}/oauth/callback` | OAuth 回调 |

### Sessions

| Method | Path | Description | Notes |
|--------|------|-------------|-------|
| GET | `/session` | 列出会话 | |
| POST | `/session` | 新建会话 | body `{ parentID?, title? }` |
| GET | `/session/status` | **全部会话状态** | `{ [sessionID]: SessionStatus }` |
| GET | `/session/:id` | 会话详情 | |
| DELETE | `/session/:id` | 删除会话 | |
| PATCH | `/session/:id` | 更新（如 title） | |
| GET | `/session/:id/children` | 子会话 | |
| GET | `/session/:id/todo` | Todo 列表 | |
| POST | `/session/:id/init` | 分析应用并生成 AGENTS.md | |
| POST | `/session/:id/fork` | 在某消息处分叉 | |
| POST | `/session/:id/abort` | **中断当前会话** | 停止按钮可接 |
| POST / DELETE | `/session/:id/share` | 分享 / 取消分享 | |
| GET | `/session/:id/diff` | 会话 diff | query `messageID?` |
| POST | `/session/:id/summarize` | 摘要 | |
| POST | `/session/:id/revert` / `/unrevert` | 回滚 / 恢复消息 | |
| POST | `/session/:id/permissions/:permissionID` | **程序化回复权限请求** | body `{ response, remember? }` |

`SessionStatus`（与 SSE 共用）：

```ts
type SessionStatus =
  | { type: "idle" }
  | { type: "busy" }
  | { type: "retry"; attempt: number; message: string; next: number };
```

### Messages

| Method | Path | Description | Notes |
|--------|------|-------------|-------|
| GET | `/session/:id/message` | 列出消息 | query `limit?` |
| POST | `/session/:id/message` | 发送并等待回复 | parts 等 |
| GET | `/session/:id/message/:messageID` | 单条消息 | |
| POST | `/session/:id/prompt_async` | **异步发送（不阻塞）** | 204 |
| POST | `/session/:id/command` | 执行 slash 命令 | |
| POST | `/session/:id/shell` | 在会话上下文跑 shell | |

### Commands / Files / Find

| Method | Path | Description |
|--------|------|-------------|
| GET | `/command` | 列出 slash 命令 |
| GET | `/find?pattern=` | 全文搜索 |
| GET | `/find/file?query=` | 按名找文件（fuzzy；`type`/`directory`/`limit`） |
| GET | `/find/symbol?query=` | 工作区符号 |
| GET | `/file?path=` | 列目录 |
| GET | `/file/content?path=` | 读文件 |
| GET | `/file/status` | 受跟踪文件状态（类 git status） |

### Tools（实验性）/ LSP / Formatter / MCP / Agent

| Method | Path | Description |
|--------|------|-------------|
| GET | `/experimental/tool/ids` | 工具 ID 列表 |
| GET | `/experimental/tool?provider=&model=` | 模型可用工具 schema |
| GET | `/lsp` | LSP 状态 |
| GET | `/formatter` | Formatter 状态 |
| GET | `/mcp` / POST `/mcp` | MCP 状态 / 动态注册 |
| GET | `/agent` | 可用 agent 列表 |
| POST | `/log` | 写日志 `{ service, level, message, extra? }` |
| PUT | `/auth/:id` | 写入提供商凭据 |

### TUI 驱动

与 `append-prompt` 同类，直接操控已打开的 TUI：

| Method | Path | Body / 说明 |
|--------|------|-------------|
| POST | `/tui/append-prompt` | `{ text }` — 本扩展已在用 |
| POST | `/tui/submit-prompt` | 提交当前 prompt（自动回车） |
| POST | `/tui/clear-prompt` | 清空输入框 |
| POST | `/tui/execute-command` | `{ command }` |
| POST | `/tui/open-help` | 打开帮助 |
| POST | `/tui/open-sessions` | 会话选择器 |
| POST | `/tui/open-themes` | 主题选择器 |
| POST | `/tui/open-models` | 模型选择器 |
| POST | `/tui/show-toast` | `{ title?, message, variant }`，`variant`: info/success/warning/error |
| GET | `/tui/control/next` | 等待下一个 control 请求 |
| POST | `/tui/control/response` | 回复 control `{ body }` |

### SSE Events

| Method | Path | Description |
|--------|------|-------------|
| GET | `/event` | 实例事件流；首包 `server.connected` |
| GET | `/global/event` | 全局事件流；每条为 `{ directory, payload: Event }` |

SDK 用法示意：

```ts
const events = await client.event.subscribe();
for await (const event of events.stream) {
  // event.type, event.properties
}
```

扩展侧用 `fetch` + `text/event-stream` / `EventSource` 均可；注意断线重连。

---

## SSE 事件类型（`Event`）

Payload 信封：

```ts
// /event
{ type: string; properties: {...} }

// /global/event
{ directory: string; payload: { type: string; properties: {...} } }
```

### 连接与实例

| type | properties |
|------|------------|
| `server.connected` | `{}`（流建立） |
| `server.instance.disposed` | `{ directory }` |
| `installation.updated` | `{ version }` |
| `installation.update-available` | `{ version }`（及元数据） |

### 会话（空闲检测 / 状态核心）

| type | properties | 用途 |
|------|------------|------|
| **`session.idle`** | `{ sessionID }` | **会话空闲，可做完成通知** |
| **`session.status`** | `{ sessionID, status: SessionStatus }` | busy / idle / retry |
| `session.created` / `updated` / `deleted` | `{ info: Session }` | 生命周期 |
| `session.compacted` | `{ sessionID }` | 压缩完成 |
| `session.diff` | `{ sessionID, diff: FileDiff[] }` | 本轮文件 diff |
| `session.error` | `{ sessionID?, error? }` | 失败提示 |

### 消息与工具调用

| type | properties |
|------|------------|
| `message.updated` | `{ info: Message }` |
| `message.removed` | `{ sessionID, messageID }` |
| `message.part.updated` | 分片更新（文本流、工具调用等） |
| `message.part.removed` | 分片删除 |

### 权限（审批 UI）

| type | properties |
|------|------------|
| `permission.updated` | `Permission`（含 id、title、sessionID、metadata…） |
| `permission.replied` | `{ sessionID, permissionID, response }` |

### 文件 / Todo / 命令 / VCS

| type | properties |
|------|------------|
| `file.edited` | `{ file }` — agent 改过的文件（可做热力/跳转） |
| `file.watcher.updated` | `{ file, event: "add"\|"change"\|"unlink" }` |
| `todo.updated` | `{ sessionID, todos: Todo[] }` |
| `command.executed` | `{ name, sessionID, arguments, messageID }` |
| `vcs.branch.updated` | `{ branch? }` |

`Todo`：

```ts
{
  id: string;
  content: string;
  status: string;   // pending | in_progress | completed | cancelled
  priority: string; // high | medium | low
}
```

### TUI / PTY / LSP

| type | properties |
|------|------------|
| `tui.prompt.append` | `{ text }` |
| `tui.command.execute` | `{ command }`（如 `prompt.submit`、`session.interrupt`） |
| `tui.toast.show` | `{ title?, message, variant, duration? }` |
| `pty.created` / `pty.updated` | `{ info: Pty }` |
| `pty.exited` | `{ id, exitCode }` |
| `pty.deleted` | `{ id }` |
| `lsp.client.diagnostics` / `lsp.updated` | LSP 诊断与状态 |

`Pty`：`{ id, title, command, args, cwd, status: "running"|"exited", pid }`

---

## 与本扩展相关的推荐接法

| 需求 | 优先 | 备注 |
|------|------|------|
| 完成 / 空闲提醒 | SSE `session.idle`（或 `session.status` → idle） | 比 PTY 静默准 |
| 中断 agent | `POST /session/:id/abort` | 可配合工具栏停止按钮 |
| 填入并发送 | `append-prompt` + `submit-prompt` | 现只用 append |
| 会话忙闲 | `GET /session/status` 或 SSE | 仅 OpenCode 有 HTTP 时 |
| agent 碰过的文件 | SSE `file.edited` | 会话收据 / 热力 |
| 权限请求提示 | SSE `permission.updated` + POST permissions | |
| 失败 toast | SSE `session.error` | |
| 无 HTTP 工具（Claude/Codex…） | PTY quiet 回退 | 通用 fallback |

**空闲检测建议**：OpenCode + HTTP 可用 → 订阅 SSE；否则 PTY 静默超时。

---

## 相关代码（本仓库）

| 文件 | 职责 |
|------|------|
| `src/services/OpenCodeApiClient.ts` | health + append-prompt |
| `src/services/ideContext/` | Claude 风格 IDE Context WS（非本表 HTTP） |
| `src/providers/SessionRuntime.ts` | HTTP ready 轮询、会话启动 |

新增 HTTP 方法时，优先扩在 `OpenCodeApiClient`，并带上 `x-opencode-directory`。
