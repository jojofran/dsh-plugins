# DSH 动态 Cordis 插件开发：踩坑记录与经验提炼

> 来源：一次完整的动态插件开发会话 —— 「任务完成提示音」插件（`ding-1`，当前版本 `pkg-5`）。
> 目标：把过程中踩过的坑、查过的源码结论、验证过的方法论沉淀成可复用的文档。

---

## 1. 插件背景与最终架构

**需求**：当任务完成时，浏览器播放一声「叮」；提供启用开关、声音源选择；配置持久化。

**最终架构**（两个半部 + 一条 RPC + 浏览器本地持久化）：

```
┌─ Host（node:vm 沙箱，挂载在根作用域）────────────────────────┐
│  ctx.on('agent/status') → status==='idle' 时 pending += 1   │
│  harness.handle('task-ding/take') → 取走并清零 pending       │
└──────────────────────────────┬──────────────────────────────┘
                               │ host.call（Client→Host 轮询，500ms）
┌──────────────────────────────▼──────────────────────────────┐
│ Client（浏览器闭包）                                          │
│  ctx.interval(poll, 500) → 有未消费事件则 playDing()          │
│  playDing：Web Audio 合成三种音源 / 自定义 URL                 │
│  设置页：settings.section 注册（开关 + 声音源 + URL）           │
│  持久化：localStorage（dsh.ding-chime）                       │
└─────────────────────────────────────────────────────────────┘
```

**触发语义**：动态 Host 半部挂载在根作用域，会收到**所有** Agent 的 `agent/status`（主 Agent 和后台子 Agent 都算"任务完成"）。

---

## 2. 踩坑记录（现象 → 根因 → 解法）

### 坑 1：配置 UI 放在 `tool.view.cordis`（Run 卡片）里，用户根本找不到

- **现象**：`Slots.listSubTree` 查询显示 `tool.view.cordis` 有活跃 occupant（`dyn/ding-1`，key `ding-1.pkg-2`，active: true），但用户看不到任何控件。
- **根因**：`tool.view.cordis` 只在 `cordis_run` 卡片内部渲染，且 `CordisRunRow.tsx` 中
  `showBusiness = reading === 'running' && key !== null` —— 卡片状态必须是 `running` 才渲染业务区；
  而对话流中的工具调用卡片默认是折叠的，展开前内容不可见。
- **解法**：配置类 UI 一律放 `settings.section`（设置页，标准导航入口、始终可见）；`tool.view.cordis` 只放与本次 Run 强相关的交互控件，或一行静态指引（如"配置入口：设置 → …"）。

### 坑 2：动态插件内存状态在每次更新（update）后全部丢失

- **现象**：更新到新 Package 后，开关和声音源选择被重置为默认值。
- **根因**：
  - update 语义 = 先停旧 Run 再启动新 Package，Client 半部被重新求值，`apply()` 作用域内的变量全部重建；
  - 动态插件是**进程局部**的，进程重启后整个插件（含注册表）都不存在。
- **解法**：用户配置持久化到浏览器 `localStorage`（键 `dsh.ding-chime`）。加载时 `JSON.parse` + 逐字段校验 + 合并默认值；每次改动立即写回。附带收益：停止重跑、甚至重启后重建插件都能恢复配置。

### 坑 3：Host 的 `settings` / `storageDomain` 服务需要 zod/schemastery schema，动态沙箱里造不出来

- **现象**：想用官方 `settings` 服务持久化，但 `register(ns, schema: z<T>)` 要求 schemastery schema。
- **根因**：动态 Host 半部在 `node:vm` 沙箱中运行，**没有模块系统**（`import`/`require` 被屏蔽），无法构造 zod schema；`storageDomain.open(spec)` 同样要求 zod schema 校验记录。
- **解法**：先查服务契约再选持久化方案。对"配置属于客户端行为"的场景，`localStorage` 是最省事且可靠的选择（本应用自身偏好也这样存：`dsh.locale`、`dsh.theme` 等）。

### 坑 4：不要凭技能文档猜 Client 符号面 —— 以 evaluator 源码为准

- **现象/经验**：技能说"不要假设 `window`/`document` 可用"，但实际 Client 闭包**只屏蔽**了
  `setTimeout / setInterval / clearTimeout / clearInterval / fetch / require / process / Buffer`；
  `window`、`localStorage`、`AudioContext`、`Audio` 都是可达的浏览器全局（它们是闭包的 ambient 全局，不在参数表里）。
- **解法**：读源码确认符号面：
  - Client：`dk-harness/packages/extensions/cordis-client-runner/src/client/evaluator.ts`（`parameters` 数组即符号面）
  - Host：`dk-harness/packages/extensions/cordis-host-runner/src/sandbox.ts`（`NODE_API_REDIRECTS` 即屏蔽清单）
  - 仍建议对浏览器全局做 `typeof x !== 'undefined'` 兜底 + try/catch。

### 坑 5：动态 Host 半部挂载在根作用域，`agent/status` 会收到**所有** Agent 的事件

