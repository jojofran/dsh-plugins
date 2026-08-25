/**
 * UniFlow gates — 纯函数层（M1）。
 *
 * 单一真相约束：本文件不复制 uni_claw 侧 schema/校验语义；结构校验委托
 * repo 侧 `tools/agent_profile_validator.py`（CLI 子进程调用），这里只做
 * 插件运行期必须本地判定的最小机械检查（envelope/binding 形状与一致性）。
 * 与 Python 侧的裁决冲突时，以 Python validator 为准（fail-closed）。
 */

/** Host 回执必含字段（与 repo 侧 HOST_RECEIPT_FIELDS 对齐，仅形状判定）。 */
export const HOST_RECEIPT_FIELDS = [
  'session_id', 'run_id', 'work_item_id', 'worker_owner',
  'actual_provider', 'actual_model', 'actual_reasoning',
  'binding_revision', 'started_at',
]

export const ROUTING_CAPABILITY_LIMIT = 'ROUTING_CAPABILITY_LIMIT'
export const RECEIPT_LOST = 'RECEIPT_LOST'
export const WORK_ITEM_REQUIRED = 'WORK_ITEM_REQUIRED'

/**
 * 校验 dsh_work_envelope 形状（五/六节契约的最小本地判定）。
 * 返回错误列表；空数组 = 通过。深层 schema 校验委托 Python validator。
 */
export function checkEnvelopeShape (envelope) {
  const errors = []
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return ['envelope must be an object']
  }
  const inner = envelope.dsh_work_envelope
  if (inner === null || typeof inner !== 'object') {
    return ['envelope.dsh_work_envelope must be an object']
  }
  for (const field of ['protocol_version', 'session_id', 'run_id', 'correlation_id', 'profile_version']) {
    if (inner[field] === undefined || inner[field] === null || inner[field] === '') {
      errors.push(`envelope.dsh_work_envelope.${field} is required`)
    }
  }
  if (inner.work_item === null || typeof inner.work_item !== 'object') {
    errors.push('envelope.dsh_work_envelope.work_item is required')
  } else {
    for (const field of ['id', 'worker_owner', 'execution_profile']) {
      if (!inner.work_item[field]) errors.push(`work_item.${field} is required`)
    }
  }
  const binding = inner.model_binding
  if (binding === null || typeof binding !== 'object') {
    errors.push('envelope.dsh_work_envelope.model_binding is required for dispatch envelopes')
  } else {
    // tool-only: model 必须为 none 且不产生模型调用；其余角色三字段必填。
    if (binding.work_item_id !== inner.work_item.id) {
      errors.push('model_binding.work_item_id must match work_item.id')
    }
    if (binding.worker_owner !== inner.work_item.worker_owner) {
      errors.push('model_binding.worker_owner must match work_item.worker_owner')
    }
    if (binding.model === 'none') {
      if (binding.provider !== 'none' || binding.reasoning !== 'none') {
        errors.push('tool-only binding must be none/none/none')
      }
    } else {
      for (const field of ['provider', 'model', 'reasoning']) {
        if (!binding[field]) errors.push(`model_binding.${field} is required`)
      }
    }
  }
  return errors
}

/**
 * requested-vs-actual 回执核对（六.5 对齐）。
 * PENDING_SESSION_SPAWN 回执（CLI 派发、spawn 延迟）返回 RECEIPT_LOST——
 * 不是拒绝为 mismatch，而是"回执尚未存在"，验收必须等待 session 日志。
 */
export function checkHostReceipt (receipt, requestedBinding, workItemId, workerOwner) {
  const reasons = []
  if (receipt === null || typeof receipt !== 'object') {
    return [RECEIPT_LOST, ['model_receipt_missing']]
  }
  if (receipt.receipt_status === 'PENDING_SESSION_SPAWN') {
    return [RECEIPT_LOST, ['model_receipt_pending_session_spawn']]
  }
  if (receipt.work_item_id !== workItemId) reasons.push('model_receipt_work_item_mismatch')
  if (receipt.worker_owner !== workerOwner) reasons.push('model_receipt_worker_owner_mismatch')
  if (requestedBinding !== null && typeof requestedBinding === 'object') {
    for (const [field, actualKey] of [['provider', 'actual_provider'], ['model', 'actual_model'], ['reasoning', 'actual_reasoning']]) {
      const requested = requestedBinding[field]
      const actual = receipt[actualKey]
      if (requested === undefined || requested === null) continue
      if (actual === undefined || actual === null) {
        reasons.push(`model_receipt_missing:${actualKey}`)
        continue
      }
      if (requested !== actual) {
        reasons.push('model_binding_mismatch')
        break
      }
    }
    if (requestedBinding.binding_revision && receipt.binding_revision !== requestedBinding.binding_revision) {
      reasons.push('model_receipt_binding_revision_mismatch')
    }
  }
  const missing = HOST_RECEIPT_FIELDS.filter(f => !(f in receipt))
  if (missing.length > 0) reasons.push(`model_receipt_incomplete:${missing.join(',')}`)
  if (reasons.length === 0 && !receipt.started_at) reasons.push('model_receipt_missing_started_at')
  return [reasons.length === 0 ? null : ROUTING_CAPABILITY_LIMIT, reasons]
}
