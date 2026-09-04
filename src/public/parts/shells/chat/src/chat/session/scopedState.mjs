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

import { scopedStatePath } from '../lib/paths.mjs'

/**
 * 读取频道 scoped 状态文件（整个频道所有 char 的分块）。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<Record<string, { memory: object, workdir?: object }>>} charname → 状态分块；文件不存在时 {}
 */
async function readScopedState(username, groupId, channelId) {
	try {
		const raw = JSON.parse(await readFile(scopedStatePath(username, groupId, channelId), 'utf8'))
		return raw && typeof raw === 'object' ? raw : {}
	}
	catch {
		return {}
	}
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
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @returns {Promise<{ memory: object, workdir: object | undefined }>} 记忆缺省 {}；workdir 未设置时 undefined
 */
export async function getScopedCharState(username, groupId, channelId, charname) {
	if (!charname) return { memory: {}, workdir: undefined }
	const entry = (await readScopedState(username, groupId, channelId))[charname]
	return {
		memory: entry?.memory && typeof entry.memory === 'object' ? entry.memory : {},
		workdir: entry?.workdir && typeof entry.workdir === 'object' ? entry.workdir : undefined,
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
	if (!charname) return
	const state = await readScopedState(username, groupId, channelId)
	const entry = state[charname] || {}
	state[charname] = { ...entry, memory: memory && typeof memory === 'object' ? memory : {} }
	await writeScopedState(username, groupId, channelId, state)
}

/**
 * 快照某 char 在频道的工作目录目标（整个 workdir 对象，含 machine 与 path；未生成 round 则沿用请求构建者的传入）。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @param {string} charname 角色名
 * @param {object | undefined} workdir 就地 mutate 后的 workdir 对象 `({ machine?, machineId?, path? })`；undefined 为清除
 * @returns {Promise<void>}
 */
export async function saveScopedWorkdir(username, groupId, channelId, charname, workdir) {
	const state = await readScopedState(username, groupId, channelId)
	const entry = { ...state[charname] || {} }
	if (workdir && typeof workdir === 'object') entry.workdir = workdir
	else delete entry.workdir
	if (Object.keys(entry).length) state[charname] = entry
	else delete state[charname]
	await writeScopedState(username, groupId, channelId, state)
}

/**
 * 删除频道全部 scoped 状态（频道删除时 GC）。
 * @param {string} username replica 所有者
 * @param {string} groupId 群 ID
 * @param {string} channelId 频道 ID
 * @returns {Promise<void>}
 */
export async function clearScopedState(username, groupId, channelId) {
	if (!username || !groupId || !channelId) return
	await rm(scopedStatePath(username, groupId, channelId), { force: true })
}
