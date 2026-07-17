/**
 * 【文件】public/shared/entityProfilePopup.mjs
 * 【职责】跨壳轻量人物卡弹层：仅依赖 entityHash + profile API，不依赖 Hub store。
 * 【原理】Chat Hub / Cabinet / Social 均可调用；Hub 专属按钮（DM/care）仍走 hub/profilePopup。
 */
import { renderTemplate, usingTemplates } from '../../../../scripts/features/template.mjs'
import { formatSocialProfileHref } from '/parts/shells:social/shared/runUri.mjs'
import { fetchEntityProfileApi, cachedProfileFromApi } from '../src/entityProfileApi.mjs'

import { aliasForEntity } from './aliases.mjs'
import { isEntityHash128 } from './entityHash.mjs'
import {
	ensureEntityProfileCardStyles,
	paintEntityProfileCard,
	paintEntityProfileExtras,
} from './entityProfileCard.mjs'

const LAYER_ID = 'shared-entity-profile-popup-layer'

/**
 * @returns {void}
 */
export function dismissEntityProfilePopup() {
	document.getElementById(LAYER_ID)?.remove()
}

/**
 * @param {HTMLElement} popup 弹层
 * @param {object} entity 实体
 * @returns {Promise<void>}
 */
async function paintSharedPopup(popup, entity) {
	const entityHash = entity.entityHash
	const data = entityHash ? await fetchEntityProfileApi(entityHash).catch(() => null) : null
	const profile = data?.profile ? cachedProfileFromApi(data.profile, entityHash) : null
	const name = aliasForEntity(entityHash) || profile?.name || entity.displayName || '?'
	await paintEntityProfileCard(popup, profile || { name }, {
		entityHash,
		nameOverride: name,
	})

	let ownerName = null
	const ownerEntityHash = profile?.ownerEntityHash || null
	if (isEntityHash128(ownerEntityHash)) {
		ownerName = aliasForEntity(ownerEntityHash)
		if (!ownerName)
			try {
				const ownerData = await fetchEntityProfileApi(ownerEntityHash)
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
	ensureEntityProfileCardStyles()
	usingTemplates('/parts/shells:chat/src/templates')

	const layer = document.createElement('div')
	layer.id = LAYER_ID
	layer.className = 'hub-profile-popup-backdrop show'
	layer.addEventListener('click', event => {
		if (event.target === layer) dismissEntityProfilePopup()
	})

	const popup = await renderTemplate('hub/profile_popup', {})
	layer.appendChild(popup)
	document.body.appendChild(layer)

	popup.querySelector('[data-profile-popup-close]')?.addEventListener('click', () => dismissEntityProfilePopup())
	popup.querySelector('[data-profile-popup-social]')?.addEventListener('click', () => {
		if (!isEntityHash128(entity.entityHash)) return
		window.location.href = formatSocialProfileHref(entity.entityHash)
	})

	await paintSharedPopup(popup, entity)
}
