/**
 * 图片 CORS 支持探测：为 `<img>` 决定要不要带 `crossorigin="anonymous"`。
 *
 * 背景：跨域 `<img>` 默认发 no-cors 请求，响应是 opaque —— 读不到内容，也不能被 `svgInliner`
 * 的 cors fetch 或 Service Worker 复用（两种模式的缓存条目不通用），同一个图标会被下载两次。
 * 带上 `crossorigin="anonymous"` 后一次 CORS 抓取就能喂所有消费方；但前提是对端返回
 * `Access-Control-Allow-Origin`，对端不支持时该属性会让图片**直接加载失败**。
 *
 * 因此这里按 **hostname** 探测并缓存结论：已知支持的 host 同步命中（`knownVerdictFor`），
 * 未知的探测一次后供同页面/同会话后续图片使用；也可以把真实请求的结果用 `recordVerdict`
 * 喂回来（`svgInliner` 的 cors fetch 成功即证明该 host 支持 CORS），免掉探测请求。
 *
 * 成本：每个未知 hostname 最多一次 `HEAD`（结果缓存到模块级 Map；探测失败/超时按不支持处理）。
 * 同源图片不探测也不加属性：`crossorigin` 对同源请求没有作用（请求模式本就相同，缓存条目也通用）。
 *
 * 用法：
 * - 拼 HTML 字符串（含模板 `${}`）用同步的 `corsImgAttribute(url)`：已知 host 立刻带属性，
 *   未知 host 先按安全旧行为不带、并在后台探测一次，之后渲染的同 host 图片就能同步带上。
 * - 已经拿到的 DOM（toast / 插件注册表推来的 HTML）用 `corsifyHtml` / `corsifyImages` 在**插入前**补属性。
 * - 能等的异步路径用 `resolveCorsImgAttribute` / `resolveCorsImgTag`。
 *
 * @module corsImage
 */

import { escapeHtml } from './escapeHtml.mjs'

/** 已知允许 CORS 的图标 host：同步命中，页面上的第一个图标不必等异步探测。 */
export const KNOWN_CORS_HOSTS = ['api.iconify.design']

/** 探测上限（毫秒）：探测只是顺手确认，不能拖住图片。 */
export const CORS_PROBE_TIMEOUT_MS = 8000

/**
 * 取 URL 的 hostname。
 * @param {string} url - 绝对或相对 URL
 * @returns {string | null} hostname；无法解析时返回 null
 */
function hostnameOf(url) {
	try {
		return new URL(url, globalThis.location?.href ?? 'http://localhost/').hostname
	}
	catch {
		return null
	}
}

/**
 * 构造一个按 hostname 缓存的 CORS 支持探测器。
 * @param {object} [options] - 注入点。
 * @param {typeof fetch} [options.fetchImpl] - fetch 实现（测试可注入）。
 * @param {string[]} [options.knownHosts] - 直接认定支持 CORS 的 host。
 * @param {number} [options.timeoutMs] - 单次探测上限。
 * @param {string} [options.origin] - 页面源（同源图片直接判定为无需属性）。
 * @returns {object} 探测器：`verdictFor` / `knownVerdictFor` / `supportsCorsSync` / `recordVerdict` / `clear`。
 */
