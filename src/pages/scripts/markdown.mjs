import { createDOMFromHtmlString } from './template.mjs'

const { GetMarkdownConvertor } = await import('./markdownConvertor.mjs').catch(error => {
	debugger
	return {
		GetMarkdownConvertor: () => {
			return {
				process: content => {
					return `\
<h1>Markdown Load Error: ${error.name}</h1>
<pre><code>
${error.stack || error.message || error}
</code></pre>

<br/>

<pre><code>
${content}
</code></pre>
`
				},
			}
		},
	}
})

let convertor, standaloneConvertor

/**
 * @description 将 Markdown 渲染为字符串。
 * @param {string} markdown - Markdown 文本。
 * @returns {Promise<string>} - 渲染后的 HTML 字符串。
 */
export async function renderMarkdownAsString(markdown) {
	convertor ??= await GetMarkdownConvertor()
	const file = await convertor.process(markdown)
	return String(file)
}

/**
 * @description 将 Markdown 渲染为 DOM 元素。
 * @param {string} markdown - Markdown 文本。
 * @returns {Promise<DocumentFragment>} - 渲染后的 DOM 片段。
 */
export async function renderMarkdown(markdown) {
	return createDOMFromHtmlString(await renderMarkdownAsString(markdown))
}

/**
 * @description 将 Markdown 渲染为独立的 HTML 字符串。
 * @param {string} markdown - Markdown 文本。
 * @returns {Promise<string>} - 渲染后的 HTML 字符串。
 */
export async function renderMarkdownAsStandAloneHtmlString(markdown) {
	standaloneConvertor ??= await GetMarkdownConvertor({ isStandalone: true })
	const file = await standaloneConvertor.process(markdown)
	return String(file)
}
