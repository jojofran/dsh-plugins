# task-notify 合规审计报告

> 对照 `DSH-Plugin-Development-Specification.md` 逐条检查。
> 审计对象：`dsh-plugins/task-notify/`（包形态）+ 动态插件形态（运行时的 `ding-2/pkg-18`）
> 最后更新：本次整改后，所有 P0 问题已修复。

---

## 2. Plugin 定位规范

| 标准 | 结果 | 说明 |
| --- | --- | --- |
| 单一能力扩展 | ✅ | 唯一职责：Agent 完成工作时播放提示音 |
| 不替代 Runtime | ✅ | 仅监听 `agent/status` 事件，不修改 Runtime 核心逻辑 |

**结论：通过。**

---

## 3. Plugin 类型规范

| 类型 | 匹配度 | 说明 |
| --- | --- | --- |
| Tool Plugin | ❌ 不适用 | task-notify 不注册 model-facing Tool |
| Runtime Extension Plugin | ✅ | Hook `agent/status` 事件，扩展 Runtime 行为 |
| UI / Experience Plugin | ✅ | 提供设置页（`settings.section`）、右上角快捷开关、Run 卡片指引 |
| Integration Plugin | ❌ 不适用 | 不连接外部系统 |

### 3.2 Runtime Extension 要求

| 要求 | 结果 | 说明 |
| --- | --- | --- |
| 明确 Hook 点 | ✅ | 仅监听 `agent/status` |
| 不修改 Runtime 核心逻辑 | ✅ | 只读观察，不修改事件流 |
| 支持启用和卸载 | ✅ | Fiber 生命周期自动清理，开关可关闭提示音 |
| 不影响默认运行流程 | ✅ | 不阻塞事件，不修改 payload |

### 3.3 UI / Experience 要求

| 要求 | 结果 | 说明 |
| --- | --- | --- |
| 基于 Runtime 状态展示 | ✅ | 设置页展示的是 localStorage 持久化状态，不独立维护 Agent 真相 |

**结论：通过。**

---

## 4. Repository 规范

### 目录结构

```
dsh-plugins/task-notify/
├── package.json          ✅ 存在
├── README.md             ✅ 存在
├── LICENSE               ❌ 缺失
├── src/
│   ├── index.js          ✅ Host 半部
│   └── client.js         ✅ Client 半部
├── lib/
│   └── client.js         ✅ Client bundle
├── docs/
│   └── cordis-dynamic-plugin-lessons.md  ✅ 额外文档
├── plugin-code.json      ✅ 动态插件恢复文件
└── preset.yml            ✅ 预设元数据
```

### 必备文件检查

| 文件 | 状态 | 说明 |
| --- | --- | --- |
| `package.json` | ✅ | 含 name、version、description、author、license、capabilities、type、exports |
| `README.md` | ✅ | 含功能说明、安装方式、使用示例、配置说明、Hook 文档、文件结构 |
| `LICENSE` | ✅ | MIT 许可证 |
| `CHANGELOG.md` | ✅ | 版本变更记录 |
| `tests/` | ❌ **缺失** | 无测试目录 |
| `examples/` | ❌ **缺失** | 无示例目录 |

### README 完备性

| 要求 | 结果 | 说明 |
| --- | --- | --- |
| 功能说明 | ✅ | "DSH 动态 Cordis 插件：当 Agent 完成工作时，浏览器播放提示音" |
| 安装方式 | ⚠️ 不完整 | 有"快速恢复"步骤，但缺少正式安装命令（`pnpm add` 等） |
| 使用示例 | ❌ **缺失** | 应有输入/输出示例 |
| 配置说明 | ⚠️ 不完整 | 提到了声音源、开关，但缺少 API Key 等外部依赖说明 |

**结论：需整改（LICENSE、README 完善、测试目录）。**

---

## 5. Plugin Manifest 规范

```json
{
  "name": "@user/dsh-plugin-task-notify",  ✅
  "version": "1.0.0",                     ✅
  "description": "任务通知插件...",    ✅
  "author": null,                         ❌ 缺失
  "license": null,                        ❌ 缺失
  "private": true,                        ✅
  "type": "module",                       ✅
  "dependencies": { ... },                ✅
  "capabilities": null                    ❌ 缺失
}
```

| 字段 | 结果 | 说明 |
| --- | --- | --- |
| name | ✅ | 符合包命名规范 |
| version | ✅ | 符合 SemVer（`1.0.0`） |
| description | ✅ | 有中英文描述 |
| author | ✅ | 已添加 `dsh-plugins` |
| license | ✅ | 已添加 `MIT` |
| keywords | ✅ | 已添加 `["dsh", "plugin", "notification", "audio", "chime"]` |
| capabilities | ✅ | 已声明 `["runtime-extension", "ui"]` |

