/**
 * 【文件】lib/channelId.mjs
 * 【职责】频道 id 校验、默认值解析及按群物化状态解析有效频道（1–127 `\w.-`）。
 * 【原理】CHANNEL_ID_RE 正则；resolveChannelId 非法回退 default；resolveGroupChannelId 读 settings/channels；
 *   firstOpenableChannelId 沿根容器 links 前序取首个非分类/非线程频道（群允许无默认频道）。
 * 【数据结构】无持久化；resolveGroupChannelId 可返回 null（群无可用频道）。
 * 【关联】paths messagesPath、contextSidecar、postMessage；materialize state.channels。
 */
import { getState } from '../dag/materialize.mjs'

/** 频道 / 侧车目录名（1–127 字符，`\w`、`.`、`-`）。 */
export const CHANNEL_ID_RE = /^[\w.-]{1,127}$/u

/**
 * @param {unknown} value 候选频道 id
 * @returns {boolean} 合法时为 true（`null` / `undefined` 为 false）
 */
export function isChannelIdValid(value) {
	return value != null && CHANNEL_ID_RE.test(value)
}

/**
 * 取值并校验，永远返回合法频道 id 字符串。
 * @param {unknown} value 候选频道 id
 * @param {string} [defaultChannelId] 非法时的默认值
 * @returns {string} 合法频道 id 或 defaultChannelId
 */
export function resolveChannelId(value, defaultChannelId = 'default') {
	return isChannelIdValid(value) ? value : defaultChannelId
}

/**
 * 返回群内最上侧第一个可打开的频道 id（与侧栏顺序一致）：
 * 沿根容器 `links` 前序遍历，跳过根容器自身、分类（category）与子线程；无则 null。
 * @param {object} state 物化群状态
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
			if (child.parentEventId) continue
			return childId
		}
		return null
	}
	if (rootChannelId && channels[rootChannelId])
		return visit(rootChannelId, new Set([rootChannelId]))
	// 兼容旧群无 root：按频道表顺序取首个非分类、非线程频道。
	for (const [channelId, channel] of Object.entries(channels))
		if (channel && channel.type !== 'category' && !channel.parentEventId) return channelId
	return null
}

/**
 * 治理/权限折叠用频道：显式默认 → 根容器 → 频道表首个；均无则 null。
 * @param {object} state 物化群状态
 * @returns {string | null} 频道 id 或 null
 */
export function fallbackChannelId(state) {
	const explicit = state?.groupSettings?.defaultChannelId
	if (explicit && state.channels?.[explicit]) return explicit
	const rootChannelId = state?.groupSettings?.rootChannelId
	if (rootChannelId && state.channels?.[rootChannelId]) return rootChannelId
	return Object.keys(state?.channels || {})[0] || null
}

/**
 * 解析群组内有效频道 id：优先 hint，其次显式默认频道，最后首个可打开频道。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {unknown} [hint] 调用方提供的频道 id
 * @returns {Promise<string | null>} 合法频道 id 或 null（群无可打开频道）
 */
export async function resolveGroupChannelId(username, groupId, hint) {
	if (isChannelIdValid(hint)) return hint
	const { state } = await getState(username, groupId)
	const rootChannelId = state.groupSettings?.rootChannelId
	const explicitDefault = state.groupSettings?.defaultChannelId
	if (isChannelIdValid(explicitDefault) && explicitDefault !== rootChannelId && state.channels?.[explicitDefault])
		return explicitDefault
	return firstOpenableChannelId(state)
}
