/**
 * 不可信 Markdown rehype 净化：剥危险标签、事件属性与非安全 URL。
 * 由 GetMarkdownConvertor 在 allowDangerousHtml:false 时自动挂到 early 阶段
 *（remarkRehype 之后、剧透/Mermaid/代码块/KaTeX 之前）。
 */
import { visit } from 'https://esm.sh/unist-util-visit'

const BLOCKED_TAG_NAMES = new Set([
	'script',
	'style',
	'iframe',
	'object',
	'embed',
	'link',
	'meta',
	'base',
	'form',
])

const SAFE_URL_SCHEMES = /^(https?:|mailto:|tel:|#|\/|about:blank#|fount:)/i

/**
 * @returns {(tree: import('npm:@types/hast').Root) => void} rehype 插件
 */
export function rehypeSanitizeUntrustedContent() {
	return () => tree => {
		visit(tree, 'element', (node, index, parent) => {
			const tagName = node.tagName.toLowerCase()
			if (BLOCKED_TAG_NAMES.has(tagName)) {
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
					if (url && !SAFE_URL_SCHEMES.test(url.trim()))
						delete properties[propertyName]
				}
			}
		})
	}
}
