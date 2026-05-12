import fs from 'node:fs'
import path from 'node:path'
import { topologicalSort } from './dag.mjs'
import { buildStateFromEvents, applyEvent } from './materialized_state.mjs'

/**
 * Checkpoint 管理
 * 负责 Checkpoint 的生成、签发、验证
 */

const CHECKPOINT_DIR = path.join(process.cwd(), 'data', 'checkpoints')

/**
 * 确保目录存在
 * @param {string} dir - 目录路径
 */
function ensureDir(dir) {
	if (!fs.existsSync(dir)) {
		fs.mkdirSync(dir, { recursive: true })
	}
}

/**
 * 创建 Checkpoint
 * @param {object} state - 物化状态
 * @param {Array} events - 事件列表
 * @returns {object}
 */
export function createCheckpoint(state, events) {
	// 计算成员分页
	const members = Object.values(state.members).filter(m => m.status === 'active')
	const membersPerPage = 500
	const pagesCount = Math.ceil(members.length / membersPerPage)

	// 计算 Epoch root hash
	const epochRootHash = calculateEpochRootHash(events)

	// 转换 messageOverlay 为可序列化格式
	const serializableOverlay = {
		deletedIds: Array.from(state.messageOverlay.deletedIds),
		editHistory: Array.from(state.messageOverlay.editHistory.entries()),
		reactionCounts: Array.from(state.messageOverlay.reactionCounts.entries()),
		pins: Array.from(state.messageOverlay.pins.entries()),
		fileIndex: Array.from(state.messageOverlay.fileIndex.entries())
	}

	const checkpoint = {
		groupId: state.groupId,
		home_node_id: state.home_node_id,
		members_root: calculateMembersRoot(members),
		members_pages_count: pagesCount,
		members_page_0: pagesCount === 1 ? members : members.slice(0, membersPerPage),
		roles: state.roles,
		channelPermissions: state.channelPermissions,
		channels: state.channels,
		fileFolders: state.fileFolders,
		groupMeta: state.groupMeta,
		groupSettings: state.groupSettings,
		messageOverlay: serializableOverlay,
		checkpoint_event_id: state.checkpoint_event_id,
		epoch_id: state.epoch_id,
		epoch_root_hash: epochRootHash,
		created_at: Date.now()
	}

	return checkpoint
}

/**
 * 计算 Epoch root hash
 * @param {Array} events - 事件列表
 * @returns {string}
 */
function calculateEpochRootHash(events) {
	if (events.length === 0) return null

	const eventIds = events.map(e => e.id).sort()
	const combined = eventIds.join('')
	const encoder = new TextEncoder()
	const data = encoder.encode(combined)

	return crypto.subtle.digest('SHA-256', data).then(hash =>
		Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
	)
}

/**
 * 计算成员 Merkle root
 * @param {Array} members - 成员列表
 * @returns {string}
 */
function calculateMembersRoot(members) {
	if (members.length === 0) return null

	const hashes = members.map(m => {
		const data = JSON.stringify(m)
		const encoder = new TextEncoder()
		return crypto.subtle.digest('SHA-256', encoder.encode(data))
	})

	return Promise.all(hashes).then(results => {
		const combined = results.map(r =>
			Array.from(new Uint8Array(r)).map(b => b.toString(16).padStart(2, '0')).join('')
		).join('')

		const encoder = new TextEncoder()
		return crypto.subtle.digest('SHA-256', encoder.encode(combined)).then(hash =>
			Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('')
		)
	})
}

/**
 * 保存 Checkpoint
 * @param {string} groupId - 群组ID
 * @param {object} checkpoint - Checkpoint 对象
 * @returns {Promise<void>}
 */
export async function saveCheckpoint(groupId, checkpoint) {
	ensureDir(CHECKPOINT_DIR)
	const checkpointPath = path.join(CHECKPOINT_DIR, `${groupId}.json`)

	// 等待异步哈希计算完成
	if (checkpoint.members_root instanceof Promise) {
		checkpoint.members_root = await checkpoint.members_root
	}
	if (checkpoint.epoch_root_hash instanceof Promise) {
		checkpoint.epoch_root_hash = await checkpoint.epoch_root_hash
	}

	await fs.promises.writeFile(checkpointPath, JSON.stringify(checkpoint, null, 2))
}

