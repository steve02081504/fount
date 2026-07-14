/**
 * 群 replica 本地闭门羹 / 疑似出局状态（非 DAG，仅本机 UX 与写路径门控）。
 */
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { withAsyncMutex } from 'npm:@steve02081504/fount-p2p/utils/async_mutex'

import { groupDir } from '../chat/lib/paths.mjs'

/** 共识窗口：窗口内收到的 shun 才计入。 */
export const SHUN_CONSENSUS_WINDOW_MS = 5 * 60 * 1000

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} shun_state.json 路径
 */
function shunStatePath(username, groupId) {
	return join(groupDir(username, groupId), 'shun_state.json')
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {string} 进程内写锁键
 */
function shunStateLockKey(username, groupId) {
	return `chat:shun-state:${username}:${groupId}`
}

/**
 * @param {unknown} raw 磁盘 JSON
 * @returns {{ shunsByNode: Record<string, number>, suspectedRemoved: boolean, suspectedAt: number | null, shunnedBy: string[], bannerDismissed: boolean, lastProbeAt: number }} 规范化状态
 */
export function normalizeShunState(raw) {
	const shunsByNode = {}
	for (const [nodeHash, ts] of Object.entries(raw?.shunsByNode || {})) {
		const key = String(nodeHash || '').trim().toLowerCase()
		const at = Number(ts)
		if (key && Number.isFinite(at)) shunsByNode[key] = at
	}

	const shunnedBy = Array.isArray(raw?.shunnedBy)
		? [...new Set(raw.shunnedBy.map(id => String(id).trim().toLowerCase()).filter(Boolean))]
		: []
	return {
		shunsByNode,
		suspectedRemoved: !!raw?.suspectedRemoved,
		suspectedAt: Number.isFinite(Number(raw?.suspectedAt)) ? Number(raw.suspectedAt) : null,
		shunnedBy,
		bannerDismissed: !!raw?.bannerDismissed,
		lastProbeAt: Number.isFinite(Number(raw?.lastProbeAt)) ? Number(raw.lastProbeAt) : 0,
	}
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<ReturnType<typeof normalizeShunState>>} 本地 shun 状态
 */
export async function loadGroupShunState(username, groupId) {
	try {
		const raw = JSON.parse(await readFile(shunStatePath(username, groupId), 'utf8'))
		return normalizeShunState(raw)
	}
	catch {
		return normalizeShunState(null)
	}
}

/**
 * 在进程内写锁下原子地 read-modify-write，避免并发 shun 入站互相覆盖 shunsByNode。
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {(prev: ReturnType<typeof normalizeShunState>) => Partial<ReturnType<typeof normalizeShunState>> | Promise<Partial<ReturnType<typeof normalizeShunState>>>} updater 基于最新状态计算补丁
 * @returns {Promise<ReturnType<typeof normalizeShunState>>} 写入后状态
 */
export async function updateGroupShunState(username, groupId, updater) {
	return withAsyncMutex(shunStateLockKey(username, groupId), async () => {
		const dir = groupDir(username, groupId)
		await mkdir(dir, { recursive: true })
		const prev = await loadGroupShunState(username, groupId)
		const patch = await updater(prev) || {}
		const next = normalizeShunState({ ...prev, ...patch })
		await writeFile(shunStatePath(username, groupId), JSON.stringify(next, null, 2), 'utf8')
		return next
	})
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @param {Partial<ReturnType<typeof normalizeShunState>>} patch 补丁
 * @returns {Promise<ReturnType<typeof normalizeShunState>>} 写入后状态
 */
export async function saveGroupShunState(username, groupId, patch) {
	return updateGroupShunState(username, groupId, () => patch)
}

/**
 * @param {string} username 用户
 * @param {string} groupId 群 ID
 * @returns {Promise<void>}
 */
export async function clearGroupShunState(username, groupId) {
	try {
		await unlink(shunStatePath(username, groupId))
	}
	catch { /* absent */ }
}
