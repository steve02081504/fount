import { createDocumentFragmentFromHtmlStringNoScriptActivation, activateScripts } from './template.mjs'

const { GetMarkdownConvertor } = await import('./markdownConvertor.mjs').catch(error => {
	/**
	 * 处理 Markdown 内容。
	 * @param {string} content 要处理的 Markdown 字符串。
	 * @returns {string} 返回处理后的 HTML 字符串。
	 */
	const func = content => /* html */ `\
<h1>Markdown Load Error: ${error.name}</h1>
<pre><code>
${error.stack || error.message || error}
</code></pre>

<br/>

<pre><code>
${content}
</code></pre>
`
	return {
		/**
		 * 获取一个 Markdown 转换器。
		 * @returns {{process: (function(string): string)}} 返回一个包含 process 方法的对象。
		 */
		GetMarkdownConvertor: () => {
			return {
				process: func,
				processSync: func
			}
		},
	}
})

let convertor, standaloneConvertor

/**
 * 强制预加载独立 Markdown 转换器，用于需要同步渲染的情况。
 * @returns {Promise<import('npm:unified').Processor>} 返回一个 Promise，解析为独立的 Markdown 转换器实例。
 */
export async function getStandaloneConvertor() {
	standaloneConvertor ??= await GetMarkdownConvertor({ isStandalone: true })
	return standaloneConvertor
}
/**
 * 强制预加载 Markdown 转换器，用于需要同步渲染的情况。
 * @returns {Promise<import('npm:unified').Processor>} 返回一个 Promise，解析为 Markdown 转换器实例。
 */
export async function getConvertor() {
	convertor ??= await GetMarkdownConvertor()
	return convertor
}

/**
 * 将 Markdown 渲染为字符串。
 * @param {string} markdown - Markdown 文本。
 * @returns {Promise<string>} - 渲染后的 HTML 字符串。
 */
export async function renderMarkdownAsString(markdown) {
	convertor ??= await GetMarkdownConvertor()
	const file = await convertor.process(markdown)
	return String(file)
}

/**
 * 将 Markdown 渲染为 DOM 元素（不激活脚本）。
 * @param {string} markdown - Markdown 文本。
 * @returns {Promise<DocumentFragment>} - 渲染后的 DOM 片段（脚本未激活）。
 */
export async function renderMarkdownNoScriptActivation(markdown) {
	return createDocumentFragmentFromHtmlStringNoScriptActivation(await renderMarkdownAsString(markdown))
}

/**
 * 将 Markdown 渲染为 DOM 元素（并激活脚本）。
 * @param {string} markdown - Markdown 文本。
 * @returns {Promise<DocumentFragment>} - 渲染后的 DOM 片段。
 */
export async function renderMarkdown(markdown) {
	const fragment = await renderMarkdownNoScriptActivation(markdown)
	return activateScripts(fragment)
}

/**
 * 将 Markdown 渲染为独立的 HTML 字符串。
 * @param {string} markdown - Markdown 文本。
 * @returns {Promise<string>} - 渲染后的 HTML 字符串。
 */
export async function renderMarkdownAsStandAloneHtmlString(markdown) {
	standaloneConvertor ??= await GetMarkdownConvertor({ isStandalone: true })
	const file = await standaloneConvertor.process(markdown)
	return String(file)
}

/**
 * 将 Markdown 同步渲染为独立的 HTML 字符串。
 * @param {string} markdown - Markdown 文本。
 * @returns {string} - 渲染后的 HTML 字符串。
 */
export function renderMarkdownAsStandAloneHtmlStringSync(markdown) {
	if (!standaloneConvertor) throw new Error('Standalone markdown convertor not initialized')
	const file = standaloneConvertor.processSync(markdown)
	return String(file)
}
