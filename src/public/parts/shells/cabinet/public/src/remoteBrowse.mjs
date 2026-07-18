/**
 * 远端柜浏览：索引过滤、面包屑 trail、实体条、人物卡入口。
 */
import { renderTemplate } from '/scripts/features/template.mjs'
import { formatHashShort } from '/parts/shells:chat/shared/entityHash.mjs'

import { escapeHtml } from './escape.mjs'
import { cabinetStore } from './state.mjs'

/**
 * 远端索引本地过滤子目录（服务端返回整柜）。
 * @param {object[]} all 全部条目
 * @param {string | null} parentId 父
 * @param {boolean} showHidden 显示隐藏
 * @returns {object[]} 子条目
 */
export function filterRemoteChildren(all, parentId, showHidden) {
	const parent = parentId == null || parentId === '' ? null : String(parentId)
	return all
		.filter(entry => (entry.parent_id ?? null) === parent)
		.filter(entry => showHidden || !entry.attrs?.hidden)
		.sort((a, b) => {
			if (a.kind === 'folder' && b.kind !== 'folder') return -1
			if (a.kind !== 'folder' && b.kind === 'folder') return 1
			return String(a.name).localeCompare(String(b.name))
		})
}

/**
 * @param {object[]} all 全部条目
 * @param {string | null} folderId 当前文件夹
 * @returns {{ id: string, name: string }[]} trail
 */
export function buildRemoteTrail(all, folderId) {
	const byId = new Map(all.map(entry => [entry.id, entry]))
	const trail = []
	let cur = folderId
	const seen = new Set()
	while (cur && !seen.has(cur)) {
		seen.add(cur)
		const entry = byId.get(cur)
		if (!entry) break
		trail.unshift({ id: entry.id, name: entry.name })
		cur = entry.parent_id
	}
	return trail
}

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
