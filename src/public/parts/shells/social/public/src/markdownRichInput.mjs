/**
 * Social 发帖框富文本接线：安装共享 markdownRichInput 组件，提供实体别名解析。
 */
import { aliasForEntity } from '/parts/shells:chat/shared/aliases.mjs'
import { resolveDisplayName } from '/parts/shells:chat/shared/nameResolve.mjs'
import { createMarkdownRichInput } from '/scripts/components/markdownRichInput.mjs'

/**
 * 解析 mention chip 显示名（走本地别名 / 短码兜底）。
 * @param {object} token token 描述
 * @returns {Promise<string | null>} 显示名或 null
 */
async function socialTokenLabel(token) {
	if (token.kind === 'mention' && token.entityHash) {
		const alias = aliasForEntity(token.entityHash)
		if (alias) return alias
		return resolveDisplayName({ entityHash: token.entityHash })
	}
	return null
}

/**
 * 在 `#postText` 上安装富文本输入框（幂等）。
 * @returns {object | null} 组件句柄；元素缺失或非目标时为 null
 */
export function installSocialRichInput() {
	const input = document.getElementById('postText')
	if (!(input instanceof HTMLElement) || input instanceof HTMLTextAreaElement) return null
	if (input.classList.contains('fount-markdown-rich-input')) return null
	return createMarkdownRichInput(input, { resolveTokenLabel: socialTokenLabel })
}
