/**
 * 【文件】public/hub/sidebar/federationRoom.mjs
 * 【职责】切群/切频道时安静重绑联邦分区房间。
 */
import { rebindFederationRoom } from '../../src/endpoints/groupFederation.mjs'
import { handleError } from '/scripts/features/errorHandlers.mjs'

/**
 * 后台重绑联邦分区房间；失败经 handleError 上报。
 * @param {string} groupId 群 ID
 * @param {{ channelId?: string | null }} [options] 活跃频道
 * @returns {Promise<void>}
 */
export async function rebindFederationRoomQuiet(groupId, options = {}) {
	if (!groupId) return
	try {
		await rebindFederationRoom(groupId, options)
	}
	catch (error) {
		handleError('chat.hub.federation.rebindFailed', {
			groupId,
			channelId: options.channelId ?? null,
		}, error)
	}
}
