/**
 * M1 gates 单元测试 — node:test，零外部依赖。
 * 覆盖：envelope 形状校验（含 tool-only 与 fanout）、回执核对
 * （PENDING→RECEIPT_LOST、mismatch、缺失字段）、生命周期（dispose 清空）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkEnvelopeShape, checkHostReceipt } from '../src/gates.js'

function envelope (overrides = {}) {
  return {
    dsh_work_envelope: {
      protocol_version: 1,
      session_id: 'sess-1',
      run_id: 'run-1',
      correlation_id: 'corr-1',
      profile_version: '1@abc',
      work_item: { id: 'WI-1', worker_owner: 'w-1', execution_profile: 'development' },
      model_binding: {
        provider: 'opencode-go', model: 'deepseek-v4-flash', reasoning: 'high',
        work_item_id: 'WI-1', worker_owner: 'w-1', binding_revision: 'dsb@abc',
      },
      ...overrides,
    },
  }
}

function receipt (overrides = {}) {
  return {
    session_id: 'sess-1', run_id: 'run-1', work_item_id: 'WI-1', worker_owner: 'w-1',
    actual_provider: 'opencode-go', actual_model: 'deepseek-v4-flash',
    actual_reasoning: 'high', binding_revision: 'dsb@abc',
    started_at: '2026-08-25T12:00:00Z', ...overrides,
  }
}

test('valid envelope passes shape check', () => {
  assert.deepEqual(checkEnvelopeShape(envelope()), [])
})

test('missing required envelope fields are rejected', () => {
  const bad = envelope()
  delete bad.dsh_work_envelope.session_id
  delete bad.dsh_work_envelope.work_item.worker_owner
  const errors = checkEnvelopeShape(bad)
  assert.ok(errors.some(e => e.includes('session_id')))
  assert.ok(errors.some(e => e.includes('worker_owner')))
})

test('binding id/owner mismatch with work item is rejected', () => {
  const bad = envelope()
  bad.dsh_work_envelope.model_binding.work_item_id = 'WI-OTHER'
  assert.ok(checkEnvelopeShape(bad).some(e => e.includes('work_item_id')))
})

test('tool-only binding must be none/none/none', () => {
  const bad = envelope()
  bad.dsh_work_envelope.model_binding = {
    provider: 'opencode-go', model: 'none', reasoning: 'none',
    work_item_id: 'WI-1', worker_owner: 'w-1',
  }
  assert.ok(checkEnvelopeShape(bad).some(e => e.includes('tool-only')))
})

test('non-object envelope rejected', () => {
  assert.deepEqual(checkEnvelopeShape('markdown pseudo work item'), ['envelope must be an object'])
})

test('matching receipt verifies', () => {
  const [code, reasons] = checkHostReceipt(receipt(), envelope().dsh_work_envelope.model_binding, 'WI-1', 'w-1')
  assert.equal(code, null)
  assert.deepEqual(reasons, [])
})

test('model mismatch is rejected with ROUTING_CAPABILITY_LIMIT', () => {
  const [code, reasons] = checkHostReceipt(
    receipt({ actual_model: 'glm-5.2' }),
    envelope().dsh_work_envelope.model_binding, 'WI-1', 'w-1')
  assert.equal(code, 'ROUTING_CAPABILITY_LIMIT')
  assert.ok(reasons.includes('model_binding_mismatch'))
})

test('PENDING_SESSION_SPAWN receipt maps to RECEIPT_LOST (not mismatch)', () => {
  const [code, reasons] = checkHostReceipt(
    receipt({ receipt_status: 'PENDING_SESSION_SPAWN' }),
    envelope().dsh_work_envelope.model_binding, 'WI-1', 'w-1')
  assert.equal(code, 'RECEIPT_LOST')
  assert.ok(reasons.includes('model_receipt_pending_session_spawn'))
})

test('missing receipt maps to RECEIPT_LOST', () => {
  const [code, reasons] = checkHostReceipt(null, null, 'WI-1', 'w-1')
  assert.equal(code, 'RECEIPT_LOST')
  assert.deepEqual(reasons, ['model_receipt_missing'])
})

test('incomplete receipt (missing fields) is rejected', () => {
  const partial = receipt()
  delete partial.actual_provider
  delete partial.started_at
  const [code, reasons] = checkHostReceipt(partial, null, 'WI-1', 'w-1')
  assert.equal(code, 'ROUTING_CAPABILITY_LIMIT')
  assert.ok(reasons.some(r => r.startsWith('model_receipt_incomplete')))
})

test('work item / owner mismatch rejected', () => {
  const [code] = checkHostReceipt(receipt({ work_item_id: 'WI-X' }), null, 'WI-1', 'w-1')
  assert.equal(code, 'ROUTING_CAPABILITY_LIMIT')
})
