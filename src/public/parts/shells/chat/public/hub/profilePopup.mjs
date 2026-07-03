/**
 * 【文件】public/hub/profilePopup.mjs
 * 【职责】点击头像/作者链接触发的轻量资料弹层：解析锚点实体并展示只读资料摘要。
 * 【原理】`showProfilePopup` / `dismissProfilePopup` 管理单例 popup DOM 定位与关闭；从消息行 `data-author` 等属性解析实体；不修改频道列表 HTML 结构。
 * 【数据结构】hubStore（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/template、../../../../scripts/toast、../src/lib/entityHash、../src/lib/pubKeyHex、core/state、entityProfile、entityResolve、friendChat。
 */
import {
	renderTemplate,
	usingTemplates,
} from '../../../../scripts/features/template.mjs'
import { showToastI18n } from '../../../../scripts/features/toast.mjs'
import { entityHashLabel, isEntityHash128 } from '../shared/entityHash.mjs'
import { isHex64 } from '../shared/pubKeyHex.mjs'

import { hubStore } from './core/state.mjs'
import {
	loadEntityProfile,
	paintEntityProfileUi,
	wireProfileEditButton,
} from './entityProfile.mjs'
import { charAgentEntityHash, isViewerEntityHash } from './entityResolve.mjs'
import { dispatchFriendChat } from './friendChat.mjs'
import { hideHoverCard } from './presence.mjs'

const LAYER_ID = 'hub-profile-popup-layer'

/** @returns {void} */
export function dismissProfilePopup() {
	document.getElementById(LAYER_ID)?.remove()
}

/**
 * @param {object} member 群成员行
 * @returns {object} 统一实体描述
 */
function userEntityFromMember(member) {
	const entityHash = String(member?.entityHash || '').trim().toLowerCase()
	const pubKeyHash = String(member?.pubKeyHash || '').trim().toLowerCase()
	const displayName = String(member?.displayName || '').trim()
		|| (entityHash ? entityHashLabel(entityHash) : '')
		|| (pubKeyHash ? `${pubKeyHash.slice(0, 8)}…${pubKeyHash.slice(-4)}` : '?')
	return {
		entityHash: isEntityHash128(entityHash) ? entityHash : null,
		charname: null,
		pubKeyHash: isHex64(pubKeyHash) ? pubKeyHash : null,
		pubKeyHex: member?.pubKeyHex || null,
		displayName,
	}
}

/**
 * @param {string} charname 角色 part 名
 * @param {string} [label] 展示名
 * @returns {object | null} 实体描述
 */
async function charEntityFromName(charname, label) {
	const name = String(charname || '').trim()
	if (!name) return null
	const entityHash = await charAgentEntityHash(name)
	if (!entityHash) return null
	return {
		entityHash,
		charname: name,
		pubKeyHash: null,
		pubKeyHex: null,
		displayName: String(label || '').trim() || name,
	}
}

/**
 * @param {HTMLElement} anchor 点击锚点
 * @returns {object | null} 实体描述（含 `entityHash`）
 */
export async function resolveEntityFromAnchor(anchor) {
	if (!(anchor instanceof HTMLElement)) return null

	const charRow = anchor.closest('.hub-list-item-char')
	if (charRow?.dataset.char)
		return charEntityFromName(charRow.dataset.char, charRow.dataset.char)

	const messageRow = anchor.closest('.hub-message[data-message-id]')
	const charId = messageRow?.dataset.charId?.trim()
	if (charId)
		return charEntityFromName(charId, charId)

	const memberItem = anchor.closest('.hub-member-item')
	const memberCharId = memberItem?.dataset.charId?.trim()
	if (memberCharId) {
		const label = memberItem?.querySelector('.hub-member-name')?.textContent?.trim()
		return charEntityFromName(memberCharId, label || memberCharId)
	}
	const memberKey = memberItem?.dataset.memberKey?.trim()
	const avatarFor = anchor.dataset.avatarFor
		|| anchor.closest('[data-avatar-for]')?.dataset.avatarFor
		|| memberItem?.querySelector('[data-avatar-for]')?.dataset.avatarFor
	const authorHash = messageRow?.dataset.authorPubkeyHash?.trim()
	const displayKey = String(avatarFor || memberKey || authorHash || '').trim().toLowerCase()
	if (!displayKey || displayKey === '?') return null

	const members = hubStore.context.currentState?.members || []
	const memberRow = members.find(m =>
		m.entityHash === displayKey
		|| m.memberKey === displayKey
		|| m.agentEntityHash === displayKey
		|| m.pubKeyHash === displayKey
		|| m.pubKeyHash === memberKey
		|| m.pubKeyHash === authorHash,
	)

	if (memberRow?.charname)
		return charEntityFromName(memberRow.charname, memberRow.displayName || memberRow.charname)
	if (memberRow) return userEntityFromMember(memberRow)
	if (isEntityHash128(displayKey)) {
		const bound = hubStore.sidebar.groups.find(g => g.friendBinding?.entityHash === displayKey)?.friendBinding
		if (bound?.charname)
			return await charEntityFromName(bound.charname, bound.displayName || bound.charname)
		return {
			entityHash: displayKey,
			charname: null,
			pubKeyHash: null,
			pubKeyHex: null,
			displayName: entityHashLabel(displayKey),
		}
	}
	if (isHex64(displayKey))
		return {
			entityHash: null,
			charname: null,
			pubKeyHash: displayKey,
			pubKeyHex: null,
			displayName: `${displayKey.slice(0, 8)}…${displayKey.slice(-4)}`,
		}
	return null
}

