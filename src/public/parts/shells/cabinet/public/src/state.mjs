/**
 * Cabinet 页面共享可变状态（各子模块读写此对象字段）。
 */
import { createCommandHistory } from '../shared/commandHistory.mjs'
import { shortcutLabels } from '../shared/keyboard.mjs'

import { readClipboard, subscribeClipboard } from './clipboard.mjs'

/**
 *
 */
export const cabinetStore = {
	/** @type {object[]} */
	cabinets: [],
	/** @type {string | null} */
	currentCabinetId: null,
	/** @type {string | null} */
	currentParentId: null,
	/** @type {object[]} */
	entries: [],
	/** @type {{ id: string, name: string }[]} */
	folderTrail: [],
	/** @type {object | null} */
	currentCabinet: null,
	/** @type {string | null} 远端浏览中的实体（#user:） */
	remoteEntityHash: null,
	/** @type {Set<string>} */
	selected: new Set(),
	/** @type {string | null} */
	rangeAnchor: null,
	/** @type {Map<string, string>} folderId -> unlock token */
	unlockTokens: new Map(),
	/** @type {Array<{ cabinet_id: string, parent_id: string | null }>} */
	navStack: [],
	/** @type {ReturnType<typeof createCommandHistory>} */
	history: createCommandHistory(50),
	/** @type {{ mode: 'copy' | 'cut', cabinet_id: string, entry_ids: string[], source_parent_id: string | null, at: number } | null} */
	clipboard: readClipboard(),
}

const isMac = /Mac|iPhone|iPad/.test(navigator.platform || '')
/**
 *
 */
export const hotkeys = shortcutLabels(isMac)

subscribeClipboard(value => {
	cabinetStore.clipboard = value
})

/**
 * @returns {string | undefined} 当前解锁 token
 */
export function currentUnlockToken() {
	return cabinetStore.currentParentId
		? cabinetStore.unlockTokens.get(cabinetStore.currentParentId)
		: undefined
}

/**
 * @returns {boolean} 当前柜是否可写
 */
export function canWrite() {
	const { remoteEntityHash, currentCabinet } = cabinetStore
	if (remoteEntityHash) return false
	if (!currentCabinet) return false
	if (currentCabinet.type === 'shared') return Boolean(currentCabinet.can_write)
	if (currentCabinet.type === 'group') return Boolean(currentCabinet.permissions?.can_write)
	return true
}

/**
 * @returns {{ mode: 'copy' | 'cut', cabinet_id: string, entry_ids: string[], source_parent_id: string | null, at: number } | null} 剪贴板
 */
export function currentClipboard() {
	return cabinetStore.clipboard || readClipboard()
}

/**
 * @returns {boolean} 是否有可粘贴条目
 */
export function hasClipboard() {
	return Boolean(currentClipboard()?.entry_ids?.length)
}

/**
 * @returns {void}
 */
export function syncRemoteChrome() {
	document.body.classList.toggle('cabinet-remote', Boolean(cabinetStore.remoteEntityHash))
}
