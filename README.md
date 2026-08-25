# dsh-plugins

> DSH（DeepSeek Harness）插件集合仓库 —— **每一个顶层文件夹都是一个独立的 DSH 插件包**，
> 可单独安装、测试、版本化与发布，互不耦合。

## 目录结构

```
dsh-plugins/
├── task-notify/                  # ★ 独立插件：任务完成通知枢纽（声音 + 系统通知 + Hook 扩展）
├── provider_usage/               # ★ 独立插件：模型供应商用量/配额查询 Tool
│   ├── plugin/                   #    插件的包本体（src/、tests/、README.md、package.json）
│   └── …                         #    调查文档（docs/、README.md、probe.sh）
├── uniflow-agent-loop/           # ★ 独立插件：UniFlow 机械强制闭环（M1 已实现，开发中）
├── skills/
│   └── dsh-plugin-development/   #    开发规范 skill（非插件，供 Agent 加载）
├── DSH-Plugin-Development-Specification.md  # 开发规范全文
├── task-notify-compliance-audit.md          # task-notify 合规审计报告
└── AGENTS.md                     # Agent 在本仓库工作的准则
```

| 顶层文件夹 | 类型 | 插件包名 | capabilities | 状态 |
| --- | --- | --- | --- | --- |
| `task-notify/` | Runtime Extension + UI | `@user/dsh-plugin-task-notify` | `runtime-extension`, `ui` | ✅ 可用 |
| `provider_usage/plugin/` | Tool + UI | `@user/dsh-plugin-provider-usage` | `tool`, `ui` | ✅ 可用 |
| `uniflow-agent-loop/` | Runtime Extension + Tool | `dsh-uniflow-agent-loop` | `runtime-extension`, `tool` | 🚧 M1 完成 |
| `skills/` | 规范/经验 skill（非插件） | — | — | 含 `dsh-plugin-development`（规范）与 `dsh-plugin-static-client-ui`（静态 Client 半部经验） |

## 为什么不在统一的 `src/` 下面？

结论：**可以**，但没有必要，当前保持顶层布局。

原因：DSH 加载插件走 **按包名/路径引用**（`dsh plugin --profile <name> add <包名|路径>` →
pnpm 依赖解析 + `cordis.patch.yml` 挂载），**没有任何"扫描目录"的约定**。插件源码放哪个
目录都不影响加载；每个插件内部**已经有自己的 `src/`**（包源码）与 `test(s)/`（测试）。

若未来想统一收入根 `src/`（如 `src/task-notify/`），只需同步更新各文档/安装说明里的
路径引用即可，功能上零风险——但顶层布局让"一个文件夹 = 一个插件"的对应关系更直观，
也更贴合 awesome-dsh-plugin 社区的单插件仓库形态，故沿用。

## 安装（通用流程）

每个插件都是一份独立 npm 包，安装方式一致：

```bash
# 1. 将插件注册为 profile 依赖（本地路径或 registry 包名均可）
dsh plugin --profile web add /path/to/dsh-plugins/task-notify

# 2. 在 $DSH_HOME/profiles/web/cordis.patch.yml 挂载插件行
#    - insert:
#        - id: task-notify
#          name: '@user/dsh-plugin-task-notify'

# 3. 重启 dsh web（必要时强刷浏览器 Ctrl+Shift+R）
```

各插件的详细安装说明见各自 `README.md`：

- [task-notify 安装说明](task-notify/README.md)
- [provider_usage 安装说明](provider_usage/plugin/README.md)（生命周期分析见 `provider_usage/docs/deploy-lifecycle.md`）
  - 弹窗 UI（侧边栏「用量」按钮 + 浮层）已内置为静态 Client 半部（v1.1.0，重启自动加载）；
    早期动态伴生插件恢复文件见 `provider_usage/ui/recovery.usg-1.json`（历史参考）
- [uniflow-agent-loop 安装说明](uniflow-agent-loop/README.md)

> 注意：插件包内的 `dependencies` 目前用 `link:` 指向本地 dk-harness 检出（开发回路），
> 发布/外部安装前需改为 registry 版本或 peerDependencies——详见各插件文档。

## 开发与测试

- 每个插件自包含：进入对应文件夹后 `npm test`（`node:test`，零外部依赖）。
- 测试不通过视为缺陷，合并前必须修复（各插件 `CHANGELOG.md` 记录历史）。
- 修改后请保持 `README.md`（功能/安装/示例/配置）、`LICENSE`（MIT）与 `package.json`
  声明一致。

## 规范与贡献

- 本仓库的 DSH 插件开发规范见 [DSH-Plugin-Development-Specification.md](DSH-Plugin-Development-Specification.md)，
  同一规范以 skill 形态提供于 `skills/dsh-plugin-development/`（Agent 可直接加载）。
- 在本仓库工作的 Agent 请先阅读 [AGENTS.md](AGENTS.md)。
- 安全底线：插件不替代 Agent 决策、不保存 Runtime 真相、权限透明、不默认上传用户数据；
  仓库内不提交任何密钥（凭证只存在于 `~/.dsh/.credentials.yaml`）。

## 许可

各插件均为独立 MIT 许可（见各自 `LICENSE`）。