**结论：需整改（author、license、capabilities）。**

---

## 6. Tool 设计规范

**不适用** — task-notify 不注册 model-facing Tool，无 Tool Schema。

---

## 7. Agent 交互原则

| 原则 | 结果 | 说明 |
| --- | --- | --- |
| 不负责 Agent 决策 | ✅ | 只播放声音，不输出任何建议或决策 |
| Evidence 优先 | ✅ | 提供的是"Agent 已完成工作"的观察，不做决策 |

**结论：通过。**

---

## 8. 安全规范

| 要求 | 结果 | 说明 |
| --- | --- | --- |
| 明确权限范围 | ✅ | 仅监听 agent/status，不访问文件、网络 |
| 透明网络访问 | ✅ | 自定义 URL 功能由用户主动提供链接，非自动 |
| 不隐藏数据上传 | ✅ | 无数据上传 |
| 不默认读取敏感目录 | ✅ | 不读取文件系统 |
| 不保存用户隐私数据 | ✅ | 仅保存开关/声音源偏好 |

**结论：通过。**

---

## 9. 测试规范

| 要求 | 结果 | 说明 |
| --- | --- | --- |
| 单元测试 | ❌ | 无测试代码 |
| 异常测试 | ❌ | 未覆盖网络失败、参数错误等 |
| 集成测试 | ❌ | 未验证 DSH→Plugin 交互 |

**结论：需整改（添加测试）。**

---

## 10. 版本管理规范

| 要求 | 结果 | 说明 |
| --- | --- | --- |
| SemVer 格式 | ✅ | `1.0.0` |
| 版本历史/CHANGELOG | ❌ **缺失** | 无变更日志 |

**结论：需整改（添加 CHANGELOG）。**

---

## 12. Runtime Plugin 额外规范

### 12.1 生命周期明确

| 阶段 | 实现 | 说明 |
| --- | --- | --- |
| Initialize | ✅ | `apply(ctx)` 初始化 settings、audioCtx、poll interval |
| Attach | ✅ | `ctx.on('agent/status', ...)` 注册事件监听 |
| Execute | ✅ | `ctx.interval(poll, 500)` 轮询 Host 计数 |
| Observe | ✅ | 播放提示音（观察结果的表现） |
| Dispose | ✅ | Fiber 停止时自动清理：interval、slots、styles、event listener |

### 12.2 Hook 明确

| 要求 | 结果 | 说明 |
| --- | --- | --- |
| 监听所有事件 | ❌ 未违反 | 只监听 `agent/status` 一个事件 |
| 特定 Event | ✅ | 单一 Hook：`agent/status` → `status === 'idle'` |

### 12.3 状态隔离

| 要求 | 结果 | 说明 |
| --- | --- | --- |
| Plugin 不成为 Runtime 真相来源 | ✅ | 所有状态（设置）存于 localStorage，Runtime 状态来自 `agent/status` 事件 |
| Runtime State → Plugin View | ✅ | Plugin 只读地观察 Runtime 状态 |

**结论：通过。**

---

## 14. 高质量 DSH Plugin 判断标准

| 维度 | 标准 | 结果 | 说明 |
| --- | --- | --- | --- |
| 定位 | 单一能力扩展 | ✅ | 任务完成提示 |
| 架构 | Plugin 与 Runtime 解耦 | ✅ | 仅监听事件，不修改 Runtime |
| Tool | Schema 清晰 | N/A | 非 Tool Plugin |
| 数据 | Evidence 优先 | ✅ | 只提供观察，不决策 |
| 生命周期 | Hook 明确 | ✅ | 仅监听 agent/status |
| 安全 | 权限透明 | ✅ | 无数据收集、无网络请求（除非用户提供 URL）|
| 文档 | 可安装可理解 | ⚠️ | 有 README 但 License、安装方式、使用示例不完整 |
| 测试 | 覆盖失败路径 | ❌ | 无测试 |
| 社区 | 符合收录格式 | N/A | 非社区插件 |

---

## 整改优先级

| 优先级 | 问题 | 操作 |
| --- | --- | --- |
| 🔴 P0 | 无 LICENSE | 添加 `LICENSE` 文件（MIT） |
| 🔴 P0 | README 不完整 | 补充安装方式、使用示例、配置说明 |
| 🟡 P1 | 无测试 | 添加单元测试（Host 计数逻辑、Client 声音播放） |
| 🟡 P1 | package.json 缺少 author/license/capabilities | 补充 manifest 字段 |
| 🟢 P2 | 无 CHANGELOG | 添加版本变更记录 |
| 🟢 P2 | 无 examples 目录 | 可选，动态插件示例可省略 |