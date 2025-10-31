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

export async function renderMarkdownAsString(markdown) {
	convertor ??= await GetMarkdownConvertor()
	const file = await convertor.process(markdown)
	return String(file)
}

export async function renderMarkdown(markdown) {
	return createDOMFromHtmlString(await renderMarkdownAsString(markdown))
}

export async function renderMarkdownAsStandAloneHtmlString(markdown) {
	standaloneConvertor ??= await GetMarkdownConvertor({ isStandalone: true })
	const file = await standaloneConvertor.process(markdown)
	return String(file)
}
