# 给 Catcher 贡献代码

[English](CONTRIBUTING.md) | **简体中文**

感谢关注。Catcher 是一个 Electron + Playwright + LLM 测试工具——最值得贡献的部分是把自然语言步骤转成可靠点击的启发式，以及判定断言成立与否的 LLM prompt。

## 快速上手

```bash
git clone https://github.com/Catcher2026/Catcher.git
cd Catcher
npm install        # postinstall 会下载 Playwright 用的 Chromium（约 150MB）
npm run dev        # 启动 Electron 应用 dev 模式
```

## 提 PR 之前

```bash
npm test                 # 单元测试（vitest）
npx tsc --noEmit         # 类型检查
npm run build:renderer   # 完整构建，能查出集成层的问题
```

这三步会被 [.github/workflows/ci.yml](.github/workflows/ci.yml) 在每个 PR 上自动跑。CI 绿是 review 的入门门槛。

## 新代码应该放哪

运行时刻意拆分过，让纯逻辑可以独立测试：

| 文件 | 用途 | 有测试？ |
|---|---|---|
| [electron/heuristics.ts](electron/heuristics.ts) | Token 提取、点击目标打分、确定性断言检查。**纯函数——不碰 Playwright、不碰 LLM。** | 有 |
| [electron/planParser.ts](electron/planParser.ts) | 解析 + 校验 LLM planner 的 JSON 返回。垃圾输入抛 `InvalidPlanError`。 | 有 |
| [electron/actions.ts](electron/actions.ts) | 把一个 `PlannedAction` 用 Playwright 的 `Page` 执行掉（click、fill、navigate 等）。 | 无——直接碰 Playwright |
| [electron/runner.ts](electron/runner.ts) | 编排一次运行：snapshot → plan → execute → assert。调上面的模块。 | 无——编排层 |

**经验法则**：你改的是纯函数 → 放 `heuristics.ts` 或 `planParser.ts`，附测试。你的代码需要 `page.evaluate` 或调 LLM → 放 `runner.ts`。

## 加一个新的点击目标策略

点击恢复链当前用的是关键词重叠度（见 [electron/heuristics.ts](electron/heuristics.ts) 里的 `relevanceScore` + `extractTargetTokens`）。加新策略的步骤：

1. 把纯函数的打分/抽取逻辑加到 `electron/heuristics.ts`。
2. 在 `electron/__tests__/heuristics.test.ts` 加单测——至少：happy path、一个现有启发式会选错的 edge case、以及任何归一化的小坑（CJK、智能引号、NBSP）。
3. 把它接入 [electron/runner.ts](electron/runner.ts) 的 `planActions`。

策略改动没有测试，review 时会被要求补——启发式正是那种"回归了会悄悄选错元素"的代码，必须有测试兜底。

## 改 LLM prompt 或 response shape

如果你改了 planner 的返回 shape：

1. 更新 [electron/actions.ts](electron/actions.ts) 里的 `PlannedAction` interface。
2. 同步更新 [electron/planParser.ts](electron/planParser.ts) 里的 `isValidPlannedAction`，让校验器和新 shape 对得上。
3. 在 `electron/__tests__/planParser.test.ts` 加一个新 shape 的测试 + 一个畸形输入的测试。

校验器是 LLM 输出和 Playwright 之间的防火墙——坏 shape 一旦混过去，故障表现是"点错了元素"，而不是一个干净的错误。

## 代码风格

- 不轻易加新的运行时依赖。当前仓库依赖 Playwright、React、Zustand——就这个门槛。
- 不要写解释 *what* 的注释（代码本身已经说了）。注释只写 *why*（非显而易见的约束、针对特定浏览器 bug 的 workaround 等）。
- 跟周围代码风格保持一致（无分号、2 空格缩进、单引号）。
