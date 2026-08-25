# provider_usage — DSH 已配置供应商用量查询调查报告

> 调查时间：2026-08-25（探针实测，见 `probe.sh`，可重复执行）
> 配置来源：`~/.dsh/settings.yaml` 的 `llm-pi-ai.providers`；密钥在 `~/.dsh/.credentials.yaml`
> 范围：`qwen-token-plan-cn`、`opencode-go`、`zai`（按要求跳过 `nova`）

## 结论速览

| provider | 说明 | 用量/配额是否可查（仅凭 API Key） | 端点 | 鉴权 | 能查到什么 |
|---|---|---|---|---|---|
| `zai` | 智谱 GLM (open.bigmodel.cn) | ✅ 可查 | `GET /api/monitor/usage/quota/limit` | `Authorization: <API Key>`（实测带/不带 Bearer 均 200） | 各档额度 usage / remaining / percentage / nextResetTime；账户档位 level |
| `opencode-go` | OpenCode Zen Go 网关 | ✅ 可查 | `GET https://opencode.ai/zen/go/v1/usage` | `Authorization: Bearer <API Key>` | rolling / weekly / monthly 用量百分比 + 重置时间 |
| `qwen-token-plan-cn` | 阿里云百炼 Token Plan | ❌ 仅控制台 | `zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage`（控制台网关） | 需要阿里云控制台登录 token（非 API Key） | 每 5 小时 / 每 1 周配额百分比 + 重置时间 |
| `deepseek`（附加） | DeepSeek 官方 API（凭证已存在，未配置为 provider 路由） | ✅ 可查余额 | `GET https://api.deepseek.com/user/balance` | `Authorization: Bearer <API Key>` | 账户可用性 + CNY 余额（total/granted/topped_up）；**无用量历史 API** |

前三个 provider 的 API Key 均验证有效（`GET {base}/models` 全部 200）。

---

## 1. zai（智谱，open.bigmodel.cn）— ✅ 可查

### 端点
```http
GET https://open.bigmodel.cn/api/monitor/usage/quota/limit
Authorization: <API Key>        # 实测带不带 "Bearer " 前缀都返回 200
```

### 实测返回（2026-08-25）
```json
{
  "code": 200, "msg": "操作成功", "success": true,
  "data": {
    "level": "pro",
    "limits": [
      {"type": "CREDIT_LIMIT", "unit": 3, "number": 5, "usage": 12000,
       "currentValue": 117, "remaining": 11882, "percentage": 1,
       "nextResetTime": 1787678742802},
      {"type": "CREDIT_LIMIT", "unit": 6, "number": 1, "usage": 60000,
       "currentValue": 4167, "remaining": 55832, "percentage": 6,
       "nextResetTime": 1787749266997}
    ]
  }
}
```

### 字段解读
- `data.limits[]`：两条配额记录，`usage`=已用、`remaining`=剩余、`percentage`=已用百分比、`nextResetTime`=重置时间(ms)。
- `unit`/`number`：参考 cc-switch（`src-tauri/src/services/coding_plan.rs` 的 `TIER_FIVE_HOUR` / `TIER_WEEKLY_LIMIT`）推测为 5 小时窗口（unit:3）与 1 周窗口（unit:6）两档。
- `data.level`：账户档位（pro 等）。
- 国际站 `api.z.ai` 同路径同返回结构，按 base URL 路由（cc-switch PR #3702）。

### 无效尝试
- `GET /api/paas/v4/balance` → 404
- `GET /api/maas/v1/balance` → 500 `{"code":500,"msg":"404 NOT_FOUND"}`

---

## 2. opencode-go（OpenCode Zen Go）— ✅ 可查

### 端点
```http
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <API Key>
```

### 实测返回（2026-08-25）
```json
{"usage": {
  "rolling": {"status": "ok", "percent": 1,   "resetsAt": "2026-08-25T18:08:07.390Z"},
  "weekly":  {"status": "ok", "percent": 31,  "resetsAt": "2026-08-31T00:00:00.390Z"},
  "monthly": {"status": "ok", "percent": 66,  "resetsAt": "2026-09-18T16:29:46.390Z"}
}}
```

### 字段解读
- `rolling` / `weekly` / `monthly` 三个时间窗口的用量百分比 `percent`（0–100）+ 状态 + 重置时间 `resetsAt`（ISO 字符串）。

