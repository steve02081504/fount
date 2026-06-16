import { visit } from 'https://esm.sh/unist-util-visit'

import { expandChannelLinksInText } from '../../../../chat/public/src/lib/expandChannelLinks.mjs'

/**
 * 展开 @entityHash、social 帖子深链与 Chat #[group/channel] 标记（remark 阶段）。
 * @returns {(tree: import('npm:@types/mdast').Root) => void} remark 插件
 */
export function remarkExpandSocialLinks() {
	return tree => {
		visit(tree, 'text', node => {
			if (typeof node.value !== 'string') return
			let value = expandChannelLinksInText(node.value)
			value = value
				.replace(/@([\da-f]{128})/gi, '[$1](/parts/shells:social/#profile;$1)')
				.replace(/social:post:([\da-f]{128}):([\da-f]{64})/gi, '[$2](/parts/shells:social/#profile;$1;$2)')
			node.value = value
		})
	}
}
