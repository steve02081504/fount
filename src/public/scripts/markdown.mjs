import rehypeKatex from 'https://esm.sh/rehype-katex'
import rehypeStringify from 'https://esm.sh/rehype-stringify'
import remarkParse from 'https://esm.sh/remark-parse'
import remarkRehype from 'https://esm.sh/remark-rehype'
import remarkMath from 'https://esm.sh/remark-math'
import { unified } from 'https://esm.sh/unified'
// import rehypeShiki from 'https://esm.sh/@shikijs/rehype'
import remarkGfm from 'https://esm.sh/remark-gfm'
import remarkBreaks from 'https://esm.sh/remark-breaks'
import rehypeHighlight from 'https://esm.sh/rehype-highlight'

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
