import { visit } from 'https://esm.sh/unist-util-visit'

import { formatSocialSearchHref } from './lib/runUri.mjs'

/** 话题标签（不含 Chat `#[group/channel]`）。 */
const HASHTAG_RE = /#([\p{L}\p{N}_-]{2,32})/gu

/**
 * 将正文中的 `#tag` 转为站内搜索深链（remark 阶段）。
 * @returns {(tree: import('npm:@types/mdast').Root) => void} remark 插件
 */
export function remarkHashtagLinks() {
	return tree => {
		visit(tree, 'text', node => {
			if (typeof node.value !== 'string') return
			const source = node.value
			let result = ''
			let lastIndex = 0
			for (const match of source.matchAll(HASHTAG_RE)) {
				const index = match.index ?? 0
				if (index > 0 && source[index - 1] === '[') continue
				result += source.slice(lastIndex, index)
				const tag = match[1]
				result += `[#${tag}](${formatSocialSearchHref(tag)})`
				lastIndex = index + match[0].length
			}
			if (lastIndex > 0) {
				result += source.slice(lastIndex)
				node.value = result
			}
		})
	}
}
