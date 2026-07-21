/**
 * Social 作者名/头像悬停：复用 chat 共享人物卡（含 tags）。
 */
import { isEntityHash128 } from '/parts/shells:chat/shared/entityHash.mjs'
import { wireEntityProfileHover } from '/parts/shells:chat/shared/entityProfileHoverCard.mjs'

import { state } from '../state.mjs'

import { viewerEntityHash } from './apiClient.mjs'

const PROFILE_HOVER_SELECTOR = [
	'a.author-name',
	'a.author-avatar-link',
	'a.reply-avatar-link',
	'a.author-handle',
	'a.suggested-account-name',
	'a.explore-account-avatar-link',
].join(', ')

/**
 * 从 Social profile 链接解析 entityHash。
 * @param {string} href 链接
 * @returns {string | null} 128 hex 或 null
 */
export function entityHashFromProfileHref(href) {
	try {
		const url = new URL(String(href || ''), location.origin)
		const hash = url.hash.replace(/^#/, '')
		const match = /^profile;([0-9a-f]{128})/i.exec(hash)
		return match ? match[1].toLowerCase() : null
	}
	catch {
		return null
	}
}

/**
 * 注册 feed / replies / explore 等作者锚点的悬停资料卡。
 * @returns {void}
 */
export function wireSocialProfileHover() {
	wireEntityProfileHover(PROFILE_HOVER_SELECTOR, (el) => {
		const entityHash = entityHashFromProfileHref(el.getAttribute('href') || '')
		if (!isEntityHash128(entityHash)) return null
		const label = el.textContent?.trim()
		return {
			cacheKey: entityHash,
			entityHash,
			displayName: label && label !== '@' ? label : undefined,
			paintOptions: {
				selfEntityHash: viewerEntityHash(),
				nodeHash: state.viewerNodeHash,
				viewerOwnerEntityHash: state.viewerProfile?.ownerEntityHash,
			},
		}
	})
}
