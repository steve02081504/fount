import { geti18n, i18nElement } from './i18n.mjs'
import { svgInliner } from './svg-inliner.mjs'
geti18n

const template_cache = {}

export async function renderTemplateAsHtmlString(template, data) {
	template_cache[template] ??= fetch('/template/' + template + '.html').then(response => response.text())
	let html = template_cache[template] = await template_cache[template]

	const data_unpacker = `let { ${Object.keys(data).join(', ')} } = data;`
	// 使用循环匹配所有 ${...} 表达式
	let result = ''
	while (html.indexOf('${') != -1) {
		const length = html.indexOf('${')
		result += html.slice(0, length)
		html = html.slice(length + 2)
		let end_index = 0
		find: while (html.indexOf('}', end_index) != -1) { // 我们需要遍历所有的结束符直到表达式跑通
			end_index = html.indexOf('}', end_index) + 1
			const expression = html.slice(0, end_index - 1)
			try {
				const eval_result = eval(data_unpacker + expression)
				result += eval_result
				html = html.slice(end_index)
				break find
			} catch (error) { }
		}
	}

	return result + html
}

export async function renderTemplate(template, data) {
	const div = document.createElement('div')
	div.innerHTML = await renderTemplateAsHtmlString(template, data)

	return i18nElement(svgInliner(div.firstChild))
}
