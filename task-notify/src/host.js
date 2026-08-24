/**
 * task-notify Host 半部 - 简单函数版本
 * 不依赖 @deepseek-ai/dsh-typert-protocol，使用局部变量存储计数。
 * 客户端通过动态插件 harness.handle/host.call 轮询。
 */

let pending = 0

export const name = 'ding-chime'
export const inject = []

export function apply(ctx) {
  ctx.on('agent/status', (payload) => {
    if (payload === null || typeof payload !== 'object') return
    if (payload.status === 'idle') pending += 1
  })
}

/**
 * 供客户端轮询的取数方法（被动态插件 Host 半部的 harness.handle 调用）。
 * 取走并清零未消费的完成计数。
 */
export function take() {
  const count = pending
  pending = 0
  return { ding: count > 0, count }
}