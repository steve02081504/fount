/**
 * 可恢复删除 / 创建 / 补丁 的撤销历史工厂。
 */
import { cabinetApi } from './api.mjs'

/** @returns {Promise<void>} */
async function refreshEntries() {
	const { refreshEntries: refresh } = await import('./navigation.mjs')
	await refresh()
}

/**
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @returns {Promise<void>}
 */
export async function finalizeRecovery(cabinetId, recoveryToken) {
	if (!recoveryToken) return
	await cabinetApi('POST', '/entries/finalize-delete', { recovery_token: recoveryToken }, {
		cabinetId, unlock: undefined,
	}).catch(() => { })
}

/**
 * @param {string} cabinetId 柜
 * @param {string[]} entryIds ids
 * @param {string} [unlock] unlock
 * @returns {Promise<{ deleted: string[], recovery_token?: string }>} 删除结果
 */
export async function recoverableDelete(cabinetId, entryIds, unlock) {
	return cabinetApi('DELETE', '/entries', { entry_ids: entryIds, recoverable: true }, { cabinetId, unlock })
}

/**
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @param {string} [unlock] unlock
 * @returns {Promise<void>}
 */
export async function restoreRecovery(cabinetId, recoveryToken, unlock) {
	await cabinetApi('POST', '/entries/restore', { recovery_token: recoveryToken }, { cabinetId, unlock })
}

/**
 * @param {{ label: string, cabinetId: string, ids: string[], token?: string, create?: boolean }} opts 选项
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
function makeRecoveryHistory({ label, cabinetId, ids, token, create }) {
	let recoveryToken = token
	/* eslint-disable jsdoc/require-jsdoc -- history callbacks */
	return {
		label,
		async undo() {
			if (create) recoveryToken = (await recoverableDelete(cabinetId, ids)).recovery_token
			else if (recoveryToken) {
				await restoreRecovery(cabinetId, recoveryToken)
				recoveryToken = undefined
			}
			await refreshEntries()
		},
		async redo() {
			if (create) {
				if (!recoveryToken) return
				await restoreRecovery(cabinetId, recoveryToken)
				recoveryToken = undefined
			}
			else recoveryToken = (await recoverableDelete(cabinetId, ids)).recovery_token
			await refreshEntries()
		},
		async discard() {
			if (recoveryToken) await finalizeRecovery(cabinetId, recoveryToken)
			recoveryToken = undefined
		},
	}
	/* eslint-enable jsdoc/require-jsdoc */
}

/**
 * @param {string[]} createdIds 新建 id
 * @param {string} label 标签
 * @param {string} cabinetId 柜
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
export function makeCreateHistory(createdIds, label, cabinetId) {
	return makeRecoveryHistory({ label, cabinetId, ids: createdIds, create: true })
}

/**
 * @param {string[]} ids 条目
 * @param {string} [initialToken] 首次删除 token
 * @param {string} cabinetId 柜
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
export function makeDeleteHistory(ids, initialToken, cabinetId) {
	return makeRecoveryHistory({ label: 'delete', cabinetId, ids, token: initialToken })
}

/**
 * @param {{ entryId: string, before: object, after: object, label?: string, cabinetId: string }} opts 选项
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
export function makePatchHistory({ entryId, before, after, label = 'patch', cabinetId }) {
	const path = `/entries/${encodeURIComponent(entryId)}`
	/* eslint-disable jsdoc/require-jsdoc -- history callbacks */
	return {
		label,
		async undo() {
			await cabinetApi('PATCH', path, before, { cabinetId })
			await refreshEntries()
		},
		async redo() {
			await cabinetApi('PATCH', path, after, { cabinetId })
			await refreshEntries()
		},
	}
	/* eslint-enable jsdoc/require-jsdoc */
}

/**
 * @param {{ entryIds: string[], fromParent: string | null, toParent: string | null, label?: string, cabinetId: string }} opts 选项
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
export function makeMoveHistory({ entryIds, fromParent, toParent, label = 'cut', cabinetId }) {
	/**
	 * @param {string | null} parentId 父
	 * @returns {Promise<void>}
	 */
	async function moveAll(parentId) {
		for (const entryId of entryIds)
			await cabinetApi('PATCH', `/entries/${encodeURIComponent(entryId)}`, { parent_id: parentId }, { cabinetId })
		await refreshEntries()
	}
	return {
		label,
		/**
		 * @returns {Promise<void>}
		 */
		undo: () => moveAll(fromParent),
		/**
		 * @returns {Promise<void>}
		 */
		redo: () => moveAll(toParent),
	}
}