/**
 * @param {HTMLElement} popup 弹层根节点
 * @param {object} entity 实体
 * @returns {Promise<void>}
 */
async function paintProfilePopup(popup, entity) {
	const { entityHash } = entity
	const groupId = hubStore.context.currentGroupId || undefined
	const profile = entityHash
		? await loadEntityProfile(entityHash, { bypassCache: true, groupId })
		: null

	if (profile)
		await paintEntityProfileUi(popup, profile)
	else {
		const nameEl = popup.querySelector('[data-entity-profile-name]')
		if (nameEl) nameEl.textContent = entity.displayName || '?'
	}

	const tagEl = popup.querySelector('[data-profile-popup-entity-tag]')
	if (tagEl)
		if (isViewerEntityHash(entityHash))
			tagEl.dataset.i18n = 'chat.hub.profilePopup.tagLocal'
		else if (entity.charname)
			tagEl.dataset.i18n = 'chat.hub.profilePopup.tagChar'
		else
			tagEl.dataset.i18n = 'chat.hub.profilePopup.tagFed'


	const editBtn = popup.querySelector('[data-profile-popup-edit]')
	const dmBtn = popup.querySelector('[data-profile-popup-dm]')
	const socialBtn = popup.querySelector('[data-profile-popup-social]')

	if (editBtn instanceof HTMLButtonElement && entityHash)
		wireProfileEditButton(popup, entityHash, {
			/**
			 * 资料保存后刷新弹窗与侧栏角色卡。
			 * @returns {Promise<void>}
			 */
			onSaved: async () => {
				await paintProfilePopup(popup, entity)
				if (entity.charname) {
					const { renderCharInfoCardActive, getCharDetails } = await import('./charCard.mjs')
					await renderCharInfoCardActive(entity.charname, await getCharDetails(entity.charname))
				}
				if (isViewerEntityHash(entityHash))
					void import('./init.mjs').then(({ refreshViewerHubPresentation }) => refreshViewerHubPresentation())
			},
		})

	if (dmBtn instanceof HTMLButtonElement) {
		const isSelf = isViewerEntityHash(entityHash)
		const canDm = !isSelf && (entity.charname || isHex64(entity.pubKeyHex))
		dmBtn.hidden = !canDm
		dmBtn.dataset.i18n = entity.charname
			? 'chat.hub.profilePopup.dmChar'
			: 'chat.hub.profilePopup.dmFed'
	}

	if (socialBtn instanceof HTMLButtonElement)
		socialBtn.hidden = !isEntityHash128(entityHash)

}

/**
 * 在屏幕中央展示资料卡（点击触发，带遮罩与关闭按钮）。
 * @param {object} entity 实体（含 `entityHash`）
 * @returns {Promise<void>}
 */
export async function showProfilePopup(entity) {
	if (!entity?.entityHash && !entity?.displayName) return
	dismissProfilePopup()
	hideHoverCard()
	usingTemplates('/parts/shells:chat/src/templates')

	const layer = document.createElement('div')
	layer.id = LAYER_ID
	layer.className = 'hub-profile-popup-backdrop show'
	layer.addEventListener('click', (event) => {
		if (event.target === layer) dismissProfilePopup()
	})

	const popup = await renderTemplate('hub/profile_popup', {})
	layer.appendChild(popup)
	document.body.appendChild(layer)

	popup.querySelector('[data-profile-popup-close]')?.addEventListener('click', () => dismissProfilePopup())

	popup.querySelector('[data-profile-popup-dm]')?.addEventListener('click', () => {
		dismissProfilePopup()
		const dmEntity = entity.charname
			? { type: 'char', id: entity.charname, displayName: entity.displayName, entityHash: entity.entityHash }
			: { type: 'user', displayName: entity.displayName, pubKeyHex: entity.pubKeyHex, entityHash: entity.entityHash }
		void dispatchFriendChat(dmEntity).catch(error => {
			showToastI18n('error', 'chat.hub.profilePopup.dmFailed', { error: error.message })
		})
	})

	popup.querySelector('[data-profile-popup-social]')?.addEventListener('click', () => {
		if (!isEntityHash128(entity.entityHash)) return
		window.location.href = `/parts/shells:social/#profile;${entity.entityHash}`
	})

	await paintProfilePopup(popup, entity)
}

/**
 * 注册资料弹层 Esc 关闭（由 wireEvents 显式调用）。
 * @returns {void}
 */
export function wireProfilePopupDismiss() {
	document.addEventListener('keydown', (event) => {
		if (event.key === 'Escape') dismissProfilePopup()
	})
}
