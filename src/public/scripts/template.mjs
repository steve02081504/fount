import { geti18n, i18nElement } from './i18n.mjs'
import { svgInliner } from './svg-inliner.mjs'
geti18n

const template_cache = {}

/**
 * 从 HTML 字符串安全地创建 DOM 元素（包括执行 <script> 标签和使得 <link> 标签生效），返回 DocumentFragment。
 *
 * @param {string} htmlString 包含 HTML 代码的字符串。
 * @returns {DocumentFragment} 渲染好的 DocumentFragment。
 */
export function createDocumentFragmentFromHtmlString(htmlString) {
	if (!htmlString || !htmlString.trim()) return document.createDocumentFragment()

	const template = document.createElement('template')
	template.innerHTML = htmlString
	const fragment = template.content

	fragment.querySelectorAll('script').forEach(oldScript => {
		const newScript = document.createElement('script')
		for (const attr of oldScript.attributes)
			newScript.setAttribute(attr.name, attr.value)
		if (oldScript.textContent) newScript.text = oldScript.textContent
		oldScript.parentNode.replaceChild(newScript, oldScript)
	})
	fragment.querySelectorAll('link').forEach(oldLink => {
		const newLink = document.createElement('link')
		for (const attr of oldLink.attributes)
			newLink.setAttribute(attr.name, attr.value)
		oldLink.parentNode.replaceChild(newLink, oldLink)
	})

	return fragment
}

export function createDOMFromHtmlString(htmlString) {
	const div = document.createElement('div')
	div.appendChild(createDocumentFragmentFromHtmlString(htmlString))
	return div.children.length == 1 ? div.children[0] : div
}

export async function renderTemplate(template, data) {
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
				const eval_result = await eval(data_unpacker + '(async ()=>(' + expression + '))()')
				result += eval_result
				html = html.slice(end_index)
				break find
			} catch (error) { }
		}
	}
	result += html
	return i18nElement(await svgInliner(createDOMFromHtmlString(result)))
}

export async function renderTemplateAsHtmlString(template, data) {
	const html = await renderTemplate(template, data)
	return html.outerHTML
}
