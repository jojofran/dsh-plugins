/**
 * 离线单元测试：覆盖解析、认证头、URL 构造与失败路径（规范 §9）。
 * 不依赖网络、不依赖 DSH 服务，`node --test tests/` 直接可跑。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PROVIDERS,
  adapterFor,
  providerIds,
  ERROR_CODES,
} from '../src/providers.js'

// ---------- URL / 认证头构造 ----------

test('zai: URL 落在监控配额端点（容忍尾部斜杠）', () => {
  const adapter = adapterFor('zai')
  assert.equal(adapter.url('https://open.bigmodel.cn'), 'https://open.bigmodel.cn/api/monitor/usage/quota/limit')
  assert.equal(adapter.url('https://open.bigmodel.cn/'), 'https://open.bigmodel.cn/api/monitor/usage/quota/limit')
})

test('zai: 认证头直接放 API Key（不带 Bearer，与 cc-switch 一致）', () => {
  assert.deepEqual(adapterFor('zai').auth('sk-x'), { Authorization: 'sk-x' })
})

test('opencode-go: URL 与 Bearer 认证头', () => {
  const adapter = adapterFor('opencode-go')
  assert.equal(adapter.url('https://opencode.ai/zen/go'), 'https://opencode.ai/zen/go/v1/usage')
  assert.deepEqual(adapter.auth('sk-x'), { Authorization: 'Bearer sk-x' })
})

test('deepseek: URL 与 Bearer 认证头', () => {
  const adapter = adapterFor('deepseek')
  assert.equal(adapter.url('https://api.deepseek.com'), 'https://api.deepseek.com/user/balance')
  assert.deepEqual(adapter.auth('sk-x'), { Authorization: 'Bearer sk-x' })
})

// ---------- 解析归一化 ----------

test('zai: parse 归一化为 canonical 形态（含窗口推断）', () => {
  const raw = {
    code: 200,
    msg: 'ok',
    success: true,
    data: {
      level: 'pro',
      limits: [
        { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 12000, currentValue: 117, remaining: 11882, percentage: 1, nextResetTime: 1787678742802 },
        { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 60000, currentValue: 4167, remaining: 55832, percentage: 6, nextResetTime: 1787749266997 },
      ],
    },
  }
  const data = adapterFor('zai').parse(raw)
  assert.equal(data.level, 'pro')
  assert.equal(data.limits.length, 2)
  assert.equal(data.limits[0].windowGuess, '5h')
  assert.equal(data.limits[0].remaining, 11882)
  assert.equal(data.limits[1].windowGuess, 'weekly')
})

test('zai: 畸形响应抛 PARSE_ERROR 语义错误', () => {
  assert.throws(() => adapterFor('zai').parse({}), /data\.limits/)
  assert.throws(() => adapterFor('zai').parse(null), /data\.limits/)
})

test('opencode-go: parse 归一化三个窗口', () => {
  const raw = {
    usage: {
      rolling: { status: 'ok', percent: 1, resetsAt: '2026-08-25T18:08:07.390Z' },
      weekly: { status: 'ok', percent: 31, resetsAt: '2026-08-31T00:00:00.390Z' },
      monthly: { status: 'ok', percent: 66, resetsAt: '2026-09-18T16:29:46.390Z' },
    },
  }
  const data = adapterFor('opencode-go').parse(raw)
  assert.equal(data.windows.weekly.percent, 31)
  assert.equal(data.windows.monthly.resetsAt, '2026-09-18T16:29:46.390Z')
})

test('opencode-go: 缺窗口时返回 undefined 而非崩溃', () => {
  const data = adapterFor('opencode-go').parse({ usage: {} })
  assert.equal(data.windows.rolling, undefined)
})

test('deepseek: parse 归一化余额（含负余额字符串）', () => {
  const raw = {
    is_available: false,
    balance_infos: [
      { currency: 'CNY', total_balance: '-0.05', granted_balance: '0.00', topped_up_balance: '-0.05' },
    ],
  }
  const data = adapterFor('deepseek').parse(raw)
  assert.equal(data.isAvailable, false)
  assert.equal(data.balanceInfos[0].totalBalance, '-0.05')
})

// ---------- 供应商目录与失败路径 ----------

test('qwen-token-plan-cn: 标记为仅控制台（无公开 API），带调查结论', () => {
  const adapter = adapterFor('qwen-token-plan-cn')
  assert.ok(adapter.consoleOnly)
  assert.equal(adapter.consoleOnly.code, ERROR_CODES.CONSOLE_ONLY)
  assert.match(adapter.consoleOnly.message, /控制台/)
  assert.equal(typeof adapter.url, 'undefined') // 无网络端点，杜绝误调用
})

test('未知供应商返回 undefined（由调用方归一化为 UNKNOWN_PROVIDER）', () => {
  assert.equal(adapterFor('nope'), undefined)
})

test('providerIds 覆盖全部注册项且与 PROVIDERS 一致', () => {
  assert.deepEqual([...providerIds()].sort(), Object.keys(PROVIDERS).sort())
})