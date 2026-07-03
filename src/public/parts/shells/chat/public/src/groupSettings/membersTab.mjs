import { mountTemplate } from '../../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { authorDisplayLabel } from '../../hub/core/domUtils.mjs'
import { unbanMember } from '../api/groupApi.mjs'
import { memberDisplaysAsAdmin } from '../memberDisplay.mjs'

/**
 * @param {import('./state.mjs').GroupSettingsContext} ctx 群设置上下文
 * @param {string} username 成员公钥哈希
 * @returns {Promise<void>}
 */
async function kickMember(ctx, username) {
	const viewerKey = String(ctx.state?.viewerMemberPubKeyHash || '').toLowerCase()
	if (viewerKey && username.toLowerCase() === viewerKey)
		if (!confirmI18n('chat.group.settingsPage.kickSelfNodeWarning', { name: username })) return

	if (!confirmI18n('chat.group.settingsPage.kickConfirm', { name: username })) return
	const resp = await fetch(`/api/parts/shells:chat/groups/${encodeURIComponent(ctx.groupId)}/members/${encodeURIComponent(username)}/kick`, {
		method: 'POST',
		credentials: 'include'
	})
	if (!resp.ok) throw new Error(resp.statusText)
	showToastI18n('success', 'chat.group.settingsPage.kickSuccess')
	await ctx.reload(ctx.groupId)
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} ctx 群设置上下文
 * @param {string} username 成员公钥哈希
 * @returns {Promise<void>}
 */
async function banMember(ctx, username) {
	const { pickBanScope } = await import('../../hub/banScopePicker.mjs')
	const picked = await pickBanScope({ displayName: username })
	if (!picked) return
	try {
		const { banMemberWithScope } = await import('../api/groupBan.mjs')
		await banMemberWithScope(ctx.groupId, username, picked)
		showToastI18n('success', 'chat.group.settingsPage.banSuccess')
		await ctx.reload(ctx.groupId)
	}
	catch (error) {
		showToastI18n('error', 'chat.group.settingsPage.banFailed', { error: error.message })
	}
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} ctx 群设置上下文
 * @param {string} username 成员公钥哈希
 * @returns {Promise<void>}
 */
async function unbanMemberAction(ctx, username) {
	if (!confirmI18n('chat.group.settingsPage.unbanConfirm', { name: username })) return
	try {
		await unbanMember(ctx.groupId, username)
		showToastI18n('success', 'chat.group.settingsPage.unbanSuccess')
		await ctx.reload(ctx.groupId)
	}
	catch (error) {
		showToastI18n('error', 'chat.group.settingsPage.unbanFailed', { error: error.message })
	}
}

/** @param {import('./state.mjs').GroupSettingsContext} ctx @returns {Promise<void>} */
export async function renderMembers(ctx) {
	const container = document.getElementById('members-list')
	if (!container) return
	if (!ctx.settingsCaps?.isMember) {
		container.replaceChildren()
		return
	}

	ctx.membersController?.abort()
	ctx.membersController = new AbortController()
	const { signal } = ctx.membersController

	const memberRows = Array.isArray(ctx.state.members) ? ctx.state.members : []
	const members = memberRows.map(member => {
		const memberKey = member.memberKey || member.agentEntityHash || member.pubKeyHash || ''
		const roles = member.roles || ['@everyone']
		const displayName = String(member.displayName || '').trim()
			|| authorDisplayLabel(member.entityHash || memberKey)
		const isAgent = member.memberKind === 'agent'
		const roleDefs = ctx.state?.roles || {}
		return {
			memberKey: escapeHtml(memberKey),
			displayName: escapeHtml(displayName),
			initial: escapeHtml(displayName.charAt(0).toUpperCase() || '?'),
			rolesLabel: escapeHtml(roles.map(roleId => ctx.state.roles[roleId]?.name || roleId).join(' / ') || '@everyone'),
			isAdmin: memberDisplaysAsAdmin(member, roleDefs),
			isAgent,
		}
	})

	const bannedRows = Array.isArray(ctx.state.bannedMembers) ? ctx.state.bannedMembers : []
	const bannedMembers = bannedRows.map(member => ({
		memberKey: escapeHtml(member.memberKey || ''),
	}))

	await mountTemplate(container, 'group/settings/members_list', {
		members,
		bannedMembers,
		showModerationActions: ctx.settingsCaps?.canModerateMembers === true,
		showUnbanActions: ctx.settingsCaps?.canUnbanMembers === true,
	})

	container.addEventListener('click', async (clickEvent) => {
		const memberActionButton = clickEvent.target.closest('[data-action="kick"],[data-action="ban"],[data-action="unban"]')
		if (!memberActionButton) return
		if (memberActionButton.dataset.action === 'kick') await kickMember(ctx, memberActionButton.dataset.username)
		else if (memberActionButton.dataset.action === 'ban') await banMember(ctx, memberActionButton.dataset.username)
		else await unbanMemberAction(ctx, memberActionButton.dataset.username)
	}, { signal })
}
