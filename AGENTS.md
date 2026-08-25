# AGENTS.md — dsh-plugins 仓库工作准则

本文件是给在本仓库工作的 Agent（含子代理）的行为基线。目标：让多插件集合仓库保持
**每一文件夹独立、可单测、可单发**，避免插件间耦合或跨目录“顺手”改动。

## 仓库性质：多插件集合，不是单体项目

- 本仓库是 **DSH 插件集合**：`task-notify/`、`provider_usage/plugin/`、
  `uniflow-agent-loop/` 各自是一个**独立的 DSH 插件包**（独立 `package.json` / `src/` /
  `test(s)/` / `README.md` / `LICENSE` / `CHANGELOG.md`）。
- `skills/` 是开发规范 skill（非插件）；根目录的 `DSH-Plugin-Development-Specification.md`
  与 `task-notify-compliance-audit.md` 是文档，不是插件。
- **插件之间禁止互相依赖、互相 import**；禁止在仓库根目录引入共享业务代码。
  共享的只有规范与文档。

## 插件加载机制（决定“目录可以怎么摆”）

- DSH 通过 `dsh plugin --profile <name> add <包名|路径>` 以 **pnpm 依赖解析**安装插件，
  依靠 `package.json` 的包名 / `main` / `exports` / `dsh.*` 声明与 `cordis.patch.yml`
  挂载行加载；**不存在“扫描目录”的约定**。
- 因此插件源码放在 `src/` 下是插件自身结构（每个插件内部已有自己的 `src/`），
  与仓库的顶层目录布局无关。除非收到明确指示，**不要**把插件文件夹挪进仓库根的
  `src/`——顶层“一文件夹一插件”是当前既定布局，移动只会破坏安装文档中的路径引用。

## 插件开发规范（必备文件与门槛）

对齐 `skills/dsh-plugin-development/SKILL.md`（与根规范同源）：

- 单一能力扩展：一个插件只做一件事，不替代 Runtime 决策、不保存 Runtime 真相。
- 每个插件必须包含：
  - `README.md`：一句话功能说明、安装方式、使用示例（输入/输出）、配置说明；
  - `LICENSE`（MIT）；
  - `package.json`：`name` / `version` / `description` / `capabilities`，
    semver 管理（破坏契约 → MAJOR；新增能力 → MINOR；修复 → PATCH）；
  - 测试：`npm test` 用 `node:test`（零外部依赖），覆盖失败路径
    （网络失败 / 参数错误 / 权限不足 / 超时），错误返回可恢复状态。
- 改动插件后必须 `cd <插件目录> && npm test` 全绿才算完成；测试失败是缺陷，不是警告。

## 安全底线

- 仓库内**严禁提交任何密钥/Token**：凭证只存在于 `~/.dsh/.credentials.yaml`
  （probe.sh 等脚本从该文件读取，不打印 key；测试用占位符如 `sk-x`）。
- 插件默认不读取敏感目录、不上传用户数据；网络访问在文档中透明声明。

## 提交规范

- 提交信息用 `type: 中文描述` 风格（如 `feat: xxx 插件`），一次提交只围绕一个插件/文档。
- `node_modules`、`*.log`、`.DS_Store` 已被 `.gitignore` 排除，不要手动 add。
- 根 README（`../README.md`）中的插件清单/状态表随插件变化同步更新。

## 验证清单（每次任务结束前）

1. 改过的插件目录 `npm test` 全绿；
2. 未引入跨插件依赖、未挪动既定目录结构；
3. 无密钥入库（`git status` 不含凭证文件）；
4. 若改了插件能力/安装方式，对应 `README.md` 与根 `README.md` 已同步。