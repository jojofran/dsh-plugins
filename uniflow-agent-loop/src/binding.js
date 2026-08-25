/**
 * UniFlow binding resolution — 从 uni_claw 侧 profile-source.yaml 读取模型绑定（M2）。
 *
 * 单一真相：绑定的真相源是 repo 侧 `.dsh/profile-adapter/profile-source.yaml`
 * 的 machine-readable JSON 块（#BEGIN JSON … #END JSON）。本模块只做最小解析，
 * 不复制绑定语义；与 Python 侧 `dsh_profile_adapter.py` 的裁决冲突时以
 * Python 为准（fail-closed）。
 */

import { readFileSync } from 'node:fs'

/** 从 profile-source.yaml 文本提取 machine-readable JSON 块。 */
export function extractMachineJson (text) {
  const begin = text.indexOf('#BEGIN JSON')
  const end = text.indexOf('#END JSON')
  if (begin === -1 || end === -1 || end < begin) {
    throw new Error('profile-source.yaml has no #BEGIN JSON … #END JSON machine block')
  }
  const block = text.slice(begin + '#BEGIN JSON'.length, end)
  try {
    return JSON.parse(block)
  } catch (err) {
    throw new Error(`profile-source.yaml machine block is not valid JSON: ${err.message}`)
  }
}

/**
 * 解析 profile-source 配置。
 * @param {string} path - profile-source.yaml 路径。
 * @returns {{ protocolVersion:number, sourceRevision:string, modelBindings:Record<string, {primary:{provider:string,model:string,reasoning?:string},fallback?:object}>, stateDir:string }}
 */
export function loadProfileSource (path) {
  const doc = extractMachineJson(readFileSync(path, 'utf8'))
  if (doc.protocol_version === undefined) throw new Error('profile-source: protocol_version missing')
  if (doc.model_bindings === undefined || typeof doc.model_bindings !== 'object') {
    throw new Error('profile-source: model_bindings missing')
  }
  return {
    protocolVersion: doc.protocol_version,
    sourceRevision: doc.profile_source?.source_revision ?? 'unknown',
    modelBindings: doc.model_bindings,
    stateDir: doc.state_dir ?? '.dsh/profile-adapter/state',
  }
}

/**
 * ExecutionProfile → requested binding（对齐 EXECUTION_BINDING_ROLES）。
 * 返回 { provider, model, reasoning }；tool-only → none/none/none。
 */
export const EXECUTION_BINDING_ROLES = {
  'development': 'implementation_efficient',
  'test-authoring': 'implementation_efficient',
  'verification': 'implementation_efficient',
  'semantic-analysis': 'semantic_read',
  'tool-only': 'tool_only',
}

export function bindingForExecution (source, executionProfile) {
  const role = EXECUTION_BINDING_ROLES[executionProfile]
  if (role === undefined) {
    throw new Error(`unknown execution profile: ${executionProfile}`)
  }
  if (role === 'tool_only') {
    return { provider: 'none', model: 'none', reasoning: 'none', binding_role: role }
  }
  const binding = source.modelBindings[role]
  if (binding?.primary?.provider === undefined || binding?.primary?.model === undefined) {
    throw new Error(`profile-source has no primary binding for role ${role}`)
  }
  return {
    provider: binding.primary.provider,
    model: binding.primary.model,
    reasoning: binding.primary.reasoning ?? 'medium',
    binding_role: role,
  }
}
