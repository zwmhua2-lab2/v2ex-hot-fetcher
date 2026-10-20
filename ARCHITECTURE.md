# ARCHITECTURE.md —— v2ex-hot-fetcher

## 0. 目标与边界
- **目标**：提供独立运行的 Node.js 本地工具，支持 JSON 任务提取与 V2EX 热门主题抓取。
- **保留**：`extract-tasks.mjs`、`parse-config.mjs` 现有功能及行为不变。
- **新增**：`fetch-v2ex.mjs`，获取 V2EX 前 5 条热门主题，保存为 `hot.json`。
- **不做**：定时抓取、数据库、缓存、通用 HTTP 框架、用户认证、第三方依赖。

## 1. 组件
- `extract-tasks.mjs`：从当前目录的 `data.json` 筛选 `type === "task"` 且包含 `id`、`title` 的对象，按原顺序输出至 `tasks.json`，缺失字段的记录直接忽略。
- `parse-config.mjs`：保留现有配置解析逻辑，不纳入本次修改。
- `fetch-v2ex.mjs`：通过 HTTPS 获取 V2EX 热门主题，提取前 5 条的 `title`、`url`，写入当前目录的 `hot.json`。

## 2. 硬约束
- **C1-C2 数据安全**：各工具仅访问自身约定的资源；输出 JSON 必须先写入同目录临时文件，再通过原子重命名替换，提交前失败不得覆盖旧文件。
- **C3-C4 错误与依赖**：失败必须返回退出码 `1` 和明确错误标识，不输出堆栈；禁止硬编码密钥、泄露数据或新增第三方依赖，原有工具错误标识保持不变。
- **C5 红牌文件**：修改 `.github/**`、`package.json`、lockfile、`AGENTS.md`、`ARCHITECTURE.md` 必须独立建 Issue，由 Human 审查。
- **C6-C8 网络抓取**：唯一外部 API 为 `https://www.v2ex.com/api/topics/hot.json`；请求总超时 `3000ms`，最多重试 `1` 次（仅临时网络错误或 HTTP 502/503/504，采用固定退避）；任一抓取或输出失败均向 stderr 输出 `FETCH_ERROR`，退出码为 `1`，不得覆盖已有 `hot.json`；仅使用 Node.js 内置模块。

## 3. 数据契约
- `tasks.json`：保持原有筛选契约，仅输出 `id`、`title`；零匹配输出 `[]`。
- `hot.json`：合法 JSON 数组，恰好 5 个对象，每个对象仅包含字符串 `title`、`url`，保留 API 原始顺序。
- API 返回非数组、不足 5 条、前 5 条字段缺失或类型错误，均视为抓取失败。
- 所有输入输出路径以 `process.cwd()` 为基准。

## 4. 技术栈
- **运行时**：Node.js 20+，ES Modules，无第三方依赖。
- **网络与文件**：内置 `fetch`、`AbortController`、`node:fs`。
- **执行命令**：`node extract-tasks.mjs`、`node fetch-v2ex.mjs`。
- **测试**：`node --test`；测试代码放在 `test/`，使用固定模拟数据。

## 5. 验收原则
- 每条命中的硬约束必须在对应 Issue 中有可执行的 Given/When/Then 验收标准。
- 必须验证成功输出、网络异常、超时、JSON 错误、写入失败和旧文件保护。
- 未实际运行的测试不得标记为通过。

## 6. 风险区域
- **高风险**：鉴权/权限、外部数据写入、数据迁移、并发，以及修改 `tasks.json`、`hot.json` 的原子替换或失败保护策略。
- **其他高风险**：修改抓取器超时、重试及错误处理策略。
- 高风险任务必须独立 AI 审查，并由 Human 本地验收；其他任务为低风险。

## 7. 当前状态
- 原有本地工具已存在于仓库，运行及验收状态未验证。
- V2EX 抓取器尚未实现；本文件仅定义架构与约束。
- 每次 PR 合并后更新实际能力，不得将未验证内容标记为已验收。