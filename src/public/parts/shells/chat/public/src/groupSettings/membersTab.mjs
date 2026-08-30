import { handleError } from '/scripts/features/errorHandlers.mjs'
import { showToastI18n } from '../../../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../../../scripts/i18n/index.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { applyProfileAvatarToHost } from '../../hub/core/avatarCover.mjs'
import { authorDisplayLabel } from '../../hub/core/domUtils.mjs'
import { aliasForEntity } from '../../shared/aliases.mjs'
import { avatarColor, avatarInitial, avatarTextColor, displayProfileAvatar } from '../../shared/hashAvatar.mjs'
import { disambiguateLabels, resolveDisplayName } from '../../shared/nameResolve.mjs'
import { unbanMember } from '../endpoints/groupGovernance.mjs'
import { kickMember as kickMemberRequest } from '../endpoints/members.mjs'
import { memberDisplaysAsAdmin } from '../memberDisplay.mjs'
import { mountTemplate } from '../templates.mjs'

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @param {string} username 成员公钥哈希
 * @returns {Promise<void>}
 */
async function kickMember(context, username) {
	const viewerKey = String(context.state?.viewerMemberPubKeyHash || '')
	if (viewerKey && username === viewerKey)
		if (!confirmI18n('chat.group.settings.page.kick.selfNodeWarning', { name: username })) return

	if (!confirmI18n('chat.group.settings.page.kick.confirm', { name: username })) return
	try {
		await kickMemberRequest(context.groupId, username)
		showToastI18n('success', 'chat.group.settings.page.kick.success')
		await context.reload(context.groupId)
	}
	catch (error) {
		handleError('chat.group.settings.page.kick.failed')(error)
	}
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
		const { banMemberWithScope } = await import('../endpoints/groupBan.mjs')
		const result = await banMemberWithScope(context.groupId, username, picked)
		showToastI18n('success', 'chat.group.settings.page.banSuccess')
		if (result.reputationSlash && result.reputationSlash.ok === false)
			handleError('chat.group.settings.page.banFailed')(new Error(result.reputationSlash.error || 'reputation slash failed'))
		await context.reload(context.groupId)
	}
	catch (error) {
		handleError('chat.group.settings.page.banFailed')(error)
	}
}

/**
 * @param {import('./state.mjs').GroupSettingsContext} context 群设置上下文
 * @param {string} username 成员公钥哈希
 * @returns {Promise<void>}
 */
async function unbanMemberAction(context, username) {
	if (!confirmI18n('chat.group.settings.page.unbanConfirm', { name: username })) return
	try {
		await unbanMember(context.groupId, username)
		showToastI18n('success', 'chat.group.settings.page.unbanSuccess')
		await context.reload(context.groupId)
	}
	catch (error) {
		handleError('chat.group.settings.page.unbanFailed')(error)
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
		const memberKey = member.memberKey || member.pubKeyHash || ''
		const entityHash = member.entityHash || ''
		const label = entityHash
			? resolveDisplayName({
				entityHash,
				alias: aliasForEntity(entityHash),
				profileName: member.displayName,
			})
			: (member.displayName || '')
			|| authorDisplayLabel(memberKey)
		return { member, memberKey, entityHash, label }
	})
	const labels = disambiguateLabels(labelItems)
	const members = labelItems.map((item, index) => {
		const displayName = labels[index]
		const roles = item.member.roles || ['@everyone']
		const isAgent = item.member.memberKind === 'agent'
		const roleDefs = context.state?.roles || {}
		const avatarSeed = item.entityHash || item.memberKey || displayName
		return {
			memberKey: escapeHtml(item.memberKey),
			displayName: escapeHtml(displayName),
			avatarFor: escapeHtml(item.entityHash || ''),
			avatarLabel: escapeHtml(displayName),
			avatarBg: avatarColor(avatarSeed),
			avatarTextColor: avatarTextColor(avatarSeed),
			initial: escapeHtml(avatarInitial(displayName)),
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

	await applyMemberAvatars(container, context.groupId)

	container.addEventListener('click', async (clickEvent) => {
		const memberActionButton = clickEvent.target.closest('[data-action="kick"],[data-action="ban"],[data-action="unban"]')
		if (!memberActionButton) return
		if (memberActionButton.dataset.action === 'kick') await kickMember(context, memberActionButton.dataset.username)
		else if (memberActionButton.dataset.action === 'ban') await banMember(context, memberActionButton.dataset.username)
		else await unbanMemberAction(context, memberActionButton.dataset.username)
	}, { signal })
}

/**
 * 为成员列表头像宿主加载真实头像：统一走 fount 资料管线（presence.fetchAuthorProfile → applyProfileAvatarToHost，与 Hub 侧栏/消息同机制）。
 * 无 entityHash 或资料无头像时保持 hash 占位。
 * @param {HTMLElement} container 成员列表容器
 * @param {string | null} groupId 当前群 ID（persona 解析）
 * @returns {Promise<void>}
 */
async function applyMemberAvatars(container, groupId) {
	const { fetchAuthorProfile } = await import('../../hub/presence.mjs')
	await Promise.all([...container.querySelectorAll('[data-avatar-for]')].map(async avatarHost => {
		const authorKey = avatarHost.dataset.avatarFor
		if (!authorKey || avatarHost.dataset.avatarLoaded) return
		const profile = await fetchAuthorProfile(authorKey, { groupId: groupId || undefined })
		if (!profile?.avatar) return
		avatarHost.dataset.avatarLoaded = '1'
		applyProfileAvatarToHost(avatarHost, {
			seed: authorKey,
			label: avatarHost.dataset.avatarLabel || authorKey,
			avatar: displayProfileAvatar(profile),
			letterClass: 'avatar-letter',
		})
	}))
}
