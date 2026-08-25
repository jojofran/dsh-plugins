---
name: dsh-plugin-static-client-ui
description: 给 DSH 静态插件接入浏览器 UI（Client 半部）并做免构建 Client→Host RPC 的经验蒸馏。选自 provider-usage 弹窗完整实现（v1.1.0）：静态 bundle 格式、Typert SRC 标记服务、strict codec 坑、生命周期与验证清单。开发带 UI 的 DSH 插件或复现"重启自动加载的弹窗/面板"时加载。
metadata:
  version: "1.0.0"
  source: https://github.com/jojofran/dsh-plugins
---

# DSH 插件静态 Client 半部开发经验（蒸馏）

> 来源：`provider-usage` 插件两次完整实现（动态伴生插件 → 静态 Client 半部 v1.1.0）。
> 目标：把"给静态包加浏览器 UI + 免生成 RPC"这件事从踩坑记录变成可复用方法论。

---

## 1. 先决策：UI 放哪个平面（本节结论来自实测）

| 方案 | 重启后 | 成本/风险 | 结论 |
|---|---|---|---|
| 动态插件（cordis_define/run） | ❌ 进程局部，需重建 + 每次重新批准 | 零构建、零 profile 改动 | 只适合临时预览 |
| **静态包 Client 半部**（`exports["./client"]` + `dsh.client`） | ✅ 随 DSH 自动加载 | **免重建 web**（见 §2/§3），一次重启生效 | **唯一正路** |
| 改 web shell / 依赖 typert 生成器跑 workspace 构建 | ✅ | 重建 web 产物、停机窗口、破坏面大 | 避坑：**不需要** |

关键事实（决定上面结论的底层机制）：
- 插件包**不进 web shell 构建图**——web plugin table（`dsh-client-modules`）在运行时按
  `exports["./client"]` 从磁盘读文件、以 classic script 服务 `/plugins/<id>/client.js`；
- 客户端网关 `resolveDescriptor` 对无严格定义的端点**回退 SRC 标记运行时解析**
  （`packages/api/gateway/src/index.ts`），所以 Host 侧**不需要生成描述符**。

---

## 2. Client 半部声明与 bundle 格式（照抄即可）

### package.json

```jsonc
"exports": {
  ".": "./src/index.js",
  "./client": "./src/client.js",        // ← web plugin table 服务的入口
  "./src/*": "./src/*",
  "./package.json": "./package.json"
},
"dsh": {
  "client": {
    "inject": ["@deepseek-ai/dsh-client-runtime", "@deepseek-ai/dsh-api-remotes"],
    "platform": "web"
  }
}
```

- `dsh.client.inject`：声明依赖的客户端包（图排序用），平台必须是 `web`；
- `capabilities` 加 `"ui"`。

### src/client.js —— 手写模块系统 bundle

格式与 tsdown 产物完全同构（`lib/client.js` 头部），可**手写、无需构建**：

```js
window.__ModuleLoader__.load({
  id: "@scope/your-plugin",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");              // 模块系统解析，产品 bundle 同样 require('react')
    const inject = ["slots", "remote"];        // ← cordis 服务名数组（不是包名！）
    function apply(ctx) { /* 注册 UI：ctx.get('slots').inject/register */ }
    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
```

要点：
- **符号来源**：React 用 `require("react")` 拿；其余一律走 ctx 服务（`slots`/`remote`/`theme`/…）；
  不要用动态插件的自由符号（`styles.insert`/`host.call` 只存在于动态 Client 沙箱）；
- 样式用内联 style 对象，颜色走 `var(--dsw-alias-*)` token（图标用 stroke=currentColor 的
  线条 SVG），不引入 CSS/构建；
- UI 注册照常：`slots.inject('sidebar.footer.action'|'shell.overlay'|…)` + `slots.register`。

---

## 3. 免生成 RPC：SRC 标记服务 + 手写 Typert 贡献

### Host 侧：SRC 标记服务（真实进程里可 import）

```js
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol'

export class YourHost extends TypertRemoteService {
  static inject = []
  constructor(ctx, cfg) { super(ctx, 'yourService') }   // ← 服务键即网关命名空间
  async overview() { /* 复用与工具同一份查询逻辑 */ }
}
// 手动应用 @Remote('overview')（Node 不支持装饰器语法）
const deco = Remote('overview')
let init = null
deco(YourHost.prototype.overview, { kind: 'method', name: 'overview', private: false,
  static: false, metadata: undefined,
  access: { get: () => YourHost.prototype.overview },
  addInitializer(fn) { init = fn } })
if (init) init.call(Object.create(YourHost.prototype))
// apply() 里执行 new YourHost(ctx, cfg) 即注册进 ctx.reflect.props（网关靠它扫描）
```

