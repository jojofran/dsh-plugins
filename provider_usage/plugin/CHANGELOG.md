# Changelog

## 1.1.0 — 2026-08-25

- **静态化弹窗 UI**（重启自动加载，不再依赖动态插件）：
  - `src/client.js`：手写模块系统 bundle（`window.__ModuleLoader__.load`），经 `exports["./client"]` + `dsh.client` 声明由 web plugin table 运行时服务，重启后随 DSH 自动存在
  - `src/index.js` 新增 SRC 标记服务 `providerUsage`（`TypertRemoteService` + 手动 `@Remote('overview')`），复用 `queryProvider`，与工具同一口径
  - RPC 免生成：Client 手写 Typert 贡献（`src-json` codec）→ 网关 SRC 运行时解析（`typertGateway` 对无严格定义的端点回退 SRC 标记），无需 typert 生成器/重建 web
  - 弹窗形态不变：侧边栏「用量」按钮 + `shell.overlay` 浮层，默认关闭不占主界面
- capabilities: `tool` + `ui`

## 1.0.0 — 2026-08-25

- 首个可用版本：`usage_query` / `usage_overview` 两个工具
- 支持供应商：zai（配额/余额/重置时间）、opencode-go（三窗口用量百分比）、deepseek（余额）、qwen-token-plan-cn（仅控制台说明）
- 结构化错误归一化（UNKNOWN_PROVIDER / MISSING_CREDENTIAL / NETWORK_ERROR / TIMEOUT / HTTP_ERROR / PARSE_ERROR / CONSOLE_ONLY / NO_FETCH）
- 离线单元测试 12 例