/**
 * 加载 Checkpoint
 * @param {string} groupId - 群组ID
 * @returns {Promise<object|null>}
 */
export async function loadCheckpoint(groupId) {
	const checkpointPath = path.join(CHECKPOINT_DIR, `${groupId}.json`)

	if (!fs.existsSync(checkpointPath)) {
		return null
	}

	const data = await fs.promises.readFile(checkpointPath, 'utf-8')
	const checkpoint = JSON.parse(data)

	// 恢复 messageOverlay 为 Map 和 Set
	checkpoint.messageOverlay = {
		deletedIds: new Set(checkpoint.messageOverlay.deletedIds),
		editHistory: new Map(checkpoint.messageOverlay.editHistory),
		reactionCounts: new Map(checkpoint.messageOverlay.reactionCounts),
		pins: new Map(checkpoint.messageOverlay.pins),
		fileIndex: new Map(checkpoint.messageOverlay.fileIndex)
	}

	return checkpoint
}

/**
 * 获取成员分页
 * @param {string} groupId - 群组ID
 * @param {number} pageIndex - 页码
 * @returns {Promise<Array>}
 */
export async function getMembersPage(groupId, pageIndex) {
	const checkpoint = await loadCheckpoint(groupId)
	if (!checkpoint) return []

	if (pageIndex === 0 && checkpoint.members_page_0) {
		return checkpoint.members_page_0
	}

	// 从完整成员列表中分页
	const membersPath = path.join(CHECKPOINT_DIR, `${groupId}_members.json`)
	if (!fs.existsSync(membersPath)) return []

	const data = await fs.promises.readFile(membersPath, 'utf-8')
	const allMembers = JSON.parse(data)

	const membersPerPage = 500
	const start = pageIndex * membersPerPage
	const end = start + membersPerPage

	return allMembers.slice(start, end)
}

/**
 * 保存完整成员列表
 * @param {string} groupId - 群组ID
 * @param {Array} members - 成员列表
 * @returns {Promise<void>}
 */
export async function saveMembers(groupId, members) {
	ensureDir(CHECKPOINT_DIR)
	const membersPath = path.join(CHECKPOINT_DIR, `${groupId}_members.json`)
	await fs.promises.writeFile(membersPath, JSON.stringify(members, null, 2))
}

/**
 * 验证 Checkpoint 完整性
 * @param {object} checkpoint - Checkpoint 对象
 * @param {Array} events - 事件列表
 * @returns {Promise<boolean>}
 */
export async function verifyCheckpoint(checkpoint, events) {
	const calculatedHash = await calculateEpochRootHash(events)
	return calculatedHash === checkpoint.epoch_root_hash
}

/**
 * 从 Checkpoint 恢复状态
 * @param {object} checkpoint - Checkpoint 对象
 * @returns {object}
 */
export function restoreStateFromCheckpoint(checkpoint) {
	return {
		groupId: checkpoint.groupId,
		home_node_id: checkpoint.home_node_id,
		members: checkpoint.members_page_0.reduce((acc, m) => {
			acc[m.pubKeyHash] = m
			return acc
		}, {}),
		members_root: checkpoint.members_root,
		members_pages_count: checkpoint.members_pages_count,
		roles: checkpoint.roles,
		channelPermissions: checkpoint.channelPermissions,
		channels: checkpoint.channels,
		fileFolders: checkpoint.fileFolders,
		groupMeta: checkpoint.groupMeta,
		groupSettings: checkpoint.groupSettings,
		messageOverlay: checkpoint.messageOverlay,
		checkpoint_event_id: checkpoint.checkpoint_event_id,
		epoch_id: checkpoint.epoch_id,
		epoch_root_hash: checkpoint.epoch_root_hash,
		bannedMembers: new Set()
	}
}
