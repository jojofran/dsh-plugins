# DSH Plugin 开发规范

## 1. 文档目的

本文档基于 `awesome-dsh-plugin` 社区插件收录规则及现有插件形态，总结 DSH（DeepSeek Harness）Plugin 的设计、开发、发布与维护规范。

目标：

- 保证 Plugin 具备清晰职责边界
- 提升插件生态可维护性
- 降低插件之间的耦合
- 保证 Plugin 能够被 Agent Runtime 安全调用

---

# 2. Plugin 定位规范

## 2.1 单一能力扩展原则

DSH Plugin 应围绕明确能力进行扩展，不建议设计成"大而全"的 Agent 框架。

推荐：

- 文件处理插件
- 数据查询插件
- 外部 API 集成插件
- Runtime Hook 插件
- Trace / Observation 插件

不推荐：

一个 Plugin 同时负责：

- Agent 编排
- 模型管理
- UI
- 数据存储
- 工具调用
- 业务逻辑

Plugin 应增强 Runtime 能力，而不是替代 Runtime。

---

# 3. Plugin 类型规范

## 3.1 Tool Plugin

最常见类型。

结构：

```
User
 |
Agent
 |
Tool
 |
External Capability
```

适用于：

- 文件处理
- 搜索
- API 调用
- 数据转换
- 自动化操作

要求：

- Tool Schema 明确
- 输入输出稳定
- 错误信息可理解
- 不包含业务决策逻辑

---

## 3.2 Runtime Extension Plugin

用于扩展 Agent Runtime 行为。

例如：

- Trace
- Monitoring
- Security
- Approval Flow
- Budget Control
- Recovery Mechanism

结构：

```
Agent Runtime
      |
      Hook
      |
    Plugin
```

要求：

- 明确 Hook 点
- 不修改 Runtime 核心逻辑
- 支持启用和卸载
- 不影响默认运行流程

---

## 3.3 UI / Experience Plugin

用于增强交互体验。

例如：

- Web Dashboard
- 状态面板
- Agent 运行可视化

要求：

UI 应基于 Runtime 状态展示，而不是独立维护 Agent 真相。

---

## 3.4 Integration Plugin

用于连接外部系统。

例如：

- GitHub
- SSH
- MCP
- 数据库
- 第三方 API

推荐结构：

```
DSH Plugin
    |
Adapter Layer
    |
External Service
```

禁止：

直接将第三方 SDK 逻辑散落在 Agent 内部。

---

# 4. Repository 规范

推荐目录：

```
dsh-plugin-example/

├── package.json
├── README.md
├── LICENSE
├── src/
│   ├── index.ts
│   ├── plugin.ts
│   └── tools/
├── tests/
└── examples/
```

---

## 必备文件

### README.md

必须包含：

### 功能说明

一句话说明：

```
为 DSH 提供 xxx 能力
```

---

### 安装方式

说明：

- 安装命令
- 依赖要求
- 环境要求

---

### 使用示例

至少提供：

输入：

```
example input
```

输出：

```
example output
```

---

### 配置说明

明确：

- API Key
- 环境变量
- 文件路径
- 权限要求

---

# 5. Plugin Manifest 规范

Plugin 应声明：

```
name

version

description

author

license

dependencies

capabilities
```

示例：

```json
{
  "name": "dsh-example",
  "version": "1.0.0",
  "description": "Example DSH Plugin",
  "capabilities": [
    "tool",
    "hook"
  ]
}
```

---

# 6. Tool 设计规范

## 6.1 Tool 命名规范

推荐：

```
domain_action
```

例如：

```
pdf_extract

git_status

browser_open

vision_analyze
```

避免：

```
doSomething

helper

process
```

---

## 6.2 输入结构化

不推荐：

```
帮我处理这个文件
```

推荐：

```json
{
  "file": "demo.pdf",
  "mode": "summary",
  "pages": [1,2,3]
}
```

---

## 6.3 输出结构化

推荐：

```json
{
  "success": true,
  "result": {},
  "error": null
}
```

