/**
 * 【文件】lib/channelId.mjs
 * 【职责】频道 id 校验、默认值解析及按群物化状态解析有效频道（1–127 `\w.-`）。
 * 【原理】CHANNEL_ID_RE 正则；resolveChannelId 非法回退 default；resolveGroupChannelId 读 settings/channels。
 * 【数据结构】无持久化；返回合法 channelId 字符串。
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
	return value != null && CHANNEL_ID_RE.test(String(value).trim())
}

/**
 * 取值并校验，永远返回合法频道 id 字符串。
 * @param {unknown} value 候选频道 id
 * @param {string} [defaultChannelId] 非法时的默认值
 * @returns {string} 合法频道 id 或 defaultChannelId
 */
export function resolveChannelId(value, defaultChannelId = 'default') {
	return isChannelIdValid(value) ? String(value).trim() : defaultChannelId
}

/**
 * 解析群组内有效频道 id：优先 hint，其次 groupSettings / channels 键。
 * @param {string} username 所有者
 * @param {string} groupId 群 ID
 * @param {unknown} [hint] 调用方提供的频道 id
 * @returns {Promise<string>} 合法频道 id
 */
export async function resolveGroupChannelId(username, groupId, hint) {
	if (isChannelIdValid(hint)) return String(hint).trim()
	const { state } = await getState(username, groupId)
	const fromSettings = state.groupSettings?.defaultChannelId
	const fromChannels = Object.keys(state.channels || {})[0]
	return resolveChannelId(fromSettings, resolveChannelId(fromChannels))
}
