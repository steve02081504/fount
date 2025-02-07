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

const convertor = unified()
	.use(remarkParse)
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
			dark: "github-dark-dimmed",
			light: "github-light",
		},
		transformers: [
			transformerCopyButton({
				visibility: 'always',
				feedbackDuration: 3_000,
			}),
		],
	})
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
