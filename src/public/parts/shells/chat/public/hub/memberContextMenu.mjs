/**
 * 【文件】public/hub/memberContextMenu.mjs
 * 【职责】成员列表项右键菜单：查看资料、私信、踢出、封禁（含 `banScopePicker`）等成员操作。
 */
import { renderTemplate } from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { confirmI18n } from '../../../../scripts/i18n/index.mjs'
import { aliasForEntity, setEntityAlias } from '../shared/aliases.mjs'
import { isCared, setCared } from '../shared/care.mjs'
import { getGroupState } from '../src/api/groupApi.mjs'
import { fetchViewerChannelPermissions } from '../src/groupViewerPermissions.mjs'

import { pickBanScope } from './banScopePicker.mjs'
import { hubStore } from './core/state.mjs'
import { dispatchFriendChat } from './friendChat.mjs'
import { renderMemberList } from './groupNav.mjs'
import { insertComposerMention } from './mentionAutocomplete.mjs'
import { resolveEntityFromAnchor } from './profilePopup.mjs'

/** @type {HTMLElement | null} */
let openMenuElement = null

/** @returns {void} */
function dismissMemberContextMenu() {
	if (!openMenuElement) return
	openMenuElement.remove()
	openMenuElement = null
}

/**
 * @param {MouseEvent} event 右键事件
 * @param {HTMLElement} memberElement `.hub-member-item` 行
 * @returns {Promise<void>}
 */
