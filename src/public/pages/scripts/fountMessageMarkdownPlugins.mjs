/**
 * 共享 remark/rehype 插件：不可信 Markdown 净化（chat / social 共用）。
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
 * 不可信内容 rehype 净化：移除危险标签、事件属性与非安全 URL。
 * @returns {(tree: import('npm:@types/hast').Root) => void} rehype 插件
 */
export function rehypeSanitizeUntrustedContent() {
	return () => tree => {
		visit(tree, 'element', (node, index, parent) => {
			if (!parent || index == null) return
			const tagName = String(node.tagName || '').toLowerCase()
			if (BLOCKED_TAG_NAMES.has(tagName)) {
				parent.children.splice(index, 1)
				return index
			}
			const properties = node.properties || {}
			for (const propertyName of Object.keys(properties)) {
				const lowerName = propertyName.toLowerCase()
				if (lowerName.startsWith('on')) {
					delete properties[propertyName]
					continue
				}
				if (lowerName === 'src' || lowerName === 'href' || lowerName === 'xlink:href') {
					const url = String(properties[propertyName] || '')
					if (url && !SAFE_URL_SCHEMES.test(url.trim()))
						delete properties[propertyName]
				}
			}
		})
	}
}
