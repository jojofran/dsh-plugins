// 任务通知 Host 半部（当前运行版本，从 plugin-code.json 同步）
// 依赖：ctx / harness
return {
  apply(ctx) {
    let pending = 0
    const hooks = { onTaskComplete: [], onDing: [] }
    let pendingHooks = []
    ctx.on('agent/status', (payload) => {
      if (payload === null || typeof payload !== 'object') return
      if (payload.status === 'idle') { pending += 1; pendingHooks = pendingHooks.concat(hooks.onTaskComplete) }
    })
    harness.handle('task-ding/take', async () => { const count = pending; pending = 0; return { ding: count > 0, count } })
    harness.handle('ding-chime/hooks/register', async (args) => {
      const { event, handler } = args || {}; if (!event || !hooks[event]) return { ok: false, error: 'unknown event' }
      hooks[event].push(handler); return { ok: true, index: hooks[event].length - 1 }
    })
    harness.handle('ding-chime/hooks/clear', async () => { hooks.onTaskComplete = []; hooks.onDing = []; pendingHooks = []; return { ok: true } })
    harness.handle('ding-chime/hooks/pending', async () => { const data = pendingHooks; pendingHooks = []; return { hooks: data } })
  },
}
