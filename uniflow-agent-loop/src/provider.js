/**
 * UniflowProvider — `registerProvider('uniflow')` 强制层（M2）。
 *
 * 装饰器模式：不复制 in-process spawn 实现，而是把绑定覆盖注入 request 后
 * 委托给宿主已注册的 `spawn` provider（`ctx.subagents.getProvider('spawn')`）。
 * 零 harness 运行时依赖 —— 所有交互走 ctx 服务面。
 *
 * 强制语义：
 * 1. start 时必须存在已登记（registerEnvelope）且未启动的 dispatch —— 没有
 *    合法 WorkItem envelope 的 uniflow 启动被拒绝（WORK_ITEM_REQUIRED）。
 * 2. 派发前核对 Host 路由：ctx.llm.listProviders() 必须含绑定 provider，
 *    否则在任何子 Agent 创建前 fail-closed（ROUTING_CAPABILITY_LIMIT）。
 * 3. request.agentOptions 的 provider/model 被 envelope 绑定强制覆盖 ——
 *    调用方（模型自发参数）无法指定别的模型。
 * 4. reasoning 由 index.js 的根级 agent/request waterfall 注入（M3），
 *    同一 listener 捕获真实回执（M4）。
 */

import { ROUTING_CAPABILITY_LIMIT, WORK_ITEM_REQUIRED } from './gates.js'

export function createUniflowProvider (ctx, registry) {
  return {
    name: 'uniflow',
    // 委托 spawn：全部 start-time 能力随被装饰者声明。
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,

    /**
     * @param {import('@deepseek-ai/dsh-subagent').ResolvedSubagentStartRequest} request
     * @returns {Promise<import('@deepseek-ai/dsh-subagent').SubagentRun>}
     */
    async start (request) {
      const dispatch = registry.takeNextDispatch()
      if (dispatch === undefined) {
        const err = new Error(
          'WORK_ITEM_REQUIRED: uniflow start requires a registered dispatch envelope (no valid WorkItem; markdown/natural-language dispatch is forbidden)')
        err.code = WORK_ITEM_REQUIRED
        throw err
      }
      const binding = dispatch.requested
      const parentSessionId = request.parent?.session?.id

      // tool-only：不创建任何子 Agent（UniFlow 语义：零模型调用）。
      if (binding.model === 'none') {
        const err = new Error(
          'WORK_ITEM_REQUIRED: tool-only WorkItem must not spawn a worker (model=none, zero model calls)')
        err.code = WORK_ITEM_REQUIRED
        registry.returnDispatch(dispatch)
        throw err
      }

      // 能力核对在任何子 Agent 创建之前 fail-closed（写入前拒绝）。
      const routes = ctx.llm.listProviders().map(p => p.id)
      if (!routes.includes(binding.provider)) {
        const err = new Error(
          `ROUTING_CAPABILITY_LIMIT: host has no registered provider route '${binding.provider}' (available: ${routes.join(', ') || 'none'}); refusing before any child creation`)
        err.code = ROUTING_CAPABILITY_LIMIT
        err.binding = binding
        registry.returnDispatch(dispatch)
        throw err
      }

      // 强制覆盖：调用方无法指定别的 provider/model。
      const overridden = {
        ...request,
        agentOptions: {
          ...request.agentOptions,
          provider: binding.provider,
          model: binding.model,
        },
      }

      // 登记 in-flight 绑定：根级 agent/request listener 按此注入 reasoning
      // 并捕获回执（见 index.js installEnforcement）。
      registry.armBinding(dispatch, parentSessionId)

      const spawn = ctx.subagents.getProvider('spawn')
      if (spawn === undefined) {
        const err = new Error(
          'ROUTING_CAPABILITY_LIMIT: delegate provider "spawn" is not registered on ctx.subagents')
        err.code = ROUTING_CAPABILITY_LIMIT
        registry.disarmBinding(dispatch)
        registry.returnDispatch(dispatch)
        throw err
      }
      try {
        const run = await spawn.start(overridden)
        registry.pinRun(run, dispatch)
        return run
      } catch (err) {
        registry.disarmBinding(dispatch)
        registry.returnDispatch(dispatch)
        throw err
      }
    },
  }
}
