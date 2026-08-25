/**
 * M2–M4 单元测试 — provider 强制、agent/request 注入与回执捕获。
 * 全部使用 fake ctx/subagents/llm（不发真实模型调用）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRegistry } from '../src/registry.js'
import { createUniflowProvider } from '../src/provider.js'
import { extractMachineJson, loadProfileSource, bindingForExecution } from '../src/binding.js'
import { readFileSync } from 'node:fs'
import { apply } from '../src/index.js'

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

function fakeCtx () {
  const listeners = { 'agent/request': [] }
  const providers = new Map()
  const ctx = {
    llm: {
      listProviders: () => [{ id: 'opencode-go' }, { id: 'zai' }],
    },
    subagents: {
      registerProvider: p => { providers.set(p.name, p) },
      getProvider: name => providers.get(name),
    },
    on: (event, fn) => {
      listeners[event] = listeners[event] ?? []
      listeners[event].push(fn)
      return () => listeners[event].splice(listeners[event].indexOf(fn), 1)
    },
    reflect: { provide: (name, service) => { ctx[name] = service } },
    logger: { warn: () => {} },
  }
  ctx.__listeners = listeners
  ctx.__providers = providers
  return ctx
}

/** 直接调根级 waterfall listener（模拟一个 agent/request 事件）。 */
async function fireRequest (ctx, sessionId, resolvedConfig) {
  const hook = ctx.__listeners['agent/request'][0]
  assert.ok(hook !== undefined, 'agent/request hook installed')
  return hook(
    { agent: { session: { id: sessionId } }, turn: 1, step: 1, signal: null },
    async () => resolvedConfig,
  )
}

test('M2: start without registered envelope is WORK_ITEM_REQUIRED', async () => {
  const ctx = fakeCtx()
  const registry = createRegistry()
  const provider = createUniflowProvider(ctx, registry)
  await assert.rejects(
    () => provider.start({ parent: { session: { id: 'p' } }, agentOptions: {} }),
    err => err.code === 'WORK_ITEM_REQUIRED' && /registered dispatch envelope/.test(err.message),
  )
})

test('M2: unsupported provider route fail-closes before any child creation', async () => {
  const ctx = fakeCtx()
  const registry = createRegistry()
  registry.registerEnvelope(envelope({
    model_binding: {
      provider: 'no-such-route', model: 'm', reasoning: 'high',
      work_item_id: 'WI-1', worker_owner: 'w-1', binding_revision: 'dsb@abc',
    },
  }))
  const provider = createUniflowProvider(ctx, registry)
  await assert.rejects(
    () => provider.start({ parent: { session: { id: 'p' } }, agentOptions: {} }),
    err => err.code === 'ROUTING_CAPABILITY_LIMIT' && /no registered provider route/.test(err.message),
  )
  // 拒绝后 dispatch 回队列（可修复路由后重试），且未产生任何 spawn 调用。
  assert.equal(registry.health().pending.includes('WI-1'), true)
})

test('M2: tool-only binding never spawns a worker', async () => {
  const ctx = fakeCtx()
  const registry = createRegistry()
  registry.registerEnvelope(envelope({
    model_binding: {
      provider: 'none', model: 'none', reasoning: 'none',
      work_item_id: 'WI-1', worker_owner: 'w-1', binding_revision: 'dsb@abc',
    },
  }))
  const provider = createUniflowProvider(ctx, registry)
  await assert.rejects(
    () => provider.start({ parent: { session: { id: 'p' } }, agentOptions: {} }),
    err => err.code === 'WORK_ITEM_REQUIRED' && /tool-only/.test(err.message),
  )
})

test('M2: provider overrides agentOptions with envelope binding and delegates to spawn', async () => {
  const ctx = fakeCtx()
  const registry = createRegistry()
  registry.registerEnvelope(envelope())
  // 恶意/错误调用方试图指定别的模型：
  const seenRequests = []
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: async (request) => {
      seenRequests.push(request)
      return { id: 'child-1', localAgent: undefined, result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} }
    },
  })
  const provider = createUniflowProvider(ctx, registry)
  const run = await provider.start({
    parent: { session: { id: 'parent-1' } },
    agentOptions: { provider: 'zai', model: 'glm-5.2' },
    prompt: [],
  })
  assert.equal(seenRequests.length, 1)
  assert.equal(seenRequests[0].agentOptions.provider, 'opencode-go')
  assert.equal(seenRequests[0].agentOptions.model, 'deepseek-v4-flash')
  // run 已钉定到 dispatch；dispatch 不再 pending。
  assert.equal(registry.health().pending.includes('WI-1'), false)
  assert.ok(run !== undefined)
})

test('M2: spawn failure returns dispatch to queue (retryable, no loss)', async () => {
  const ctx = fakeCtx()
  const registry = createRegistry()
  registry.registerEnvelope(envelope())
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: async () => { throw new Error('spawn boom') },
  })
  const provider = createUniflowProvider(ctx, registry)
  await assert.rejects(() => provider.start({ parent: { session: { id: 'p' } }, agentOptions: {} }), /spawn boom/)
  assert.equal(registry.health().pending.includes('WI-1'), true)
})

