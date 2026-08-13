/**
 * 群联邦同步水位：离线起始 UTC 月、末帧 tipsHash。
 */
import { compositeKey } from 'npm:@steve02081504/fount-p2p/core/composite_key'
import { writeJsonAtomicSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'
import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'

import { archiveMonthKey } from '../archive/settings.mjs'
import { safeReadJson } from '../lib/fsSafe.mjs'
import { groupSyncStatePath } from '../lib/paths.mjs'

const EMPTY_SYNC_STATE = {
	offlineStartUtcMonth: '',
	tipsHashAtLastSync: '',
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @returns {Promise<object>} syncState
 */
export async function loadGroupSyncState(username, groupId) {
	return await safeReadJson(groupSyncStatePath(username, groupId)) ?? { ...EMPTY_SYNC_STATE }
}

/**
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {object} patch 局部更新
 * @returns {Promise<object>} 写入后的状态
 */
export async function saveGroupSyncState(username, groupId, patch) {
	return withAsyncMutex(`group-sync:${compositeKey(username, groupId)}`, async () => {
		const next = { ...await loadGroupSyncState(username, groupId), ...patch }
		await writeJsonAtomicSynced(groupSyncStatePath(username, groupId), next)
		return next
	})
}

/**
 * 记录本次离线开始时刻（关客户端/退群前调用）。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {number} [wallMs=Date.now()] 离线起始 wall 时间戳
 * @returns {Promise<object>} 更新后的 syncState
 */
export async function markGroupOfflineStarted(username, groupId, wallMs = Date.now()) {
	return saveGroupSyncState(username, groupId, {
		offlineStartUtcMonth: archiveMonthKey(wallMs),
	})
}

/**
 * 上线 DAG 同步成功后更新末帧 tipsHash。
 * 不清除 `offlineStartUtcMonth`：冷归档补拉与 DAG catchup 不是同一件事，
 * 标记由 `pullOfflineStartUtcMonthArchives` 在该月文件齐了之后清掉。
 * @param {string} username replica
 * @param {string} groupId 群 ID
 * @param {string} tipsHash 本地 `local_tips_hash`
 * @returns {Promise<object>} 更新后的状态
 */
export async function markGroupOnlineSynced(username, groupId, tipsHash) {
	return saveGroupSyncState(username, groupId, {
		tipsHashAtLastSync: tipsHash.trim(),
	})
}
