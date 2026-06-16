import { getDefaultChannelId } from '../chat/dag/queries.mjs'
import { getGroupRuntime } from '../chat/session/runtime.mjs'

/**
 * @param {string} groupId 群组 ID
 * @param {string | undefined} channelId 显式频道；缺省时取群默认频道
 * @param {string} replicaUsername replica 所有者
 * @returns {Promise<string>} 有效频道 ID
 */
export async function resolveGroupChannel(groupId, channelId, replicaUsername) {
	const meta = await getGroupRuntime(groupId, replicaUsername)
	if (channelId) return channelId
	return getDefaultChannelId(replicaUsername, groupId)
}

/**
 * @param {unknown} value query/body 中的频道 id
 * @returns {string | undefined} 非空 trimmed 字符串，否则 undefined
 */
export function optionalChannelId(value) {
	return value?.trim() || undefined
}
