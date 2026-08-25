/**
 * @user/dsh-plugin-provider-usage — 模型供应商用量/配额查询插件（Tool Plugin）
 *
 * 职责边界（对齐 DSH Plugin 规范）：
 *  - 只做一件事：查询已配置供应商的用量/配额（余额、百分比、重置时间）；
 *  - 只提供 Evidence：返回结构化数据（success / data / error），不做任何决策；
 *  - 零稳态开销：不监听事件、无定时器，仅在工具被调用时发起 HTTPS 请求；
 *  - 软失败：任何错误（缺凭证/网络/超时/HTTP/解析/仅控制台）都归一化为
 *    结构化 error 返回，不抛未捕获异常、不影响 agent 主流程。
 *
 * 支持供应商（2026-08-25 实测）：
 *  - zai              智谱 GLM      GET /api/monitor/usage/quota/limit   ✅
 *  - opencode-go      OpenCode Zen  GET /v1/usage                        ✅
 *  - deepseek         官方 API      GET /user/balance                    ✅（仅余额）
 *  - qwen-token-plan-cn 百炼令牌    无公开 API                           ❌（仅控制台）
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import { PROVIDERS, adapterFor, providerIds, ERROR_CODES } from './providers.js'

export const name = 'provider-usage'
export const inject = ['tools']

/** Merge row config over factory defaults; both layers optional. */
function normalizeConfig(config) {
  const raw = config && typeof config === 'object' ? config : {}
  const defaults = {
    timeoutMs: 15000,
    providers: {},
  }
  const merged = {
    timeoutMs:
      Number.isFinite(raw.timeoutMs) && raw.timeoutMs > 0 ? raw.timeoutMs : defaults.timeoutMs,
    providers: raw.providers || defaults.providers,
  }
  return merged
}

/** Resolve one provider's effective baseURL: row config wins, then adapter default. */
function baseURLFor(adapter, providerConfig) {
  const fromConfig = providerConfig && typeof providerConfig.baseURL === 'string' && providerConfig.baseURL
  return (fromConfig || adapter.defaultBaseURL).replace(/\/+$/, '')
}

/**
 * Resolve a credential by env-name through the same seam llm-pi-ai uses:
 * `credentials` service first (web Models page writes there), process env as
 * fallback when the service is absent (headless). Never reads secrets directly.
 */
async function resolveApiKey(ctx, adapter, providerConfig) {
  const envName = providerConfig && typeof providerConfig.apiKeyEnv === 'string'
    ? providerConfig.apiKeyEnv
    : adapter.apiKeyEnv
  if (!envName) return undefined
  const credentials = ctx.get('credentials')
  if (credentials !== undefined) {
    const hit = await credentials.resolve(envName)
    if (hit && typeof hit.value === 'string' && hit.value.length > 0) return hit.value
  }
  if (typeof process !== 'undefined' && typeof process.env === 'object') {
    const env = process.env[envName]
    if (typeof env === 'string' && env.length > 0) return env
  }
  return undefined
}

/** Fetch JSON with an optional timeout; never throws for provider-level failures. */
async function fetchJson(url, headers, timeoutMs) {
  if (typeof fetch !== 'function') {
    return { fatal: { code: ERROR_CODES.NO_FETCH, message: '当前运行时没有全局 fetch，无法发起网络请求' } }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(url, { method: 'GET', headers, signal: controller.signal, redirect: 'follow' })
  } catch (error) {
    const aborted = error && (error.name === 'AbortError' || error.name === 'TimeoutError')
    return {
      fatal: aborted
        ? { code: ERROR_CODES.TIMEOUT, message: `请求超时（>${timeoutMs}ms）：${url}` }
        : { code: ERROR_CODES.NETWORK_ERROR, message: `网络请求失败：${error && error.message ? error.message : String(error)}` },
    }
  } finally {
    clearTimeout(timer)
  }
  const raw = await response.text().catch(() => '')
  return { response, raw }
}

/** Normalize an HTTP failure into a structured error with a response snippet. */
function httpError(status, raw) {
  return {
    code: ERROR_CODES.HTTP_ERROR,
    message: `供应商接口返回 HTTP ${status}`,
    status,
    bodySnippet: typeof raw === 'string' ? raw.slice(0, 300) : undefined,
  }
}

