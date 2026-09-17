/**
 * 【文件】public/hub/sidebar/firstOpenableChannel.mjs
 * 【职责】按侧栏顺序解析群内最上侧第一个可打开的频道（跳过根容器、分类与子线程）。
 * 【原理】沿根容器 links 前序遍历（忽略分类折叠态），与 channelListVirtual 的可见行顺序一致。
 * 【关联】hub/sidebar/index.mjs、selectChannel.mjs、friendChat.mjs。
 */
import { isThreadChannel } from '../threadDrawer.mjs'

/**
 * 返回群内最上侧第一个可打开的频道 id；无则 null。
 * @param {object} state 群 state
 * @returns {string | null} 频道 id 或 null
 */
export function firstOpenableChannelId(state) {
	const channels = state?.channels || {}
	const rootChannelId = state?.groupSettings?.rootChannelId || null
	/**
	 * @param {string} parentId 父频道 id
	 * @param {Set<string>} ancestors 当前路径上的频道 id（防环）
	 * @returns {string | null} 首个可打开频道
	 */
	const visit = (parentId, ancestors) => {
		for (const childId of channels?.[parentId]?.links || []) {
			if (ancestors.has(childId)) continue
			const child = channels?.[childId]
			if (!child) continue
			if (child.type === 'category') {
				const found = visit(childId, new Set(ancestors).add(childId))
				if (found) return found
				continue
			}
			if (isThreadChannel(child)) continue
			return childId
		}
		return null
	}
	if (rootChannelId && channels[rootChannelId])
		return visit(rootChannelId, new Set([rootChannelId]))
	// 兼容旧群无 root：按频道表顺序取首个非分类、非线程频道。
	for (const [channelId, channel] of Object.entries(channels))
		if (channel && channel.type !== 'category' && !isThreadChannel(channel)) return channelId
	return null
}
