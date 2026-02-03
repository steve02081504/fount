import { async_eval } from 'https://esm.sh/@steve02081504/async-eval'

import { base_dir } from '../base.mjs'

import { geti18n, i18nElement } from './i18n.mjs'
import { svgInliner } from './svgInliner.mjs'

const template_cache = {}

// 不需要闭合的空元素 (Void Elements)
const VOID_TAGS = new Set([
	'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'
])

/**
 * 修复未闭合的标签。
 * @param {string} html - 待修复的 HTML 字符串。
 * @returns {string} - 修复后的字符串。
 */
function escapeUnclosedTags(html) {
	const stack = []
	const indicesToEscape = new Set()

	const tagRegex = /<(\/?)([A-Za-z][\dA-Za-z-]*)\b((?:[^"'>]|"[^"]*"|'[^']*')*?)\/?>/g

	let match
	while ((match = tagRegex.exec(html)) !== null) {
		const isClosing = match[1] === '/'
		const tagName = match[2].toLowerCase()
		const { index } = match
		const isSelfClosing = match[0].trim().endsWith('/>')

		if (VOID_TAGS.has(tagName) || isSelfClosing) continue

		if (isClosing) {
			let matchIndex = -1
			for (let i = stack.length - 1; i >= 0; i--)
				if (stack[i].tagName === tagName) {
					matchIndex = i
					break
				}


			if (matchIndex !== -1) {
				for (let i = matchIndex + 1; i < stack.length; i++)
					indicesToEscape.add(stack[i].index)
				stack.splice(matchIndex)
			}
			else
				indicesToEscape.add(index)
		}
		else
			stack.push({ tagName, index })
	}

	stack.forEach(item => indicesToEscape.add(item.index))

	if (!indicesToEscape.size) return html

	let result = ''
	let lastCursor = 0
	const sortedIndices = Array.from(indicesToEscape).sort((a, b) => a - b)

	for (const idx of sortedIndices) {
		result += html.slice(lastCursor, idx)
		result += '&lt;'
		lastCursor = idx + 1
	}
	result += html.slice(lastCursor)

	return result
}

/**
 * 激活 DOM 节点中的脚本和链接标签（支持 Element、DocumentFragment、Document）。
 * @param {Element|DocumentFragment|Document} node - 要激活的 DOM 节点。
 * @returns {Element|DocumentFragment|Document} - 激活后的 DOM 节点。
 */
export function activateScripts(node) {
	// 对于 Document 或 Element，直接在其上查询并激活
	const root = node.nodeType === Node.DOCUMENT_NODE ? node : node.ownerDocument || document
	const container = node.nodeType === Node.DOCUMENT_NODE ? node.documentElement : node

	// 移除开发服务器注入的脚本
	container.querySelectorAll('script[src^="/___"]').forEach(oldScript => {
		oldScript.remove()
	})
	// 激活 script 标签
	container.querySelectorAll('script').forEach(oldScript => {
		const newScript = root.createElement('script')
		for (const attr of oldScript.attributes)
			newScript.setAttribute(attr.name, attr.value)
		if (oldScript.textContent) newScript.text = oldScript.textContent
		oldScript.parentNode.replaceChild(newScript, oldScript)
	})
	// 激活 link 标签
	container.querySelectorAll('link').forEach(oldLink => {
		const newLink = root.createElement('link')
		for (const attr of oldLink.attributes)
			newLink.setAttribute(attr.name, attr.value)
		oldLink.parentNode.replaceChild(newLink, oldLink)
	})

	return node
}

/**
 * 从 HTML 字符串创建 DOM 元素（不激活脚本），返回 DocumentFragment。
 *
 * @param {string} htmlString - 包含 HTML 代码的字符串。
 * @returns {DocumentFragment} - 渲染好的 DocumentFragment（脚本未激活）。
 */
export function createDocumentFragmentFromHtmlStringNoScriptActivation(htmlString) {
	if (!htmlString || !htmlString.trim()) return document.createDocumentFragment()

	const template = document.createElement('template')
	template.innerHTML = htmlString
	return template.content
}

/**
 * 从 HTML 字符串安全地创建 DOM 元素（包括执行 <script> 标签和使得 <link> 标签生效），返回 DocumentFragment。
 *
 * @param {string} htmlString - 包含 HTML 代码的字符串。
 * @returns {DocumentFragment} - 渲染好的 DocumentFragment。
 */
export function createDocumentFragmentFromHtmlString(htmlString) {
	const fragment = createDocumentFragmentFromHtmlStringNoScriptActivation(htmlString)
	return activateScripts(fragment)
}

/**
 * 从 HTML 字符串创建 DOM 元素（不激活脚本）。
 * @param {string} htmlString - 包含 HTML 代码的字符串。
 * @returns {Element|DocumentFragment|Document} - 创建的 DOM 元素或文档对象（脚本未激活）。
 */
export function createDOMFromHtmlStringNoScriptActivation(htmlString) {
	// 如果是完整文档，使用 DOMParser 以保留 html, head, body 结构
	if (/^\s*<!doctype/i.test(htmlString) || /^\s*<html/i.test(htmlString)) {
		const parser = new DOMParser()
		return parser.parseFromString(htmlString, 'text/html')
	}

	const fragment = createDocumentFragmentFromHtmlStringNoScriptActivation(htmlString)
	return fragment.children.length == 1 ? fragment.children[0] : fragment
}

/**
 * 从 HTML 字符串创建 DOM 元素。
 * @param {string} htmlString - 包含 HTML 代码的字符串。
 * @returns {Element|DocumentFragment|Document} - 创建的 DOM 元素或文档对象。
 */
export function createDOMFromHtmlString(htmlString) {
	// 如果是完整文档，使用 DOMParser 以保留 html, head, body 结构
	if (/^\s*<!doctype/i.test(htmlString) || /^\s*<html/i.test(htmlString)) {
		const doc = createDOMFromHtmlStringNoScriptActivation(htmlString)
		// 清理不需要的脚本
		doc.querySelectorAll('script[src^="/___"]').forEach(oldScript => {
			oldScript.remove()
		})
		return doc
	}

	const fragment = createDocumentFragmentFromHtmlString(htmlString)
	return fragment.children.length == 1 ? fragment.children[0] : fragment
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
 * 渲染模板(不激活脚本)。
 * @param {string} template - 模板名称。
 * @param {object} [data={}] - 模板数据。
 * @returns {Promise<Element|DocumentFragment|Document>} - 渲染后的 DOM 元素(脚本未激活)。
 */
export async function renderTemplateNoScriptActivation(template, data = {}) {
	data.geti18n ??= geti18n
	data.renderTemplate ??= renderTemplateAsHtmlString
	/**
	 * 在模板渲染上下文中设置一个值。
	 * @template T - 要设置的变量类型。
	 * @param {string} name - 要设置的变量名。
	 * @param {T} value - 要设置的变量值。
	 * @returns {T} - 设置的值。
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
				result += escapeUnclosedTags(String(eval_result.result))
				html = html.slice(end_index)
				break find
			} catch (error) {
				if (!(error instanceof SyntaxError))
					console.error(error)
			}
		}
	}
	result += html
	return i18nElement(await svgInliner(createDOMFromHtmlStringNoScriptActivation(result)), { skip_report: true })
}

/**
 * 渲染模板。
 * @param {string} template - 模板名称。
 * @param {object} [data={}] - 模板数据。
 * @returns {Promise<Element|DocumentFragment|Document>} - 渲染后的 DOM 元素。
 */
export async function renderTemplate(template, data = {}) {
	const node = await renderTemplateNoScriptActivation(template, data)
	return activateScripts(node)
}

/**
 * 将模板渲染为 HTML 字符串。
 * @param {string} template - 模板名称。
 * @param {object} [data={}] - 模板数据。
 * @returns {Promise<string>} - 渲染后的 HTML 字符串。
 */
export async function renderTemplateAsHtmlString(template, data = {}) {
	let node = await renderTemplateNoScriptActivation(template, data)
	if (node.nodeType === Node.DOCUMENT_NODE) {
		node = node.documentElement.outerHTML
		node = node.replace(/\s*<\/body>\s*<\/html>$/i, '\n</body>\n\n</html>\n')
		node = node.replace(/<html ([^>]*)>\s*<head>/i, '<html $1>\n\n<head>')
		node = node.replace(/^\s*<html/i, '<!DOCTYPE html>\n<html')
		return node
	}
	if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
		const div = document.createElement('div')
		div.appendChild(node)
		return div.innerHTML
	}
	return node.outerHTML
}
