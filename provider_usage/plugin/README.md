# @user/dsh-plugin-provider-usage

为 DSH 提供**模型供应商用量/配额查询**能力（Tool Plugin + 静态化弹窗 UI）——工具侧查 zai、opencode-go、deepseek 的实时用量/余额/配额，百炼 Token Plan 如实返回"仅控制台"说明；浏览器侧提供侧边栏「用量」按钮 + 浮层面板（随 DSH 启动自动加载）。

## 功能说明

- `usage_query <provider>`：查询单个供应商的用量/配额
- `usage_overview`：一次查询所有可查供应商的用量概览
- **弹窗 UI（静态 Client 半部，重启后自动存在）**：侧边栏底部「用量」按钮（窄栏显示图标），`shell.overlay` 浮层面板，默认关闭、点击穿透，不占主界面；打开后实时查询 + 手动刷新
  - 数据链路：Client 手写 Typert 贡献（`src-json` codec）→ 网关 SRC 运行时解析 → Host `providerUsage` 服务（与工具同一份查询逻辑，零重复）
  - 免生成、免重建 web：`exports["./client"]` + `dsh.client` 声明，web plugin table 运行时按磁盘文件服务
- 结构化返回（`{ success, provider, queriedAt, data?, error? }`），任何失败（缺凭证 / 网络 / 超时 / HTTP / 解析 / 仅控制台）都归一化为可读的错误码，不抛异常、不影响 Agent 主流程
- 零稳态开销：无事件监听、无定时器，仅在工具被调用 / 面板被打开时发起查询

## 支持矩阵（2026-08-25 实测）

| provider | 端点 | 鉴权 | 可查内容 |
|---|---|---|---|
| `zai` | `GET {base}/api/monitor/usage/quota/limit` | `Authorization: <API Key>`（不带 Bearer） | 各档额度已用/剩余/百分比/重置时间、账户档位 |
| `opencode-go` | `GET {base}/v1/usage` | `Authorization: Bearer <Key>` | rolling / weekly / monthly 用量百分比 + 重置时间 |
| `deepseek` | `GET {base}/user/balance` | `Authorization: Bearer <Key>` | 账户可用性 + CNY 余额（无用量明细 API） |
| `qwen-token-plan-cn` | —（无公开 API） | — | 返回"仅控制台可查"的调查结论 |

## 安装方式

### 环境要求

- DSH（web profile），Node.js ≥ 20（依赖全局 `fetch`）
- 已被 DSH 识别的供应商凭证（Web Models 页已存 key，或环境变量）

### 安装步骤（静态挂载，重启后仍然有效）

```bash
# 1. 在 profile 里注册本地包依赖
cd ~/.dsh/profiles/web
#   在 package.json 的 dependencies 中加入：
#   "@user/dsh-plugin-provider-usage": "file:/Users/fran/Documents/Code/dsh-plugins/provider_usage/plugin"

# 2. 安装依赖（链接 file: 包及其 link 依赖）
pnpm install

# 3. 在 ~/.dsh/profiles/web/cordis.patch.yml 追加一行（insert 列表）：
#   - insert:
#       - id: provider-usage
#         name: '@user/dsh-plugin-provider-usage'

# 4. 重启 DSH。新会话中即可调用 usage_query / usage_overview；
#    侧边栏底部出现「用量」按钮（静态 Client 半部由 web plugin table 在重启时装配，
#    无需额外步骤）。如重启后浏览器未见按钮，强刷页面（Ctrl+Shift+R）。
```

安全顺序建议：第 3 步行先加 `disabled: true`，重启确认 profile 正常后再去掉 `disabled` 启用（第 4 步），避免一次改动引入两个变量。

> 1.1.0 起弹窗 UI 为静态 Client 半部：`exports["./client"]` + `dsh.client` 声明驱动，RPC 用
> Host SRC 标记服务（`providerUsage`）+ 网关 SRC 运行时解析，**无需重建 web 产物**。
> 回滚：删除 patch 行 / 移除 `dsh.client` 与 `./client` 导出后重启即可。

