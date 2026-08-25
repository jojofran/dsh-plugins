// @user/dsh-plugin-provider-usage — 静态 Client 半部（手写模块系统 bundle）
//
// 以浏览器 classic script 被 web plugin table 原样服务（/plugins/<id>/client.js），
// 格式对齐 tsdown 产物的 window.__ModuleLoader__.load({ id, factory(require) }):
//  - react 由模块系统 require 解析（产品 client bundle 同样 require('react')）
//  - 其余全部走 ctx 服务：slots（注册 UI）、remote（调用 Host）
// RPC：手写 Typert 贡献（strict 透传 codec，免生成）→ remote.providerUsage.overview()
//      → 网关 SRC 运行时解析 → Host 的 ProviderUsageHost 服务（与工具同口径）
// 样式：内联 style 对象（不依赖 styles.insert）。

window.__ModuleLoader__.load({
	id: "@user/dsh-plugin-provider-usage",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		const inject = ["slots", "remote"]

		// 手写 Typert 贡献：端点 providerUsage/overview。
		// Client 侧要求 strict codec（src-json 仅是 Host SRC 侧约定）；用带透传
		// schema.parse 的 strict codec 实现同样的 JSON 直通语义。
		const contribution = {
			package: "@user/dsh-plugin-provider-usage",
			descriptors: [{
				id: "providerUsage.overview",
				service: "providerUsage",
				namespace: "providerUsage",
				method: "overview",
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "provider-usage/JsonValue",
					schema: { parse: (value) => value },
				},
			}],
		}

		function apply(ctx) {
			const h = react.createElement
			let open = false
			let last = null
			let loading = false
			let mounted = null
			const listeners = new Set()
			const notify = () => { for (const fn of listeners) fn() }
			const subscribe = (fn) => { listeners.add(fn); return () => { listeners.delete(fn) } }
			const setOpen = (value) => { open = value; notify() }

			const ensureMounted = () => {
				if (mounted !== null) return mounted
				const remote = ctx.get("remote")
				if (remote === undefined) return Promise.reject(new Error("remote 服务不可用"))
				mounted = remote.$mount(contribution).catch((err) => { mounted = null; throw err })
				return mounted
			}

			const load = () => {
				loading = true; notify()
				ensureMounted()
					.then(() => {
						const ns = ctx.get("remote.providerUsage")
						if (ns === undefined) throw new Error("remote.providerUsage 未挂载")
						return ns.overview()
					})
					.then((res) => {
						const data = (res && typeof res === "object" && "ok" in res && "value" in res) ? res.value : res
						last = (data && typeof data === "object")
							? data
							: { success: false, error: { code: "BAD_RPC", message: "异常返回" } }
						loading = false; notify()
					})
					.catch((err) => {
						last = {
							success: false,
							error: { code: "RPC_FAILED", message: String(err && err.message ? err.message : err) },
						}
						loading = false; notify()
					})
			}

			const S = {
				button: { display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6, height: 32, padding: "0 12px", border: "none", borderRadius: 8, background: "transparent", color: "var(--dsw-alias-label-primary)", font: "inherit", fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" },
				mask: { position: "fixed", inset: 0, zIndex: 200, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "9vh 20px 20px", background: "rgba(10,10,12,0.42)" },
				panel: { width: "min(560px,92vw)", maxHeight: "70vh", display: "flex", flexDirection: "column", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 14, background: "var(--dsw-alias-bg-layer-3)", boxShadow: "0 12px 40px rgba(0,0,0,.28)", overflow: "hidden" },
				head: { display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--dsw-alias-border-l2)" },
				title: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" },
				close: { width: 26, height: 26, border: "none", borderRadius: 6, background: "transparent", color: "var(--dsw-alias-label-secondary)", fontSize: 13, cursor: "pointer" },
				toolbar: { display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", borderBottom: "1px solid var(--dsw-alias-border-l2)" },
				btn: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 7, background: "var(--dsw-alias-bg-layer-2)", color: "var(--dsw-alias-label-primary)", font: "inherit", fontSize: 12, lineHeight: "20px", padding: "1px 10px", cursor: "pointer" },
				body: { overflow: "auto", padding: "10px 16px 16px", display: "flex", flexDirection: "column", gap: 8 },
				row: { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: 10, background: "var(--dsw-alias-bg-layer-2)", padding: "9px 12px" },
				rowhead: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, color: "var(--dsw-alias-label-primary)" },
				badge: { flex: "none", borderRadius: 999, padding: "0 8px", fontSize: 11, lineHeight: "18px", fontWeight: 500, background: "var(--dsw-alias-bg-module-platform)", color: "var(--dsw-alias-label-secondary)" },
				pre: { margin: "8px 0 0", fontSize: 11, lineHeight: 1.55, color: "var(--dsw-alias-label-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all", overflow: "hidden" },
				err: { margin: "8px 0 0", fontSize: 12, lineHeight: 1.5, color: "var(--dsw-alias-state-warning-primary,var(--dsw-alias-label-secondary))" },
				load: { fontSize: 12, color: "var(--dsw-alias-label-tertiary)", lineHeight: 1.6 },
				time: { fontSize: 11, color: "var(--dsw-alias-label-tertiary)" },
				ic: { fontSize: 14, lineHeight: 1 },
			}

			const fmt = (v) => JSON.stringify(v, null, 1)

			const Row = (result) => {
				if (!result) return null
				return h("div", { style: S.row },
					h("div", { style: S.rowhead },
						h("span", { style: S.badge }, result.success ? "OK" : "—"),
						h("span", null, result.provider + (result.success ? "" : " · " + ((result.error && result.error.code) || ""))),
					),
					result.success
						? h("pre", { style: S.pre }, fmt(result.data))
						: h("div", { style: S.err }, (result.error && result.error.message) || String(result.error || "未知错误")),
				)
			}

			const Panel = () => {
				const [tick, setTick] = react.useState(0)
				react.useEffect(() => subscribe(() => setTick((t) => t + 1)), [])
				if (!open) return null
				const rows = (last && Array.isArray(last.providers)) ? last.providers : null
				return h("div", { style: S.mask, onClick: () => setOpen(false) },
					h("div", { style: S.panel, onClick: (e) => e.stopPropagation() },
						h("div", { style: S.head },
							h("span", { style: S.title }, "模型供应商用量"),
							h("span", { style: S.time }, (last && last.queriedAt) ? "更新于 " + new Date(last.queriedAt).toLocaleTimeString() : ""),
							h("button", { type: "button", style: S.close, onClick: () => setOpen(false), "aria-label": "关闭" }, "✕"),
						),
						h("div", { style: S.toolbar },
							h("button", { type: "button", style: S.btn, disabled: loading, onClick: load }, loading ? "查询中…" : "刷新"),
						),
						h("div", { style: S.body },
							loading && !rows ? h("div", { style: S.load }, "正在查询各供应商用量…") : null,
							rows ? rows.map((r) => h(Row, { key: r.provider, result: r })) : null,
							(!loading && !rows && last && last.error) ? h("div", { style: S.err }, last.error.code + ": " + last.error.message) : null,
						),
					),
				)
			}

			const slots = ctx.get("slots")
			if (slots === undefined) return

			slots.inject("sidebar.footer.action", () => slots.register(
				{ name: "sidebar.footer.action", id: "provider-usage-open", order: 10, label: "用量" },
				(props) => {
					const [tick, setTick] = react.useState(0)
					react.useEffect(() => subscribe(() => setTick((t) => t + 1)), [])
					const wide = props && props.wide === true
					return h("button", {
						type: "button", style: S.button, title: "模型供应商用量", "aria-label": "模型供应商用量",
						onClick: () => setOpen(!open),
					},
						h("span", { style: S.ic, "aria-hidden": true }, "▥"),
						wide ? h("span", null, "用量") : null)
				},
			))

			slots.inject("shell.overlay", () => slots.register(
				{ name: "shell.overlay", id: "provider-usage-popup", order: 10, label: "供应商用量" },
				() => h(Panel, {}),
			))
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});