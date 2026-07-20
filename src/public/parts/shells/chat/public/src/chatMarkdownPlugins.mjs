/**
 * 【文件】public/src/chatMarkdownPlugins.mjs
 * 【职责】remark 插件：展开 `#[channel:group/channel]` 等链接。
 * 【原理】visit 文本节点替换 channel 链接。
 * 【数据结构】unist 树。
 * 【关联】markdown_extensions registry、expandChannelLinks.mjs。
 */
import { visit } from 'https://esm.sh/unist-util-visit'

import { expandChannelLinksInText } from '../shared/expandChannelLinks.mjs'

/**
 * 将聊天方言 `#[channel:…]` / `#[group:…]` / `#[message:…]` 展开为 Markdown 链接（remark 阶段）。
 * @returns {(tree: import('npm:@types/mdast').Root) => void} remark 插件
 */
export function remarkExpandChannelLinks() {
	return tree => {
		visit(tree, 'text', node => {
			if (typeof node.value === 'string' && node.value.includes('#['))
				node.value = expandChannelLinksInText(node.value)
		})
	}
}
