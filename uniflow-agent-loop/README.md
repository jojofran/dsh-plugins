# dsh-uniflow-agent-loop

[中文](README.zh.md) · MIT

为 DSH（DeepSeek Harness）提供 **UniFlow 机械强制闭环**：合法 WorkItem →
显式模型绑定派发 → 真实 Host 回执 → ResultGate 验收。解决"协议靠执行者自觉"
的失效模式——绑定与回执由插件在 spawn 时强制与核对，不依赖 agent 记性。

> 设计真相源：uni_claw 仓 `tmpDecision/dsh-uniflow-agent-loop-design.md`
> （M1–M6 里程碑 + L1–L5 生命周期与配置管理）。
> Profile/WorkItem schema/模型绑定语义全部留在 uni_claw 侧
> （`.ai/`、`.dsh/profile-adapter/profile-source.yaml`、
> `tools/agent_profile_validator.py`）；本插件是消费者与强制执行点，**不建第二真相**。

## 状态

| Milestone | 内容 | 状态 |
|---|---|---|
| M1 | 包骨架 + 纯函数 gates（envelope 形状 / 回执核对）+ 会话级登记 | ✅ |
| M2 | `registerProvider('uniflow')` spawn 强制绑定 + 能力 fail-closed | 待实施 |
| M3 | `installModelSelection` reasoning 注入 | 待实施 |
| M4 | session 日志回执监听 + `uniflow_accept` | 待实施 |
| M5 | 真实 Host 集成闭环 | 待实施 |
| M6 | 发布 1.0.0 | 待实施 |

## 安装

```sh
dsh plugin --profile web add dsh-uniflow-agent-loop
```

然后在 `$DSH_HOME/profiles/web/cordis.patch.yml` 挂载：

```yaml
- insert:
    - id: uniflow-agent-loop
      name: dsh-uniflow-agent-loop
```

重启 `dsh web` 并强制刷新浏览器（`Ctrl+Shift+R`）。

**版本管理**：生产安装一律 npm 版本包（不可变、registry 托管）；源码符号链接
仅限开发回路。profile root 禁止本地 `file:` 依赖（悬空链接属安装损坏，
`validate` 必须检出）。

**配置**：插件不携带 UniFlow 配置。`settings` 中 `uniflow.profileSource`
是指向 uni_claw 仓 `.dsh/profile-adapter/profile-source.yaml` 的路径指针；
绑定 digest 漂移 → 启动即拒载（`STALE_PROFILE_SOURCE`），不降级运行。

## 生命周期（设计 L1–L5 摘要）

- **重启**：静态配置在 repo（git）无损；进行中回执从 session 持久日志重建，
  不可恢复 → `RECEIPT_LOST` 拒绝（fail-closed，不猜）；ModuleContext 状态
  主权在 repo 侧，插件死了不丢。
- **插件不可用**：UniFlow 拒绝派发（`ADAPTER_UNAVAILABLE`），不退回自愿仪式
  路径；唯一 fallback 是 repo 侧 CLI
  （`python3 tools/dsh_profile_adapter.py dispatch/receipt`），两通道同构可审计。
- **热重载**仅开发便利；生产语义一律冷启动。

## 测试

```sh
npm test          # node:test，零外部依赖
```

发布前检查清单（M6 gate）：

1. `npm test` 全绿；
2. 包自包含：`files` 只含 `src/` 产物与文档，运行时零依赖（host 部件走
   peerDependencies）；
3. `npm pack --dry-run` 产物与 `files` 声明一致；
4. semver：破坏 envelope/回执契约 → MAJOR；新增能力 → MINOR；修复 → PATCH；
5. `protocol_version` 兼容性声明与 uni_claw 侧 `DSH_PROTOCOL_VERSION` 核对。

## 安全

- 不替代 Agent 决策：插件只提供 gate / 证据 / 能力；
- 不保存 Runtime 真相：回执为会话级视图，状态主权在 repo 侧；
- 权限透明：只读 uni_claw 仓配置与 DSH session 日志，无网络上传；
- Hook 明确：`subagents.registerProvider` / `installModelSelection` /
  子会话 `request/header` 订阅，`ctx.effect`/`ctx.on('dispose')` 全部可撤销。
