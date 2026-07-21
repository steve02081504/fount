import { parseEntityHash } from 'npm:@steve02081504/fount-p2p/core/entity_id'
import { applyNetworkHint } from 'npm:@steve02081504/fount-p2p/node/network'

/**
 * 关注/取关后为被关注实体的 nodeHash 写入 explore 扩边 hint。
 * @param {string} username replica 登录名
 * @param {string} targetEntityHash 128 hex
 * @param {boolean} follow true=关注
 * @returns {void}
 */
export function applyFollowNetworkHints(username, targetEntityHash, follow) {
	if (!follow) return
	const parsed = parseEntityHash(targetEntityHash)
	if (!parsed) return
	applyNetworkHint({
		nodeHash: parsed.nodeHash,
		source: 'social:follow',
		kind: 'follow',
		weight: 0.25,
	})
	import('npm:@steve02081504/fount-p2p/transport/remote_user_room').then(({ ensureRemoteUserRoom }) =>
		ensureRemoteUserRoom(username, parsed.nodeHash),
	).catch(err => console.warn('social: ensureRemoteUserRoom after follow failed', err))
}

/**
 * 帖子 @ 提及后为被提及实体的 nodeHash 写入 explore 扩边 hint。
 * @param {string} username replica 登录名
 * @param {string} entityHash 128 hex
 * @returns {void}
 */
export function applyMentionNetworkHint(username, entityHash) {
	const parsed = parseEntityHash(entityHash)
	if (!parsed) return
	applyNetworkHint({
		nodeHash: parsed.nodeHash,
		source: 'social:mention',
		kind: 'mention',
		weight: 0.15,
	})
}
