/**
 * happy-dom + registry stub，供 Deno 侧跑浏览器 Markdown convertor。
 * 须在 import convertor 之前调用。
 */
import { Window } from 'npm:happy-dom@15'

let installed = false

/**
 * 安装最小浏览器全局（幂等）。
 * @returns {void}
 */
export function installMarkdownTestDom() {
	if (installed) return
	installed = true

	const window = new Window({ url: 'http://localhost/' })
	// KaTeX：happy-dom 的 document.compatMode 为 undefined，会被当成 quirks 刷 Warning
	// https://github.com/capricorn86/happy-dom/issues/2267 — 上游补齐后可删此 shim
	Object.defineProperty(window.document, 'compatMode', {
		configurable: true,
		/** @returns {string} 标准模式，避免 KaTeX 将 happy-dom 误判为 quirks */
		get: () => 'CSS1Compat',
	})
	Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true })
	Object.defineProperty(window, 'innerHeight', { value: 0, configurable: true })

	globalThis.window = window
	globalThis.document = window.document
	globalThis.HTMLElement = window.HTMLElement
	globalThis.HTMLScriptElement = window.HTMLScriptElement
	globalThis.Element = window.Element
	globalThis.Node = window.Node
	globalThis.DocumentFragment = window.DocumentFragment
	globalThis.ShadowRoot = window.ShadowRoot
	globalThis.DOMParser = window.DOMParser
	globalThis.XMLSerializer = window.XMLSerializer
	globalThis.MutationObserver = window.MutationObserver
	globalThis.CSSStyleSheet = window.CSSStyleSheet
	globalThis.CSSStyleRule = window.CSSStyleRule
	globalThis.navigator = window.navigator
	globalThis.getComputedStyle = window.getComputedStyle.bind(window)
	/**
	 * happy-dom 下用 setTimeout 模拟 requestAnimationFrame。
	 * @param {() => void} cb - 下一帧执行的回调。
	 * @returns {number} setTimeout 返回的定时器 handle。
	 */
	globalThis.requestAnimationFrame = cb => setTimeout(cb, 0)
	globalThis.localStorage = window.localStorage
	globalThis.sessionStorage = window.sessionStorage
	globalThis.SVGElement = window.SVGElement
	globalThis.HTMLDivElement = window.HTMLDivElement
	globalThis.Image = window.Image

	// mermaid 渲染 HTML 标签节点时用 SVG getBBox 测量；happy-dom 未实现（返回 0 / 抛错）
	// https://github.com/capricorn86/happy-dom/issues/2145 — 上游补齐后可删此 shim
	Object.defineProperty(window.SVGElement.prototype, 'getBBox', {
		configurable: true,
		/**
		 * 返回零尺寸包围盒，满足 mermaid 测量 HTML 标签节点。
		 * @returns {{ x: number, y: number, width: number, height: number }} 全零包围盒
		 */
		value() {
			return { x: 0, y: 0, width: 0, height: 0 }
		},
	})

	const realFetch = globalThis.fetch.bind(globalThis)
	/**
	 * 测试环境 fetch：对 registry API 返回空数组，其余透传真实 fetch。
	 * @param {RequestInfo | URL} input - 请求 URL 或 Request 对象。
	 * @param {RequestInit} [init] - 可选的 fetch 初始化参数。
	 * @returns {Promise<Response>} registry 桩响应或真实网络响应。
	 */
	globalThis.fetch = async (input, init) => {
		const href = String(input?.url ?? input)
		if (href.includes('/api/registries/'))
			return new Response('[]', { headers: { 'content-type': 'application/json' } })
		return realFetch(input, init)
	}
}
