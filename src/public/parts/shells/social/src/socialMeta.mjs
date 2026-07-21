import { commitTimelineEvent } from './timeline/append.mjs'
import { getTimelineMaterialized } from './timeline/materialize.mjs'

/**
 * 追加 social_meta 事件更新探索资料。
 * @param {string} username replica 登录名
 * @param {string} entityHash 时间线 owner
 * @param {object} patch 可写字段
 * @param {boolean} [patch.hideFromDiscovery] 是否从探索隐藏
 * @returns {Promise<object>} 物化后的 socialMeta
 */
export async function updateSocialMeta(username, entityHash, patch) {
	/** @type {Record<string, unknown>} */
	const content = {}
	if (patch.hideFromDiscovery !== undefined) content.hideFromDiscovery = patch.hideFromDiscovery
	if (!Object.keys(content).length)
		return (await getTimelineMaterialized(username, entityHash)).socialMeta

	await commitTimelineEvent(username, entityHash, {
		type: 'social_meta',
		content,
	})
	return (await getTimelineMaterialized(username, entityHash)).socialMeta
}
