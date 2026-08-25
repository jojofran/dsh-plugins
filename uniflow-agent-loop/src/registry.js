/**
 * UniFlow 会话级登记处 — envelope / 绑定 / 回执的运行时状态（M2–M4）。
 *
 * 生命周期（设计 L2）：本状态是会话级视图；持久真相在两处 ——
 * dispatch record（repo 侧 CLI 原子落盘）与 Host session 日志。DSH 重启后
 * 经 M0 CLI `receipt` 从 session 日志恢复；插件内状态丢失时验收 fail-closed
 * （RECEIPT_LOST），绝不伪造。
 */

import { checkEnvelopeShape, checkHostReceipt, ROUTING_CAPABILITY_LIMIT } from './gates.js'

export function createRegistry () {
  /** work_item id → { envelope, requested, recordedAt, started } */
  const envelopes = new Map()
  /** 待启动 dispatch 队列（register 入队，provider.start 取走）。 */
  const queue = []
  /** in-flight 绑定：agent/request 匹配用。 */
  const armed = []
  /** run id → work_item id（run → dispatch 关联）。 */
  const runPins = new Map()
  /** work_item id → 捕获的实际回执（agent/request 拦截生成，机器真相）。 */
  const receipts = new Map()

  function registerEnvelope (envelope) {
    const errors = checkEnvelopeShape(envelope)
    if (errors.length > 0) {
      const err = new Error(`WORK_ITEM_REQUIRED: ${errors.join('; ')}`)
      err.code = 'WORK_ITEM_REQUIRED'
      throw err
    }
    const inner = envelope.dsh_work_envelope
    const id = inner.work_item.id
    if (envelopes.has(id)) {
      const err = new Error(`fanout rejected: work item ${id} already registered`)
      err.code = 'FANOUT_REJECTED'
      throw err
    }
    envelopes.set(id, { envelope, requested: inner.model_binding, recordedAt: Date.now() })
    queue.push(id)
    return { registered: true, work_item_id: id }
  }

  function takeNextDispatch () {
    while (queue.length > 0) {
      const id = queue.shift()
      const entry = envelopes.get(id)
      if (entry !== undefined && !entry.started) return { id, ...entry }
    }
    return undefined
  }

  function returnDispatch (dispatch) {
    queue.unshift(dispatch.id)
  }

  function armBinding (dispatch, parentSessionId) {
    armed.push({ ...dispatch, parentSessionId })
  }

  function disarmBinding (dispatch) {
    const index = armed.findIndex(a => a.id === dispatch.id)
    if (index !== -1) armed.splice(index, 1)
  }

  /** agent/request 匹配：session 已钉定 → 直接取；否则按 (provider, model)
   *  FIFO 匹配并排除 dispatch 父会话。并发同绑定 dispatch 的 work_item
   *  归属按 FIFO —— 绑定相同时回执内容一致，归属差异无行为影响（已记录）。 */
  function matchBinding (sessionId, provider, model) {
    for (const candidate of armed) {
      if (candidate.sessionId === sessionId) return candidate
    }
    const index = armed.findIndex(a =>
      a.sessionId === undefined &&
      a.requested.provider === provider &&
      a.requested.model === model &&
      a.parentSessionId !== sessionId)
    if (index === -1) return undefined
    const matched = armed.splice(index, 1)[0]
    matched.sessionId = sessionId
    return matched
  }

  function pinRun (run, dispatch) {
    const entry = envelopes.get(dispatch.id)
    if (entry !== undefined) entry.started = true
    if (run?.id !== undefined) runPins.set(String(run.id), dispatch.id)
  }

  function captureReceipt (workItemId, receipt) {
    receipts.set(workItemId, { ...receipt, captured_by: 'agent/request-interception' })
  }

  function getReceipt (workItemId) {
    return receipts.get(workItemId)
  }

  function verifyReceipt (workItemId, receipt) {
    const entry = envelopes.get(workItemId)
    if (entry === undefined) {
      const err = new Error(`RECEIPT_LOST: no envelope registered for ${workItemId}`)
      err.code = 'RECEIPT_LOST'
      throw err
    }
    const actual = receipt ?? receipts.get(workItemId)
    const [code, reasons] = checkHostReceipt(
      actual, entry.requested, workItemId, entry.requested.worker_owner)
    if (actual === undefined || actual === null) {
      const err = new Error('RECEIPT_LOST: no captured receipt for ' + workItemId)
      err.code = 'RECEIPT_LOST'
      throw err
    }
    if (reasons.length > 0) {
      const err = new Error(`${code ?? ROUTING_CAPABILITY_LIMIT}: ${reasons.join(', ')}`)
      err.code = code ?? ROUTING_CAPABILITY_LIMIT
      throw err
    }
    return {
      verified: true,
      actual: `${actual.actual_provider}/${actual.actual_model}/${actual.actual_reasoning}`,
    }
  }

  function health () {
    return {
      plugin: 'dsh-uniflow-agent-loop',
      loaded: true,
      envelopes: envelopes.size,
      receipts: receipts.size,
      pending: [...envelopes.entries()]
        .filter(([, v]) => !v.started).map(([id]) => id),
      awaiting_receipt: [...envelopes.keys()].filter(id => !receipts.has(id)),
    }
  }

  function dispose () {
    envelopes.clear()
    queue.length = 0
    armed.length = 0
    runPins.clear()
    receipts.clear()
  }

  return {
    registerEnvelope, takeNextDispatch, returnDispatch,
    armBinding, disarmBinding, matchBinding, pinRun,
    captureReceipt, getReceipt, verifyReceipt, health, dispose,
  }
}
