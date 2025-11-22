import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { base_dir } from '../base.mjs'

import { geti18n, i18nElement } from './i18n.mjs'
import { svgInliner } from './svgInliner.mjs'

const template_cache = {}

/**
 * 从 HTML 字符串安全地创建 DOM 元素（包括执行 <script> 标签和使得 <link> 标签生效），返回 DocumentFragment。
 *
 * @param {string} htmlString - 包含 HTML 代码的字符串。
 * @returns {DocumentFragment} - 渲染好的 DocumentFragment。
 */
export function createDocumentFragmentFromHtmlString(htmlString) {
	if (!htmlString || !htmlString.trim()) return document.createDocumentFragment()

	const template = document.createElement('template')
	template.innerHTML = htmlString
	const fragment = template.content

	// 移除开发服务器注入的脚本
	fragment.querySelectorAll('script[src^="/___"]').forEach(oldScript => {
		oldScript.remove()
	})
	// 激活 script 标签
	fragment.querySelectorAll('script').forEach(oldScript => {
		const newScript = document.createElement('script')
		for (const attr of oldScript.attributes)
			newScript.setAttribute(attr.name, attr.value)
		if (oldScript.textContent) newScript.text = oldScript.textContent
		oldScript.parentNode.replaceChild(newScript, oldScript)
	})
	// 激活 link 标签
	fragment.querySelectorAll('link').forEach(oldLink => {
		const newLink = document.createElement('link')
		for (const attr of oldLink.attributes)
			newLink.setAttribute(attr.name, attr.value)
		oldLink.parentNode.replaceChild(newLink, oldLink)
	})

	return fragment
}

/**
 * 从 HTML 字符串创建 DOM 元素。
 * @param {string} htmlString - 包含 HTML 代码的字符串。
 * @returns {Element|DocumentFragment|Document} - 创建的 DOM 元素或文档对象。
 */
export function createDOMFromHtmlString(htmlString) {
	// 如果是完整文档，使用 DOMParser 以保留 html, head, body 结构
	if (/^\s*<!DOCTYPE/i.test(htmlString) || /^\s*<html/i.test(htmlString)) {
		const parser = new DOMParser()
		const doc = parser.parseFromString(htmlString, 'text/html')

		// 清理不需要的脚本
		doc.querySelectorAll('script[src^="/___"]').forEach(oldScript => {
			oldScript.remove()
		})

		return doc
	}

	const div = document.createElement('div')
	div.appendChild(createDocumentFragmentFromHtmlString(htmlString))
	return div.children.length == 1 ? div.children[0] : div
}

let templatePath

/**
 * 设置模板路径。
 * @param {string} path - 模板路径。
 * @returns {void}
 */
export function usingTemplates(path) {
	templatePath = (base_dir + '/' + path).replace(/\/+/g, '/').replace(/\/$/g, '')
}

/**
 * 渲染模板。
 * @param {string} template - 模板名称。
 * @param {object} [data={}] - 模板数据。
 * @returns {Promise<Element|DocumentFragment|Document>} - 渲染后的 DOM 元素。
 */
export async function renderTemplate(template, data = {}) {
	data.geti18n ??= geti18n
	data.renderTemplate ??= renderTemplateAsHtmlString
	/**
	 * 在模板渲染上下文中设置一个值。
	 * @param {string} name - 要设置的变量名。
	 * @param {*} value - 要设置的变量值。
	 * @returns {void}
	 */
	data.setValue ??= (name, value) => data[name] = value
	template_cache[template] ??= fetch(templatePath + '/' + template + '.html').then(response => {
		if (!response.ok) throw new Error(`HTTP error, status: ${response.status}`)
		return response.text()
	})
	let html = template_cache[template] = await template_cache[template]

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
				const eval_result = await async_eval(expression, data)
				if (eval_result.error) throw eval_result.error
				result += eval_result.result
				html = html.slice(end_index)
				break find
			} catch (error) {
				if (!(error instanceof SyntaxError))
					console.error(error)
			}
		}
	}
	result += html
	return i18nElement(await svgInliner(createDOMFromHtmlString(result)), { skip_report: true })
}

/**
 * 将模板渲染为 HTML 字符串。
 * @param {string} template - 模板名称。
 * @param {object} [data={}] - 模板数据。
 * @returns {Promise<string>} - 渲染后的 HTML 字符串。
 */
export async function renderTemplateAsHtmlString(template, data = {}) {
	let node = await renderTemplate(template, data)
	if (node.nodeType === Node.DOCUMENT_NODE) {
		node = node.documentElement.outerHTML
		node = node.replace(/[\s\n]*<\/body>[\s\n]*<\/html>$/i, '\n</body>\n\n</html>\n')
		node = node.replace(/<html ([^>]*)>[\s\n]*<head>/i, '<html $1>\n\n<head>')
		node = node.replace(/^[\s\n]*<html/i, '<!DOCTYPE html>\n<html')
		return node
	}
	return node.outerHTML
}
