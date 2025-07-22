import rehypeKatex from 'https://esm.run/rehype-katex'
import rehypeStringify from 'https://esm.run/rehype-stringify'
import remarkParse from 'https://esm.run/remark-parse'
import remarkRehype from 'https://esm.run/remark-rehype'
import remarkMath from 'https://esm.run/remark-math'
import { unified } from 'https://esm.run/unified'
import remarkGfm from 'https://esm.run/remark-gfm'
import remarkBreaks from 'https://esm.run/remark-breaks'
import rehypePrettyCode from 'https://esm.run/rehype-pretty-code'
import rehypeMermaid from 'https://esm.run/rehype-mermaid'
import { transformerCopyButton } from 'https://esm.run/@rehype-pretty/transformers'
import { visit } from 'https://esm.run/unist-util-visit'
import { h } from 'https://esm.run/hastscript'
import { onThemeChange } from './theme.mjs'
import { createDOMFromHtmlString } from './template.mjs'

function remarkDisable(options = {}) {
	const data = this.data()
	const list = data.micromarkExtensions || (data.micromarkExtensions = [])
	list.push({ disable: { null: options.disable || [] } })
}

function rehypeAddDaisyuiClass() {
	return (tree) => {
		visit(tree, 'element', (node) => {
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
