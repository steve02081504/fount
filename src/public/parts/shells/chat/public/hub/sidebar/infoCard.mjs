/**
 * 【文件】public/hub/sidebar/infoCard.mjs
 * 【职责】右侧群组信息卡渲染。
 */
import { renderTemplate } from '../../src/templates.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { avatarColor, avatarInitial, avatarTextColor, groupDisplayName } from '../core/domUtils.mjs'
import { captureGroupContext } from '../core/groupContext.mjs'
import { store } from '../core/state.mjs'

let renderSequence = 0

/**
 * 渲染右侧群组信息卡。
 * @param {object} state 群组状态
 * @param {() => boolean} [stillCurrent] 群视图仍有效
 * @returns {Promise<void>}
 */
export async function renderGroupInfoCard(state, stillCurrent = captureGroupContext(store.context.currentGroupId)) {
	const sequence = ++renderSequence
	/** @returns {boolean} 最新且仍属于当前群的渲染。 */
	const current = () => stillCurrent() && sequence === renderSequence
	const host = document.getElementById('info-card-host')
	const meta = state?.groupMeta || {}
	const groupId = store.context.currentGroupId
	const displayName = await groupDisplayName(groupId, meta.name)
	if (!current()) return
	const description = meta.description ?? ''
	const card = await renderTemplate('hub/nav/info_card', {
		avatarColor: avatarColor(groupId || displayName || '?'),
		avatarTextColor: avatarTextColor(groupId || displayName || '?'),
		avatarInitial: escapeHtml(avatarInitial(displayName || '?')),
		groupName: escapeHtml(displayName),
		nameI18nAttr: '',
		description: escapeHtml(description),
		descriptionI18nAttr: description ? '' : ' data-i18n="chat.hub.group.descriptionEmpty"',
	})
	if (current()) host.replaceChildren(card)
}
