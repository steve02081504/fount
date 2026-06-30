/**
 * 【文件】wsLifecycle.mjs — 群会话 WebSocket 生命周期与内存注册表
 * 【职责】维护 groupId→{ username, chatMetadata } 的全局 Map；启动时扫描用户 groups 目录预注册槽位；绑定 UI WebSocket、空闲卸载、purge；消费 stop_generation 控制帧；中继 WebRTC 信令到同群其它连接。
 * 【原理】registerGroupUiSocket 在连接建立时清除 30 分钟卸载定时器并注册到 groupWsHub；onGroupWsClose 在房间无连接时启动定时器（不中止进行中的生成）；purgeGroupSession 同步中止流式与生成任务。
 * 【数据结构】groupMetadatas（Map）、groupUnloadTimers（Map<groupId, Timeout>）、GROUP_UNLOAD_TIMEOUT；由 session.mjs 注入的 deleteGroupHook / isVividGroupHook。
 * 【关联】session.mjs、generationAbort.mjs、groupWsHub、groupWsRooms、crud.deleteGroup。
 */
import fs from 'node:fs'

import { ms } from '../../../../../../../scripts/ms.mjs'
import { getAllUserNames } from '../../../../../../../server/auth.mjs'
import { shellChatRoot } from '../lib/paths.mjs'
import { getLocalNodeHash } from '../lib/replica.mjs'
import { broadcastEvent, countGroupSockets, registerSocket } from '../stream/groupWsHub.mjs'
import {
	registerGroupReplicaForUser,
	resolveGroupWsRoomKey,
} from '../stream/groupWsRooms.mjs'

import { abortAllGenerations, abortGenerationByMessageId } from './generationAbort.mjs'

/** @type {Map<string, { username: string, chatMetadata: object | null }>} */
export const groupMetadatas = new Map()

const groupUnloadTimers = new Map()
const GROUP_UNLOAD_TIMEOUT = ms('30m')

/** @type {(groupIds: string[], username: string) => Promise<void>} */
let deleteGroupHook = async () => { }
/** @type {(metadata: object | null) => boolean} */
let isVividGroupHook = () => false
/** @type {(username: string, groupId: string) => Promise<boolean>} */
let isLocallyOwnedGroupHook = async () => false

/**
 * @param {object} hooks 会话卸载钩子（由 session.mjs 在加载时注入）
 * @param {(groupIds: string[], username: string) => Promise<void>} hooks.deleteGroup 删除会话
 * @param {(metadata: object | null) => boolean} hooks.isVividGroup 是否保留在内存
 * @param {(username: string, groupId: string) => Promise<boolean>} hooks.isLocallyOwnedGroup 是否本地自建群
 */
export function bindSessionUnloadHooks({ deleteGroup, isVividGroup, isLocallyOwnedGroup }) {
	deleteGroupHook = deleteGroup
	isVividGroupHook = isVividGroup
	isLocallyOwnedGroupHook = isLocallyOwnedGroup
}

/**
 * 启动时扫描 groups 目录，登记群 runtime 槽位。
 */
export function initializeGroupMetadatas() {
	for (const user of getAllUserNames()) {
		const base = `${shellChatRoot(user)}/groups`
		try {
			if (!fs.existsSync(base)) continue
			for (const name of fs.readdirSync(base)) {
				const full = `${base}/${name}`
				if (!fs.statSync(full).isDirectory()) continue
				if (!groupMetadatas.has(name)) {
					groupMetadatas.set(name, { username: user, chatMetadata: null })
					registerGroupReplicaForUser(name)
				}
			}
		}
		catch { /* no groups yet */ }
	}
}

/**
 * @param {string} replicaUsername 本地 replica 所有者
 * @param {string} groupId 群组 ID
 * @param {import('npm:ws').WebSocket} ws WebSocket 实例
 */
export function registerGroupUiSocket(replicaUsername, groupId, ws) {
	registerGroupReplicaForUser(groupId)
	const roomKey = resolveGroupWsRoomKey(groupId, getLocalNodeHash())
	if (groupUnloadTimers.has(groupId)) {
		clearTimeout(groupUnloadTimers.get(groupId))
		groupUnloadTimers.delete(groupId)
	}
	registerSocket(roomKey, ws)
	ws.on('close', () => {
		queueMicrotask(() => {
			if (countGroupSockets(roomKey) > 0) return
			onGroupWsClose(groupId)
		})
	})
}

/**
 * 从内存移除群会话状态（退群 / 删群 / 删会话时调用）。
 * @param {string} groupId 群 ID
 * @returns {void}
 */
export function purgeGroupSession(groupId) {
	const timer = groupUnloadTimers.get(groupId)
	if (timer) {
		clearTimeout(timer)
		groupUnloadTimers.delete(groupId)
	}
	abortAllGenerations(groupId)
	groupMetadatas.delete(groupId)
}

/**
 * @param {string} groupId 群组 ID
 */
export function onGroupWsClose(groupId) {
	const chatData = groupMetadatas.get(groupId)
	if (!chatData) return
	// UI 断开不等于用户取消生成；后台继续跑，终稿写入 DAG 后切回可见
	clearTimeout(groupUnloadTimers.get(groupId))
	groupUnloadTimers.set(groupId, setTimeout(async () => {
		try {
			if (countGroupSockets(resolveGroupWsRoomKey(groupId)) > 0) return
			if (!chatData) return
			let owned = true
			try {
				owned = await isLocallyOwnedGroupHook(chatData.username, groupId)
			}
			catch { /* 判定失败时不删盘 */ }
			if (owned || isVividGroupHook(chatData.chatMetadata))
				chatData.chatMetadata = null
			else await deleteGroupHook([groupId], chatData.username)
		}
		finally {
			groupUnloadTimers.delete(groupId)
		}
	}, GROUP_UNLOAD_TIMEOUT))
}

/**
 * @param {object} controlFrame 已解析 JSON
 * @returns {boolean} true 表示已消费
 */
export function handleClientWsControlFrame(controlFrame) {
	if (controlFrame?.type !== 'stop_generation' || !controlFrame.payload) return false
	const { messageId, dagEventId } = controlFrame.payload
	if (messageId)
		abortGenerationByMessageId(messageId)
	if (dagEventId && dagEventId !== messageId)
		abortGenerationByMessageId(dagEventId)
	return true
}

/**
 * 中继客户端 WebRTC 信令（`webrtc_signal`）到同群其它 WS 连接。
 * @param {string} groupId 群组 ID
 * @param {object} wireMessage 已解析 JSON
 * @returns {boolean} true 表示已消费
 */
export function relayClientWebRtcSignal(groupId, wireMessage) {
	if (wireMessage?.type !== 'webrtc_signal') return false
	if (!wireMessage.channelId || !wireMessage.from) return true
	broadcastEvent(resolveGroupWsRoomKey(groupId), wireMessage)
	return true
}
