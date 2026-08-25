# Changelog

## 1.0.0 — 2026-08-25

- 首个可用版本：`usage_query` / `usage_overview` 两个工具
- 支持供应商：zai（配额/余额/重置时间）、opencode-go（三窗口用量百分比）、deepseek（余额）、qwen-token-plan-cn（仅控制台说明）
- 结构化错误归一化（UNKNOWN_PROVIDER / MISSING_CREDENTIAL / NETWORK_ERROR / TIMEOUT / HTTP_ERROR / PARSE_ERROR / CONSOLE_ONLY / NO_FETCH）
- 离线单元测试 12 例