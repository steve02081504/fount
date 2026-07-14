import { mountTemplate } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { authorDisplayLabel } from '../../hub/core/domUtils.mjs'
import { aliasForEntity } from '../../shared/aliases.mjs'
import { disambiguateLabels, resolveDisplayName } from '../../shared/nameResolve.mjs'
import { unbanMember } from '../api/groupApi.mjs'
import { memberDisplaysAsAdmin } from '../memberDisplay.mjs'

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @param {string} username 成员公钥哈希
 * @returns {Promise<void>}
 */
async function kickMember(context, username) {
	const viewerKey = String(context.state?.viewerMemberPubKeyHash || '').toLowerCase()
	if (viewerKey && username.toLowerCase() === viewerKey)
		if (!confirmI18n('chat.group.settingsPage.kickSelfNodeWarning', { name: username })) return

	if (!confirmI18n('chat.group.settingsPage.kickConfirm', { name: username })) return
	const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(context.groupId)}/members/${encodeURIComponent(username)}/kick`, {
		method: 'POST',
		credentials: 'include'
	})
	if (!resp.ok) throw new Error(resp.statusText)
	showToastI18n('success', 'chat.group.settingsPage.kickSuccess')
	await context.reload(context.groupId)
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @param {string} username 成员公钥哈希
 * @returns {Promise<void>}
 */
async function banMember(context, username) {
	const { pickBanScope } = await import('../../hub/banScopePicker.mjs')
	const picked = await pickBanScope({ displayName: username })
	if (!picked) return
	try {
		const { banMemberWithScope } = await import('../api/groupBan.mjs')
		await banMemberWithScope(context.groupId, username, picked)
		showToastI18n('success', 'chat.group.settingsPage.banSuccess')
		await context.reload(context.groupId)
	}
	catch (error) {
		showToastI18n('error', 'chat.group.settingsPage.banFailed', { error: error.message })
	}
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @param {string} username 成员公钥哈希
 * @returns {Promise<void>}
 */
async function unbanMemberAction(context, username) {
	if (!confirmI18n('chat.group.settingsPage.unbanConfirm', { name: username })) return
	try {
		await unbanMember(context.groupId, username)
		showToastI18n('success', 'chat.group.settingsPage.unbanSuccess')
		await context.reload(context.groupId)
	}
	catch (error) {
		showToastI18n('error', 'chat.group.settingsPage.unbanFailed', { error: error.message })
	}
}

/** @param {import('./state.mjs').GroupSettingsContext} context @returns {Promise<void>} */
export async function renderMembers(context) {
	const container = document.getElementById('members-list')
	if (!container) return
	if (!context.settingsCaps?.isMember) {
		container.replaceChildren()
		return
	}

	context.membersController?.abort()
	context.membersController = new AbortController()
	const { signal } = context.membersController

	const memberRows = Array.isArray(context.state.members) ? context.state.members : []
	const labelItems = memberRows.map(member => {
		const memberKey = member.memberKey || member.agentEntityHash || member.pubKeyHash || ''
		const entityHash = String(member.entityHash || '').trim()
		const label = entityHash
			? resolveDisplayName({
				entityHash,
				alias: aliasForEntity(entityHash),
				profileName: member.displayName,
			})
			: String(member.displayName || '').trim()
				|| authorDisplayLabel(memberKey)
		return { member, memberKey, entityHash, label }
	})
	const labels = disambiguateLabels(labelItems)
	const members = labelItems.map((item, index) => {
		const displayName = labels[index]
		const roles = item.member.roles || ['@everyone']
		const isAgent = item.member.memberKind === 'agent'
		const roleDefs = context.state?.roles || {}
		return {
			memberKey: escapeHtml(item.memberKey),
			displayName: escapeHtml(displayName),
			initial: escapeHtml(displayName.charAt(0).toUpperCase() || '?'),
			rolesLabel: escapeHtml(roles.map(roleId => context.state.roles[roleId]?.name || roleId).join(' / ') || '@everyone'),
			isAdmin: memberDisplaysAsAdmin(item.member, roleDefs),
			isAgent,
		}
	})

	const bannedRows = Array.isArray(context.state.bannedMembers) ? context.state.bannedMembers : []
	const bannedMembers = bannedRows.map(member => ({
		memberKey: escapeHtml(member.memberKey || ''),
	}))

	await mountTemplate(container, 'group/settings/members_list', {
		members,
		bannedMembers,
		showModerationActions: context.settingsCaps?.canModerateMembers === true,
		showUnbanActions: context.settingsCaps?.canUnbanMembers === true,
	})

	container.addEventListener('click', async (clickEvent) => {
		const memberActionButton = clickEvent.target.closest('[data-action="kick"],[data-action="ban"],[data-action="unban"]')
		if (!memberActionButton) return
		if (memberActionButton.dataset.action === 'kick') await kickMember(context, memberActionButton.dataset.username)
		else if (memberActionButton.dataset.action === 'ban') await banMember(context, memberActionButton.dataset.username)
		else await unbanMemberAction(context, memberActionButton.dataset.username)
	}, { signal })
}