- **现象**：`ctx.on('agent/status')` 不只收到当前会话 Agent 的状态变化。
- **根因**：
  - Host 半部经 `rootCtx.plugin({ name: 'cordis-dynamic' })` 组挂载（`cordis-host-runner/src/lifecycle.ts` 的 `startHostHalf`），上下文**无 scope tag**；
  - `scopeTarget` 的 filter 对无 tag 的监听者放行全部事件（"events flow up the chain, never down"）；
  - 运行时 emit 的 payload 只有 `{ status }`（`agent` 字段由 fused dispatcher 注入，但 Host 半部无法借此反查"我的 session id"）。
- **解法**：按"任意 Agent 完成即提示"设计（子 Agent 完成同样是有价值的任务完成信号）；如果必须只响当前会话，需要另找归属标识（当前 Host 半部拿不到，属已知限制）。

### 坑 6：主题适配 —— 颜色用主题变量，字体不要写死

- **经验**：`Theme.listTokens` 只返回**颜色** token（`--dsw-alias-bg-*`、`--dsw-alias-label-*`、`--dsw-alias-border-*`、`--dsw-alias-brand-primary`、`--dsw-alias-state-*`），**没有**字体 token。
- **解法**：
  - 颜色一律 `var(--dsw-alias-xxx)`，明暗主题自动适配，无需监听 `theme/change`；
  - 字体不写死 family：普通文本继承应用字体栈，`select`/`input` 需显式 `font-family: inherit`（否则落到浏览器默认字体）；
  - 用 `styles.insert(css)` 注入样式，类名加唯一前缀（如 `dsh-ding-`）避免与页面其它包冲突；`styles` 的清理随 fiber 自动完成。

### 坑 7：Host→Client 没有推送通道，只有 Client→Host RPC

- **经验**：`harness.handle` / `host.call` 方向固定为 Client→Host，且只传 lossless JSON；Host 侧事件要通知浏览器只能**轮询**。
- **解法**：Client `inject: ['timer']` + `ctx.interval(poll, 500)` 轮询 `host.call('task-ding/take')`；Host 处理器用"取走并清零"（take-and-clear）语义，避免重复提示。本地 RPC 每 500ms 一次的开销可忽略。

### 坑 8：两个 UI 位置共享同一状态 → 必然不同步

- **现象/经验**：曾计划在 Run 卡片和设置页同时放控件；各自持有 `useState`，一处改动另一处不会刷新，出现过期值。
- **解法**：**单一配置位置**（设置页），其它位置只放静态指引；进程内共享的可变 `settings` 对象 + 单方向镜像即可，不要做双向 React 状态同步。

### 坑 9：更新（update）流程语义

- update 会**先停旧 Run** 再启动目标 Package；失败不会自动回滚（需显式 `run` 回滚到 `currentPackageId`）；
- 新 Package 的客户端是否需要重新授权，取决于之前批准时勾的是"仅本次"（单勾）还是"信任后续版本"（双勾）；
- `awaiting-approval` ≠ 失败；`starting` ≠ 成功，最终结果由系统 steering 报告。

---

## 3. 方法论与可复用模式

### 3.1 标准工作流（先查后写）

1. `cordis_inspect_list` 看有哪些 Provider；
2. `cordis_inspect_query` 查目标 Service/Event/Slot/Builtin 的**精确契约**（签名、参数、payload、注册选项）；
3. 关键结论再回源码确认（evaluator/sandbox/lifecycle/UI 渲染路径）；
4. `cordis_define` 定义 → `cordis_run` 激活 → 用 `cordis_inspect_self` + Slots 查询验证；
5. 修复用**同一 pluginId 追加新 Package**，绝不覆盖旧版本；失败先 `cordis_inspect_self` 读诊断。

### 3.2 平台选择原则

| 需求 | 放哪 | 依据 |
| --- | --- | --- |
| 事件监听、计数、业务状态 | Host | `agent/status`、`tools/result` 等均为 Host 事件 |
| 声音、主题、布局、交互 UI | Client | 浏览器能力（Audio、CSS 变量、Slots） |
| Host 事件 → 浏览器通知 | Client 轮询 + host.call | 无推送通道（坑 7） |
| 配置持久化 | Client localStorage | 官方 settings 服务需 zod（坑 3） |

### 3.3 生命周期纪律

所有副作用必须挂在 fiber 上，停止/更新时自动清理：
- `ctx.on(...)`、`ctx.interval(...)`（需 `inject: ['timer']`）→ 自动随 fiber 释放；
- `slots.inject(...)` + `slots.register(...)` → 随 fiber 级联卸载；
- `styles.insert(css)` → 随 fiber 删除 `<style>` 标签；
- `harness.handle(...)` → 由 runner 的 `run.handlerDisposers` 管理。

### 3.4 持久化决策树（动态插件）

```
配置是否需要跨更新/刷新保留？
├─ 需要 → 配置属于客户端行为 → localStorage（JSON + 校验 + 默认值合并）
├─ 需要 → 必须 Host 侧 / 跨浏览器 → 官方 settings 服务
│         （但需要 zod schema，动态沙箱不可用 → 需先确认是否可注入 schema 来源）
└─ 不需要 → 进程内存对象即可
```

