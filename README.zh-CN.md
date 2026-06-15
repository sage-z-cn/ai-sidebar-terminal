# AI 侧边栏终端

[![Visual Studio Marketplace](https://img.shields.io/visual-studio-marketplace/v/sagez.ai-sidebar-terminal?logo=visual-studio-code&label=VS%20Code%20Marketplace)](https://marketplace.visualstudio.com/items?itemName=sagez.ai-sidebar-terminal)

[English](https://github.com/sage-z-cn/ai-sidebar-terminal/blob/main/README.md)

在 VS Code 侧边栏中嵌入多种 AI 编程助手（OpenCode、Claude Code、Codex、Gemini CLI、Kimi Code、Qwen Code、Mimo Code 或任意自定义 AI 工具），提供完整终端管理。

## 功能特性

- **自动启动 AI 工具**: 侧边栏激活时自动启动所选 AI 编程助手
- **完整 TUI 支持**: xterm.js + WebGL 渲染的终端模拟
- **多 AI 工具支持**: 内置 OpenCode、Claude Code、Codex、Gemini CLI、Kimi Code、Qwen Code、Mimo Code，可自定义扩展
- **单终端模式**: 专注的单终端体验，支持会话/实例切换
- **Pill Dropdown 工具栏**: 统一的 pill 式下拉菜单，快速切换 AI 工具
- **HTTP API 集成**: 通过 HTTP API 与 OpenCode CLI 双向通信
- **自动上下文共享**: 终端打开时自动共享编辑器上下文
- **带行号的文件引用**: 以 `@filename#L10-L20` 语法发送文件引用
- **代码操作**: 对错误和警告触发诊断代码操作
- **键盘快捷键**: `Alt+A` 发送文件引用，`Cmd+Alt+A` 发送所有打开文件
- **图片粘贴支持**: 从剪贴板直接粘贴图片到终端
- **拖放支持**: 按住 Shift 拖放文件/文件夹发送引用
- **右键菜单集成**: 在资源管理器或编辑器中右键发送到 AI 终端
- **辅助侧边栏**: 将终端停靠在辅助侧边栏实现分屏工作流
- **高度可配置**: 自定义命令、字体、终端设置、HTTP API 行为和 AI 工具偏好

## 架构

本扩展提供**仅侧边栏**的终端体验。AI 工具内嵌在 VS Code 侧边栏活动栏中运行，而非原生 VS Code 终端面板。

### 通信架构

扩展采用混合通信方式：

1. **HTTP API**: 与 OpenCode CLI 的主要通信通道
   - 端口范围：16384-65535（临时端口）
   - 端点：`/health`、`/tui/append-prompt`
   - 自动发现 OpenCode CLI HTTP 服务器

2. **WebView 消息**: 扩展宿主与侧边栏 WebView 之间的终端 I/O
   - xterm.js 终端渲染
   - 双向消息传递用于输入/输出

## 使用方法

1. 点击活动栏中的 AI Sidebar Terminal 图标
2. 终端视图激活时自动启动
3. 直接在侧边栏中与 AI 工具交互

## 命令

### 基础命令

- **AI 侧边栏终端: Start OpenCode** - 手动启动 AI 工具
- **AI 侧边栏终端: Paste** - 粘贴文本到终端
- **AI 侧边栏终端: Focus Terminal** - 聚焦侧边栏终端

### 文件引用命令

- **Send File Reference (@file)** (`Alt+A`) - 发送当前文件及行号
  - 无选中：`@filename`
  - 单行：`@filename#L10`
  - 多行：`@filename#L10-L20`
- **Send All Open File References** (`Cmd+Alt+A` / `Ctrl+Alt+A`) - 发送所有打开的文件引用
- **Send to AI Terminal** - 通过右键菜单发送选中文本或文件
- **Send to Active Terminal** - 发送选中文本到活动终端

### 键盘快捷键

| 快捷键                    | 功能             | 适用场景                  |
| ------------------------- | ---------------- | ------------------------- |
| `Alt+A`                    | 发送文件引用     | 编辑器或终端              |
| `Cmd+Alt+A` / `Ctrl+Alt+A` | 发送所有打开文件 | 编辑器或终端              |
| `Cmd+V` / `Ctrl+V`         | 粘贴             | 终端聚焦时                |
| `Ctrl+P`                   | 透传             | 终端聚焦时（透传）        |

### 右键菜单

- **资源管理器**: 右键任意文件或文件夹 → "Send to AI Terminal"
- **编辑器**: 右键任意位置 → "Send File Reference (@file)"

### 拖放

- 按住 **Shift** 拖动文件/文件夹到终端，以 `@file` 引用方式发送

## HTTP API 集成

扩展通过 HTTP API 与 OpenCode CLI 通信，实现可靠的双向通信：

### 功能

- **自动发现**: 自动发现 OpenCode CLI HTTP 服务器端口
- **健康检查**: 在发送命令前验证 OpenCode CLI 可用性
- **重试逻辑**: 指数退避确保可靠通信
- **上下文共享**: 终端打开时自动共享编辑器上下文

### 工作方式

1. OpenCode 启动时在临时端口（16384-65535）上启动 HTTP 服务器
2. 扩展发现端口并建立通信
3. 文件引用和上下文通过 HTTP POST 发送到 `/tui/append-prompt`
4. 健康检查确保 OpenCode 准备就绪后再发送数据

## 自动上下文共享

启用后，终端打开时自动共享编辑器上下文：

- **打开的文件**: 列出所有当前打开的文件
- **活动选中内容**: 包含选中文本的行号
- **格式**: `@path/to/file#L10-L20`

此功能消除了手动共享上下文的需要。

> **关于行号的说明**：扩展共享的是 1-based 行号（与 VS Code 显示的行号一致）。但 OpenCode 内部使用 0-based 行号，因此自动上下文中的 `#L52` 在 OpenCode 的上下文显示中可能表现为 `#51`。这是预期行为，并非 Bug。

## 配置

在 VS Code 设置中可用（`Cmd+,` / `Ctrl+,`）：

### 终端设置

| 设置                                   | 类型    | 默认值            | 描述                                      |
| -------------------------------------- | ------- | ----------------- | ----------------------------------------- |
| `ai-sidebar-terminal.fontSize`         | number  | `12`              | 终端字号（像素，6-25）                    |
| `ai-sidebar-terminal.fontFamily`       | string  | Nerd Font 字体栈* | 终端字体族                                |
| `ai-sidebar-terminal.cursorBlink`      | boolean | `true`            | 启用光标闪烁                              |
| `ai-sidebar-terminal.cursorStyle`      | string  | `"block"`         | 光标样式：`block`、`underline`、`bar`     |
| `ai-sidebar-terminal.scrollback`       | number  | `10000`           | 回滚缓冲区最大行数（0-100000）            |
| `ai-sidebar-terminal.autoFocusOnSend`  | boolean | `true`            | 发送文件引用后自动聚焦侧边栏              |
| `ai-sidebar-terminal.autoStartOnOpen`  | boolean | `true`            | 侧边栏打开时自动启动 AI 工具              |
| `ai-sidebar-terminal.shellPath`        | string  | `""`              | 自定义 Shell 路径（空 = VS Code 默认）    |
| `ai-sidebar-terminal.shellArgs`        | array   | `[]`              | 自定义 Shell 参数                         |
| `ai-sidebar-terminal.sendKeybindingsToShell` | boolean | `true`       | 将 Ctrl/Cmd 快捷键发送到终端              |

\* 默认：`'JetBrainsMono Nerd Font', 'FiraCode Nerd Font', 'CascadiaCode NF', Menlo, monospace`

### HTTP API 设置

| 设置                                   | 类型    | 默认值  | 描述                                        |
| -------------------------------------- | ------- | ------- | ------------------------------------------- |
| `ai-sidebar-terminal.enableHttpApi`    | boolean | `true`  | 启用 HTTP API 通信                          |
| `ai-sidebar-terminal.httpTimeout`      | number  | `5000`  | HTTP API 请求超时（毫秒，1000-30000）        |
| `ai-sidebar-terminal.autoShareContext` | boolean | `true`  | 自动共享编辑器上下文给 AI 工具              |
| `ai-sidebar-terminal.contextDebounceMs` | number  | `500`   | 上下文更新防抖延迟（毫秒，100-5000）        |

### AI 工具设置

| 设置                                   | 类型    | 默认值                        | 描述                                      |
| -------------------------------------- | ------- | ----------------------------- | ----------------------------------------- |
| `ai-sidebar-terminal.aiTools`          | array   | `[{opencode, claude, codex}]` | 配置 AI 工具及其自定义路径和参数          |
| `ai-sidebar-terminal.defaultAiTool`    | string  | `"opencode"`                  | 新终端会话的默认 AI 工具                  |
| `ai-sidebar-terminal.enableAutoSpawn`  | boolean | `true`                        | AI 工具未运行时自动拉起                   |
| `ai-sidebar-terminal.promptAiToolOnSession` | boolean | `true`                   | 创建新会话时显示 AI 工具选择器            |

### 高级设置

| 设置                                            | 类型   | 默认值                 | 描述                                     |
| ----------------------------------------------- | ------ | ---------------------- | ---------------------------------------- |
| `ai-sidebar-terminal.logLevel`                  | string | `"info"`               | 日志级别：`debug`、`info`、`warn`、`error` |
| `ai-sidebar-terminal.maxDiagnosticLength`       | number | `500`                  | 诊断消息最大长度（100-2000）              |
| `ai-sidebar-terminal.codeActionSeverities`      | array  | `["error", "warning"]` | 触发代码操作的诊断严重级别                |

### 示例配置

```json
{
  "ai-sidebar-terminal.fontSize": 12,
  "ai-sidebar-terminal.fontFamily": "'JetBrainsMono Nerd Font', monospace",
  "ai-sidebar-terminal.cursorBlink": true,
  "ai-sidebar-terminal.cursorStyle": "block",
  "ai-sidebar-terminal.scrollback": 10000,
  "ai-sidebar-terminal.enableHttpApi": true,
  "ai-sidebar-terminal.httpTimeout": 5000,
  "ai-sidebar-terminal.autoShareContext": true,
  "ai-sidebar-terminal.defaultAiTool": "opencode"
}
```

## 安装

### 从源码构建

1. 克隆仓库：

```bash
git clone https://github.com/sage-z-cn/ai-sidebar-terminal.git
cd ai-sidebar-terminal
```

2. 安装依赖：

```bash
npm install
```

3. 构建扩展：

```bash
npm run build-and-install
```

4. 打包扩展：

```bash
npx @vscode/vsce package
```

5. 在 VS Code 中安装：

- 打开 VS Code
- 打开扩展面板（`Cmd+Shift+X` / `Ctrl+Shift+X`）
- 点击"..."菜单 → "从 VSIX 安装"
- 选择生成的 `.vsix` 文件

## 许可证

MIT — 详见 [LICENSE](LICENSE)。