### 无效尝试
- `GET /quota`、`GET /v1/quota` → 404
- `GET https://api.z.ai/api/monitor/usage/quota/limit`（用 opencode-go 的 key）→ 200 但业务码 401 `token expired or incorrect`
- 与社区结论一致：OpenCode 侧无公开 quota API（[anomalyco/opencode#18648](https://github.com/anomalyco/opencode/issues/18648)、[anomalyco/opencode#10448](https://github.com/anomalyco/opencode/issues/10448)、[OmniRoute#3844](https://github.com/diegosouzapw/OmniRoute/issues/3844)）。但 `v1/usage` 端点可用，足够做用量展示。

---

## 3. qwen-token-plan-cn（阿里云百炼 Token Plan）— ❌ API Key 查不到，仅控制台

### API Key 直连的全部失败情况
| 尝试 | 结果 |
|---|---|
| `{base}/compatible-mode/v1/balance`、`…/usage`（含 `?model=` 参数） | 400 `Required parameter "model" missing`——compatible-mode 网关把任意路径路由到推理入口，**没有** balance/usage 接口 |
| `https://dashscope.aliyuncs.com/api/v1/balance`（原生 DashScope 余额接口） | 404（该接口已不可用/迁移） |
| `https://token-plan.cn-beijing.maas.aliyuncs.com/tokenplan/personal/api/v2/usage` 直连 | 404 |

### 真实数据源（控制台）
- bailian-cli（[modelstudioai/cli](https://github.com/modelstudioai/cli)）的 `bl usage token-plan` 使用：
  ```text
  api = zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage   # 控制台网关
  ```
  经 `bailian-cs.console.aliyun.com`（`BroadScopeAspnGateway`）调用，需阿里云**控制台登录 token**（`bl login`），鉴权不是 API Key。返回字段：`per5HourPercentage` / `per5HourResetTime` / `per1WeekPercentage` / `per1WeekResetTime`。
- 同类控制台接口（`quota/check.ts`）：`zeldaEasy.bailian-telemetry.monitor.getMonitorData`——QPM/TPM 限流查询，同样仅控制台。
- 后续插件若要做这项：要么调 `bailian-cli`（或复刻其控制台网关调用），要么引导用户在百炼控制台查看；**纯 API Key 拿不到**。

---

## 4. DeepSeek 官方 API（附加调查）

> `~/.dsh/.credentials.yaml` 里有 `DEEPSEEK_API_KEY`（35 字符），但 `llm-pi-ai.providers` 中没有配置 deepseek 路由——顺手实测了官方接口。

### 端点
```http
GET https://api.deepseek.com/user/balance
Authorization: Bearer <API Key>
```

### 实测返回（2026-08-25）
```json
{
  "is_available": false,
  "balance_infos": [
    {"currency": "CNY", "total_balance": "-0.05",
     "granted_balance": "0.00", "topped_up_balance": "-0.05"}
  ]
}
```

### 解读
- 官方只提供**余额查询**，没有用量历史 API（`/usage`、`/dashboard/billing/usage` → 404）。
- 当前账户 `is_available: false`、余额 **-0.05 CNY（欠费）**，基本不可用——这很可能正是 DSH 把默认模型路由到 opencode-go 而不是直连 DeepSeek 的原因。
- 后续插件如需 DeepSeek 用量：本接口只能给余额；用量明细只能去 [DeepSeek 开放平台](https://platform.deepseek.com) 控制台看，无公开 API。

---

## 5. 本地维度：DSH 自身记录的用量（未来插件可聚合）

- 会话日志 `~/.dsh/sessions/**/session.jsonl.zstd`（zstd 压缩）中，每条请求有 `assistant/chunk → usage` 记录：
  ```json
  {"type":"assistant/chunk","data":{"chunk":{"type":"usage","usage":{"inputTokens":17664,"outputTokens":504}}}}
  ```
  同文件还含 `provider`、`model` 字段 → 可按 provider/model 聚合 DSH 实际消耗的 token（多轮窗口大小）。
- `@deepseek-ai/dsh-token-meter` 服务只做上下文压力估算，**不**记录供应商计费（harness 不读取 pi-ai 的 cost 定价元数据）。
- 即：供应商"额度还剩多少"看上面各 provider 端点；"自己在各模型上实际花了多少 token/钱"可从本地会话日志聚合（结合 pi-ai catalog 中的 cost 定价可粗估金额）。

---

## 参考链接
- [bailian-cli token-plan usage 实现](https://github.com/modelstudioai/cli/blob/main/packages/commands/src/commands/usage/token-plan.ts)
- [cc-switch 智谱配额查询路由 PR #3702](https://github.com/farion1231/cc-switch/pull/3702)
- [智谱计费 FAQ（费用扣减与资源包）](https://docs.bigmodel.cn/cn/faq/fee-issues.md)
- [opencode usage API 讨论 #18648](https://github.com/anomalyco/opencode/issues/18648) / [#16017](https://github.com/anomalyco/opencode/issues/16017)