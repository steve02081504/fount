/**
 * 【文件】scopedState.mjs — 频道级私域状态（char 记忆 / workdir）
 * 【职责】按 (groupId, channelId, charname) 本地读写角色记忆与工作目录；
 *   存 `groups/{groupId}/scoped_state/{channelId}.json`，不上 DAG / 不联邦复制，群目录删除即 GC。
 * 【原理】单文件整体读 + 原子写（`writeJsonAtomicSynced`）；memory 以引用返回，写回点
 *   在 `triggerReply` 的生成 `finally` 中持久化。
 * 【关联】chat/lib/paths、session/chatRequest、session/triggerReply、dag/channelOperations（频道删除 GC）。
 */
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

import { writeJsonAtomicSynced } from 'npm:@steve02081504/fount-p2p/dag/storage'

import { isChannelIdValid } from '../lib/channelId.mjs'
import { scopedStatePath } from '../lib/paths.mjs'

/**
 * 读取频道 scoped 状态文件（整个频道所有 char 的分块）。
 * 仅文件缺失（ENOENT）返回空态；JSON 解析错误或其它读取错误一律向上抛出，
 * 避免 saveScopedMemory / saveScopedWorkdir 用空态整体覆盖损坏的频道状态。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<Record<string, { memory: object, workdir?: object }>>} charname → 状态分块；文件不存在时 {}
 */
async function readScopedState(username, groupId, channelId) {
	try {
		const raw = JSON.parse(await readFile(scopedStatePath(username, groupId, channelId), 'utf8'))
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TypeError('scoped state must be a JSON object')
		return raw
	}
	catch (error) {
		if (error?.code === 'ENOENT') return {}
		throw error
	}
}

/**
 * 同频道 scoped-state 修改的串行队列：读、改、写在同一队列中依次完成，
 * 不同频道之间各自独立队列，仍可并行处理。
 * @type {Map<string, Promise<unknown>>}
 */
const channelMutexes = new Map()

/** 已删除频道的失效标记：删除完成后任何已排队或后续的 scoped 写入都跳过，避免重建已删频道的状态。 */
const deletedChannelKeys = new Set()

/**
 * 频道级串行队列键。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {string} 队列键
 */
const channelKey = (username, groupId, channelId) => `${username}\u0000${groupId}\u0000${channelId}`

/**
 * 频道重建时清除删除失效标记，恢复该频道的 scoped 写入。
 * 与 clearScopedState 共用频道串行队列：激活排在任何待执行的清除之后依次完成，
 * 避免「先删标记 → 清除执行再置标记」导致重建频道的 scoped 写入被误跳过。
 * 排队中的 clearScopedState（或其它先序操作）失败时不吞掉错误：保留删除失效标记，
 * 并让本调用拒绝，调用方据此中止频道创建，避免为清理失败的频道恢复 scoped 写入。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>} 激活完成
 */
export function markScopedStateChannelActive(username, groupId, channelId) {
	if (!isChannelIdValid(channelId)) return Promise.reject(new TypeError(`invalid channelId: ${String(channelId)}`))
	const key = channelKey(username, groupId, channelId)
	const prev = channelMutexes.get(key) ?? Promise.resolve()
	const next = prev
		.then(() => {
			deletedChannelKeys.delete(key)
		})
	channelMutexes.set(key, next)
	/** 队列完成（含失败）后若仍是本链则移除。 */
	const cleanup = () => { if (channelMutexes.get(key) === next) channelMutexes.delete(key) }
	next.then(cleanup, cleanup)
	return next
}

/**
 * 在指定频道的串行队列上执行一次「读 → 改 → 写」的 scoped 状态修改。
 * 非法 channelId 立即拒绝（不进入文件路径）；已删除频道的写入跳过（防重建状态）。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {(state: Record<string, { memory: object, workdir?: object }>, charname: string) => void} mutate 对分块状态的修改；无 char 时直接返回以跳过写入
 * @param {string} charname 角色名
 * @returns {Promise<void>} 修改完成
 */
export function withScopedStateMutex(username, groupId, channelId, mutate, charname) {
	if (!isChannelIdValid(channelId)) return Promise.reject(new TypeError(`invalid channelId: ${String(channelId)}`))
	const key = channelKey(username, groupId, channelId)
	if (deletedChannelKeys.has(key)) return Promise.resolve()
	const prev = channelMutexes.get(key) ?? Promise.resolve()
	const next = prev
		.catch(() => {})
		.then(async () => {
			if (deletedChannelKeys.has(key)) return
			if (!charname) return
			const state = await readScopedState(username, groupId, channelId)
			mutate(state, charname)
			await writeScopedState(username, groupId, channelId, state)
		})
	channelMutexes.set(key, next)
	/** 队列完成（含失败）后若仍是本链则移除。 */
	const cleanup = () => { if (channelMutexes.get(key) === next) channelMutexes.delete(key) }
	next.then(cleanup, cleanup)
	return next
}