### Client 侧：手写贡献 → `$mount` → 调用

```js
const ns = ctx.get('remote')
await ns.$mount({
  package: "@scope/your-plugin",
  descriptors: [{
    id: "yourService.overview",
    service: "yourService",
    namespace: "yourService",                 // 端点 = namespace/method
    method: "overview",
    invocation: { kind: "direct" },
    parameters: [],
    result: {                                 // ★ strict codec（见坑 1）
      mode: "strict",
      typeSymbol: "your-plugin/JsonValue",
      schema: { parse: (value) => value },    // 透传 = src-json 语义
    },
  }],
})
const svc = ctx.get("remote.yourService")     // 命名空间服务键 = remote.<namespace>
const res = await svc.overview()
```

---

## 4. 生命周期与部署事实（本次实测）

- **生效时机**：静态 Client 半部在 **DSH 重启**时由 web plugin table 装配；改 client 源码后
  重启 + **浏览器强刷（Ctrl+Shift+R）**；
- **profile 拷贝是硬链接/拷贝**：改插件源码后必须 `cp` 到
  `~/.dsh/profiles/web/node_modules/<scope>/<pkg>/` 或重跑 `pnpm install`，运行拷贝才会更新
  （edit 工具改写文件会**断开目录硬链接**，尤其注意）；
- **验证分层**：
  1. 离线：`node --test`；bundle 用假 `window.__ModuleLoader__` + `require` 桩执行 factory
     （验证注册 id / exports.apply / inject）；
  2. 离线 E2E：cordis Context + 假 tools 服务 + 真 typert-protocol，验证服务挂载、
     `typertRemote` 绑定 namespace、`remoteMethods()` 标记、真实业务调用；
  3. 重启实测：按钮出现 → 弹窗 → 刷新拿实时数据（浏览器环节必须实测收尾）；
- **回滚**：删 `dsh.client`/`exports["./client"]`（或删 patch 行）→ 重启，回到纯工具形态；
  工具行不受影响。

---

## 5. 踩坑清单（每条都是本次真实报错）

| # | 现象 | 根因 | 解法 |
|---|---|---|---|
| 1 | `client api: … field "result" has no strict codec` | Client 侧 codec 只认 **strict**（带 `schema.parse`）；`src-json` 只是 Host SRC 侧约定 | result 用 `{mode:'strict', typeSymbol, schema:{parse:v=>v}}` 透传 |
| 2 | `ctx.tools.register('x', defineTool(...))` 注册出无名工具 | 真实 `Tools.register(definition)` 是**单参数**（工具名在 defineTool options 里） | `ctx.tools.register(defineTool({name:'x',…}))` |
| 3 | 动态 Host 沙箱发不了带头的请求 | 动态沙箱无 fetch；`ctx.web.fetch` 只支持裸 GET（无自定义头） | 静态包宿主里用全局 fetch；动态侧只能 subprocess+curl（不推荐用于正式 UI） |
| 4 | 动态插件重启即失，且**每次重建都要重新 UI 批准** | 动态注册表进程局部、会话归属、grant 不跨重启 | 长期 UI 一律走静态 Client 半部 |
| 5 | Client 更新后按钮不出现 | 页面没拿到新注册/新 bundle | 强刷；改 client 后重启 |
| 6 | `exports["./client"]` 指向缺失文件会**拖垮 profile 启动** | client-modules 组合失败会聚合抛错 | 声明的文件必须先存在且语法正确；改动前保留回滚手段 |

---

## 6. 检查清单（交付前逐项过）

- [ ] `dsh.client`（platform web）与 `exports["./client"]` 指向真实存在的文件
- [ ] bundle 冒烟：假 `__ModuleLoader__` + 假 require 执行无异常，`exports.apply/inject` 就位
- [ ] Host 服务：`TypertRemoteService` 挂载、`typertRemote.namespace` 与 client namespace 一致、
      `remoteMethods()` 含目标方法
- [ ] client codec 全部 strict（含 result 透传 schema）
- [ ] 插件 `npm test` 全绿；profile 拷贝已同步（cp / pnpm install）
- [ ] 文档（README 安装/回滚/验证）+ CHANGELOG + 仓库 AGENTS.md 技能索引同步
- [ ] 重启后强刷实测：按钮可见、弹窗可查、失败项结构化显示