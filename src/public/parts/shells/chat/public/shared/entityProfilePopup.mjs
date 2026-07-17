/**
 * 【文件】public/shared/entityProfilePopup.mjs
 * 【职责】跨壳轻量人物卡弹层：仅依赖 entityHash + profile API，不依赖 Hub store。
 * 【原理】Chat Hub / Cabinet / Social 均可调用；Hub 专属按钮（DM/care）仍走 hub/profilePopup。
 */
import { renderTemplate, usingTemplates } from '../../../../scripts/features/template.mjs'
import { formatSocialProfileHref } from '/parts/shells:social/shared/runUri.mjs'
import { applyProfileAvatarToHost } from '../hub/core/avatarCover.mjs'
import { avatarInitial } from '../hub/core/domUtils.mjs'
import { paintProfileTags, profileDescriptionText } from '../hub/entityProfile.mjs'
import { applyBioElement, applyStatusDot, formatStatusLabel } from '../hub/presence.mjs'
import { fetchEntityProfileApi, cachedProfileFromApi } from '../src/entityProfileApi.mjs'

import { aliasForEntity } from './aliases.mjs'
import { isEntityHash128 } from './entityHash.mjs'
import { paintEntityProfileExtras } from './entityProfileCard.mjs'

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
	const nameElement = popup.querySelector('[data-entity-profile-name]')
	if (nameElement) nameElement.textContent = name

	const avatarElement = popup.querySelector('[data-entity-profile-avatar]')
	if (avatarElement instanceof HTMLElement)
		await applyProfileAvatarToHost(avatarElement, {
			seed: entityHash || name,
			label: name,
			avatar: profile?.avatar,
			emojiFontSize: '28px',
			letterClass: 'hub-avatar-letter',
		})
	const letterElement = popup.querySelector('[data-entity-profile-letter]')
	if (letterElement instanceof HTMLElement) {
		letterElement.textContent = avatarInitial(name)
		letterElement.hidden = !!profile?.avatar
	}
	applyBioElement(popup.querySelector('[data-entity-profile-bio]'), profileDescriptionText(profile))
	paintProfileTags(popup.querySelector('[data-entity-profile-tags]'), profile?.tags)
	applyStatusDot(
		popup.querySelector('[data-entity-profile-status-dot]'),
		profile?.status || 'offline',
	)
	const statusText = popup.querySelector('[data-entity-profile-status-text]')
	if (statusText)
		statusText.textContent = await formatStatusLabel(profile?.status || 'offline', profile?.customStatus)

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
