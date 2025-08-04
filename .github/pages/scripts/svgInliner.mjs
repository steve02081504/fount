import { createDocumentFragmentFromHtmlString } from './template.mjs'

const IconCache = {}

// currentColor在img的从url导入的svg中不起作用，此函数旨在解决这个问题
export async function svgInliner(DOM) {
	const svgs = DOM.querySelectorAll('img[src$=".svg"]')
	await Promise.all([...svgs].map(async (svg) => {
		const url = svg.getAttribute('src')
		IconCache[url] ??= fetch(url).then((response) => response.text())
		let data = IconCache[url] = await IconCache[url]
		// 对于每个id="xx"的match，在id后追加uuid
		const uuid = Math.random().toString(36).slice(2)
		const matches = data.matchAll(/id="([^"]+)"/g)
		for (const match of matches) data = data.replaceAll(match[1], `${match[1]}-${uuid}`)
		const newSvg = createDocumentFragmentFromHtmlString(data)
		for (const attr of svg.attributes)
			newSvg.querySelector('svg').setAttribute(attr.name, attr.value)
		svg.replaceWith(newSvg)
	})).catch(console.error)
	return DOM
}
