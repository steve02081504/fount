/**
 * 【文件】public/hub/profilePopup.mjs
 * 【职责】点击头像/作者链接触发的轻量资料弹层：解析锚点实体并展示只读资料摘要。
 * 【原理】`showProfilePopup` / `dismissProfilePopup` 管理单例 popup DOM 定位与关闭；优先 `data-entity-hash`，再回退 avatarFor / memberKey；不修改频道列表 HTML 结构。
 * 【数据结构】store（core/state）及本模块函数入参/返回值；详见 JSDoc。
 * 【关联】../../../../scripts/template、shared/entityHash、shared/memberByEntityHash、fount-p2p/core/hexIds、core/state、entityProfile、entityResolve。
 */
import { isHex64 } from 'https://esm.sh/@steve02081504/fount-p2p/core/hexIds'

import { aliasForEntity } from '../shared/aliases.mjs'
import { entityHashLabel, isEntityHash128 } from '../shared/entityHash.mjs'
import {
	dismissProfilePopupLayer,
	openProfilePopupLayer,
} from '../shared/entityProfilePopup.mjs'
import { findMemberByEntityHash } from '../shared/memberByEntityHash.mjs'
import { resolveDisplayName } from '../shared/nameResolve.mjs'
import { renderTemplate } from '../src/templates.mjs'

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
	const entityHash = member?.entityHash || ''
	const pubKeyHash = member?.pubKeyHash || ''
	const displayName = aliasForEntity(entityHash)
		|| String(member?.displayName || '').trim()
		|| (entityHash ? entityHashLabel(entityHash) : '')
		|| (pubKeyHash ? `${pubKeyHash.slice(0, 8)}…${pubKeyHash.slice(-4)}` : '?')
	return {
		entityHash: isEntityHash128(entityHash) ? entityHash : null,
		charname: null,
		pubKeyHash: isHex64(pubKeyHash),
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
		displayName: (label || '').trim() || charname,
	}
}

/**
 * 已知 entityHash 时解析成员行 / 好友绑定 / stub。
 * @param {string} entityHash 实体哈希
 * @param {object[]} members 群成员
 * @returns {Promise<object | null>} 实体描述
 */
async function entityFromEntityHash(entityHash, members) {
	const memberRow = findMemberByEntityHash(members, entityHash)
	if (memberRow?.charname)
		return charEntityFromName(memberRow.charname, memberRow.displayName || memberRow.charname)
	if (memberRow) return userEntityFromMember(memberRow)
	if (!isEntityHash128(entityHash)) return null
	const bound = store.sidebar.groups.find(group => group.friendBinding?.entityHash === entityHash)?.friendBinding
	if (bound?.charname)
		return charEntityFromName(bound.charname, bound.displayName || bound.charname)
	return {
		entityHash,
		charname: null,
		pubKeyHash: null,
		pubKeyHex: null,
		displayName: resolveDisplayName({ entityHash, alias: aliasForEntity(entityHash) }),
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

	const members = store.context.currentState?.members || []
	const entityHash = anchor.closest('[data-entity-hash]')?.dataset.entityHash?.trim()
	if (entityHash)
		return entityFromEntityHash(entityHash, members)

	// 无 data-entity-hash 的遗留锚点：仅用展示键做 entityHash / pubKeyHash 直通，不再跨字段猜成员
	const memberKey = memberItem?.dataset.memberKey?.trim()
	const avatarFor = anchor.dataset.avatarFor
		|| anchor.closest('[data-avatar-for]')?.dataset.avatarFor
		|| memberItem?.querySelector('[data-avatar-for]')?.dataset.avatarFor
	const authorHash = messageRow?.dataset.authorPubkeyHash?.trim()
	const displayKey = avatarFor || memberKey || authorHash || ''
	if (!displayKey || displayKey === '?') return null

	if (isEntityHash128(displayKey))
		return entityFromEntityHash(displayKey, members)
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

	const popup = await renderTemplate('hub/profile_popup', {})
	openProfilePopupLayer(LAYER_ID, popup)

	popup.querySelector('[data-profile-popup-close]')?.addEventListener('click', () => dismissProfilePopup())

	// 远端 EVFS 可能要等超时：先用入参 stub 填名字/字母头像，避免空壳卡死感
	const stubName = (entity.displayName || '') || entityHashLabel(entity.entityHash) || '?'
	if (entity.entityHash) popup.dataset.entityHash = entity.entityHash
	const nameElement = popup.querySelector('[data-entity-profile-name]')
	if (nameElement) nameElement.textContent = stubName
	const avatarElement = popup.querySelector('[data-entity-profile-avatar]')
	if (avatarElement instanceof HTMLElement) {
		const { applyProfileAvatarToHost } = await import('./core/avatarCover.mjs')
		applyProfileAvatarToHost(avatarElement, {
			seed: entity.entityHash || stubName,
			label: stubName,
			avatar: null,
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
