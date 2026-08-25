/**
 * Provider usage adapters — one pure adapter per vendor.
 *
 * Adapters never touch the network and never resolve credentials by
 * themselves: `index.js` owns the HTTP layer and the credential seam, so
 * every adapter here is unit-testable offline and the failure paths stay in
 * one place. Each adapter exposes:
 *   - label / defaultBaseURL / apiKeyEnv  (config + docs facts)
 *   - url(baseURL)      → full endpoint URL for this provider
 *   - auth(apiKey)      → headers object for this provider's auth style
 *   - parse(json)       → canonical, lossless-data usage object
 *   - consoleOnly?      → providers with NO public API (structured notice)
 *
 * Canonical result contract (evidence for the agent, no decisions):
 *   { success, provider, queriedAt, data?, error? }
 */

const STRIP_SLASH = /\/+$/

/** Canonical error codes surfaced to the agent. */
export const ERROR_CODES = {
  UNKNOWN_PROVIDER: 'UNKNOWN_PROVIDER',
  MISSING_CREDENTIAL: 'MISSING_CREDENTIAL',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  HTTP_ERROR: 'HTTP_ERROR',
  PARSE_ERROR: 'PARSE_ERROR',
  CONSOLE_ONLY: 'CONSOLE_ONLY',
  NO_FETCH: 'NO_FETCH',
}

/**
 * 阿里云百炼 Token Plan（qwen-token-plan-cn）没有公开用量 API。
 * 调查结论（2026-08-25，见上层 README.md）：
 *  - compatible-mode 网关把任意路径路由到推理入口（/balance、/usage → 400 "model missing"）；
 *  - 真实接口走阿里云控制台网关（bailian-cli：zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage），
 *    需要阿里云控制台登录 token，API Key 不可用。
 * 插件如实返回提示，不假装能查。
 */
function tokenPlanConsoleOnly() {
  return {
    code: ERROR_CODES.CONSOLE_ONLY,
    message:
      'qwen-token-plan-cn（阿里云百炼 Token Plan）没有公开用量 API：' +
      'compatible-mode 网关的 /balance、/usage 均不可用（400 "model missing"），' +
      '真实配额走阿里云控制台网关（bailian-cli `bl usage token-plan`，' +
      'zeldaHttp.apikeyMgr./tokenplan/personal/api/v2/usage），需要阿里云账号控制台登录，API Key 查不到。' +
      '请改用控制台查看，或让 DSH 包装 bailian-cli 的控制台登录流程。',
  }
}

/** Adapter registry. Key = provider id used by the tool and the config. */
export const PROVIDERS = {
  zai: {
    label: '智谱 GLM (open.bigmodel.cn)',
    defaultBaseURL: 'https://open.bigmodel.cn',
    apiKeyEnv: 'ZAI_API_KEY',
    url(base) {
      return `${base.replace(STRIP_SLASH, '')}/api/monitor/usage/quota/limit`
    },
    // 实测（2026-08-25）：Authorization 直接放 API Key 即可（不带 Bearer 前缀；
    // 带 Bearer 也返回 200）。cc-switch 源码注释亦为"智谱不加 Bearer 前缀"。
    auth(key) {
      return { Authorization: key }
    },
    parse(json) {
      if (!json || typeof json !== 'object' || !json.data || !Array.isArray(json.data.limits)) {
        throw new Error('unexpected zai response shape: missing data.limits')
      }
      return {
        level: json.data.level,
        limits: json.data.limits.map((l) => ({
          // 窗口为推断值：unit 3 ↔ 5 小时档、unit 6 ↔ 周档（参考 cc-switch
          // coding_plan.rs 的 TIER_FIVE_HOUR / TIER_WEEKLY_LIMIT），官方文档无字段说明。
          windowGuess: String(l.unit) === '3' ? '5h' : String(l.unit) === '6' ? 'weekly' : `unit-${l.unit}`,
          unit: l.unit,
          number: l.number,
          usage: l.usage,
          currentValue: l.currentValue,
          remaining: l.remaining,
          percentage: l.percentage,
          nextResetTime: l.nextResetTime,
        })),
      }
    },
  },

  'opencode-go': {
    label: 'OpenCode Zen Go (opencode.ai)',
    defaultBaseURL: 'https://opencode.ai/zen/go',
    apiKeyEnv: 'OPENCODE_GO_API_KEY',
    url(base) {
      return `${base.replace(STRIP_SLASH, '')}/v1/usage`
    },
    auth(key) {
      return { Authorization: `Bearer ${key}` }
    },
    parse(json) {
      const usage = json && json.usage
      if (!usage || typeof usage !== 'object') {
        throw new Error('unexpected opencode-go response shape: missing usage')
      }
      const windowOf = (name) => {
        const w = usage[name]
        if (!w || typeof w !== 'object') return undefined
        return {
          status: w.status,
          percent: w.percent,
          resetsAt: w.resetsAt,
        }
      }
      return {
        windows: {
          rolling: windowOf('rolling'),
          weekly: windowOf('weekly'),
          monthly: windowOf('monthly'),
        },
      }
    },
  },

  deepseek: {
    label: 'DeepSeek 官方 API (api.deepseek.com)',
    defaultBaseURL: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    url(base) {
      return `${base.replace(STRIP_SLASH, '')}/user/balance`
    },
    auth(key) {
      return { Authorization: `Bearer ${key}` }
    },
    // 官方仅提供余额查询；/usage、/dashboard/billing/usage 均 404（实测）。
    parse(json) {
      if (!json || typeof json !== 'object' || !Array.isArray(json.balance_infos)) {
        throw new Error('unexpected deepseek response shape: missing balance_infos')
      }
      return {
        isAvailable: json.is_available,
        // 只有余额，用量明细需到 platform.deepseek.com 控制台查看（无公开 API）。
        balanceInfos: json.balance_infos.map((b) => ({
          currency: b.currency,
          totalBalance: b.total_balance,
          grantedBalance: b.granted_balance,
          toppedUpBalance: b.topped_up_balance,
        })),
      }
    },
  },

  'qwen-token-plan-cn': {
    label: '阿里云百炼 Token Plan (qwen-token-plan-cn)',
    defaultBaseURL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'QWEN_TOKEN_PLAN_CN_API_KEY',
    consoleOnly: tokenPlanConsoleOnly(),
  },
}

/** Return the adapter for a provider id, or undefined when unknown. */
export function adapterFor(provider) {
  return PROVIDERS[provider] ?? undefined
}

/** Human-readable one-line description used in tool output and docs. */
export function describe(provider) {
  const adapter = PROVIDERS[provider]
  if (!adapter) return `未知供应商: ${provider}`
  const base = `baseURL=${adapter.defaultBaseURL}`
  const key = adapter.apiKeyEnv ? `apiKeyEnv=${adapter.apiKeyEnv}` : '（无需凭证）'
  const state = adapter.consoleOnly ? '仅控制台（无公开 API）' : '支持 API 查询'
  return `${adapter.label} — ${state} — ${base}，${key}`
}

/** List of every provider id the tool accepts. */
export function providerIds() {
  return Object.keys(PROVIDERS)
}