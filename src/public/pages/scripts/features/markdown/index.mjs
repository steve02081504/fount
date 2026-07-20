import { createDocumentFragmentFromHtmlStringNoScriptActivation, activateScripts } from '../template.mjs'

import { loadRegisteredMarkdownExtensions } from './extensions.mjs'

const { GetMarkdownConvertor } = await import('./convertor.mjs').catch(error => {
	/**
	 * 处理 Markdown 内容。
	 * @param {{value: string, data: object}} content 要处理的对象。
	 * @returns {string} 返回处理后的 HTML 字符串。
	 */
	const func = content => /* html */ `\
<h1>Markdown Load Error: ${error.name}</h1>
<pre><code>
${error.stack || error.message || error}
</code></pre>

<br/>

<pre><code>
${content.value}
</code></pre>
`
	return {
		/**
		 * @returns {{process: (function(string): string)}} 含 process 的对象
		 */
		GetMarkdownConvertor: () => ({
			process: func,
			processSync: func,
		}),
	}
})

/** @type {Map<string, Promise<import('npm:unified').Processor>>} */
const convertorCache = new Map()

/** @type {import('npm:unified').Processor | null} */
let standaloneConvertor = null

/**
 * 取 Markdown 转换器（按信任档缓存）。chat/social 扩展经 registry 自动进 pipeline，壳侧不必再包一层。
 * @param {object} [options] 转换器选项
 * @param {boolean} [options.allowDangerousHtml=true] 可信档；false = 安全档
 * @param {boolean} [options.isStandalone=false] 独立导出模式
 * @returns {Promise<import('npm:unified').Processor>} 缓存后的 unified 处理器
 */
export async function getConvertor({
	allowDangerousHtml = true,
	isStandalone = false,
} = {}) {
	const version = (await loadRegisteredMarkdownExtensions()).version
	const key = `${allowDangerousHtml ? 'trusted' : 'secure'}:${isStandalone ? 'solo' : 'app'}:${version}`
	if (!convertorCache.has(key))
		convertorCache.set(key, GetMarkdownConvertor({ allowDangerousHtml, isStandalone }))
	return convertorCache.get(key)
}

/**
 * 强制预加载独立 Markdown 转换器（可信档，供 sync API）。
 * @returns {Promise<import('npm:unified').Processor>} 独立模式处理器
 */
export async function getStandaloneConvertor() {
	standaloneConvertor = await getConvertor({ isStandalone: true, allowDangerousHtml: true })
	return standaloneConvertor
}

/**
 * 将 Markdown 渲染为字符串。
 * @param {string} markdown Markdown 文本
 * @param {object} [cache] 缓存对象
 * @param {object} [options] 渲染选项
 * @param {boolean} [options.allowDangerousHtml=true] 信任档
 * @param {boolean} [options.isStandalone=false] 独立模式
 * @returns {Promise<string>} HTML
 */
export async function renderMarkdownAsString(markdown, cache, {
	allowDangerousHtml = true,
	isStandalone = false,
} = {}) {
	const convertor = await getConvertor({ allowDangerousHtml, isStandalone })
	const file = await convertor.process({ value: markdown, data: { cache } })
	return String(file)
}

/**
 * 将 Markdown 渲染为 DOM 元素（不激活脚本）。
 * @param {string} markdown Markdown 文本
 * @param {object} [cache] 缓存对象
 * @param {object} [options] 同 renderMarkdownAsString
 * @returns {Promise<DocumentFragment>} 未激活脚本的文档片段
 */
export async function renderMarkdownNoScriptActivation(markdown, cache, options) {
	return createDocumentFragmentFromHtmlStringNoScriptActivation(
		await renderMarkdownAsString(markdown, cache, options),
	)
}

/**
 * 将 Markdown 渲染为 DOM 元素（并激活脚本）。
 * @param {string} markdown Markdown 文本
 * @param {object} [cache] 缓存对象
 * @param {object} [options] 同 renderMarkdownAsString
 * @returns {Promise<DocumentFragment>} 已激活脚本的文档片段
 */
export async function renderMarkdown(markdown, cache, options) {
	const fragment = await renderMarkdownNoScriptActivation(markdown, cache, options)
	return activateScripts(fragment)
}

/**
 * 将 Markdown 渲染为独立的 HTML 字符串（可信档）。
 * @param {string} markdown Markdown 文本
 * @param {object} [cache] 缓存对象
 * @returns {Promise<string>} HTML
 */
export async function renderMarkdownAsStandAloneHtmlString(markdown, cache) {
	return renderMarkdownAsString(markdown, cache, { isStandalone: true, allowDangerousHtml: true })
}

/**
 * 将 Markdown 同步渲染为独立的 HTML 字符串。
 * @param {string} markdown Markdown 文本
 * @param {object} [cache] 缓存对象
 * @returns {string} HTML
 */
export function renderMarkdownAsStandAloneHtmlStringSync(markdown, cache) {
	if (!standaloneConvertor) throw new Error('Standalone markdown convertor not initialized')
	const file = standaloneConvertor.processSync({ value: markdown, data: { cache } })
	return String(file)
}
