/**
 * 【文件】public/shared/entityProfilePopup.mjs
 * 【职责】跨壳轻量人物卡弹层：仅依赖 entityHash + profile API，不依赖 Hub store。
 * 【原理】Chat Hub / Cabinet / Social 均可调用；Hub 专属按钮（DM/care）仍走 hub/profilePopup。
 * 模板经 `createEntityProfileCardElement`（chat bound templates）加载。
 */
import { formatSocialProfileHref } from '/parts/shells:social/shared/runUri.mjs'
import { cachedProfileFromApi, getEntityProfile } from '../src/endpoints/entities.mjs'

import { aliasForEntity } from './aliases.mjs'
import { isEntityHash128 } from './entityHash.mjs'
import {
	createEntityProfileCardElement,
	paintEntityProfileCard,
	paintEntityProfileExtras,
} from './entityProfileCard.mjs'

const LAYER_ID = 'shared-entity-profile-popup-layer'

/**
 * 创建并展示资料弹层（DaisyUI modal + modal-box）；同 ID 层先移除再挂。
 * @param {string} layerId dialog id
 * @param {HTMLElement} content 弹层内容（通常为人物卡）
 * @returns {HTMLDialogElement} 已 showModal 的 dialog
 */
export function openProfilePopupLayer(layerId, content) {
	document.getElementById(layerId)?.remove()
	const layer = document.createElement('dialog')
	layer.id = layerId
	layer.className = 'modal profile-popup-dialog'
	layer.addEventListener('click', event => { if (event.target === layer) layer.close() })
	layer.addEventListener('close', () => layer.remove())
	content.classList.add('modal-box')
	layer.appendChild(content)
	document.body.appendChild(layer)
	layer.showModal()
	return layer
}

/**
 * @param {string} layerId dialog id
 * @returns {void}
 */
export function dismissProfilePopupLayer(layerId) {
	document.getElementById(layerId)?.remove()
}

/**
 * @returns {void}
 */
export function dismissEntityProfilePopup() {
	dismissProfilePopupLayer(LAYER_ID)
}

/**
 * @param {HTMLElement} popup 弹层
 * @param {object} entity 实体
 * @returns {Promise<void>}
 */
async function paintSharedPopup(popup, entity) {
	const { entityHash } = entity
	const data = entityHash ? await getEntityProfile(entityHash).catch(() => null) : null
	const profile = data?.profile ? cachedProfileFromApi(data.profile, entityHash) : null
	const name = aliasForEntity(entityHash) || profile?.name || entity.displayName || '?'
	await paintEntityProfileCard(popup, profile || { name }, {
		entityHash,
		nameOverride: name,
		selfEntityHash: entity.selfEntityHash,
	})

	let ownerName = null
	const ownerEntityHash = profile?.ownerEntityHash || null
	if (isEntityHash128(ownerEntityHash)) {
		ownerName = aliasForEntity(ownerEntityHash)
		if (!ownerName)
			try {
				const ownerData = await getEntityProfile(ownerEntityHash)
				ownerName = ownerData?.profile?.name || null
			}
			catch { /* miss */ }
	}
	paintEntityProfileExtras(popup, {
		ownerEntityHash,
		ownerName,
		attribution: entity.attribution || null,
	})

	for (const sel of [
		'[data-profile-popup-edit]',
		'[data-profile-popup-care]',
		'[data-profile-popup-alias]',
		'[data-profile-popup-dm]',
		'[data-profile-popup-trust]',
	]) {
		const button = popup.querySelector(sel)
		if (button instanceof HTMLElement) button.hidden = true
	}
	const socialButton = popup.querySelector('[data-profile-popup-social]')
	if (socialButton instanceof HTMLButtonElement)
		socialButton.hidden = !isEntityHash128(entityHash)
}

/**
 * @param {object} entity `{ entityHash, displayName?, attribution? }`
 * @returns {Promise<void>}
 */
export async function showEntityProfilePopup(entity) {
	if (!entity?.entityHash && !entity?.displayName) return
	dismissEntityProfilePopup()

	const popup = await createEntityProfileCardElement('popup')
	openProfilePopupLayer(LAYER_ID, popup)

	popup.querySelector('[data-profile-popup-close]')?.addEventListener('click', () => dismissEntityProfilePopup())
	popup.querySelector('[data-profile-popup-social]')?.addEventListener('click', () => {
		if (!isEntityHash128(entity.entityHash)) return
		window.location.href = formatSocialProfileHref(entity.entityHash)
	})

	await paintSharedPopup(popup, entity)
}
