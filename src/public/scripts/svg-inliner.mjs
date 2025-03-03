const IconCache = {}
const parser = new DOMParser()

// currentColor在img的从url导入的svg中不起作用，此函数旨在解决这个问题
export async function svgInliner(DOM) {
	const svgs = DOM.querySelectorAll('img[src$=".svg"]')
	await Promise.all([...svgs].map(async (svg) => {
		const url = svg.getAttribute('src')
		const data = IconCache[url] ??= await fetch(url).then((response) => response.text())
		const newsvg = parser.parseFromString(data, 'image/svg+xml').documentElement
		for (const attribute of svg.attributes) newsvg.setAttribute(attribute.name, attribute.value)
		svg.replaceWith(newsvg)
	})).catch(console.error)
	return DOM
}
