import { createDocumentFragmentFromHtmlString } from '../features/template.mjs'

import { recordCorsVerdict } from './corsImage.mjs'

const IconCache = {}

/**
 * 提前量：图标在进入视口前这么远就取好，滚动到时不会闪一下。
 */
const INLINE_ROOT_MARGIN = '200px'

/**
 * 每个 Document 一个观察者：只服务「当前不可见」的图标，可见后再真正请求。
 * @type {WeakMap<Document, IntersectionObserver>}
 */
const observers = new WeakMap()

/**
 * @param {string} url SVG URL
 * @returns {Promise<string>} SVG 文本（id 已加 uuid 后缀）
 */
async function loadSvgText(url) {
	// 能读到 CORS 响应就证明该 host 支持 CORS（失败可能是限流/抖动，不当作结论）：
	// 把这条正面结论喂给探测缓存，后续 `<img>` 就能同步带上 crossorigin，省掉一次 HEAD 探测。
	IconCache[url] ??= fetch(url).then(response => {
		recordCorsVerdict(url, true)
		return response.text()
	})
	const data = IconCache[url] = await IconCache[url]
	const uuid = [...crypto.getRandomValues(new Uint8Array(8))].map(byte => byte.toString(16).padStart(2, '0')).join('')
	const ids = [...data.matchAll(/id="([^"]+)"/g)].map(match => match[1])
	const map = new Map(ids.map(id => [id, `${id}-${uuid}`]))
	return data.replace(/(id="|url\(#|href="#|#)([A-Za-z0-9_:.-]+)/g,
		(match, prefix, id) => map.has(id) ? prefix + map.get(id) : match
	)
}

/**
 * 该 img 现在是否值得立刻取图。
 * 已经取过文本的（缓存命中）与脱离文档的（挂上观察者也不会触发，例如 `template.mjs` 里
 * 先内联再挂载的片段）都按「值得」处理，回到原来的立即内联行为。
 * @param {HTMLImageElement} img - 待判断的图片
 * @param {string} url - 图片地址
 * @returns {boolean} 是否立刻内联
 */
function shouldInlineNow(img, url) {
	if (IconCache[url]) return true
	if (!img.isConnected) return true
	// checkVisibility 只管「渲染与否」（display:none / content-visibility），不看视口；
	// 是否在视口内得自己比矩形，否则屏幕外几千像素的图标会照样立刻去取文本。
	if (typeof img.checkVisibility === 'function' && !img.checkVisibility({ checkOpacity: false, checkVisibilityCSS: false })) return false
	const rect = img.getBoundingClientRect()
	const view = img.ownerDocument?.defaultView
	return rect.bottom >= 0 && rect.right >= 0
		&& rect.top <= (view?.innerHeight ?? 0) && rect.left <= (view?.innerWidth ?? 0)
}

/**
 * 取该 DOM 所属窗口的观察者（同一 Document 共用一个）。
 * @param {DocumentFragmentOrElement} DOM - 要处理的 DOM
 * @returns {IntersectionObserver | null} 观察者；窗口不支持时返回 null
 */
function observerFor(DOM) {
	// `DOM` 可能本身就是 Document（`svgInliner(document)`）：它的 ownerDocument 是 null，
	// 直接拿去当 WeakMap 键会抛 "Invalid value used as weak map key"。
	const document = DOM.ownerDocument ?? DOM
	const view = document.defaultView ?? globalThis
	if (typeof view.IntersectionObserver !== 'function') return null
	let observer = observers.get(document)
	if (observer) return observer
	observer = new view.IntersectionObserver(entries => {
		for (const entry of entries) {
			// 观察者持有目标的强引用，而「已从文档移除」的目标不会再有下一次回调：
			// 这两类都必须脱钩，否则长页面反复渲染会把观察者变成一批死元素的寄存处。
			// 只是暂时移到视口外的目标继续留着——移回来时还得靠它取文本。
			if (entry.isIntersecting || !entry.target.isConnected) observer.unobserve(entry.target)
			if (entry.isIntersecting) inlineImage(entry.target).catch(console.error)
		}
	}, { rootMargin: INLINE_ROOT_MARGIN })
	observers.set(document, observer)
	return observer
}

/**
 * 把一张 `<img>` 图标换成内联 `<svg>`。
 * @param {HTMLImageElement} img - 图片元素
 * @returns {Promise<void>} 无返回值
 */
async function inlineImage(img) {
	const url = img.getAttribute('src')
	if (!url) return
	const data = await loadSvgText(url)
	const newSvg = createDocumentFragmentFromHtmlString(data)
	const root = newSvg.querySelector('svg')
	if (!root) return
	for (const attr of img.attributes)
		root.setAttribute(attr.name, attr.value)
	img.replaceWith(newSvg)
}

/**
 * currentColor 在 img 引用的外部 SVG 上无效；将未标记 ignore 的 `.svg` img inline。
 * 用户头像/贴纸等加 `svg-inliner-ignore`，保持 `<img>`；用户可控正文（markdown/reaction）
 * 也由渲染管线标记 `svg-inliner-ignore`（见 markdown convertor / sanitize），内联远程 SVG
 * 会激活其中脚本（存储型 XSS）。
 *
 * 只为**当前可见**的图标发请求：页面一次可能挂上几十个图标，全都立刻 `fetch()` 是白打
 * 对端（图标 CDN 会因此回 429），也会和 `<img>` 自身的加载抢带宽；不可见的挂到
 * `IntersectionObserver` 上，进入视口（含 `INLINE_ROOT_MARGIN` 提前量）时才取。
 * @param {DocumentFragmentOrElement} DOM - 要处理的 DOM。
 * @returns {Promise<DocumentFragmentOrElement>} - 处理后的 DOM（不可见的图标之后才会被替换）。
 */
export async function svgInliner(DOM) {
	const deferred = []
	await Promise.all([...DOM.querySelectorAll('img[src$=".svg"]:not([svg-inliner-ignore])')].map(async img => {
		if (shouldInlineNow(img, img.getAttribute('src'))) return inlineImage(img)
		deferred.push(img)
	})).catch(console.error)

	if (deferred.length) {
		const observer = observerFor(DOM)
		if (observer) for (const img of deferred) observer.observe(img)
		else await Promise.all(deferred.map(img => inlineImage(img))).catch(console.error)
	}
	return DOM
}

/**
 * 获取 SVG 图标。
 * @param {string} url - 图标的 URL。
 * @param {object} [attributes={}] - 要添加到 SVG 元素的属性。
 * @returns {Promise<SVGElement>} - SVG 元素。
 */
export async function getSvgIcon(url, attributes = {}) {
	const data = await loadSvgText(url)
	const newSvg = createDocumentFragmentFromHtmlString(data)
	const root = newSvg.querySelector('svg')
	for (const attr in attributes)
		root.setAttribute(attr, attributes[attr])
	return root
}
