/**
 * dsh-uniflow-agent-loop — UniFlow 机械强制闭环插件（M2–M4）。
 *
 * 设计真相源：uni_claw 仓 `tmpDecision/dsh-uniflow-agent-loop-design.md`
 * （M1–M6 + L1–L5 生命周期）。Profile/schema/绑定语义全部留在 uni_claw 侧；
 * 本插件是消费者与强制执行点，不建第二真相。
 *
 * 组成：
 * - registry.js      会话级 envelope/绑定/回执状态（L2：会话视图，持久真相在
 *                    repo dispatch record + Host session 日志）
 * - binding.js       profile-source.yaml 最小解析（#BEGIN JSON 机器块）
 * - provider.js      registerProvider('uniflow')：装饰 spawn provider，强制
 *                    provider/model；路由能力在子 Agent 创建前 fail-closed
 * - 本文件            根级 agent/request waterfall：reasoning 注入（M3）+
 *                    真实回执捕获（M4，来自实际 LlmCallConfig —— 机器真相，
 *                    非模型自述）
 *
 * 领队派发路径（与 M0 CLI 同构）：Leader 经 repo 侧
 * `python3 tools/dsh_profile_adapter.py dispatch <wi.json>` 产出 dispatch
 * record（含 requested binding），随后把 envelope 登记进本插件并经
 * `ctx.subagents.start('uniflow', …)` 启动 worker —— 两通道共享同一绑定真相。
 */

import { createRegistry } from './registry.js'
import { createUniflowProvider } from './provider.js'
import { loadProfileSource } from './binding.js'

export const inject = ['subagents', 'llm']

export function apply (ctx, config) {
  const registry = createRegistry()
  const profileSourcePath = config?.profileSource

  // L1：绑定真相只从 repo 侧 profile-source.yaml 读取（settings 指针传入）。
  let profileSource = null
  if (profileSourcePath !== undefined && profileSourcePath !== null && profileSourcePath !== '') {
    try {
      profileSource = loadProfileSource(profileSourcePath)
    } catch (err) {
      ctx.logger?.warn?.(`uniflow: profile-source load failed: ${err.message}`)
    }
  }

  // M2：注册强制 provider。registerProvider 返回 effect disposer（自动挂载）。
  ctx.subagents.registerProvider(createUniflowProvider(ctx, registry))

  // M3 + M4：根级 agent/request waterfall —— 对已匹配绑定的子会话注入
  // reasoningEffort 并捕获真实回执。安装在插件 ctx（agent 作用域的祖先），
  // 对所有 Agent 的请求可见；未匹配绑定的请求原样放行（零干扰）。
  const disposeRequestHook = ctx.on('agent/request', async (payload, next) => {
    const resolved = await next()
    const sessionId = String(payload.agent?.session?.id ?? '')
    if (sessionId === '') return resolved
    const binding = registry.matchBinding(sessionId, resolved.provider, resolved.model)
    if (binding === undefined) return resolved
    const requested = binding.requested
    const { reasoningEffort: _inherited, ...withoutInheritedEffort } = resolved
    const overridden = {
      ...withoutInheritedEffort,
      provider: requested.provider,
      model: requested.model,
      ...requested.reasoning === undefined || requested.reasoning === null || requested.reasoning === 'none'
        ? {}
        : { reasoningEffort: requested.reasoning },
    }
    registry.captureReceipt(binding.id, {
      session_id: sessionId,
      run_id: sessionId,
      work_item_id: binding.id,
      worker_owner: requested.worker_owner,
      actual_provider: overridden.provider,
      actual_model: overridden.model,
      actual_reasoning: overridden.reasoningEffort ?? null,
      binding_revision: requested.binding_revision ?? null,
      started_at: new Date().toISOString(),
    })
    return overridden
  })

  // L3：能力面。Leader/验证方查询插件健康与绑定真相。
  ctx.plugin('uniflow', {
    registerEnvelope: envelope => registry.registerEnvelope(envelope),
    verifyReceipt: (id, receipt) => registry.verifyReceipt(id, receipt),
    getReceipt: id => registry.getReceipt(id),
    health: () => ({
      ...registry.health(),
      profile_source: profileSource === null
        ? { loaded: false, path: profileSourcePath ?? null }
        : {
            loaded: true,
            path: profileSourcePath,
            protocol_version: profileSource.protocolVersion,
            source_revision: profileSource.sourceRevision,
          },
    }),
  })

  ctx.on('dispose', () => {
    disposeRequestHook()
    registry.dispose()
  })

  return { registry }
}

export { createRegistry, createUniflowProvider, loadProfileSource }
