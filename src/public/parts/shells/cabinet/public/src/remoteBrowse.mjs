/**
 * 远端柜浏览：实体条、人物卡入口。
 */
import { renderTemplate } from '/scripts/features/template.mjs'
import { escapeHtml } from '/scripts/lib/escapeHtml.mjs'
import { formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'

import { cabinetStore } from './state.mjs'

/**
 * 打开统一人物卡（Chat Hub 同源弹层）。
 * @param {string} entityHash 128 hex
 * @returns {Promise<void>}
 */
export async function openEntityProfileCard(entityHash) {
	const hash = String(entityHash || '').trim().toLowerCase()
	if (!/^[0-9a-f]{128}$/i.test(hash)) return
	const { showEntityProfilePopup } = await import('/parts/shells:chat/shared/entityProfilePopup.mjs')
	await showEntityProfilePopup({
		entityHash: hash,
		displayName: formatHashShort(hash, { headLen: 8, tailLen: 4 }),
	})
}

/**
 * 渲染远端实体浏览条。
 * @returns {Promise<void>}
 */
export async function renderRemoteEntityBar() {
	const { remoteEntityHash } = cabinetStore
	const bar = document.getElementById('cabinetRemoteEntityBar')
	if (!remoteEntityHash) {
		bar?.remove()
		return
	}
	const short = formatHashShort(remoteEntityHash, { headLen: 8, tailLen: 4 })
	const host = document.getElementById('breadcrumb')?.parentElement || document.body
	const next = await renderTemplate('remote_entity_bar', { short: escapeHtml(short) })
	next.querySelector('[data-remote-entity-open]')?.addEventListener('click', () => {
		void openEntityProfileCard(remoteEntityHash)
	})
	if (bar) bar.replaceWith(next)
	else host.prepend(next)
}
