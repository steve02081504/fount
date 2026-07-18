/**
 * 不可信 Markdown rehype 净化：剥危险标签、事件属性与非安全 URL。
 * 由 GetMarkdownConvertor 在 allowDangerousHtml:false 时自动挂到 early 阶段
 *（remarkRehype 之后、剧透/Mermaid/代码块/KaTeX 之前）。
 * 标签/URL 规则与 `/scripts/lib/sanitizeHtml.mjs` 对齐。
 */
import { visit } from 'https://esm.sh/unist-util-visit'

import { BLOCKED_HTML_TAGS, SAFE_HTML_URL_SCHEMES } from '../../lib/sanitizeHtml.mjs'

/**
 * @returns {(tree: import('npm:@types/hast').Root) => void} rehype 插件
 */
export function rehypeSanitizeUntrustedContent() {
	return () => tree => {
		visit(tree, 'element', (node, index, parent) => {
			const tagName = node.tagName.toLowerCase()
			if (BLOCKED_HTML_TAGS.has(tagName)) {
				parent.children.splice(index, 1)
				return index
			}
			const { properties } = node
			for (const propertyName of Object.keys(properties)) {
				const lowerName = propertyName.toLowerCase()
				if (lowerName.startsWith('on')) {
					delete properties[propertyName]
					continue
				}
				if (lowerName === 'src' || lowerName === 'href' || lowerName === 'xlink:href') {
					const url = String(properties[propertyName])
					if (url && !SAFE_HTML_URL_SCHEMES.test(url.trim()))
						delete properties[propertyName]
				}
			}
		})
	}
}
