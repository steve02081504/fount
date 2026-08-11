/**
 * 可恢复删除 / 创建 / 补丁 的撤销历史工厂。
 */
import { handleError } from '/scripts/features/errorHandlers.mjs'

import { deleteEntries, finalizeDelete, patchEntry, restoreEntries } from './endpoints.mjs'
import { currentUnlockToken } from './state.mjs'

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
	try {
		await finalizeDelete(recoveryToken, { cabinetId })
	}
	catch (error) {
		handleError('cabinet.bootstrapFailed', {}, error)
	}
}

/**
 * @param {string} cabinetId 柜
 * @param {string[]} entryIds ids
 * @param {string} [unlock] unlock
 * @returns {Promise<{ deleted: string[], recovery_token?: string }>} 删除结果
 */
export async function recoverableDelete(cabinetId, entryIds, unlock) {
	return deleteEntries(entryIds, { cabinetId, unlock })
}

/**
 * @param {string} cabinetId 柜
 * @param {string} recoveryToken token
 * @param {string} [unlock] unlock
 * @returns {Promise<void>}
 */
export async function restoreRecovery(cabinetId, recoveryToken, unlock) {
	await restoreEntries(recoveryToken, { cabinetId, unlock })
}

/**
 * @param {{ label: string, cabinetId: string, ids: string[], token?: string, create?: boolean, unlock?: string }} opts 选项
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
function makeRecoveryHistory({ label, cabinetId, ids, token, create, unlock }) {
	let recoveryToken = token
	return {
		label,
		/** 撤销：切换删除/还原并刷新列表。 */
		async undo() {
			if (create) recoveryToken = (await recoverableDelete(cabinetId, ids, unlock)).recovery_token
			else if (recoveryToken) {
				await restoreRecovery(cabinetId, recoveryToken, unlock)
				recoveryToken = undefined
			}
			await refreshEntries()
		},
		/** 重做：切换删除/还原并刷新列表。 */
		async redo() {
			if (create) {
				if (!recoveryToken) return
				await restoreRecovery(cabinetId, recoveryToken, unlock)
				recoveryToken = undefined
			}
			else recoveryToken = (await recoverableDelete(cabinetId, ids, unlock)).recovery_token
			await refreshEntries()
		},
		/** 放弃撤销链时永久删除恢复令牌。 */
		async discard() {
			if (recoveryToken) await finalizeRecovery(cabinetId, recoveryToken)
			recoveryToken = undefined
		},
	}
}

/**
 * @param {string[]} createdIds 新建 id
 * @param {string} label 标签
 * @param {string} cabinetId 柜
 * @param {string} [unlock] 创建时的 unlock token
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
export function makeCreateHistory(createdIds, label, cabinetId, unlock = currentUnlockToken()) {
	return makeRecoveryHistory({ label, cabinetId, ids: createdIds, create: true, unlock })
}

/**
 * @param {string[]} ids 条目
 * @param {string} [initialToken] 首次删除 token
 * @param {string} cabinetId 柜
 * @param {string} [unlock] 删除时的 unlock token
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
export function makeDeleteHistory(ids, initialToken, cabinetId, unlock = currentUnlockToken()) {
	return makeRecoveryHistory({ label: 'delete', cabinetId, ids, token: initialToken, unlock })
}

/**
 * @param {{ entryId: string, before: object, after: object, label?: string, cabinetId: string, unlock?: string }} opts 选项
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
export function makePatchHistory({ entryId, before, after, label = 'patch', cabinetId, unlock = currentUnlockToken() }) {
	return {
		label,
		/** 撤销 PATCH：写回修改前快照。 */
		async undo() {
			await patchEntry(entryId, before, { cabinetId, unlock: unlock })
			await refreshEntries()
		},
		/** 重做 PATCH：应用修改后快照。 */
		async redo() {
			await patchEntry(entryId, after, { cabinetId, unlock: unlock })
			await refreshEntries()
		},
	}
}

/**
 * @param {{ entryIds: string[], fromParent: string | null, toParent: string | null, label?: string, cabinetId: string, unlock?: string }} opts 选项
 * @returns {import('./commandHistory.mjs').HistoryEntry} 历史
 */
export function makeMoveHistory({ entryIds, fromParent, toParent, label = 'cut', cabinetId, unlock = currentUnlockToken() }) {
	/**
	 * @param {string | null} parentId 父
	 * @returns {Promise<void>}
	 */
	async function moveAll(parentId) {
		for (const entryId of entryIds)
			await patchEntry(entryId, { parent_id: parentId }, { cabinetId, unlock: unlock })
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
