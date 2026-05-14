# Catcher

[English](README.md) | **简体中文**

> **开源、本地优先、自带 LLM Key 的 AI Web 测试工具。** 用英文描述测试，在你自己机器上的真实浏览器里跑。

[![Release](https://img.shields.io/github/v/release/Catcher2026/Catcher?include_prereleases)](https://github.com/Catcher2026/Catcher/releases)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![CI](https://github.com/Catcher2026/Catcher/actions/workflows/ci.yml/badge.svg)](https://github.com/Catcher2026/Catcher/actions/workflows/ci.yml)

![Catcher 演示](demo.gif)

## ✨ 它有什么不一样

大部分 AI 测试工具是付费 SaaS，测试跑在他们的云上、用他们的 LLM。Catcher 是反过来的：

- **桌面应用，不是托管服务**——你的站点、会话、cookie、截图永远不离开你的机器
- **自带 LLM Key (BYOK)**——把它指向 OpenAI / Anthropic / Gemini / Ollama / 任何 OpenAI 兼容接口；你直接付费给 LLM 提供商
- **视觉坐标兜底**——当所有选择器策略都点不中时，Catcher 会截屏、让 LLM 指出 `{x, y}` 坐标。能从遮罩、动画、CSS 遮挡这类场景恢复，是其他 planner 通常搞不定的
- **MIT 协议、无遥测**——可以 fork、可以审计、可以塞进公司内部用

## 📝 长什么样

你用自然语言写步骤，Catcher 用 Playwright 跑：

```
Click the 'Sign in' button
Type 'alice@example.com' in the email field
Type 'hunter2' in the password field
Click the 'Continue' button
Verify the page contains 'Welcome, Alice'
```

每一步先走启发式匹配活的 DOM；只有启发式没把握时才调 LLM。这让简单测试又快又便宜——大多数点击根本不会打到 API。

## 📦 安装

从 [Releases 页](https://github.com/Catcher2026/Catcher/releases) 下载对应平台的安装包：

- **Windows** —— `Catcher Setup x.y.z.exe`（NSIS 安装器，约 290 MB）
- **macOS Apple Silicon** —— `Catcher-x.y.z-arm64.dmg`
- **macOS Intel** —— `Catcher-x.y.z.dmg`

> 安装包**未签名**（还没有 Apple Developer 或 Windows 代码签名证书）。
>
> - Windows SmartScreen 会警告 "Unknown publisher"。点 **More info → Run anyway**。
> - macOS Gatekeeper 第一次会拒绝打开，右键点 App → **Open** 后确认。或者跑 `xattr -dr com.apple.quarantine /Applications/Catcher.app`。

## 🚀 快速上手

1. 启动 Catcher。
2. 打开 **Settings** → 从下拉选一个模型（GPT-4o、Claude Sonnet、Gemini Pro 等）粘贴 API key。所有预设模型都支持视觉（坐标兜底特性会用到）。
3. 点 **+ Add site**，填一个 URL。
4. 点 **+ New test** → 加步骤。
5. 按 **▶ Run this test**。在右侧抽屉里看实时浏览器画面。

要写出让 planner 稳定处理的步骤，详见 [`PROMPT_WRITING_GUIDE.md`](PROMPT_WRITING_GUIDE.md)。短版本：

- **任何字面量都加引号**：`Click the 'Save' button`、`Type 'hello' in the search box`、`Verify the page contains 'Order placed'`。被引号包起来的字符串走确定性子串匹配，几乎不会出错。
- **每步只一个动作**。"填表然后提交"要拆成两个 Act。
- **断言时**，引用用户实际能在页面上看到的文字。

## 🎯 功能

- **三种步骤类型** —— Act（LLM 规划的点击/输入/悬停等）、Assert（带引号时走确定性匹配，否则 LLM 判定）、Wait（按秒数纯等待）
- **认证档案** —— 通过真实浏览器窗口登录一次，会话持久化。每个测试绑自己的档案；Run-all 时一并使用
- **AI 生成步骤** —— 描述一个流程，Catcher 看一眼活的页面给你起草一份步骤列表，可编辑
- **实时运行抽屉** —— 把浏览器视图 + 每步的推理过程都流式呈现，你能看到 planner 究竟点了什么、为什么

## ⚙️ 配置

设置存在 `~/.catcher/settings.json`。多数用户只需要管这几项：

| 字段 | 默认值 | 说明 |
|---|---|---|
| LLM provider + model | OpenAI `gpt-4o-mini` | 在 Settings 下拉里选——所有预设都支持视觉 |
| API key | 空 | 本地存储；只会发到你指定的 provider |
| Send screenshot to LLM | 开 | 视觉点击兜底必须开。预设模型都支持。自定义接口可能不支持——模型不带视觉时准确率会下降 |
| Headless | 开 | 关掉可以本地肉眼看 Playwright 浏览器跑测试 |
| Action timeout | 5000ms | Playwright 单次操作等待多久才落入兜底 |
| Confidence threshold | 0.7 | 低于这个置信度的断言变成 "needs review" 而不是 pass/fail |

## 🏗️ 架构

```
┌─────────────────────────────────────────────────────────┐
│                      Renderer (React)                   │
│  Sidebar · Tests · Editor · Run drawer · Settings       │
└──────────────────────────┬──────────────────────────────┘
                           │ IPC (window.catcher)
┌──────────────────────────┴──────────────────────────────┐
│                  Main process (Electron)                │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐ ┌──────────┐  │
│  │ storage  │  │  runner  │  │ generate │ │   auth   │  │
│  └──────────┘  └────┬─────┘  └─────┬────┘ └────┬─────┘  │
│                     │              │           │        │
│              ┌──────┴──────────────┴───────────┴─────┐  │
│              │   snapshot · actions · llm clients   │  │
│              └─────────────────┬────────────────────┘  │
└────────────────────────────────┼────────────────────────┘
                                 │
                          Playwright (Chromium)
```

- `electron/runner.ts` —— 执行引擎：单步规划、重试、视觉兜底、屏幕共享、取消处理
- `electron/snapshot.ts` —— 收集 planner 需要的 ARIA 树 + 可点击列表（带排序）+ 遮罩检测
- `electron/actions.ts` —— 把一个 `PlannedAction` 翻译成 Playwright 调用，附点击回退链（Playwright click → 角点点击穿透 backdrop → 通过 `page.evaluate` 调原生 `el.click()` → 视觉坐标）
- `electron/generate.ts` —— AI 测试生成（看一次活页面，起草步骤列表）
- `electron/llm.ts` —— 与 provider 无关的完成接口（OpenAI、Anthropic、Gemini、OpenAI 兼容）

## 🔧 开发

要求：Node 20+、Git。

```bash
git clone https://github.com/Catcher2026/Catcher.git catcher
cd catcher
npm install            # postinstall 把 Chromium 下到 node_modules/playwright-core/.local-browsers
npm run dev            # vite + electron 监听模式
```

### 常用脚本

| 命令 | 用途 |
|---|---|
| `npm run dev` | 监听模式启动（Vite + Electron，热重载） |
| `npm test` | 跑单元测试（vitest）—— 覆盖启发式 + LLM plan 解析 |
| `npm run build:renderer` | 类型检查 + 构建 React 渲染层 |
| `npm run dist:win` | 构建 Windows 安装器（NSIS `.exe`）输出到 `release/` |
| `npm run dist:mac` | 构建 macOS `.dmg` 输出到 `release/`（必须在 macOS 上跑） |
| `npm run dist` | 同时构建两端（仅 macOS） |

### 仓库结构

```
catcher/
├── electron/                Main process（Node）—— runner、snapshot、actions、LLM 客户端
│   ├── runner.ts            执行引擎：snapshot → plan → execute → assert，带重试 / 取消
│   ├── snapshot.ts          收集 planner 需要的 ARIA 树 + 排序后的可点击列表 + 遮罩
│   ├── heuristics.ts        纯函数：token 提取 + 点击目标打分（有单测）
│   ├── planParser.ts        LLM plan JSON 校验，垃圾抛 InvalidPlanError（有单测）
│   ├── actions.ts           把一个 PlannedAction 翻译成 Playwright 调用，附点击回退链
│   ├── generate.ts          AI 测试生成（看活页面起草步骤列表）
│   ├── llm.ts               与 provider 无关的完成接口（OpenAI / Anthropic / Gemini / OpenAI-compat）
│   ├── pricing.ts           各 provider 的 token 成本估算
│   ├── auth.ts              认证档案管理（登录一次，会话持久化）
│   ├── storage.ts           ~/.catcher/ 下的本地 JSON 存储（站点、测试、运行、设置）
│   ├── engine.ts            浏览器类型选择
│   ├── main.ts              Electron 主进程入口，IPC 处理器
│   ├── preload.ts           把 IPC 桥暴露为 window.catcher
│   └── __tests__/           Vitest 单测（heuristics、planParser）
├── shared/                  Main / renderer 共享的类型 + IPC 协议
│   ├── types.ts             领域类型（Site、TestCase、RunResult、Settings 等）
│   └── ipc.ts               频道名 + payload 契约
├── src/                     渲染层（React）
│   ├── App.tsx              顶层布局
│   ├── store.ts             Zustand store（tests / runs / settings）
│   ├── main.tsx             React 入口
│   ├── index.css            Tailwind base + 微调
│   └── components/          Sidebar、TestEditor、ResultsTab、SettingsModal 等
├── .github/
│   └── workflows/
│       ├── ci.yml           每个 PR 跑类型检查 + 测试 + 构建
│       └── release.yml      Tag push 时构建 Win + Mac 安装包
├── CONTRIBUTING.md          新代码放哪 + 测试约定
├── PROMPT_WRITING_GUIDE.md  如何写出 planner 稳定处理的步骤
└── package.json
```

### 一个步骤是怎么被执行的

| # | 阶段 | 主要操作 | 代码位置 |
|---|---|---|---|
| 1 | **快照** | 收集 ARIA 树 + 排序后的可点击元素 + 当前遮罩 | [`snapshot.ts`](electron/snapshot.ts) |
| 2 | **启发式匹配** | 从步骤描述抽出目标 token（引号字面量优先）；给每个可点击元素打分 | [`heuristics.ts`](electron/heuristics.ts) |
| 3 | **快路径** | 对 `Click 'X'` 这种带引号 + 启发式有信心的步骤，**直接跳过 LLM** —— 省一次往返，也防止 LLM 偶尔飘到相邻错元素 | [`runner.planActions`](electron/runner.ts) |
| 4 | **LLM 规划** | 否则把快照 + 推荐 action + 准则交给 planner LLM；返回的 shape 走校验器，不合法抛 `InvalidPlanError` | [`planParser.ts`](electron/planParser.ts) |
| 5 | **执行** | Playwright `loc.click()` → backdrop 选择器走角点点击 → 通过 `page.evaluate` 调原生 `el.click()` → 视觉坐标兜底（LLM 在点击前截屏上指坐标） | [`actions.ts`](electron/actions.ts) |
| 6 | **断言** | 带引号的断言先走确定性子串检查（页面文本归一化：NBSP、智能引号、大小写）；否则交给 asserter LLM 语义判定 | [`heuristics.ts`](electron/heuristics.ts) + `runner.judgeAssert` |

步骤 1–6 包在一个步骤级的重试循环里：失败或断言置信度不够时，runner 会重新拍快照、重新规划，最多重试 `settings.retry.maxAttempts` 次。

## 🏷️ 发布

发布由 `.github/workflows/release.yml` 在 tag push 时触发。

```bash
# 在 package.json 里改 version
git commit -am "release v0.1.2"
git tag v0.1.2
git push origin main v0.1.2
```

Workflow 在 GitHub-hosted runner 上并行构建 Windows 和 macOS，electron-builder 把产物上传到 [Releases 页](https://github.com/Catcher2026/Catcher/releases) 上的 draft release。审一遍点 **Publish release** 即可发布。

<details>
<summary><b>🔒 隐私</b> —— 本地优先，无遥测，无埋点</summary>

- 所有站点数据、会话、运行历史都在 `~/.catcher/` 下面。
- Catcher 只会和你配置的 LLM provider 通信。具体发了什么 base URL、请求体、截图，在 `Settings → Log all LLM calls` 里可以审计。
- 无遥测、无埋点、无自动更新心跳。

</details>

<details>
<summary><b>⚠️ 局限</b> —— 安装包只有 Chromium、视觉兜底质量随模型而异、二进制未签名</summary>

- 安装包里只有 Chromium（Firefox / WebKit 在 dev 模式可用）。
- 视觉兜底质量随模型而异——预设模型全部支持；自定义接口的模型如果不带视觉，就只能用启发式 + 纯文本 planner。
- 还没做代码签名（参考[安装](#-安装)一节里的 Gatekeeper / SmartScreen 绕过方法）。

</details>

## 🤝 贡献

欢迎 PR。项目还小，做非显而易见的改动前开个 issue 讨论一下更好，但明显的 bugfix 不强制。

新启发式或 planner 解析代码该放哪、单测怎么写，详见 [CONTRIBUTING.md](CONTRIBUTING.zh-CN.md)。短版本：纯逻辑放 [`electron/heuristics.ts`](electron/heuristics.ts) 和 [`electron/planParser.ts`](electron/planParser.ts)，两边都有 [`electron/__tests__/`](electron/__tests__/) 里的测试 —— 提交前先跑 `npm test`。

## 📄 许可证

MIT —— 详见 [LICENSE](LICENSE)。
