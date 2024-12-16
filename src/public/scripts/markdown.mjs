
import rehypeKatex from 'https://esm.sh/rehype-katex@7?bundle'
import rehypeStringify from 'https://esm.sh/rehype-stringify@10?bundle'
import remarkParse from 'https://esm.sh/remark-parse@11?bundle'
import remarkRehype from 'https://esm.sh/remark-rehype@11?bundle'
import remarkMath from 'https://esm.sh/remark-math@6?bundle'
import { unified } from 'https://esm.sh/unified@11?bundle'
import rehypeShiki from 'https://esm.sh/@shikijs/rehype@1?bundle'

export async function renderMarkdown(markdown) {
	const file = await unified()
		.use(remarkParse)
		.use(remarkMath)
		.use(remarkRehype).use(rehypeShiki, {
			// or `theme` for a single theme
			themes: {
				light: 'vitesse-light',
				dark: 'vitesse-dark',
			},
			inline: 'tailing-curly-colon', // or other options
		}).use(rehypeKatex).use(rehypeStringify).process(markdown)
	return String(file)
}
