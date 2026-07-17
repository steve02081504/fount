/**
 * 【文件】public/hub/sidebar/members.mjs
 * 【职责】成员列表侧栏与 Merkle 摘要条。
 */
import {
	mountTemplate,
	renderTemplate,
} from '../../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { aliasForEntity } from '../../shared/aliases.mjs'
import { disambiguateLabels, resolveDisplayName } from '../../shared/nameResolve.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { memberDisplaysAsAdmin } from '../../src/memberDisplay.mjs'
import { authorDisplayLabel, avatarColor, avatarInitial, avatarTextColor } from '../core/domUtils.mjs'
import { hubStore } from '../core/state.mjs'
import { showMemberContextMenu } from '../memberContextMenu.mjs'
import { collectActiveMemberHashes, computeMembersMerkleRoot } from '../membersDigest.mjs'
import { isHubMemberPersonallyFiltered, loadHubPersonalFilter } from '../personalFilter.mjs'
import { applyAvatarsTo } from '../presence.mjs'

/**
 * 更新成员 Merkle 摘要校验条。
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
async function refreshMemberDigestBar(state) {
	const el = document.getElementById('hub-member-digest')
	if (!hubStore.context.currentGroupId) return
	const expected = state?.membersRoot ?? null
	if (!expected) {
		el.innerHTML = ''
		el.setAttribute('hidden', '')
		return
	}
	el.removeAttribute('hidden')
	el.className = 'hub-member-digest'
	el.replaceChildren()
	const pending = document.createElement('span')
	pending.dataset.i18n = 'chat.hub.membersDigestPending'
	el.appendChild(pending)
	const keys = collectActiveMemberHashes(state)
	const local = keys.length ? await computeMembersMerkleRoot(keys) : null
	const ok = local === expected
	const short = `${expected.slice(0, 8)}…${expected.slice(-8)}`
	const pages = Math.max(1, Number(state.membersPagesCount) || 1)
	el.className = ok ? 'hub-member-digest is-ok' : 'hub-member-digest is-warn'
	if (pages > 1) {
		const { setElementI18n } = await import('../../../../../scripts/i18n/index.mjs')
		setElementI18n(el, 'chat.hub.membersDigestPagesTitle', { expected, pages: String(pages) })
	}
	else el.title = expected
	el.replaceChildren()
	const row = document.createElement('div')
	row.className = 'hub-member-digest-row'
	const viewerEh = hubStore.viewer.viewerEntityHash
	if (viewerEh) {
		const copyButton = document.createElement('button')
		copyButton.type = 'button'
		copyButton.className = 'hub-member-digest-copy'
		copyButton.dataset.i18n = 'chat.hub.copyEntityId'
		copyButton.title = viewerEh
		copyButton.addEventListener('click', async (clickEvent) => {
			clickEvent.stopPropagation()
			await navigator.clipboard.writeText(viewerEh)
			showToastI18n('success', 'chat.hub.copyEntityIdOk')
		})
		row.appendChild(copyButton)
	}
	const label = document.createElement('span')
	label.className = 'hub-member-digest-label'
	label.dataset.root = short
	label.dataset.pages = String(pages)
	label.dataset.i18n = ok
		? pages > 1 ? 'chat.hub.membersDigestOkPaged' : 'chat.hub.membersDigestOk'
		: 'chat.hub.membersDigestMismatch'
	row.appendChild(label)
	el.appendChild(row)
}

/**
 * 渲染成员列表侧栏。
 * @param {object} state 群组状态
 * @returns {Promise<void>}
 */
export async function renderMemberList(state) {
	const container = document.getElementById('hub-member-list')
	await loadHubPersonalFilter()
	const viewerHash = String(hubStore.context.currentState?.viewerMemberPubKeyHash || '').toLowerCase()
	const members = (state.members || []).filter(member => {
		const memberKey = String(member.memberKey || member.agentEntityHash || member.pubKeyHash || '').trim()
		const entityHash = member.entityHash
			|| (viewerHash === memberKey.toLowerCase() ? hubStore.viewer.viewerEntityHash : '')
		return !isHubMemberPersonallyFiltered(entityHash, memberKey)
	})
	if (!members.length) {
		await mountTemplate(container, 'hub/nav/side_muted', { i18nKey: 'chat.hub.noMembers' })
		return
	}
	const roleDefs = state.roles || {}
	const prepared = members.map((member) => {
		const memberKey = String(member.memberKey || member.agentEntityHash || member.pubKeyHash || '').trim()
		const isAgent = member.memberKind === 'agent'
		const entityHash = member.entityHash
			|| (viewerHash && member.pubKeyHash?.toLowerCase() === viewerHash ? hubStore.viewer.viewerEntityHash : '')
			|| ''
		const label = entityHash
			? resolveDisplayName({
				entityHash,
				alias: aliasForEntity(entityHash),
				profileName: member.displayName,
				fallbackLabel: isAgent ? member.charname : undefined,
			})
			: String(member.displayName || '').trim()
				|| (isAgent ? member.charname : '')
				|| authorDisplayLabel(memberKey)
		return { member, memberKey, isAgent, entityHash, label }
	})
	const labels = disambiguateLabels(prepared)
	const rowsByMember = new Map(prepared.map((row, index) => [row.member, { ...row, displayName: labels[index] }]))
	const admins = members.filter(member => memberDisplaysAsAdmin(member, roleDefs))
	const others = members.filter(member => !memberDisplaysAsAdmin(member, roleDefs))
	/**
	 * @param {string} titleKey i18n 分组标题键
	 * @param {object[]} list 成员列表
	 * @returns {Promise<void>}
	 */
	const appendMemberGroup = async (titleKey, list) => {
		if (!list.length) return
		container.appendChild(await renderTemplate('hub/nav/member_group', {
			titleKey,
			count: String(list.length),
		}))
		const listHost = container.querySelector('.hub-member-group-list:last-of-type')
		for (const member of list) {
			const row = rowsByMember.get(member)
			const { memberKey, isAgent, entityHash, displayName } = row
			const avatarFor = entityHash
			const isAdmin = memberDisplaysAsAdmin(member, roleDefs)
			const ownerAttr = isAgent && member.ownerPubKeyHash
				? ` data-owner-pub-key-hash="${escapeHtml(member.ownerPubKeyHash)}"`
				: ''
			const avatarSeed = entityHash || memberKey || (isAgent ? member.charname : '') || displayName
			listHost.appendChild(await renderTemplate('hub/nav/member_item', {
				adminClass: isAdmin ? ' is-admin' : '',
				charClass: isAgent ? ' hub-member-item-char' : '',
				charIdAttr: '',
				memberKindAttr: ` data-member-kind="${isAgent ? 'agent' : 'user'}"${ownerAttr}`,
				username: escapeHtml(displayName),
				avatarFor: escapeHtml(avatarFor),
				memberKey: escapeHtml(memberKey),
				entityHash: escapeHtml(entityHash),
				avatarColor: avatarColor(avatarSeed),
				avatarTextColor: avatarTextColor(avatarSeed),
				avatarInitial: escapeHtml(avatarInitial(displayName)),
			}))
		}
	}
	container.replaceChildren()
	await appendMemberGroup('chat.hub.adminSection', admins)
	await appendMemberGroup('chat.hub.memberSection', others)
	container.querySelectorAll('.hub-member-item').forEach(el => {
		el.addEventListener('contextmenu', (event) => {
			void showMemberContextMenu(event, el)
		})
	})
	applyAvatarsTo(container)
	void refreshMemberDigestBar(state)
}
