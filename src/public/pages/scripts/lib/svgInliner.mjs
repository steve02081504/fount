import { createDocumentFragmentFromHtmlString } from '../features/template.mjs'

const IconCache = {}

/**
 * @param {string} url SVG URL
 * @returns {Promise<string>} SVG 文本（id 已加 uuid 后缀）
 */
async function loadSvgText(url) {
	IconCache[url] ??= fetch(url).then(response => response.text())
	let data = IconCache[url] = await IconCache[url]
	const uuid = Math.random().toString(36).slice(2)
	for (const match of data.matchAll(/id="([^"]+)"/g))
		data = data.replaceAll(match[1], `${match[1]}-${uuid}`)
	return data
}

/**
 * currentColor 在 img 引用的外部 SVG 上无效；将未标记 ignore 的 `.svg` img inline。
 * 用户头像/贴纸等加 `svg-inliner-ignore`，保持 `<img>`。
 * @param {DocumentFragmentOrElement} DOM - 要处理的 DOM。
 * @returns {Promise<DocumentFragmentOrElement>} - 处理后的 DOM。
 */
export async function svgInliner(DOM) {
	const svgs = DOM.querySelectorAll('img[src$=".svg"]:not([svg-inliner-ignore])')
	await Promise.all([...svgs].map(async img => {
		const url = img.getAttribute('src')
		const data = await loadSvgText(url)
		const newSvg = createDocumentFragmentFromHtmlString(data)
		const root = newSvg.querySelector('svg')
		if (!root) return
		for (const attr of img.attributes)
			root.setAttribute(attr.name, attr.value)
		img.replaceWith(newSvg)
	})).catch(console.error)
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
