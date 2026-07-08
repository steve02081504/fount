/**
 * 【文件】broadcast.mjs — 群 WebSocket 事件广播
 * 【职责】向群 WS 房间推送聊天 UI 事件（message_deleted/edited 等）；对 VOLATILE 流式块附加签名后广播（§6.4）。
 * 【原理】broadcastGroupEvent 根据 groupMetadatas 解析 owner 得到 resolveGroupWsRoomKey；broadcastSignedGroupVolatile 经 attachStreamVolatileSignature 签名后发到 replica 专属房间。
 * 【数据结构】事件对象 { type, payload }；签名后的 stream_chunk 等载荷。
 * 【关联】groupWsHub、groupWsRooms、wsLifecycle.groupMetadatas、triggerReply（stream_chunk）。
 */
/** @typedef {import('../../../../../../../decl/charAPI.ts').CharAPI_t} CharAPI_t */
/** @typedef {import('../../../../../../../decl/worldAPI.ts').WorldAPI_t} WorldAPI_t */
/** @typedef {import('../../../../../../../decl/userAPI.ts').UserAPI_t} UserAPI_t */
/** @typedef {import('../../../../../../../decl/pluginAPI.ts').PluginAPI_t} PluginAPI_t */
/** @typedef {import('../../../../../../../decl/basedefs.ts').locale_t} locale_t */

import { broadcastEvent } from '../ws/groupWsBroadcast.mjs'
import { groupWsRoomKeyForReplica, resolveGroupWsRoomKey } from '../ws/groupWsRooms.mjs'
import { attachStreamVolatileSignature } from '../ws/signing.mjs'

import { groupMetadatas } from './wsLifecycle.mjs'

/**
 * 广播带签名的 VOLATILE 群流事件（§6.4）。
 * @param {string} username 签名用户
 * @param {string} groupId 群 ID
 * @param {object} payload 原始载荷
 * @returns {Promise<void>}
 */
export async function broadcastSignedGroupVolatile(username, groupId, payload) {
	const signed = await attachStreamVolatileSignature(username, payload)
	broadcastEvent(groupWsRoomKeyForReplica(groupId), signed)
}

/**
 * @param {string} groupId 群组 ID
 * @param {object} event 广播事件
 */
export function broadcastGroupEvent(groupId, event) {
	const owner = groupMetadatas.get(groupId)?.username
	broadcastEvent(resolveGroupWsRoomKey(groupId, owner), event)
}
