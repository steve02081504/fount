import { formatSocialProfileHref } from '../../shared/runUri.mjs'

import { entityHandle, renderAvatarHtml } from './display.mjs'
import { appendTemplate } from '/scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'

/** Social 壳模板根（显式传入，避免与 chat withTemplates 并发串台）。 */
const SOCIAL_TEMPLATES = '/parts/shells:social/src/templates'

/**
 * 渲染推荐关注行到容器（feed / explore 侧栏共用）。
 * @param {HTMLElement} list 列表容器
 * @param {object[]} accounts 账户行
 * @returns {Promise<void>}
 */
export async function renderSuggestedAccountRows(list, accounts) {
	list.replaceChildren()
	for (const account of accounts)
		await appendTemplate(list, 'explore_suggested', {
			profileHref: escapeHtml(formatSocialProfileHref(account.entityHash)),
			entityHash: escapeHtml(account.entityHash),
			name: escapeHtml(account.name),
			handle: escapeHtml(entityHandle(account.entityHash, account)),
			avatarHtml: renderAvatarHtml(account.entityHash, { name: account.name }),
		}, SOCIAL_TEMPLATES)
}
