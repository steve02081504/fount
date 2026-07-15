/**
 * 【文件】public/hub/sidebar/infoCard.mjs
 * 【职责】右侧群组信息卡渲染。
 */
import { mountTemplate } from '../../../../../scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { avatarColor, avatarInitial, avatarTextColor, groupDisplayName } from '../core/domUtils.mjs'
import { hubStore } from '../core/state.mjs'

/**
 * 渲染右侧群组信息卡。
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
export async function renderGroupInfoCard(state) {
	const host = document.getElementById('hub-info-card-host')
	const meta = state?.groupMeta || {}
	const groupId = hubStore.context.currentGroupId
	const displayName = await groupDisplayName(groupId, meta.name)
	const description = meta.description ?? ''
	await mountTemplate(host, 'hub/nav/info_card', {
		avatarColor: avatarColor(groupId || displayName || '?'),
		avatarTextColor: avatarTextColor(groupId || displayName || '?'),
		avatarInitial: escapeHtml(avatarInitial(displayName || '?')),
		groupName: escapeHtml(displayName),
		nameI18nAttr: '',
		description: escapeHtml(description),
		descriptionI18nAttr: description ? '' : ' data-i18n="chat.hub.groupDescriptionEmpty"',
	})
}