export async function showMemberContextMenu(event, memberElement) {
	event.preventDefault()
	event.stopPropagation()
	dismissMemberContextMenu()

	const memberKey = memberElement.dataset.memberKey?.trim()
	if (!memberKey || !hubStore.context.currentGroupId) return
	const displayName = memberElement.querySelector('.hub-member-name')?.textContent?.trim() || memberKey
	const viewer = String(hubStore.context.currentState?.viewerMemberPubKeyHash || '').toLowerCase()
	const defaultChannelId = hubStore.context.currentState?.groupSettings?.defaultChannelId || 'default'
	const isAgent = memberElement.dataset.memberKind === 'agent'
	const ownerPubKeyHash = memberElement.dataset.ownerPubKeyHash?.trim().toLowerCase() || ''
	const isOwnerOwnAgent = isAgent && ownerPubKeyHash === viewer
	const perms = viewer && memberKey.toLowerCase() !== viewer
		? await fetchViewerChannelPermissions(hubStore.context.currentState, hubStore.context.currentGroupId, defaultChannelId)
		: {}
	const showKick = memberKey.toLowerCase() !== viewer && (
		isAgent ? isOwnerOwnAgent || perms.ADMIN === true : perms.KICK_MEMBERS === true
	)
	const showBan = !!perms.BAN_MEMBERS && memberKey.toLowerCase() !== viewer
	const entityHash = memberElement.dataset.entityHash?.trim() || ''
	const showPersonalBlock = memberKey.toLowerCase() !== viewer && !!entityHash
	const showCopyEntity = !!entityHash
	const showMention = memberKey.toLowerCase() !== viewer && !!entityHash

	const menu = document.createElement('ul')
	menu.className = 'menu menu-sm bg-base-100 rounded-box shadow-lg border border-base-300 p-1 z-50'
	menu.style.cssText = `position:fixed;left:${event.clientX}px;top:${event.clientY}px;min-width:10rem;`
	menu.appendChild(await renderTemplate('hub/nav/member_context_menu', { showKick, showBan, showCopyEntity, showPersonalBlock, showMention }))
	document.body.appendChild(menu)
	openMenuElement = menu

	/**
	 * 关闭成员右键菜单并移除文档级监听。
	 * @returns {void}
	 */
	const closeOnce = () => {
		dismissMemberContextMenu()
		document.removeEventListener('click', closeOnce, true)
		document.removeEventListener('contextmenu', closeOnce, true)
	}
	setTimeout(() => {
		document.addEventListener('click', closeOnce, true)
		document.addEventListener('contextmenu', closeOnce, true)
	}, 0)

	menu.querySelector('.hub-member-menu-copy-name')?.addEventListener('click', async () => {
		await navigator.clipboard.writeText(displayName)
		closeOnce()
	})
	menu.querySelector('.hub-member-menu-copy-pubkey')?.addEventListener('click', async () => {
		await navigator.clipboard.writeText(memberKey)
		closeOnce()
	})
	menu.querySelector('.hub-member-menu-copy-entity')?.addEventListener('click', async () => {
		await navigator.clipboard.writeText(entityHash)
		showToastI18n('success', 'chat.hub.copyEntityIdOk')
		closeOnce()
	})
	menu.querySelector('.hub-member-menu-mention')?.addEventListener('click', () => {
		insertComposerMention(entityHash)
		closeOnce()
	})
	menu.querySelector('.hub-member-menu-care')?.addEventListener('click', () => {
		void (async () => {
			if (!entityHash) return
			const cared = await isCared(entityHash)
			await setCared(entityHash, !cared)
			showToastI18n('success', cared ? 'chat.hub.memberContext.careRemoved' : 'chat.hub.memberContext.careAdded')
		})().catch(error => {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		})
		closeOnce()
	})
	menu.querySelector('.hub-member-menu-alias')?.addEventListener('click', () => {
		void (async () => {
			if (!entityHash) return
			const { geti18n } = await import('../../../../scripts/i18n/index.mjs')
			const next = prompt(geti18n('chat.hub.memberContext.setAliasPrompt', { name: displayName }), aliasForEntity(entityHash))
			if (next == null) return
			await setEntityAlias(entityHash, next)
			showToastI18n('success', 'chat.hub.memberContext.aliasSaved')
			hubStore.context.currentState = await getGroupState(hubStore.context.currentGroupId)
			void renderMemberList(hubStore.context.currentState)
		})().catch(error => {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		})
		closeOnce()
	})
	menu.querySelector('.hub-member-menu-dm')?.addEventListener('click', () => {
		void (async () => {
			const entity = await resolveEntityFromAnchor(memberElement)
			if (entity) {
				dismissMemberContextMenu()
				await dispatchFriendChat(entity)
			}
		})().catch(error => {
			showToastI18n('error', 'chat.hub.profilePopup.dmFailed', { error: error.message })
		})
		closeOnce()
	})
	menu.querySelector('.hub-member-menu-kick')?.addEventListener('click', async () => {
		if (memberKey.toLowerCase() === viewer.toLowerCase())
			if (!confirmI18n('chat.hub.memberContext.kickSelfNodeWarning', { name: displayName })) return

		if (!confirmI18n('chat.group.settingsPage.kickConfirm', { name: displayName })) return
		const groupId = hubStore.context.currentGroupId
		const resp = await fetch(
			`/api/parts/shells:chat/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(memberKey)}/kick`,
			{ method: 'POST', credentials: 'include' },
		)
		if (!resp.ok) {
			const data = await resp.json().catch(() => ({}))
			showToastI18n('error', 'chat.hub.operationFailed', { error: data.error || resp.statusText })
			return
		}
		showToastI18n('success', 'chat.group.settingsPage.kickSuccess')
		hubStore.context.currentState = await getGroupState(hubStore.context.currentGroupId)
		void renderMemberList(hubStore.context.currentState)
		closeOnce()
	})
	menu.querySelector('.hub-member-menu-ban')?.addEventListener('click', async () => {
		if (!confirmI18n('chat.group.settingsPage.banConfirm', { name: displayName })) return
		const picked = await pickBanScope({ displayName })
		if (!picked) return
		const { banMemberWithScope } = await import('../src/api/groupApi.mjs')
		try {
			await banMemberWithScope(hubStore.context.currentGroupId, memberKey, picked)
			showToastI18n('success', 'chat.group.settingsPage.banSuccess')
			hubStore.context.currentState = await getGroupState(hubStore.context.currentGroupId)
			void renderMemberList(hubStore.context.currentState)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		}
		closeOnce()
	})
	menu.querySelector('.hub-member-menu-personal-block')?.addEventListener('click', async () => {
		if (!confirmI18n('chat.hub.memberContext.personalBlockConfirm', { name: displayName })) return
		const { postPersonalBlock } = await import('./personalFilter.mjs')
		try {
			await postPersonalBlock(entityHash, true)
			showToastI18n('success', 'chat.hub.memberContext.personalBlockSuccess')
			hubStore.context.currentState = await getGroupState(hubStore.context.currentGroupId)
			void renderMemberList(hubStore.context.currentState)
		}
		catch (error) {
			showToastI18n('error', 'chat.hub.operationFailed', { error: error.message })
		}
		closeOnce()
	})
}
