import { createDocumentFragmentFromHtmlString } from './template.mjs'

const IconCache = {}

// currentColor在img的从url导入的svg中不起作用，此函数旨在解决这个问题
export async function svgInliner(DOM) {
	const svgs = DOM.querySelectorAll('img[src$=".svg"]')
	await Promise.all([...svgs].map(async (svg) => {
		const url = svg.getAttribute('src')
		IconCache[url] ??= fetch(url).then((response) => response.text())
		const data = IconCache[url] = await IconCache[url]
		const newSvg = createDocumentFragmentFromHtmlString(data)
		for (const attr of svg.attributes)
			newSvg.querySelector('svg').setAttribute(attr.name, attr.value)
		svg.replaceWith(newSvg)
	})).catch(console.error)
	return DOM
}