test('M3+M4: agent/request injects binding and captures machine receipt', async () => {
  const ctx = fakeCtx()
  apply(ctx, {})
  ctx.uniflow.registerEnvelope(envelope())
  // provider.start 的 armBinding 路径（经真 provider）：
  const registryProvider = ctx.__providers.get('uniflow')
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: async () => ({ id: 'child-9', result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} }),
  })
  await registryProvider.start({ parent: { session: { id: 'parent-1' } }, agentOptions: {}, prompt: [] })

  // 真实流：子 Agent 的 agentOptions 已被 M2 覆盖为绑定模型（resolved config
  // 携带 opencode-go/deepseek-v4-flash），reasoning 仍为父默认（medium）。
  // listener 职责：注入绑定的 reasoning=high + 捕获机器回执。
  const out = await fireRequest(ctx, 'child-9', {
    provider: 'opencode-go', model: 'deepseek-v4-flash', reasoningEffort: 'medium', maxTokens: 100,
  })
  assert.equal(out.provider, 'opencode-go')
  assert.equal(out.model, 'deepseek-v4-flash')
  assert.equal(out.reasoningEffort, 'high')

  const verdict = ctx.uniflow.verifyReceipt('WI-1')
  assert.equal(verdict.verified, true)
  assert.equal(verdict.actual, 'opencode-go/deepseek-v4-flash/high')

  // 未匹配会话（父会话/无关会话）零干扰：
  const untouched = await fireRequest(ctx, 'some-other-session', {
    provider: 'zai', model: 'glm-5.2', reasoningEffort: 'medium',
  })
  assert.equal(untouched.provider, 'zai')
  assert.equal(untouched.reasoningEffort, 'medium')
})

test('M4: receipt mismatch (wrong model executed) is rejected', async () => {
  const ctx = fakeCtx()
  apply(ctx, {})
  ctx.uniflow.registerEnvelope(envelope())
  const provider = ctx.__providers.get('uniflow')
  ctx.subagents.registerProvider({
    name: 'spawn',
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
    inheritsParentContext: false,
    start: async () => ({ id: 'child-x', result: Promise.resolve({ stopReason: 'completed' }), dispose: async () => {} }),
  })
  await provider.start({ parent: { session: { id: 'p' } }, agentOptions: {}, prompt: [] })
  // 绑定未生效的真实执行（resolved 仍是父模型）：listener 不匹配 → 无覆盖、
  // 无回执捕获 —— 验收时 fail-closed（RECEIPT_LOST），绝不伪造。
  const out = await fireRequest(ctx, 'child-x', { provider: 'zai', model: 'glm-5.2' })
  assert.equal(out.provider, 'zai')
  assert.throws(() => ctx.uniflow.verifyReceipt('WI-1'), err => err.code === 'RECEIPT_LOST')
})

test('M4: verifyReceipt with no envelope is RECEIPT_LOST (restart semantics)', () => {
  const ctx = fakeCtx()
  apply(ctx, {})
  assert.throws(() => ctx.uniflow.verifyReceipt('WI-UNKNOWN'), err => err.code === 'RECEIPT_LOST')
})

test('L3: health reports envelope/receipt/pending counts', () => {
  const ctx = fakeCtx()
  apply(ctx, {})
  const h1 = ctx.uniflow.health()
  assert.equal(h1.loaded, true)
  assert.equal(h1.envelopes, 0)
  ctx.uniflow.registerEnvelope(envelope())
  const h2 = ctx.uniflow.health()
  assert.equal(h2.envelopes, 1)
  assert.deepEqual(h2.pending, ['WI-1'])
  assert.deepEqual(h2.awaiting_receipt, ['WI-1'])
})

test('L2: apply installs one dispose-cleaned registry (session view)', () => {
  const ctx = fakeCtx()
  const disposers = []
  ctx.on = (event, fn) => {
    disposers.push({ event, fn })
    return () => {}
  }
  apply(ctx, {})
  const disposeListener = disposers.find(d => d.event === 'dispose')
  assert.ok(disposeListener !== undefined)
})

test('binding.js: parses profile-source machine block and resolves execution bindings', () => {
  const path = '/Users/fran/Documents/Code/spacex/uni_claw/.dsh/profile-adapter/profile-source.yaml'
  const source = loadProfileSource(path)
  assert.equal(source.protocolVersion, 1)
  assert.ok(source.sourceRevision.length >= 12)
  const dev = bindingForExecution(source, 'development')
  assert.equal(dev.provider, 'opencode-go')
  assert.equal(dev.model, 'deepseek-v4-flash')
  const tool = bindingForExecution(source, 'tool-only')
  assert.deepEqual(
    { provider: tool.provider, model: tool.model, reasoning: tool.reasoning },
    { provider: 'none', model: 'none', reasoning: 'none' },
  )
  assert.throws(() => bindingForExecution(source, 'bogus'), /unknown execution profile/)
})

test('binding.js: machine block extraction fails closed on malformed yaml', () => {
  assert.throws(() => extractMachineJson('no block here'), /no #BEGIN JSON/)
  assert.throws(() => extractMachineJson('#BEGIN JSON\n{invalid\n#END JSON'), /not valid JSON/)
})