安装/卸载/升级的完整生命周期分析见 [`docs/deploy-lifecycle.md`](../docs/deploy-lifecycle.md)。

## 使用示例

输入：

```
usage_overview
```

输出（节选）：

```json
{
  "success": true,
  "queriedAt": "2026-08-25T13:40:00.000Z",
  "providers": [
    {
      "success": true,
      "provider": "zai",
      "data": {
        "level": "pro",
        "limits": [
          { "windowGuess": "5h", "usage": 12000, "remaining": 11882, "percentage": 1, "nextResetTime": 1787678742802 },
          { "windowGuess": "weekly", "usage": 60000, "remaining": 55832, "percentage": 6, "nextResetTime": 1787749266997 }
        ]
      }
    },
    {
      "success": true,
      "provider": "opencode-go",
      "data": {
        "windows": {
          "rolling": { "status": "ok", "percent": 1 },
          "weekly": { "status": "ok", "percent": 31 },
          "monthly": { "status": "ok", "percent": 66 }
        }
      }
    },
    {
      "success": false,
      "provider": "qwen-token-plan-cn",
      "error": { "code": "CONSOLE_ONLY", "message": "…仅控制台可查…" }
    }
  ]
}
```

输入：

```
usage_query provider=zai
```

输出：

```json
{
  "success": true,
  "provider": "zai",
  "queriedAt": "2026-08-25T13:41:00.000Z",
  "data": {
    "level": "pro",
    "limits": [
      { "windowGuess": "5h", "unit": 3, "number": 5, "usage": 12000, "currentValue": 117, "remaining": 11882, "percentage": 1, "nextResetTime": 1787678742802 },
      { "windowGuess": "weekly", "unit": 6, "number": 1, "usage": 60000, "currentValue": 4167, "remaining": 55832, "percentage": 6, "nextResetTime": 1787749266997 }
    ]
  }
}
```

## 配置说明

### 凭证（只读，不落盘）

插件通过 DSH 的 `credentials` 服务按环境变量名取 key（与 llm-pi-ai 同一条缝），服务缺失时回退进程环境变量。**不会**读取、保存或上传任何密钥。

| provider | apiKeyEnv 默认值 | 配置在 |
|---|---|---|
| `zai` | `ZAI_API_KEY` | Web Models 页 / `~/.dsh/.credentials.yaml` |
| `opencode-go` | `OPENCODE_GO_API_KEY` | 同上 |
| `deepseek` | `DEEPSEEK_API_KEY` | 同上 |
| `qwen-token-plan-cn` | `QWEN_TOKEN_PLAN_CN_API_KEY` | 同上（不发起请求） |

### 行级配置（可选，cordis 行 config）

```yaml
- id: provider-usage
  name: '@user/dsh-plugin-provider-usage'
  config:
    timeoutMs: 20000            # 单次请求超时（默认 15000）
    providers:
      zai:
        baseURL: https://open.bigmodel.cn   # 覆盖默认端点
        apiKeyEnv: ZAI_API_KEY              # 覆盖默认凭证环境变量名
      opencode-go:
        baseURL: https://opencode.ai/zen/go
      deepseek:
        baseURL: https://api.deepseek.com
```

### 权限与安全

- 仅对外发起 HTTPS GET 到供应商官方端点（工具被调用时）
- 不读取敏感目录、不保存用户数据、无任何上传行为
- 网络/权限失败全部结构化返回，可安全卸载（删行 + 移除依赖）

## 测试

```bash
cd provider_usage/plugin && npm test
```

覆盖：URL/认证头构造、各供应商解析归一化、畸形响应、仅控制台供应商、未知供应商。

## 版本

`1.0.0` — 见 [CHANGELOG.md](CHANGELOG.md)（语义化版本）。