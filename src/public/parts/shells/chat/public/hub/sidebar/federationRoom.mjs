/**
 * 【文件】public/hub/sidebar/federationRoom.mjs
 * 【职责】切群/切频道时安静重绑联邦分区房间。
 */
import { rebindFederationRoom } from '../../src/api/groupFederation.mjs'
import { toError } from '../../src/ui/errors.mjs'

/**
 * 后台重绑联邦分区房间；失败写入 debug 日志，不打扰切频道 UX。
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
		const err = toError(error)
		import('https://esm.sh/@sentry/browser')
			.then(Sentry => Sentry.captureException(err))
			.catch(() => { })
		console.error('hub_federation_rebind', {
			groupId,
			channelId: options.channelId ?? null,
			error: err.message,
		})
	}
}
