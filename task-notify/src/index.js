/**
 * 任务通知 Host 半部 — 正式包形态参考实现（@Remote 服务版）
 *
 * 监听 Agent 状态变化，通过 Remote 服务暴露 take() 方法供 Client 轮询。
 * 使用 TypertRemoteService 基类，手动应用 @Remote 装饰器（Node.js 不支持装饰器语法）。
 *
 * 注意：当前动态插件实际运行的是 host-current.js 的版本（harness.handle 模式），
 * 本文件代表"若将插件转为正式 Cordis 包加入合成配置"时的 Host 架构。
 */

import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'

/**
 * DingChimeHost — 通过 Remote 服务暴露计数器读取方法。
 * 注册为 Cordis 插件（class extends Service），自动成为合成配置中的一行。
 */
class DingChimeHost extends TypertRemoteService {
  /** 无硬依赖 */
  static inject = []

  /** 未消费的完成计数，被任意 Agent 的 idle 状态增加 */
  pending = 0

  /**
   * @param ctx - Cordis 上下文
   */
  constructor(ctx) {
    super(ctx, 'dingChimeHost')

    ctx.on('agent/status', (payload) => {
      if (payload === null || typeof payload !== 'object') return
      if (payload.status === 'idle') this.pending += 1
    })
  }

  /**
   * 取走并清零未消费的完成计数（take-and-clear 语义）。
   * @returns {{ ding: boolean, count: number }}
   */
  take() {
    const count = this.pending
    this.pending = 0
    return { ding: count > 0, count }
  }
}

// 手动应用 @Remote('take') 装饰器（Node.js 原生不支持装饰器语法）
const decorator = Remote('take')
let initializer = null
decorator(DingChimeHost.prototype.take, {
  kind: 'method',
  name: 'take',
  private: false,
  static: false,
  metadata: undefined,
  access: { get: () => DingChimeHost.prototype.take },
  addInitializer(fn) { initializer = fn },
})
// 触发标记（用原型创建空对象，使 initializer 中的 this 指向原型）
if (initializer) {
  initializer.call(Object.create(DingChimeHost.prototype))
}

export default DingChimeHost