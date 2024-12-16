import rehypeKatex from 'https://esm.run/rehype-katex'
import rehypeStringify from 'https://esm.run/rehype-stringify'
import remarkParse from 'https://esm.run/remark-parse'
import remarkRehype from 'https://esm.run/remark-rehype'
import remarkMath from 'https://esm.run/remark-math'
import { unified } from 'https://esm.run/unified'
// import rehypeShiki from 'https://esm.run/@shikijs/rehype'
import remarkGfm from 'https://esm.run/remark-gfm'
import remarkBreaks from 'https://esm.run/remark-breaks'
import rehypeHighlight from 'https://esm.run/rehype-highlight'

const convertor = unified()
	.use(remarkParse)
	.use(remarkBreaks)
	.use(remarkMath)
	.use(remarkRehype, {
		allowDangerousHtml: true,
	})
	.use(remarkGfm)
	//*
	.use(rehypeHighlight)
	/*/ // toooo slow
	.use(rehypeShiki, {
		// or `theme` for a single theme
		themes: {
			light: 'vitesse-light',
			dark: 'vitesse-dark',
		},
		inline: 'tailing-curly-colon', // or other options
	})
	*/
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
