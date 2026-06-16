import { parseEntityHash } from '../entity_id.mjs'
import { applyNetworkHint } from '../network.mjs'

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
	applyNetworkHint(username, {
		nodeHash: parsed.nodeHash,
		source: 'social:follow',
		kind: 'follow',
		weight: 0.25,
	})
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
	applyNetworkHint(username, {
		nodeHash: parsed.nodeHash,
		source: 'social:mention',
		kind: 'mention',
		weight: 0.15,
	})
}