避免：

直接返回大段自然语言。

---

# 7. Agent 交互原则

## 7.1 Plugin 不负责 Agent 决策

错误：

```
Plugin:
应该执行方案 A
```

正确：

```
Plugin:
发现事实 X
提供能力 Y
```

最终决策由 Agent 完成。

---

## 7.2 Evidence 优先原则

Plugin 应提供：

- Observation
- Evidence
- Metadata
- Result

而不是直接输出：

- Action
- Final Decision

推荐：

```
Observation
      |
 Plugin
      |
 Evidence
      |
Agent Decision
```

---

# 8. 安全规范

社区收录 Plugin 不代表安全认证。

Plugin 必须：

- 明确权限范围
- 透明网络访问
- 不隐藏数据上传
- 不默认读取敏感目录
- 不保存用户隐私数据

禁止：

```
安装 Plugin

↓

自动读取用户环境

↓

上传第三方服务
```

---

# 9. 测试规范

## 9.1 单元测试

验证：

```
Input
 |
Plugin
 |
Output
```

---

## 9.2 异常测试

必须覆盖：

- 网络失败
- API 错误
- 参数错误
- 权限不足
- 超时

错误应返回可恢复状态。

---

## 9.3 集成测试

验证：

```
DSH

↓

Plugin

↓

External Service
```

---

# 10. 版本管理规范

采用 Semantic Version：

```
MAJOR.MINOR.PATCH
```

规则：

重大变化：

```
2.0.0
```

新增能力：

```
1.1.0
```

Bug 修复：

```
1.0.1
```

---

# 11. awesome-dsh-plugin 收录规范

符合社区收录要求：

## Repository 要求

必须：

- 开源仓库
- README 完整
- 有明确用途
- 可以运行
- 有安装说明

---

## 推荐描述格式

```
- plugin-name — 为 DSH 提供 xxx 能力，支持 xxx 场景
```

示例：

```
- dsh-trace — Agent 运行轨迹采集与导出插件
```

---

# 12. Runtime Plugin 额外规范

针对 Runtime 扩展类 Plugin，需要额外满足：

## 生命周期明确

推荐：

```
Initialize

↓

Attach

↓

Execute

↓

Observe

↓

Dispose
```

---

## Hook 明确

禁止：

```
Plugin
监听所有事件
```

推荐：

```
Plugin

↓

Hook Contract

↓

Specific Event
```

例如：

```
onAgentStart

onToolCall

onObservation

onTraceCreated
```

---

## 状态隔离

Plugin 不应该成为 Runtime 真相来源。

错误：

```
Plugin Memory

↓

Agent Truth
```

正确：

```
Runtime State

↓

Plugin View
```

---

# 13. UniClaw / Runtime 类 Plugin 建议定位

如果 UniClaw 作为 DSH Plugin 接入，更适合定位：

```
Runtime Extension Plugin

+

Control Plane Adapter Plugin
```

职责：

- Trace 采集
- Observation 提供
- State 查询
- Recovery 辅助
- Runtime 控制接口

不应该：

- 替代 Agent 决策
- 保存 Runtime 真相
- 绕过 Agent Loop
- 直接执行业务 Action

---

# 14. 高质量 DSH Plugin 判断标准

| 维度 | 标准 |
| --- | --- |
| 定位 | 单一能力扩展 |
| 架构 | Plugin 与 Runtime 解耦 |
| Tool | Schema 清晰 |
| 数据 | Evidence 优先 |
| 生命周期 | Hook 明确 |
| 安全 | 权限透明 |
| 文档 | 可安装可理解 |
| 测试 | 覆盖失败路径 |
| 社区 | 符合收录格式 |

---

# 结论

一个优秀的 DSH Plugin 不应该成为新的 Agent，而应该成为 Agent Runtime 的能力扩展层。

设计原则：

```
Plugin 提供能力

Runtime 管理状态

Agent 做决策

```

通过清晰边界，可以形成稳定、可扩展、安全的 DSH Plugin 生态。