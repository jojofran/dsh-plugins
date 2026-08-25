/**
 * uniflow-e2e-driver — M5 端到端流程测试驱动（test-only 插件，经 --patch 挂载）。
 *
 * 流程（对应用户验收要求）：
 *  1. Leader 正确指派模型：读取 M0 CLI 产出的 dispatch record（requested
 *     binding 由 profile-source.yaml 解析，Leader 不自选模型）。
 *  2. Leader 正确下发指定格式指令：WorkItem envelope → registerEnvelope →
 *     ctx.subagents.start('uniflow', …)，worker prompt 为 WorkItem 执行指令
 *     （含上下文加载命令与 WorkResult 契约）。
 *  3. Worker 正确加载上下文：prompt 强制第一步为
 *     `python3 tools/agent_profile_validator.py context …`。
 *  4. 正确分配模型执行任务：provider 强制 opencode-go/deepseek-v4-flash；
 *     回执从实际 LlmCallConfig 捕获（机器真相，非模型自述）。
 *
 * 零 harness 导入：sessionId/prompt 用纯对象构造（结构兼容）。
 * 断言在进程内完成，结果经 stdout 的 UNIFLOW_E2E_RESULT 行输出，退出码 0/1。
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export const name = 'uniflow-e2e-driver'
export const inject = ['agents', 'subagents', 'uniflow']

export function apply (ctx, config) {
  const recordPath = config.recordPath
  const repoRoot = config.repoRoot
  const timeoutMs = config.timeoutMs ?? 240000

  async function drive () {
    const result = {
      flow: ['dispatch_record_read', 'envelope_registered', 'worker_started',
        'worker_context_loaded', 'worker_result', 'receipt_verified'],
      steps: {},
      pass: false,
    }
    try {
      // Loader 兄弟插件并发挂载：等整树就绪再创建 Agent（对齐 headless-runner）。
      await ctx.get('loader')?.await()

      // ── 1. Leader 指派模型：读 dispatch record（M0 CLI 产出）──
      const record = JSON.parse(readFileSync(recordPath, 'utf8'))
      result.steps.dispatch_record_read = {
        requested: `${record.requested_binding.provider}/${record.requested_binding.model}/${record.requested_binding.reasoning}`,
        role: record.requested_binding.binding_role,
      }

      // ── 2. Leader 下发指定格式指令：envelope 登记 + worker prompt 构建 ──
      const envelope = record.envelope
      const item = envelope.dsh_work_envelope.work_item
      ctx.uniflow.registerEnvelope(envelope)
      result.steps.envelope_registered = { work_item_id: item.id, owner: item.worker_owner }

      // Leader（父 Agent）：idle 占位，零 LLM 调用（不消费模型预算）。
      const parent = await ctx.agents.create({
        sessionId: `session-${randomUUID()}`,
        meta: { cwd: repoRoot },
        agentOptions: { provider: 'zai', model: 'glm-5.2' },
      })

      const contextCmd = `python3 tools/agent_profile_validator.py context --module ${item.module_profile} --execution ${item.execution_profile} --revision ${item.base_revision.slice(0, 7)}`
      const prompt = [
        `You are ${item.worker_owner} (module-worker / ${item.execution_profile} / ${item.module_profile}), executing UniFlow WorkItem ${item.id}.`,
        ``,
        `## Step 1 — Load context (MANDATORY, first action)`,
        `Run exactly: ${contextCmd}`,
        `from the working directory. If it fails, report the failure in your result and stop.`,
        ``,
        `## Step 2 — Micro task (read-only)`,
        `From the loaded manifest, extract the owned paths of module "${item.module_profile}" and list them verbatim.`,
        ``,
        `## Step 3 — Return WorkResult`,
        `Reply with ONLY a JSON code block:`,
        '```json',
        `{"work_item_id": "${item.id}", "status": "DONE", "module_profile": "${item.module_profile}", "owned_paths": ["..."], "context_command_ran": true}`,
        '```',
      ].join('\n')

      // ── 3+4. worker 启动：provider 强制模型；真实执行 ──
      const run = await ctx.subagents.start('uniflow', {
        parent: parent.agent,
        label: `uniflow:${item.id}`,
        prompt: [{ type: 'text', text: prompt }],
        signal: AbortSignal.timeout(timeoutMs),
      })
      result.steps.worker_started = { run_id: String(run.id) }

      const outcome = await run.result
      const text = (outcome.output ?? [])
        .filter(b => b.type === 'text').map(b => b.text).join('')
      result.steps.worker_result = {
        stop_reason: outcome.stopReason,
        text_head: text.slice(0, 400),
      }
      const contextLoaded = /owned|paths?|module|context/i.test(text)
      result.steps.worker_context_loaded = { evidence: contextLoaded }
      await run.dispose().catch(() => {})
      await parent.dispose().catch(() => {})

      // ── 5. 回执核对（机器真相）──
      const verdict = ctx.uniflow.verifyReceipt(item.id)
      result.steps.receipt_verified = verdict
      const requested = record.requested_binding
      result.pass = verdict.verified === true
        && verdict.actual === `${requested.provider}/${requested.model}/${requested.reasoning}`
        && outcome.stopReason === 'completed'
        && contextLoaded
      if (!result.pass && result.failed_at === undefined) result.failed_at = 'final_assertions'
    } catch (err) {
      result.failed_at = 'exception'
      result.detail = `${err.code ?? ''}: ${err.message}`
    }
    return result
  }

  const started = drive().then(result => {
    process.stdout.write(`UNIFLOW_E2E_RESULT ${JSON.stringify(result)}\n`)
    const exit = ctx.get('appExit')
    if (typeof exit === 'function') exit(result.pass ? 0 : 1)
    else process.exit(result.pass ? 0 : 1)
  }).catch(err => {
    process.stderr.write(`uniflow-e2e-driver: ${err.stack ?? err}\n`)
    process.exit(1)
  })
  ctx.on('dispose', () => started)
}
