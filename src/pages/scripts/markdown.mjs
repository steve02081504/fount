import { transformerCopyButton } from 'https://esm.sh/@rehype-pretty/transformers'
import { h } from 'https://esm.sh/hastscript'
import rehypeKatex from 'https://esm.sh/rehype-katex'
import rehypeMermaid from 'https://esm.sh/rehype-mermaid'
import rehypePrettyCode from 'https://esm.sh/rehype-pretty-code'
import rehypeStringify from 'https://esm.sh/rehype-stringify'
import remarkBreaks from 'https://esm.sh/remark-breaks'
import remarkGfm from 'https://esm.sh/remark-gfm'
import remarkMath from 'https://esm.sh/remark-math'
import remarkParse from 'https://esm.sh/remark-parse'
import remarkRehype from 'https://esm.sh/remark-rehype'
import { unified } from 'https://esm.sh/unified'
import { visit } from 'https://esm.sh/unist-util-visit'

import { createDOMFromHtmlString } from './template.mjs'
import { onThemeChange } from './theme.mjs'

function remarkDisable(options = {}) {
	const data = this.data()
	const list = data.micromarkExtensions || (data.micromarkExtensions = [])
	list.push({ disable: { null: options.disable || [] } })
}

function rehypeAddDaisyuiClass() {
	return tree => {
		visit(tree, 'element', node => {
			if (node.tagName === 'hr')
				node.properties.className = ['divider', 'divider-primary', ...node.properties.className || []]
			else if (node.tagName === 'table')
				node.properties.className = ['table', ...node.properties.className || []]
			else if (node.tagName === 'th' || node.tagName === 'td')
				node.properties.className = ['bg-base-100', ...node.properties.className || []]
			else if (node.tagName === 'a')
				node.properties.className = ['link', 'link-primary', ...node.properties.className || []]
		})
	}
}

const convertor = unified()
	.use(remarkParse)
	.use(remarkDisable, { disable: ['codeIndented'] })
	.use(remarkBreaks)
	.use(remarkMath)
	.use(remarkRehype, {
		allowDangerousHtml: true,
	})
	.use(remarkGfm, {
		singleTilde: false,
	})
	.use(rehypeMermaid, {
		dark: true,
		errorFallback: (element, diagram, error) => {
			// https://github.com/remcohaszing/rehype-mermaid/issues/31
			document.getElementById('dmermaid-0')?.remove()
			document.getElementById('dmermaid-dark-0')?.remove()

			return h('pre.mermaid-error-fallback', `\
❌ Mermaid Diagram Failed to Render
Error: ${error.message}
--- Diagram Source ---
${diagram}`
			)
		}
	})
	.use(rehypePrettyCode, {
		theme: {
			dark: 'github-dark-dimmed',
			light: 'github-light',
		},
		transformers: [
			transformerCopyButton({
				visibility: 'always',
				feedbackDuration: 3_000,
			}),
		],
	})
	.use(rehypeKatex)
	.use(rehypeAddDaisyuiClass)
	.use(rehypeStringify, {
		allowDangerousCharacters: true,
		allowDangerousHtml: true,
		tightBreaks: true,
	})

export async function renderMarkdownAsString(markdown) {
	const file = await convertor.process(markdown)
	return String(file)
}

export async function renderMarkdown(markdown) {
	return createDOMFromHtmlString(await renderMarkdownAsString(markdown))
}

document.head.prepend(Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css' }))
const markdown_style = document.createElement('link')
markdown_style.rel = 'stylesheet'
onThemeChange((theme, is_dark) => {
	if (is_dark)
		markdown_style.href = 'https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown-dark.min.css'
	else
		markdown_style.href = 'https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown-light.min.css'
})
markdown_style.crossorigin = 'anonymous'
document.head.prepend(markdown_style) // 最低优先级以免覆写颜色设定