/**
 * 一次读改写同时持久化某 char 的 memory 与 workdir（同一队列内原子完成，
 * 避免 saveScopedMemory 与 saveScopedWorkdir 各自读全量再写导致字段互相覆盖）。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {{ memory?: object, workdir?: object }} values 要写入的值；对应字段缺省表示不修改
 * @returns {Promise<void>}
 */
export function saveScopedState(username, groupId, channelId, charname, values) {
	return withScopedStateMutex(username, groupId, channelId, (state, char) => {
		if (values.memory !== undefined && (values.memory == null || typeof values.memory !== 'object'))
			throw new TypeError('scoped state memory must be a non-null object')
		if (values.workdir !== undefined && (values.workdir == null || typeof values.workdir !== 'object'))
			throw new TypeError('scoped state workdir must be a non-null object')
		const entry = { ...state[char] }
		if (values.memory !== undefined) entry.memory = values.memory
		if (values.workdir !== undefined) entry.workdir = values.workdir
		if (Object.keys(entry).length) state[char] = entry
		else delete state[char]
	}, charname)
}

/**
 * 写回频道 scoped 状态文件（原子上传整个文件）。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {Record<string, { memory: object, workdir?: object }>} state 状态分块
 * @returns {Promise<void>}
 */
async function writeScopedState(username, groupId, channelId, state) {
	const path = scopedStatePath(username, groupId, channelId)
	await mkdir(dirname(path), { recursive: true })
	await writeJsonAtomicSynced(path, state)
}

/**
 * 读取某 char 在频道的私域状态：本地记忆与工作目录；无 char（无角色视角）时返回空态。
 * 与 saveScopedState 对齐：持久化的 workdir 若存在则必须是合法对象，非法值抛错而非缺省，
 * 避免聊天请求静默丢失持久化的 machine/path 数据。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @returns {Promise<{ memory: object, workdir: object | undefined }>} 记忆缺省 {}；workdir 未设置时 undefined
 */
export async function getScopedCharState(username, groupId, channelId, charname) {
	if (!isChannelIdValid(channelId)) throw new TypeError(`invalid channelId: ${String(channelId)}`)
	if (!charname) return { memory: {}, workdir: undefined }
	const entry = (await readScopedState(username, groupId, channelId))[charname]
	if (entry?.workdir !== undefined && (entry.workdir == null || typeof entry.workdir !== 'object'))
		throw new TypeError('scoped state workdir must be a non-null object')
	return {
		memory: entry?.memory && typeof entry.memory === 'object' ? entry.memory : {},
		workdir: entry?.workdir === undefined ? undefined : entry.workdir,
	}
}

/**
 * 持久化某 char 在频道本轮回合后的记忆（生成结束时写回）。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {object} memory 角色就地 mutate 后的记忆对象
 * @returns {Promise<void>}
 */
export async function saveScopedMemory(username, groupId, channelId, charname, memory) {
	return saveScopedState(username, groupId, channelId, charname, { memory })
}

/**
 * 快照某 char 在频道的工作目录目标（整个 workdir 对象，含 machine 与 path；未生成 round 则沿用请求构建者的传入）。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {object | undefined} workdir 就地 mutate 后的 workdir 对象 `({ machine?, machineId?, path? })`；undefined 表示不修改
 * @returns {Promise<void>}
 */
export async function saveScopedWorkdir(username, groupId, channelId, charname, workdir) {
	return saveScopedState(username, groupId, channelId, charname, { workdir })
}

/**
 * 删除频道全部 scoped 状态（频道删除时 GC）。
 * 与读改写共用频道串行队列（同一顺序执行），删除时置频道级失效标记；
 * 删除完成后任何已排队或后续的写入都检查该标记并跳过，避免重建已删频道的状态。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function clearScopedState(username, groupId, channelId) {
	if (!isChannelIdValid(channelId)) throw new TypeError(`invalid channelId: ${String(channelId)}`)
	const key = channelKey(username, groupId, channelId)
	const prev = channelMutexes.get(key) ?? Promise.resolve()
	const next = prev
		.catch(() => {})
		.then(async () => {
			deletedChannelKeys.add(key)
			await rm(scopedStatePath(username, groupId, channelId), { force: true })
		})
	channelMutexes.set(key, next)
	/** 队列完成（含失败）后若仍是本链则移除。 */
	const cleanup = () => { if (channelMutexes.get(key) === next) channelMutexes.delete(key) }
	next.then(cleanup, cleanup)
	await next
}
