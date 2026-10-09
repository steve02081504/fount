/**
 * 【文件】public/hub/sidebar/members.mjs
 * 【职责】成员列表侧栏与 Merkle 摘要条。
 */
import { showToastI18n } from '../../../../../scripts/features/toast.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'
import { aliasForEntity } from '../../shared/aliases.mjs'
import { disambiguateLabels, resolveDisplayName } from '../../shared/nameResolve.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { memberDisplaysAsAdmin } from '../../src/memberDisplay.mjs'
import { renderTemplate } from '../../src/templates.mjs'
import { authorDisplayLabel, avatarColor, avatarInitial, avatarTextColor } from '../core/domUtils.mjs'
import { captureGroupContext } from '../core/groupContext.mjs'
import { store } from '../core/state.mjs'
import { showMemberContextMenu } from '../memberContextMenu.mjs'
import { collectActiveMemberHashes, computeMembersMerkleRoot } from '../membersDigest.mjs'
import { isHubMemberPersonallyFiltered, loadHubPersonalFilter } from '../personalFilter.mjs'
import { applyAvatarsTo } from '../presence.mjs'

let renderSequence = 0

/**
 * 更新成员 Merkle 摘要校验条。
 * @param {object} state 群组状态
 * @param {() => boolean} stillCurrent 渲染仍有效
 * @returns {Promise<void>}
 */
async function refreshMemberDigestBar(state, stillCurrent) {
	if (!stillCurrent()) return
	const el = document.getElementById('member-digest')
	const expected = state?.membersRoot ?? null
	if (!expected) {
		el.innerHTML = ''
		el.setAttribute('hidden', '')
		return
	}
	el.removeAttribute('hidden')
	el.className = 'member-digest'
	el.replaceChildren()
	const pending = document.createElement('span')
	pending.dataset.i18n = 'chat.hub.membersDigest.pending'
	el.appendChild(pending)
	const keys = collectActiveMemberHashes(state)
	const local = keys.length ? await computeMembersMerkleRoot(keys) : null
	if (!stillCurrent()) return
	const ok = local === expected
	const short = `${expected.slice(0, 8)}…${expected.slice(-8)}`
	const pages = Math.max(1, Number(state.membersPagesCount) || 1)
	el.className = ok ? 'member-digest is-ok' : 'member-digest is-warn'
	if (pages > 1) {
		const { setElementI18n } = await import('../../../../../scripts/i18n/index.mjs')
		if (!stillCurrent()) return
		setElementI18n(el, 'chat.hub.membersDigest.pagesTitle', { expected, pages: String(pages) })
	}
	else el.title = expected
	el.replaceChildren()
	const row = document.createElement('div')
	row.className = 'member-digest-row'
	const viewerEh = store.viewer.viewerEntityHash
	if (viewerEh) {
		const copyButton = document.createElement('button')
		copyButton.type = 'button'
		copyButton.className = 'member-digest-copy'
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
	label.className = 'member-digest-label'
	label.dataset.root = short
	label.dataset.pages = String(pages)
	label.dataset.i18n = ok
		? pages > 1 ? 'chat.hub.membersDigest.okPaged' : 'chat.hub.membersDigest.ok'
		: 'chat.hub.membersDigest.mismatch'
	row.appendChild(label)
	el.appendChild(row)
}

/**
 * 渲染成员列表侧栏。
 * @param {object} state 群组状态
 * @param {() => boolean} [stillCurrent] 群视图仍有效
 * @returns {Promise<void>}
 */
export async function renderMemberList(state, stillCurrent = captureGroupContext(store.context.currentGroupId)) {
	const sequence = ++renderSequence
	/** @returns {boolean} 最新且仍属于当前群的渲染。 */
	const current = () => stillCurrent() && sequence === renderSequence
	const container = document.getElementById('member-list')
	await loadHubPersonalFilter()
	if (!current()) return
	const viewerHash = store.context.currentState?.viewerMemberPubKeyHash || ''
	const members = (state.members || []).filter(member => {
		const memberKey = member.memberKey || member.pubKeyHash || ''
		const entityHash = member.entityHash
			|| (viewerHash === memberKey ? store.viewer.viewerEntityHash : '')
		return !isHubMemberPersonallyFiltered(entityHash, memberKey)
	})
	if (!members.length) {
		const empty = await renderTemplate('hub/nav/side_muted', { i18nKey: 'chat.hub.no.members' })
		if (current()) container.replaceChildren(empty)
		return
	}
	const roleDefs = state.roles || {}
	const prepared = members.map((member) => {
		const memberKey = member.memberKey || member.pubKeyHash || ''
		const isAgent = member.memberKind === 'agent'
		const entityHash = member.entityHash
			|| (viewerHash && member.pubKeyHash === viewerHash ? store.viewer.viewerEntityHash : '')
			|| ''
		const label = entityHash
			? resolveDisplayName({
				entityHash,
				alias: aliasForEntity(entityHash),
				profileName: member.displayName,
				fallbackLabel: isAgent ? member.charname : undefined,
			})
			: (member.displayName || '')
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
	 * @returns {Promise<DocumentFragment>} 离屏成员分组
	 */
	const appendMemberGroup = async (titleKey, list) => {
		const fragment = document.createDocumentFragment()
		if (!list.length) return fragment
		fragment.appendChild(await renderTemplate('hub/nav/member_group', {
			titleKey,
			count: String(list.length),
		}))
		const listHost = fragment.querySelector('.member-group-list')
		const items = await Promise.all(list.map(async member => {
			const row = rowsByMember.get(member)
			const { memberKey, isAgent, entityHash, displayName } = row
			const isAdmin = memberDisplaysAsAdmin(member, roleDefs)
			const ownerAttr = isAgent && member.ownerEntityHash
				? ` data-owner-entity-hash="${escapeHtml(member.ownerEntityHash)}"`
				: ''
			const avatarSeed = entityHash || memberKey || (isAgent ? member.charname : '') || displayName
			return renderTemplate('hub/nav/member_item', {
				adminClass: isAdmin ? ' is-admin' : '',
				charClass: isAgent ? ' member-item-char' : '',
				charIdAttr: '',
				memberKindAttr: ` data-member-kind="${isAgent ? 'agent' : 'user'}"${ownerAttr}`,
				username: escapeHtml(displayName),
				avatarFor: escapeHtml(entityHash),
				memberKey: escapeHtml(memberKey),
				entityHash: escapeHtml(entityHash),
				avatarColor: avatarColor(avatarSeed),
				avatarTextColor: avatarTextColor(avatarSeed),
				avatarInitial: escapeHtml(avatarInitial(displayName)),
			})
		}))
		listHost.append(...items)
		return fragment
	}
	const groups = await Promise.all([
		appendMemberGroup('chat.hub.adminSection', admins),
		appendMemberGroup('chat.hub.member.section', others),
	])
	if (!current()) return
	container.replaceChildren(...groups)
	container.querySelectorAll('.member-item').forEach(el => {
		el.addEventListener('contextmenu', (event) => {
			void showMemberContextMenu(event, el)
		})
	})
	applyAvatarsTo(container)
	refreshMemberDigestBar(state, current).catch(handleError('chat.hub.operationFailed'))
}
