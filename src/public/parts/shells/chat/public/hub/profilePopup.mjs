/**
 * 【文件】public/hub/profilePopup.mjs
 * 【职责】点击头像/作者链接触发的轻量资料弹层：解析锚点实体并展示只读资料摘要。
 * 【原理】`showProfilePopup` / `dismissProfilePopup` 管理单例 popup DOM 定位与关闭；从消息行 `data-author` 等属性解析实体；不修改频道列表 HTML 结构。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/template、../../../../scripts/toast、shared/entityHash、fount-p2p/core/hexIds、core/state、entityProfile、entityResolve、friendChat。
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import {
	renderTemplate,
	usingTemplates,
} from '../../../../scripts/features/template.mjs'
import { aliasForEntity } from '../shared/aliases.mjs'
import { entityHashLabel, isEntityHash128 } from '../shared/entityHash.mjs'
import {
	dismissProfilePopupLayer,
	openProfilePopupLayer,
} from '../shared/entityProfilePopup.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'

import { store } from './core/state.mjs'
import {
	loadEntityProfile,
	paintEntityProfileUi,
	wireEntityProfileCardActions,
} from './entityProfile.mjs'
import { charAgentEntityHash } from './entityResolve.mjs'
import { hideHoverCard } from './presence.mjs'

const LAYER_ID = 'profile-popup-layer'

/** @returns {void} */
export function dismissProfilePopup() {
	dismissProfilePopupLayer(LAYER_ID)
}

/**
 * @param {object} member 群成员行
 * @returns {object} 统一实体描述
 */
function userEntityFromMember(member) {
	const entityHash = String(member?.entityHash || '').trim().toLowerCase()
	const pubKeyHash = String(member?.pubKeyHash || '').trim().toLowerCase()
	const displayName = aliasForEntity(entityHash)
		|| String(member?.displayName || '').trim()
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
	if (!charname) return null
	const entityHash = await charAgentEntityHash(charname)
	if (!entityHash) return null
	return {
		entityHash,
		charname,
		pubKeyHash: null,
		pubKeyHex: null,
		displayName: String(label || '').trim() || charname,
	}
}

/**
 * @param {HTMLElement} anchor 点击锚点
 * @returns {object | null} 实体描述（含 `entityHash`）
 */
export async function resolveEntityFromAnchor(anchor) {
	if (!(anchor instanceof HTMLElement)) return null

	const charRow = anchor.closest('.list-item-char')
	if (charRow?.dataset.char)
		return charEntityFromName(charRow.dataset.char, charRow.dataset.char)

	const messageRow = anchor.closest('.message[data-message-id]')
	const charId = messageRow?.dataset.charId
	if (charId)
		return charEntityFromName(charId, charId)

	const memberItem = anchor.closest('.member-item')
	const memberCharId = memberItem?.dataset.charId
	if (memberCharId) {
		const label = memberItem?.querySelector('.member-name')?.textContent?.trim()
		return charEntityFromName(memberCharId, label || memberCharId)
	}
	const memberKey = memberItem?.dataset.memberKey?.trim()
	const avatarFor = anchor.dataset.avatarFor
		|| anchor.closest('[data-avatar-for]')?.dataset.avatarFor
		|| memberItem?.querySelector('[data-avatar-for]')?.dataset.avatarFor
	const authorHash = messageRow?.dataset.authorPubkeyHash?.trim()
	const displayKey = String(avatarFor || memberKey || authorHash || '').trim().toLowerCase()
	if (!displayKey || displayKey === '?') return null

	const members = store.context.currentState?.members || []
	const memberRow = members.find(m =>
		m.entityHash === displayKey
		|| m.memberKey === displayKey
		|| m.pubKeyHash === displayKey
		|| m.pubKeyHash === memberKey
		|| m.pubKeyHash === authorHash,
	)

	if (memberRow?.charname)
		return charEntityFromName(memberRow.charname, memberRow.displayName || memberRow.charname)
	if (memberRow) return userEntityFromMember(memberRow)
	if (isEntityHash128(displayKey)) {
		const bound = store.sidebar.groups.find(g => g.friendBinding?.entityHash === displayKey)?.friendBinding
		if (bound?.charname)
			return await charEntityFromName(bound.charname, bound.displayName || bound.charname)
		return {
			entityHash: displayKey,
			charname: null,
			pubKeyHash: null,
			pubKeyHex: null,
			displayName: resolveDisplayName({ entityHash: displayKey, alias: aliasForEntity(displayKey) }),
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
	const groupId = store.context.currentGroupId || undefined
	const profile = entityHash
		? await loadEntityProfile(entityHash, { bypassCache: true, groupId })
		: null

	if (profile)
		await paintEntityProfileUi(popup, profile, { attribution: entity.attribution || null })
	else {
		const nameElement = popup.querySelector('[data-entity-profile-name]')
		if (nameElement) nameElement.textContent = entity.displayName || '?'
		const { paintEntityProfileExtras } = await import('../shared/entityProfileCard.mjs')
		paintEntityProfileExtras(popup, { attribution: entity.attribution || null })
	}

	await wireEntityProfileCardActions(popup, entity, {
		profile,
		onBeforeDm: dismissProfilePopup,
		/** 资料卡重绘后刷新 popup。 */
		onRepaint: async () => {
			await paintProfilePopup(popup, entity)
		},
	})
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

	const popup = await renderTemplate('hub/profile_popup', {})
	openProfilePopupLayer(LAYER_ID, popup)

	popup.querySelector('[data-profile-popup-close]')?.addEventListener('click', () => dismissProfilePopup())

	// 远端 EVFS 可能要等超时：先用入参 stub 填名字/字母头像，避免空壳卡死感
	const stubName = String(entity.displayName || '').trim() || entityHashLabel(entity.entityHash) || '?'
	if (entity.entityHash) popup.dataset.entityHash = entity.entityHash
	const nameElement = popup.querySelector('[data-entity-profile-name]')
	if (nameElement) nameElement.textContent = stubName
	const avatarElement = popup.querySelector('[data-entity-profile-avatar]')
	if (avatarElement instanceof HTMLElement) {
		const { applyProfileAvatarToHost } = await import('./core/avatarCover.mjs')
		await applyProfileAvatarToHost(avatarElement, {
			seed: entity.entityHash || stubName,
			label: stubName,
			avatar: null,
			emojiFontSize: '30px',
			letterClass: 'avatar-letter',
		})
	}

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