/** Query one provider; always resolves to a canonical result object. */
async function queryProvider(ctx, cfg, provider) {
  const adapter = adapterFor(provider)
  if (!adapter) {
    return {
      success: false,
      provider,
      queriedAt: new Date().toISOString(),
      error: {
        code: ERROR_CODES.UNKNOWN_PROVIDER,
        message: `未知供应商: ${provider}，可选：${providerIds().join(', ')}`,
      },
    }
  }

  // 仅控制台供应商：如实返回调查结论，不发起请求。
  if (adapter.consoleOnly) {
    return {
      success: false,
      provider,
      queriedAt: new Date().toISOString(),
      error: adapter.consoleOnly,
    }
  }

  const providerConfig = cfg.providers[provider]
  const apiKey = await resolveApiKey(ctx, adapter, providerConfig).catch(() => undefined)
  if (!apiKey) {
    return {
      success: false,
      provider,
      queriedAt: new Date().toISOString(),
      error: {
        code: ERROR_CODES.MISSING_CREDENTIAL,
        message: `找不到 ${adapter.apiKeyEnv} 凭证：请在 Web Models 页存储该 key，或在环境变量导出。`,
      },
    }
  }

  const url = adapter.url(baseURLFor(adapter, providerConfig))
  const headers = { Accept: 'application/json', 'User-Agent': 'dsh-plugin-provider-usage/1.0', ...adapter.auth(apiKey) }
  const { fatal, response, raw } = await fetchJson(url, headers, cfg.timeoutMs)
  if (fatal) {
    return { success: false, provider, queriedAt: new Date().toISOString(), error: fatal }
  }
  if (!response.ok) {
    return {
      success: false,
      provider,
      queriedAt: new Date().toISOString(),
      error: httpError(response.status, raw),
    }
  }

  let json
  try {
    json = JSON.parse(raw)
  } catch (error) {
    return {
      success: false,
      provider,
      queriedAt: new Date().toISOString(),
      error: {
        code: ERROR_CODES.PARSE_ERROR,
        message: `响应不是合法 JSON：${error.message}；原文前 200 字符：${raw.slice(0, 200)}`,
      },
    }
  }

  try {
    const data = adapter.parse(json)
    return { success: true, provider, queriedAt: new Date().toISOString(), data }
  } catch (error) {
    return {
      success: false,
      provider,
      queriedAt: new Date().toISOString(),
      error: {
        code: ERROR_CODES.PARSE_ERROR,
        message: `响应解析失败：${error.message}`,
        bodySnippet: raw.slice(0, 300),
      },
    }
  }
}

/** Shared output schema: 规范 §6.3 的结构化返回（success / data / error）。 */
const RESULT_SCHEMA = {
  type: 'object',
  properties: {
    success: { type: 'boolean', required: true, description: '查询是否成功' },
    provider: { type: 'string', description: '供应商 id' },
    queriedAt: { type: 'string', description: '查询时间（ISO 8601）' },
    data: { type: 'json', description: '用量/配额数据（成功时存在）' },
    error: { type: 'json', description: '结构化错误 {code, message}（失败时存在）' },
  },
  additionalProperties: false,
}

function renderText(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
}

/** Plugin entry. 只注册两个工具，不发布服务、不改任何现有行为。 */
export function apply(ctx, config) {
  const cfg = normalizeConfig(config)

  ctx.tools.register(
    defineTool({
      name: 'usage_query',
      description:
        '查询某个已配置模型供应商的用量/配额（余额、已用/剩余百分比、重置时间等）。' +
        `可用 providers：${providerIds().join(', ')}。` +
        'qwen-token-plan-cn 无公开 API（仅控制台），会返回说明性错误。',
      parameters: {
        provider: {
          type: 'string',
          enum: providerIds(),
          required: true,
          description: '供应商 id，如 zai / opencode-go / deepseek',
        },
      },
      output: { schema: RESULT_SCHEMA, render: renderText },
      execute: (args) => queryProvider(ctx, cfg, args.provider),
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'usage_overview',
      description:
        '查询所有已配置且支持 API 查询的模型供应商用量概览（一次性返回）。' +
        '仅控制台的供应商（qwen-token-plan-cn）会被跳过并在结果中标注。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            success: { type: 'boolean', required: true },
            queriedAt: { type: 'string' },
            providers: { type: 'array', items: { type: 'json' }, description: '每个供应商一条用量结果' },
          },
          additionalProperties: false,
        },
        render: renderText,
      },
      execute: async () => {
        const providers = []
        for (const provider of providerIds()) {
          providers.push(await queryProvider(ctx, cfg, provider))
        }
        return {
          success: true,
          queriedAt: new Date().toISOString(),
          providers,
        }
      },
    }),
  )
}