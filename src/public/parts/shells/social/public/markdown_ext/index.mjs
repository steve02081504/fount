/**
 * Social shell 注册的 markdown 扩展：@entity、帖子深链、话题标签、Chat 频道链接。
 */
import { visit, SKIP } from 'https://esm.sh/unist-util-visit'

import { expandChannelLinksInText } from '/parts/shells:chat/src/lib/expandChannelLinks.mjs'
import { formatSocialSearchHref } from '../src/lib/runUri.mjs'

/** 话题标签（不含 Chat `#[group/channel]`）。 */
const HASHTAG_RE = /#([\p{L}\p{N}_-]{2,32})/gu

/**
 * remark：展开 Social 方言链接。
 *
 * hashtag 转为真正的 MDAST link 节点，确保 rehype 能生成可点击的 `<a>` 元素。
 * @returns {(tree: import('npm:@types/mdast').Root) => void} remark 插件。
 */
function remarkSocialDialect() {
	return tree => {
		visit(tree, 'text', (node, index, parent) => {
			if (typeof node.value !== 'string' || !parent || typeof index !== 'number') return

			let value = expandChannelLinksInText(node.value)
			value = value
				.replace(/@([\da-f]{128})/gi, '[$1](/parts/shells:social/#profile;$1)')
				.replace(/social:post:([\da-f]{128}):([\da-f]{64})/gi, '[$2](/parts/shells:social/#profile;$1;$2)')

			/** @type {import('npm:@types/mdast').RootContent[]} */
			const parts = []
			let lastIndex = 0
			let hasHashtags = false
			for (const match of value.matchAll(HASHTAG_RE)) {
				const start = match.index ?? 0
				if (start > 0 && value[start - 1] === '[') continue
				hasHashtags = true
				if (start > lastIndex)
					parts.push({ type: 'text', value: value.slice(lastIndex, start) })
				parts.push({
					type: 'link',
					url: formatSocialSearchHref(match[1]),
					title: null,
					children: [{ type: 'text', value: `#${match[1]}` }],
				})
				lastIndex = start + match[0].length
			}

			if (!hasHashtags) {
				if (value !== node.value) node.value = value
				return
			}
			if (lastIndex < value.length)
				parts.push({ type: 'text', value: value.slice(lastIndex) })

			parent.children.splice(index, 1, ...parts)
			return [SKIP, index + parts.length]
		})
	}
}

/**
 *
 */
export default {
	remarkPlugins: [remarkSocialDialect],
	rehypePlugins: [],
}