export function createCorsSupportProbe({
	fetchImpl = globalThis.fetch,
	knownHosts = KNOWN_CORS_HOSTS,
	timeoutMs = CORS_PROBE_TIMEOUT_MS,
	origin = globalThis.location?.origin,
} = {}) {
	/** @type {Map<string, boolean>} */
	const verdicts = new Map(knownHosts.map(host => [host, true]))
	/** @type {Map<string, Promise<boolean>>} */
	const pending = new Map()

	/**
	 * 真正发一次探测请求：CORS 模式下能读到响应即支持，被拒/超时都算不支持。
	 * @param {string} url - 该 host 上的任一 URL
	 * @returns {Promise<boolean>} 是否支持 CORS
	 */
	async function probe(url) {
		try {
			const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined
			const response = await fetchImpl(url, { method: 'HEAD', mode: 'cors', credentials: 'omit', cache: 'no-store', signal })
			return response.ok
		}
		catch {
			return false
		}
	}

	/**
	 * 记录某个 URL 所属 host 的结论（真实请求的结果可以喂回来，省掉探测）。
	 * @param {string} url - 任意 URL
	 * @param {boolean} supported - 该 host 是否支持 CORS
	 * @returns {void} 无返回值
	 */
	function recordVerdict(url, supported) {
		const hostname = hostnameOf(url)
		if (hostname) verdicts.set(hostname, !!supported)
	}

	/**
	 * 同步取已知结论。
	 * @param {string} url - 任意 URL
	 * @returns {boolean | undefined} 已知是否支持；未知返回 undefined
	 */
	function knownVerdictFor(url) {
		const hostname = hostnameOf(url)
		return hostname ? verdicts.get(hostname) : undefined
	}

	/**
	 * 取该 URL host 的结论：已知直接返回，未知则探测一次并缓存（并发调用共用同一次探测）。
	 * @param {string} url - 任意 URL
	 * @returns {Promise<boolean>} 是否支持 CORS
	 */
	async function verdictFor(url) {
		const hostname = hostnameOf(url)
		if (!hostname) return false
		const known = verdicts.get(hostname)
		if (known !== undefined) return known
		let inFlight = pending.get(hostname)
		if (!inFlight) {
			inFlight = probe(url).then(supported => {
				verdicts.set(hostname, supported)
				pending.delete(hostname)
				return supported
			})
			pending.set(hostname, inFlight)
		}
		return await inFlight
	}

	/**
	 * 判断某个 URL 是否同源；同源图片不需要（也受益不了于）`crossorigin`。
	 * @param {string} url - 任意 URL
	 * @returns {boolean} 是否同源
	 */
	function isSameOrigin(url) {
		if (!origin) return false
		try {
			return new URL(url, globalThis.location?.href ?? 'http://localhost/').origin === origin
		}
		catch {
			return false
		}
	}

	/**
	 * 同步判定该 URL 的 host 是否支持 CORS；未知 host 顺手发起一次后台探测（不阻塞本次渲染）。
	 * @param {string} url - 任意 URL
	 * @returns {boolean} 是否支持（同源与未知都返回 false，即「不加属性」的安全旧行为）
	 */
	function supportsCorsSync(url) {
		if (isSameOrigin(url)) return false
		const hostname = hostnameOf(url)
		if (!hostname) return false
		const known = verdicts.get(hostname)
		if (known !== undefined) return known
		void verdictFor(url)
		return false
	}

	/**
	 * 清空缓存（测试与「换网络后重探」用）。
	 * @returns {void} 无返回值
	 */
	function clear() {
		verdicts.clear()
		pending.clear()
		for (const host of knownHosts) verdicts.set(host, true)
	}

	return { verdictFor, knownVerdictFor, supportsCorsSync, recordVerdict, clear }
}

/** 页面默认使用的探测器（模块级缓存，页面生命周期内有效）。 */
export const corsSupportProbe = createCorsSupportProbe()

/**
 * 同步取 `crossorigin` 属性：已知支持才给，未知/不支持/同源返回空串。
 * 未知 host 会在后台探测一次，供后续图片同步命中；需要「本次就等出结论」时用 `resolveCorsImgAttribute`。
 * @param {string} url - 图片 URL
 * @returns {string} 属性文本（含前导空格）或空串
 */
export function corsImgAttribute(url) {
	return corsSupportProbe.supportsCorsSync(url) ? ' crossorigin="anonymous"' : ''
}

/**
 * 等待探测结论后取 `crossorigin` 属性。
 * @param {string} url - 图片 URL
 * @returns {Promise<string>} 属性文本（含前导空格）或空串
 */
export async function resolveCorsImgAttribute(url) {
	return await corsSupportProbe.verdictFor(url) ? ' crossorigin="anonymous"' : ''
}

/**
 * 记录真实请求得到的 CORS 结论（成功/失败即证明），供后续图片同步复用。
 * @param {string} url - 请求过的 URL
 * @param {boolean} supported - 该请求是否以 CORS 模式成功
 * @returns {void} 无返回值
 */
export function recordCorsVerdict(url, supported) {
	corsSupportProbe.recordVerdict(url, supported)
}

