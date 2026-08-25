# 插件部署生命周期：如何装进 DSH、重启有效、且不影响主功能

> 对象：`@user/dsh-plugin-provider-usage`（provider_usage/plugin/）
> 目标：**安装后 DSH 重新运行仍然有效**；**对 DSH 主要功能零干扰**；安装/卸载/升级全程可回滚、可验证。

---

## 1. 两种挂载形态：为什么必须选静态包

DSH 插件有两类生命周期完全不同的挂载方式：

| 维度 | 动态插件（`cordis_define` / `cordis_run`） | 静态包（本文档方案） |
|---|---|---|
| 代码存放 | 进程内 Registry，仅存在于当前进程 | 文件系统中的 npm 包（`file:` 依赖） |
| 重启后 | **丢失**，需手动用 plugin-code.json 重建（task-notify 的教训） | **仍在**：每次启动由 cordis loader 从 node_modules 解析并挂载 |
| 适用 | 开发调试、快速原型 | 正式部署、长期使用 |
| 对主功能影响面 | 挂载在根作用域，宿主堆栈内 | 独立包 + 一行合成配置，天然隔离 |

**结论**：要满足"dsh 重新运行有效"，必须走静态包形态。（`docs/cordis-dynamic-plugin-lessons.md` 记录过动态插件重启即失的坑。）

---

## 2. 部署步骤（推荐安全顺序）

### 前置：代码就绪（本仓库已生成）

```
provider_usage/
├── README.md            # 供应商用量调查结论（端点/鉴权/返回内容）
├── probe.sh             # 可重复执行的探测脚本
└── plugin/              # ← 插件包本体（代码维度管理，纳入 git）
    ├── package.json     # @user/dsh-plugin-provider-usage v1.0.0
    ├── src/index.js     # 插件入口：注册 usage_query / usage_overview
    ├── src/providers.js # 各供应商适配器（纯函数，可离线测试）
    ├── tests/           # 12 例离线单测（node --test 直接可跑）
    ├── README.md        # 功能/安装/示例/配置
    └── CHANGELOG.md     # 语义化版本
```

### 第 1 步：注册依赖（~/.dsh/profiles/web/package.json）

```jsonc
"dependencies": {
  // ...已有条目...
  "@user/dsh-plugin-provider-usage": "file:/Users/fran/Documents/Code/dsh-plugins/provider_usage/plugin"
}
```

与仓库内 `@user/dsh-plugin-task-notify` 同一机制（file: 本地包，pnpm 会为它安装 link 依赖 `cordis`、`dsh-tools`）。

### 第 2 步：安装依赖

```bash
cd ~/.dsh/profiles/web && pnpm install
```

### 第 3 步：追加合成行（~/.dsh/profiles/web/cordis.patch.yml）

```yaml
- insert:
    - id: provider-usage
      name: '@user/dsh-plugin-provider-usage'
```

> **安全顺序**：如果担心一次改动影响启动，先带 `disabled: true` 加行 → 重启验证 profile 正常 → 再去掉 `disabled` 重启启用。两步各只引入一个变量，失败时回滚面最小。

### 第 4 步：重启 DSH 并验证

```bash
# 进程外冒烟（不启动 DSH）：先验证包可被解析加载
cd ~/.dsh/profiles/web && node --input-type=module -e \
  "import('@user/dsh-plugin-provider-usage').then(m => console.log('load ok:', m.name, m.inject))"
# 预期输出：load ok: provider-usage [ 'tools' ]

# 然后重启 DSH，在新会话里让 Agent 调用 usage_overview 查全部供应商用量。
```

### 验证清单

- [ ] profile 启动正常，会话工具列表出现 `usage_query` / `usage_overview`
- [x] 挂载级 E2E 已在安装时预验证：真实 Cordis 上下文 + 真实凭证/网络，四个供应商全部走通（zai / opencode-go / deepseek 返回真实数据，qwen-token-plan-cn 返回 CONSOLE_ONLY）
- [ ] `usage_overview` 能查 zai / opencode-go / deepseek，qwen-token-plan-cn 返回 CONSOLE_ONLY
- [ ] 缺凭证时返回 MISSING_CREDENTIAL（结构化错误卡片），主流程不受影响
- [ ] 再次重启 DSH，工具仍然存在（持久性验收）

---

## 3. 为什么"不影响 DSH 主要功能"（设计约束逐条对照）

| 风险面 | 本插件的做法 | 结果 |
|---|---|---|
| 组合改动 | 只 **insert 一行**，不修改任何现有行、不改 bundle、不碰 preset | 主功能行零变更 |
| 服务冲突 | 只**消费**：`inject: ['tools']` + 可选 `ctx.get('credentials')`；**不发布**任何服务 → 无需 isolate realm | 不进入任何全局名称空间，多会话无碰撞 |
| 挂载期失败 | 无硬性服务依赖；凭证缺失按调用时返回结构化错误 | 即使 DSH 没配任何一个 key，插件照常启动 |
| 稳态开销 | 无事件监听、无定时器、无轮询 | 空闲时 CPU/内存/网络均为 0 |
| 请求失败 | 网络/超时/HTTP/解析错误全部 catch 归一化，工具**从不抛出** | Agent loop 与用户流程不受影响 |
| 工具名冲突 | `usage_query` / `usage_overview` 与所有内置工具名不重复 | 注册无碰撞 |
| 密钥 | 经 `credentials` 服务 resolve（与 llm-pi-ai 同一缝），不读文件不落盘 | 不触碰敏感面 |
| 停机窗口 | 安装只改文件 + 一次重启 | 无持续运行代价 |

---

## 4. 生命周期管理

### 卸载（彻底移除）

1. `~/.dsh/profiles/web/cordis.patch.yml` 删除该行
2. `package.json` 移除依赖条目
3. `pnpm install && 重启 DSH`
4. 可选：删除 `provider_usage/plugin/` 代码目录（git 历史仍可找回）

### 禁用（临时停用，保留代码）

- 行上加 `disabled: true` 即可，重启生效；后续去掉 `disabled` 即恢复。比卸载快、可逆。

### 升级（语义化版本）

1. `CHANGELOG.md` 增条目、`package.json` 升版本（新增能力 1.x.0 / 修复 1.0.x）
2. 改代码 → `npm test` 全绿
3. `cd ~/.dsh/profiles/web && pnpm install`（file: 依赖重新链接新版本）
4. 重启生效；旧的 `plugin-code` 无需处理（我们不走动态插件）

### 回滚

任何一步出问题：删掉第 3 步的行（或 `disabled: true`）→ 重启，即回到未安装状态。因为从未触碰主配置，回滚面只有这一行 + 一个依赖条目。

---

## 5. 与动态插件的取舍（记录决策，避免未来重复踩坑）

- **为什么不用 cordis_define 交付**：进程局部、重启即失、需手工恢复（plugin-code.json），不满足"重新运行有效"。
- **为什么不用 `mcp` / 外部服务迂回**：Tool Plugin 是规范推荐的数据查询形态，无额外进程、无端口、随 DSH 生命周期天然同步。
- **后续演进**：如需本地用量聚合（从 `~/.dsh/sessions/**/session.jsonl.zstd` 统计 DSH 实际消耗），作为同一插件的 `usage_local` 工具增量演进（1.1.0），仍遵循"仅工具被调用时执行"的零稳态开销原则。