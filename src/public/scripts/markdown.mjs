import rehypeKatex from 'https://esm.run/rehype-katex'
import rehypeStringify from 'https://esm.run/rehype-stringify'
import remarkParse from 'https://esm.run/remark-parse'
import remarkRehype from 'https://esm.run/remark-rehype'
import remarkMath from 'https://esm.run/remark-math'
import { unified } from 'https://esm.run/unified'
import remarkGfm from 'https://esm.run/remark-gfm'
import remarkBreaks from 'https://esm.run/remark-breaks'
import rehypePrettyCode from 'https://esm.run/rehype-pretty-code'
import { transformerCopyButton } from 'https://esm.run/@rehype-pretty/transformers'
import { onThemeChange } from './theme.mjs'
import { visit } from 'https://esm.run/unist-util-visit'

function remarkDisable(options = {}) {
	const data = this.data()
	const list = data.micromarkExtensions || (data.micromarkExtensions = [])
	list.push({ disable: { null: options.disable || [] } })
}

function rehypeWrapTables(options = {}) {
	return (tree) => {
		visit(tree, 'element', (node, index, parent) => {
			if (node.tagName === 'table') {
				const container = {
					type: 'element',
					tagName: 'figure',
					properties: { className: ['table-container'] },
					children: [node],
				}
				parent.children[index] = container
			}
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
	.use(rehypeWrapTables)
	.use(rehypeKatex)
	.use(rehypeStringify, {
		allowDangerousCharacters: true,
		allowDangerousHtml: true,
		tightBreaks: true,
	})

export async function renderMarkdown(markdown) {
	const file = await convertor.process(markdown)
	return String(file)
}

document.head.innerHTML += '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex/dist/katex.min.css" />'
const markdown_style = document.createElement('link')
markdown_style.rel = 'stylesheet'
onThemeChange((theme, is_dark) => {
	if (is_dark)
		markdown_style.href = 'https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown-dark.min.css'
	else
		markdown_style.href = 'https://cdn.jsdelivr.net/npm/github-markdown-css/github-markdown-light.min.css'
})
document.head.prepend(markdown_style) // 最低优先级以免覆写颜色设定