/**
 * 生成 `<img>` 标签：已知 host 支持 CORS 时带 `crossorigin="anonymous"`。
 * 结论未知时先不带（安全的旧行为），并用一次后台探测把结论缓存给后续图片。
 * @param {string} url - 图片 URL
 * @param {object} [options] - 选项。
 * @param {string} [options.attributes=''] - 追加的属性文本（自行负责转义）
 * @param {number} [options.width] - 宽度
 * @param {number} [options.height] - 高度
 * @param {string} [options.alt=''] - alt 文本
 * @returns {string} `<img …>` 标签
 */
export function corsImgTag(url, { attributes = '', width, height, alt = '' } = {}) {
	const size = (width ? ` width="${width}"` : '') + (height ? ` height="${height}"` : '')
	return `<img${corsImgAttribute(url)} src="${escapeHtml(url)}"${size} alt="${escapeHtml(alt)}"${attributes ? ` ${attributes}` : ''} />`
}

/**
 * 生成 `<img>` 标签，等待 host 探测结论（首个未知 host 会多等一次探测）。
 * @param {string} url - 图片 URL
 * @param {object} [options] - 同 `corsImgTag`。
 * @returns {Promise<string>} `<img …>` 标签
 */
export async function resolveCorsImgTag(url, options = {}) {
	const attribute = await resolveCorsImgAttribute(url)
	const { attributes = '', width, height, alt = '' } = options
	const size = (width ? ` width="${width}"` : '') + (height ? ` height="${height}"` : '')
	return `<img${attribute} src="${escapeHtml(url)}"${size} alt="${escapeHtml(alt)}"${attributes ? ` ${attributes}` : ''} />`
}

/**
 * 给一个已存在的 `<img>` 按 host 支持情况设置/清除 `crossorigin`（必须在赋 `src` 之前调用）。
 * 不支持或未知的 host 会清掉属性，避免复用的元素带着上一张图的属性把图片加载搞失败。
 * @param {HTMLImageElement} image - 目标图片元素
 * @param {string} url - 即将加载的图片 URL
 * @param {object} [probe] - 探测器（默认页面共享实例，测试可注入）
 * @returns {HTMLImageElement} 传入的 image
 */
export function applyCorsAttribute(image, url, probe = corsSupportProbe) {
	if (probe.supportsCorsSync(url)) image.crossOrigin = 'anonymous'
	else image.removeAttribute('crossorigin')
	return image
}

/**
 * 给一段已解析 DOM 里的图片补 `crossorigin`（插入文档前调用，否则图片已按 no-cors 发出）。
 * 只给支持 CORS 的 host 加属性，其余保持原样；未知 host 会在后台探测一次供后续复用。
 * @param {ParentNode} root - 待处理的 DOM（元素 / DocumentFragment / Document）
 * @param {object} [probe] - 探测器（默认页面共享实例，测试可注入）
 * @returns {ParentNode} 传入的 root（便于链式调用）
 */
export function corsifyImages(root, probe = corsSupportProbe) {
	for (const image of root.querySelectorAll('img'))
		if (!image.crossOrigin) applyCorsAttribute(image, image.getAttribute('src') || '', probe)
	return root
}

/** 匹配一个 `<img …>` 起始标签（标签内不会出现 `>`）。 */
const HTML_IMG_TAG_REG = /<img\b[^>]*>/gi

/** 从标签里取 `src` 属性值（双引号或单引号；未加引号的写法不处理）。 */
const TAG_SRC_REG = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)')/i

/**
 * 给一段 HTML 字符串里的图片补 `crossorigin`（在写入 `innerHTML` 前调用）。
 * 纯字符串处理，不解析 DOM：既不依赖 `document`（Service Worker 里也能用），也不会重排标记。
 * @param {string} html - HTML 字符串
 * @param {object} [probe] - 探测器（默认页面共享实例，测试可注入）
 * @returns {string} 补好属性的 HTML 字符串
 */
export function corsifyHtml(html, probe = corsSupportProbe) {
	if (!html.includes('<img')) return html
	return html.replace(HTML_IMG_TAG_REG, tag => {
		if (/\bcrossorigin\b/i.test(tag)) return tag
		const src = tag.match(TAG_SRC_REG)
		if (!src) return tag
		if (!probe.supportsCorsSync(src[1] ?? src[2] ?? '')) return tag
		return tag.replace(/^<img\b/i, '<img crossorigin="anonymous"')
	})
}