### 3.5 浏览器音频注意事项

- 用 Web Audio 合成提示音（无需音频文件，无网络依赖）；
- 自动播放策略：浏览器可能在无用户交互时挂起 `AudioContext`；首次播放时检测 `state === 'suspended'` 并 `resume()`；用户批准/交互过一次后通常正常；
- 自定义 URL 播放用 `new Audio(url).play()`（HTMLAudioElement 播放不受 CORS 限制），失败要 catch 并回退。

---

## 4. 可复用代码骨架

### 4.1 通知类插件骨架（Host 计数 + Client 轮询 + 合成音）

```js
// ---- code.host ----
return {
  apply(ctx) {
    let pending = 0
    ctx.on('agent/status', (payload) => {
      if (payload === null || typeof payload !== 'object') return
      if (payload.status === 'idle') pending += 1
    })
    harness.handle('task-ding/take', async () => {
      const count = pending
      pending = 0
      return { ding: count > 0, count }   // take-and-clear，避免重复提示
    })
  },
}

// ---- code.client ----
return {
  inject: ['timer'],
  apply(ctx) {
    // 播放逻辑（Web Audio 合成，见 3.5）
    const poll = () => {
      host.call('task-ding/take', null).then((res) => {
        if (res !== null && typeof res === 'object' && res.ding === true) playDing()
      }).catch((err) => { console.error('poll failed', err) })
    }
    ctx.interval(poll, 500)
  },
}
```

### 4.2 设置页 + localStorage 持久化骨架

```js
// ---- code.client ----
const STORAGE_KEY = 'dsh.ding-chime'
const DEFAULTS = { enabled: true, sound: 'bell', url: '' }

const loadSettings = () => {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
    if (raw === null) return { ...DEFAULTS }
    const parsed = JSON.parse(raw)
    return {                       // 逐字段校验，脏数据回退默认
      enabled: typeof parsed.enabled === 'boolean' ? parsed.enabled : DEFAULTS.enabled,
      sound: SOUNDS.includes(parsed.sound) ? parsed.sound : DEFAULTS.sound,
      url: typeof parsed.url === 'string' ? parsed.url : DEFAULTS.url,
    }
  } catch (err) { return { ...DEFAULTS } }
}
const saveSettings = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)) } catch (err) {}
}
const settings = loadSettings()

// 设置页注册（settings.section 是 list 槽：id/order/label）
const slots = ctx.get('slots')
if (slots !== undefined) {
  slots.inject('settings.section', () => slots.register(
    { name: 'settings.section', id: 'ding-chime', order: 30, label: '任务完成提示音' },
    () => React.createElement('div', null, /* 控件，onChange 里 settings.x = v; saveSettings() */),
  ))
}
```

---

## 5. 关键源码索引（dk-harness 检出目录）

| 主题 | 文件 |
| --- | --- |
| Client 符号面（闭包参数表） | `packages/extensions/cordis-client-runner/src/client/evaluator.ts` |
| Client 守卫/上下文外观 | `packages/extensions/cordis-client-runner/src/client/guard.ts`、`runtime.ts` |
| Host 沙箱（屏蔽清单） | `packages/extensions/cordis-host-runner/src/sandbox.ts` |
| Host 生命周期（挂载组） | `packages/extensions/cordis-host-runner/src/lifecycle.ts` |
| Host ctx 守卫（inject 门控） | `packages/extensions/cordis-host-runner/src/guard.ts` |
| scope 路由语义（无 tag 监听者收全部） | `packages/core/scope/src/index.ts`（`scopeTarget`） |
| agent 事件 fused dispatcher | `packages/core/agent/src/dispatch.ts` |
| Run 卡片业务区渲染条件 | `packages/extensions/ui-cordis/src/client/CordisRunRow.tsx` |
| 设置区/插槽目录 | Client `Slots.listSubTree`（`settings.section`、`tool.view.cordis`） |

---

## 6. 一句话清单（速查）

- 配置 UI → `settings.section`；Run 卡片（`tool.view.cordis`）只放指引或 Run 相关交互。
- 动态插件内存态每次 update 都会重置 → 用户配置进 localStorage，逐字段校验后合并默认值。
- 官方 `settings`/`storageDomain` 要 zod schema，动态沙箱没有模块系统 → 造不出来，先查契约再选方案。
- Client 符号面以 evaluator 源码为准：屏蔽的只有 timer 全局 / fetch / require / process / Buffer。
- Host 半部挂根作用域，`agent/status` 收所有 Agent；payload 只有 `{ status }`，无法反查归属 session。
- 主题只有颜色 token：`var(--dsw-alias-*)` 配色，`font-family: inherit`，`styles.insert` + 唯一前缀类名。
- Host→Client 无推送：轮询 + `host.call`，处理器用 take-and-clear 语义。
- 单一配置位置，避免双 UI 状态不同步。
- update 先停旧 Run；失败需显式回滚 current。
