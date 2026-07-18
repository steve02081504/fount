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
	Object.defineProperty(window, 'innerWidth', { value: 0, configurable: true })
	Object.defineProperty(window, 'innerHeight', { value: 0, configurable: true })

	globalThis.window = window
	globalThis.document = window.document
	globalThis.HTMLElement = window.HTMLElement
	globalThis.HTMLScriptElement = window.HTMLScriptElement
	globalThis.Element = window.Element
	globalThis.Node = window.Node
	globalThis.DocumentFragment = window.DocumentFragment
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
