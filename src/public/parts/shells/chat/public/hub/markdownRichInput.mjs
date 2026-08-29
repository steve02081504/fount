/**
 * Hub composer 富文本接线：安装共享 markdownRichInput 组件，并提供群内成员/角色名解析。
 */
import { aliasForEntity } from '../shared/aliases.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'
import { createMarkdownRichInput } from '/scripts/components/markdownRichInput.mjs'

import { store } from './core/state.mjs'

/**
 * 解析 mention/link chip 显示名。
 * @param {object} token token 描述
 * @returns {Promise<string | null>} 显示名（不含 @/# 前缀）或 null
 */
async function hubTokenLabel(token) {
	if (token.kind === 'mention') {
		if (token.roleId) {
			if (token.roleId === 'everyone' || token.roleId === 'here') return token.roleId
			const role = store.context.currentState?.roles?.[token.roleId]
			return role?.name || token.roleId
		}
		if (token.entityHash) {
			const members = store.context.currentState?.members || {}
			const hit = Object.values(members).find(member => member.entityHash === token.entityHash)
			if (hit)
				return resolveDisplayName({
					entityHash: token.entityHash,
					alias: aliasForEntity(token.entityHash),
					profileName: hit.displayName,
					fallbackLabel: hit.memberKind === 'agent' ? hit.charname : undefined,
				})

			if (store.viewer.viewerEntityHash === token.entityHash)
				return store.viewer.username || token.entityHash.slice(0, 8)
		}
	}
	return null
}

/**
 * 在 `#message-input` 上安装富文本输入框（幂等）。
 * @returns {object | null} 组件句柄；元素缺失或非目标时为 null
 */
export function installHubRichInput() {
	const input = document.getElementById('message-input')
	if (!(input instanceof HTMLElement) || input instanceof HTMLTextAreaElement) return null
	if (input.classList.contains('fount-markdown-rich-input')) return null
	return createMarkdownRichInput(input, { resolveTokenLabel: hubTokenLabel })
}
