/**
 * Social shell 注册的 markdown 扩展：@entity、帖子深链、话题标签、Chat 频道链接。
 */
import { visit } from 'https://esm.sh/unist-util-visit'

import { expandChannelLinksInText } from '../../../chat/public/src/lib/expandChannelLinks.mjs'
import { formatSocialSearchHref } from '../src/lib/runUri.mjs'

/** 话题标签（不含 Chat `#[group/channel]`）。 */
const HASHTAG_RE = /#([\p{L}\p{N}_-]{2,32})/gu

/**
 * remark：展开 Social 方言链接。
 * @returns {(tree: import('npm:@types/mdast').Root) => void}
 */
function remarkSocialDialect() {
	return tree => {
		visit(tree, 'text', node => {
			if (typeof node.value !== 'string') return
			let value = expandChannelLinksInText(node.value)
			value = value
				.replace(/@([\da-f]{128})/gi, '[$1](/parts/shells:social/#profile;$1)')
				.replace(/social:post:([\da-f]{128}):([\da-f]{64})/gi, '[$2](/parts/shells:social/#profile;$1;$2)')

			let result = ''
			let lastIndex = 0
			for (const match of value.matchAll(HASHTAG_RE)) {
				const index = match.index ?? 0
				if (index > 0 && value[index - 1] === '[') continue
				result += value.slice(lastIndex, index)
				const tag = match[1]
				result += `[#${tag}](${formatSocialSearchHref(tag)})`
				lastIndex = index + match[0].length
			}
			if (lastIndex > 0) {
				result += value.slice(lastIndex)
				node.value = result
			}
			else
				node.value = value
		})
	}
}

export default {
	remarkPlugins: [remarkSocialDialect],
	rehypePlugins: [],
}
